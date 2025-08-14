/**
 * Node Helper for MMM-ShareToMirror
 * Handles HTTP server, API endpoints, and YouTube URL parsing
 * @author Smart'Gic
 * @license Apache-2
 * @version 1.7.0
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const zlib = require("zlib");
const NodeHelper = require("node_helper");
const express = require("express");
const multer = require("multer");

/* -------------------- YouTube ID parse -------------------- */
function parseYouTubeId (input) {
  if (!input || typeof input !== "string") return null;
  const s = input.trim();

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
    /^([a-zA-Z0-9_-]{11})$/i
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1] && m[1].length === 11 && (/^[a-zA-Z0-9_-]+$/).test(m[1])) {
      return m[1];
    }
  }
  return null;
}

/* -------------------- Rate limit -------------------- */
function createRateLimit (windowMs = 60_000, max = 100) {
  const requests = new Map();   // ip -> { count, resetTime }
  let lastCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();

    // Do cleanup at most every 30s
    if (now - lastCleanup > 30_000) {
      for (const [ip, data] of requests.entries()) {
        if (now - data.resetTime > windowMs) requests.delete(ip);
      }
      lastCleanup = now;
    }

    // Express will honor X-Forwarded-For if trust proxy is enabled
    const clientId = req.ip || req.connection?.remoteAddress || "unknown";
    let rec = requests.get(clientId);
    if (!rec || now - rec.resetTime > windowMs) {
      rec = { count: 0, resetTime: now };
      requests.set(clientId, rec);
    }

    if (rec.count >= max) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests",
        retryAfter: Math.ceil((windowMs - (now - rec.resetTime)) / 1000)
      });
    }

    rec.count++;
    next();
  };
}

/* -------------------- Helper -------------------- */
function decodeIfCompressed(response) {
  const enc = (response.headers["content-encoding"] || "").toLowerCase();
  if (enc.includes("br")) return response.pipe(zlib.createBrotliDecompress());
  if (enc.includes("gzip")) return response.pipe(zlib.createGunzip());
  if (enc.includes("deflate")) return response.pipe(zlib.createInflate());
  return response;
}

module.exports = NodeHelper.create({
  start () {
    console.log("[MMM-ShareToMirror] Node helper starting…");
    this.config = null;
    this.server = null;
    this.state = {
      playing: false,
      lastUrl: null,
      lastVideoId: null,
      caption: { enabled: false, lang: "en" },
      quality: { target: "auto", floor: null, ceiling: null, lock: false }
    };
    this.setupErrorHandlers();
  },

  setupErrorHandlers () {
    process.on("uncaughtException", (err) => {
      console.error("[MMM-ShareToMirror] Uncaught Exception:", err);
    });
    process.on("unhandledRejection", (reason, p) => {
      console.error("[MMM-ShareToMirror] Unhandled Rejection at:", p, "reason:", reason);
    });
  },

  socketNotificationReceived (notification, payload) {
    switch (notification) {
      case "STM_START":
        this.handleStart(payload);
        break;
      case "STM_EMBEDDED_STOPPED":
        this.state.playing = false;
        console.log(`[MMM-ShareToMirror] Playback stopped: ${payload?.reason || "unknown"}`);
        break;
    }
  },

  handleStart (config) {
    this.config = this.validateConfig(config);
    if (config?.caption) Object.assign(this.state.caption, config.caption);
    if (config?.quality) Object.assign(this.state.quality, config.quality);
    this.startServer();
  },

  validateConfig (config) {
    const defaults = {
      port: 8570,
      https: { enabled: false, keyPath: "", certPath: "" },
      caption: { enabled: false, lang: "en" },
      quality: { target: "auto", floor: null, ceiling: null, lock: false }
    };

    if (!config || typeof config !== "object") return defaults;

    // Port
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      console.warn("[MMM-ShareToMirror] Invalid port, using default 8570");
      config.port = defaults.port;
    }

    // HTTPS validity
    if (config.https?.enabled && (!config.https.keyPath || !config.https.certPath)) {
      console.warn("[MMM-ShareToMirror] HTTPS enabled but missing key/cert paths, disabling");
      config.https.enabled = false;
    }

    return config;
  },

  startServer () {
    if (this.server) return;

    const app = this.createApp();
    const port = this.config.port;

    try {
      if (this.config.https?.enabled) {
        this.server = this.createHttpsServer(app, port);
        console.log(`[MMM-ShareToMirror] HTTPS server listening on port ${port}`);
      } else {
        this.server = this.createHttpServer(app, port);
        console.log(`[MMM-ShareToMirror] HTTP server listening on port ${port}`);
      }

      this.server.on("error", (err) => {
        console.error("[MMM-ShareToMirror] Server error:", err);
      });
    } catch (err) {
      console.error("[MMM-ShareToMirror] Failed to start server:", err);
    }
  },

  createApp () {
    const app = express();

    // Basics
    app.disable("x-powered-by");
    app.set("trust proxy", true);

    // Security & CSP
    app.use((req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-XSS-Protection", "1; mode=block");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      // Allow self + YouTube embeds; keep inline for our small static UI
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://www.youtube.com",
          "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
          "img-src 'self' data: https:",
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self'",
          "frame-ancestors 'self'"
        ].join("; ")
      );

      // CORS for API routes
      if (req.path.startsWith("/api/") || req.path === "/share-target") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(204).end();
      }

      next();
    });

    // Rate limit first
    app.use(createRateLimit());

    // Body parsers (Express built-ins)
    app.use(express.json({ limit: "1mb" }));
    app.use(express.urlencoded({ extended: true, limit: "1mb" }));

    // Static files for the small UI / PWA (if present)
    app.use(express.static(path.join(__dirname, "public"), {
      extensions: ["html"],
      maxAge: "1d",
      index: ["index.html"]
    }));

    // Routes
    this.setupRoutes(app);

    // Error handler
    app.use((err, req, res, next) => {
      console.error("[MMM-ShareToMirror] Request error:", err);
      if (err?.type === "entity.too.large") {
        return res.status(413).json({ ok: false, error: "Request too large" });
      }
      res.status(500).json({ ok: false, error: "Internal server error" });
    });

    return app;
  },

  setupRoutes (app) {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 1 * 1024 * 1024, fields: 10 }
    });

    // Share target (POST form-data or GET with query)
    const handleShareTarget = (req, res) => {
      const url = req.body?.url || req.body?.text || req.body?.title ||
                  req.query?.url || req.query?.text || req.query?.title;
      const videoId = parseYouTubeId(url);
      if (videoId) this.playVideo(videoId, url);

      const donePage = path.join(__dirname, "public", "done.html");
      if (fs.existsSync(donePage)) return res.sendFile(donePage);
      // Minimal fallback if file missing
      res.type("html").send("<!doctype html><meta charset='utf-8'><title>OK</title><p>Shared to MagicMirror².</p>");
    };

    app.post("/share-target", upload.none(), handleShareTarget);
    app.get("/share-target", handleShareTarget);

    // API
    app.post("/api/play", (req, res) => {
      const videoId = parseYouTubeId(req.body?.url);
      if (!videoId) return res.status(400).json({ ok: false, error: "Invalid YouTube URL" });

      this.playVideo(videoId, req.body.url);
      res.json({ ok: true, mode: "embedded", videoId });
    });

    app.post("/api/stop", (req, res) => {
      this.state.playing = false;
      this.sendSocketNotification("STM_STOP_EMBED", { reason: "api" });
      res.json({ ok: true, message: "Playback stopped" });
    });

    app.post("/api/control", (req, res) => {
      const { action } = req.body || {};
      let { seconds } = req.body || {};
      if (!action) return res.status(400).json({ ok: false, error: "Action is required" });

      const valid = new Set(["pause", "resume", "rewind", "forward"]);
      if (!valid.has(action)) return res.status(400).json({ ok: false, error: "Invalid action" });

      if (action === "rewind" || action === "forward") {
        seconds = Number(seconds) || 10; // default 10s if omitted/invalid
        if (seconds <= 0) return res.status(400).json({ ok: false, error: "Seconds must be > 0" });
      }

      this.sendSocketNotification("STM_VIDEO_CONTROL", { action, seconds });
      res.json({ ok: true, action, seconds: seconds ?? null });
    });

    app.post("/api/options", (req, res) => {
      const updates = {};

      if (req.body?.caption && typeof req.body.caption === "object") {
        updates.caption = {
          enabled: Boolean(req.body.caption.enabled),
          lang: req.body.caption.lang || "en"
        };
        Object.assign(this.state.caption, updates.caption);
      }

      if (req.body?.quality && typeof req.body.quality === "object") {
        updates.quality = {
          target: req.body.quality.target || "auto",
          floor: req.body.quality.floor || null,
          ceiling: req.body.quality.ceiling || null,
          lock: Boolean(req.body.quality.lock)
        };
        Object.assign(this.state.quality, updates.quality);
      }

      if (Object.keys(updates).length) {
        this.sendSocketNotification("STM_OPTIONS", updates);
      }
      res.json({ ok: true, state: this.state, updated: Boolean(Object.keys(updates).length) });
    });

    app.post("/api/overlay", (req, res) => {
      const { action = "toggle" } = req.body || {};
      this.sendSocketNotification("STM_OVERLAY", { action });
      res.json({ ok: true });
    });

    app.get("/api/status", (req, res) => {
      res.json({
        ok: true,
        state: this.state,
        config: {
          port: this.config.port,
          httpsEnabled: !!this.config.https?.enabled
        },
        timestamp: new Date().toISOString()
      });
    });

    app.get("/api/health", (req, res) => {
      res.json({ ok: true, status: "healthy", uptime: process.uptime(), timestamp: new Date().toISOString() });
    });
  },

  /* -------------------- YouTube info helpers -------------------- */
  async fetchYouTubeVideoInfo (videoId) {
    const methods = [
      () => this.fetchVideoInfoFromOEmbed(videoId),
      () => this.fetchVideoInfoFromYouTubeAPI(videoId),
      () => this.fetchVideoInfoFromScraping(videoId)
    ];

    for (const m of methods) {
      try {
        const r = await m();
        if (r && r.title) return r;
      } catch (e) {
        console.warn("[MMM-ShareToMirror] Video info method failed:", e.message);
      }
    }
    return this.createFallbackVideoInfo(videoId);
  },

  async fetchVideoInfoFromOEmbed (videoId) {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        timeout: 3000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MMM-ShareToMirror/1.7.0)" }
      }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`oEmbed API returned status ${res.statusCode}`));
        }
        const stream = decodeIfCompressed(res);
        let data = "";
        stream.on("data", (c) => { data += c; });
        stream.on("end", () => {
          try {
            const j = JSON.parse(data);
            if (!j.title) return reject(new Error("No title in oEmbed response"));
            resolve({
              title: j.title,
              channel: j.author_name || "YouTube",
              thumbnail: j.thumbnail_url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              description: `Video by ${j.author_name || "YouTube"}`,
              duration: null, views: null, likes: null, publishedAt: null,
              category: null, tags: [], quality: "Auto", language: "en", captions: []
            });
          } catch (e) { reject(new Error(`Failed to parse oEmbed: ${e.message}`)); }
        });
      });
      req.on("error", (e) => reject(new Error(`oEmbed request failed: ${e.message}`)));
      req.setTimeout(3000, () => { req.destroy(new Error("oEmbed request timeout")); });
    });
  },

  async fetchVideoInfoFromYouTubeAPI (videoId) {
    if (!this.config?.youtubeApiKey) throw new Error("YouTube API key not configured");
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.config.youtubeApiKey}&part=snippet,statistics,contentDetails`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 5000 }, (res) => {
        const stream = decodeIfCompressed(res);
        let data = "";
        stream.on("data", (c) => { data += c; });
        stream.on("end", () => {
          try {
            const apiData = JSON.parse(data);
            const item = apiData.items?.[0];
            if (!item) return reject(new Error("No video data in API response"));
            const sn = item.snippet, st = item.statistics, cd = item.contentDetails;
            resolve({
              title: sn.title,
              channel: sn.channelTitle || "YouTube",
              thumbnail: sn.thumbnails?.medium?.url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              description: sn.description || "",
              duration: this.parseISO8601Duration(cd.duration),
              views: parseInt(st.viewCount) || null,
              likes: parseInt(st.likeCount) || null,
              publishedAt: sn.publishedAt,
              category: sn.categoryId,
              tags: sn.tags || [],
              quality: "Auto",
              language: sn.defaultLanguage || sn.defaultAudioLanguage || "en",
              captions: cd.caption === "true" ? ["en"] : []
            });
          } catch (e) { reject(new Error(`Failed to parse API response: ${e.message}`)); }
        });
      });
      req.on("error", (e) => reject(new Error(`API request failed: ${e.message}`)));
      req.setTimeout(5000, () => { req.destroy(new Error("API request timeout")); });
    });
  },

  async fetchVideoInfoFromScraping (videoId) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        timeout: 8000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "DNT": "1",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1"
        }
      }, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`YouTube page status ${res.statusCode}`));

        const stream = decodeIfCompressed(res);
        let data = "";
        const maxSize = 2 * 1024 * 1024; // 2MB limit
        let received = 0;

        const finish = () => {
          try {
            const m = data.match(/var ytInitialPlayerResponse = ({.+?});/);
            if (m) {
              const player = JSON.parse(m[1]);
              const vd = player.videoDetails;
              if (vd) {
                const sec = parseInt(vd.lengthSeconds) || null;
                const formatDuration = (s) => {
                  if (!s && s !== 0) return null;
                  const h = Math.floor(s / 3600);
                  const m = Math.floor((s % 3600) / 60);
                  const ss = s % 60;
                  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`
                               : `${m}:${String(ss).padStart(2,"0")}`;
                };
                resolve({
                  title: vd.title,
                  channel: vd.author || "YouTube",
                  thumbnail: vd.thumbnail?.thumbnails?.[2]?.url || vd.thumbnail?.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                  url: `https://www.youtube.com/watch?v=${videoId}`,
                  description: vd.shortDescription || "",
                  duration: sec,
                  durationFormatted: formatDuration(sec),
                  views: parseInt(vd.viewCount) || null,
                  viewsFormatted: null, // keep simple
                  likes: null,
                  publishedAt: null,
                  category: null,
                  tags: vd.keywords || [],
                  quality: "Auto",
                  language: "en",
                  captions: []
                });
                return;
              }
            }
            const t = data.match(/<title>(.+?) - YouTube<\/title>/);
            if (t) {
              resolve({
                title: t[1],
                channel: "YouTube",
                thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                description: "",
                duration: null,
                durationFormatted: null,
                views: null,
                viewsFormatted: null,
                likes: null,
                publishedAt: null,
                category: null,
                tags: [],
                quality: "Auto",
                language: "en",
                captions: []
              });
            } else {
              reject(new Error("Could not extract video info"));
            }
          } catch (e) { reject(new Error(`Failed to parse scraped data: ${e.message}`)); }
        };

        stream.on("data", (chunk) => {
          received += chunk.length;
          if (received > maxSize) {
            req.destroy();
            return reject(new Error("Response too large"));
          }
          data += chunk;
          if (data.includes("var ytInitialPlayerResponse = {") && data.includes("};")) {
            // Early exit if we already got what we need
            req.destroy();
            finish();
          }
        });

        stream.on("end", finish);
      });

      req.on("error", (e) => reject(new Error(`Scraping failed: ${e.message}`)));
      req.setTimeout(8000, () => { req.destroy(new Error("Scraping request timeout")); });
    });
  },

  createFallbackVideoInfo (videoId) {
    return {
      title: "YouTube Video",
      channel: "YouTube",
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      description: "Video information could not be loaded",
      duration: null,
      views: null,
      likes: null,
      publishedAt: null,
      category: null,
      tags: [],
      quality: "Auto",
      language: "en",
      captions: []
    };
  },

  parseISO8601Duration (iso) {
    if (!iso) return null;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return null;
    const h = parseInt(m[1]) || 0;
    const min = parseInt(m[2]) || 0;
    const s = parseInt(m[3]) || 0;
    return h * 3600 + min * 60 + s;
  },

  playVideo (videoId, url) {
    this.state.playing = true;
    this.state.lastUrl = url || null;
    this.state.lastVideoId = videoId;
    this.sendSocketNotification("STM_PLAY_EMBED", { videoId, url });
    console.log(`[MMM-ShareToMirror] Playing video: ${videoId}`);
  },

  createHttpServer (app, port) {
    const server = http.createServer(app);
    server.listen(port, "0.0.0.0");
    return server;
  },

  createHttpsServer (app, port) {
    try {
      const key = fs.readFileSync(this.config.https.keyPath);
      const cert = fs.readFileSync(this.config.https.certPath);
      const server = https.createServer({ key, cert }, app);
      server.listen(port, "0.0.0.0");
      return server;
    } catch (e) {
      console.error("[MMM-ShareToMirror] HTTPS setup failed:", e.message);
      console.log("[MMM-ShareToMirror] Falling back to HTTP");
      return this.createHttpServer(app, port);
    }
  },

  stop () {
    console.log("[MMM-ShareToMirror] Node helper stopping…");
    if (this.server) {
      this.server.close(() => console.log("[MMM-ShareToMirror] Server closed"));
      this.server = null;
    }
  }
});
