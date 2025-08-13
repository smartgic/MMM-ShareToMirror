/**
 * Node Helper for MMM-ShareToMirror
 * Handles HTTP server, API endpoints, and YouTube URL parsing
 * @author Smart'Gic
 * @license MIT
 * @version 1.6.0
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const NodeHelper = require("node_helper");
const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");

/**
 * Parse YouTube video ID from URL or return direct ID
 * Enhanced with better validation and error handling
 * @param input
 */
function parseYouTubeId (input) {
	if (!input || typeof input !== "string") return null;

	const sanitized = input.trim();

	// Enhanced regex for YouTube URLs including more formats
	const patterns = [
		/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i,
		/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
		/(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/i,
		/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
		/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
		/^([a-zA-Z0-9_-]{11})$/i // Direct video ID
	];

	for (const pattern of patterns) {
		const match = sanitized.match(pattern);
		if (match && match[1]) {
			// Additional validation: ensure it's exactly 11 characters
			const videoId = match[1];
			if (videoId.length === 11 && (/^[a-zA-Z0-9_-]+$/).test(videoId)) {
				return videoId;
			}
		}
	}

	return null;
}

/**
 * Simple rate limiter
 * @param windowMs
 * @param max
 */
function createRateLimit (windowMs = 60000, max = 100) {
	const requests = new Map();

	return (req, res, next) => {
		const clientId = req.ip || req.connection.remoteAddress;
		const now = Date.now();

		// Clean old entries
		for (const [ip, data] of requests.entries()) {
			if (now - data.resetTime > windowMs) {
				requests.delete(ip);
			}
		}

		// Check rate limit
		let clientData = requests.get(clientId);
		if (!clientData || now - clientData.resetTime > windowMs) {
			clientData = { count: 0, resetTime: now };
			requests.set(clientId, clientData);
		}

		if (clientData.count >= max) {
			return res.status(429).json({
				ok: false,
				error: "Too many requests",
				retryAfter: Math.ceil((windowMs - (now - clientData.resetTime)) / 1000)
			});
		}

		clientData.count++;
		next();
	};
}

module.exports = NodeHelper.create({
	start () {
		console.log("[MMM-ShareToMirror] Node helper starting...");
		this.config = null;
		this.server = null;
		this.state = {
			playing: false,
			lastUrl: null,
			lastVideoId: null,
			caption: { enabled: false, lang: "en" },
			quality: { target: "auto", floor: null, ceiling: null, lock: false }
		};

		// Setup process error handlers
		this.setupErrorHandlers();
	},

	setupErrorHandlers () {
		process.on("uncaughtException", (error) => {
			console.error("[MMM-ShareToMirror] Uncaught Exception:", error);
		});

		process.on("unhandledRejection", (reason, promise) => {
			console.error("[MMM-ShareToMirror] Unhandled Rejection at:", promise, "reason:", reason);
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

		// Update state with config
		if (config.caption) Object.assign(this.state.caption, config.caption);
		if (config.quality) Object.assign(this.state.quality, config.quality);

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

		// Validate port
		if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
			console.warn("[MMM-ShareToMirror] Invalid port, using default 8570");
			config.port = defaults.port;
		}

		// Validate HTTPS
		if (config.https?.enabled && (!config.https.keyPath || !config.https.certPath)) {
			console.warn("[MMM-ShareToMirror] HTTPS enabled but missing paths, disabling");
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
			} else {
				this.server = this.createHttpServer(app, port);
			}

			this.server.on("error", (error) => {
				console.error("[MMM-ShareToMirror] Server error:", error);
			});
		} catch (error) {
			console.error("[MMM-ShareToMirror] Failed to start server:", error);
		}
	},

	createApp () {
		const app = express();

		// Security and CORS middleware
		app.use((req, res, next) => {
			res.setHeader("X-Content-Type-Options", "nosniff");
			res.setHeader("X-Frame-Options", "DENY");
			res.setHeader("X-XSS-Protection", "1; mode=block");
			res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
			res.setHeader("Content-Security-Policy",
				"default-src 'self'; "
				+ "script-src 'self' 'unsafe-inline' https://www.youtube.com; "
				+ "frame-src https://www.youtube.com; "
				+ "img-src 'self' data: https:; "
				+ "style-src 'self' 'unsafe-inline'; "
				+ "connect-src 'self'");

			if (req.path.startsWith("/api/")) {
				res.setHeader("Access-Control-Allow-Origin", "*");
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
				res.setHeader("Access-Control-Allow-Headers", "Content-Type");
			}
			next();
		});

		// Rate limiting and body parsing
		app.use(createRateLimit());
		app.use(bodyParser.json({ limit: "1mb" }));
		app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));

		// Static files
		app.use(express.static(path.join(__dirname, "public"), {
			extensions: ["html"],
			maxAge: "1d"
		}));

		// Routes
		this.setupRoutes(app);

		// Error handler
		app.use((error, req, res, next) => {
			console.error("[MMM-ShareToMirror] Request error:", error);

			if (error.type === "entity.too.large") {
				return res.status(413).json({ ok: false, error: "Request too large" });
			}
			if (error.type === "entity.parse.failed") {
				return res.status(400).json({ ok: false, error: "Invalid JSON" });
			}

			res.status(500).json({ ok: false, error: "Internal server error" });
		});

		return app;
	},

	setupRoutes (app) {
		const upload = multer({ limits: { fileSize: 1024 * 1024, fields: 10 } });

		// Share target
		app.post("/share-target", upload.none(), (req, res) => {
			const url = req.body?.url || req.body?.text || req.body?.title;
			const videoId = parseYouTubeId(url);

			if (videoId) {
				this.playVideo(videoId, url);
			}

			res.sendFile(path.join(__dirname, "public", "done.html"));
		});

		// API endpoints
		app.post("/api/play", (req, res) => {
			const videoId = parseYouTubeId(req.body?.url);

			if (!videoId) {
				return res.status(400).json({ ok: false, error: "Invalid YouTube URL" });
			}

			this.playVideo(videoId, req.body.url);
			res.json({ ok: true, mode: "embedded", videoId });
		});

		app.post("/api/stop", (req, res) => {
			this.state.playing = false;
			this.sendSocketNotification("STM_STOP_EMBED", { reason: "api" });
			res.json({ ok: true, message: "Playback stopped" });
		});

		app.post("/api/options", (req, res) => {
			const updates = {};

			if (req.body.caption && typeof req.body.caption === "object") {
				updates.caption = {
					enabled: Boolean(req.body.caption.enabled),
					lang: req.body.caption.lang || "en"
				};
				Object.assign(this.state.caption, updates.caption);
			}

			if (req.body.quality && typeof req.body.quality === "object") {
				updates.quality = {
					target: req.body.quality.target || "auto",
					floor: req.body.quality.floor || null,
					ceiling: req.body.quality.ceiling || null,
					lock: Boolean(req.body.quality.lock)
				};
				Object.assign(this.state.quality, updates.quality);
			}

			if (Object.keys(updates).length > 0) {
				this.sendSocketNotification("STM_OPTIONS", updates);
			}

			res.json({ ok: true, state: this.state, updated: Object.keys(updates).length > 0 });
		});

		app.get("/api/status", (req, res) => {
			res.json({
				ok: true,
				state: this.state,
				config: {
					port: this.config.port,
					httpsEnabled: this.config.https?.enabled || false
				},
				timestamp: new Date().toISOString()
			});
		});

		app.get("/api/health", (req, res) => {
			res.json({
				ok: true,
				status: "healthy",
				uptime: process.uptime(),
				timestamp: new Date().toISOString()
			});
		});

		app.options("/api/*", (req, res) => res.sendStatus(200));
	},

	playVideo (videoId, url) {
		this.state.playing = true;
		this.state.lastUrl = url;
		this.state.lastVideoId = videoId;

		this.sendSocketNotification("STM_PLAY_EMBED", { videoId, url });
		console.log(`[MMM-ShareToMirror] Playing video: ${videoId}`);
	},

	createHttpServer (app, port) {
		const server = http.createServer(app);
		server.listen(port, "0.0.0.0", () => {
			console.log(`[MMM-ShareToMirror] HTTP server listening on port ${port}`);
		});
		return server;
	},

	createHttpsServer (app, port) {
		try {
			const key = fs.readFileSync(this.config.https.keyPath);
			const cert = fs.readFileSync(this.config.https.certPath);
			const server = https.createServer({ key, cert }, app);

			server.listen(port, "0.0.0.0", () => {
				console.log(`[MMM-ShareToMirror] HTTPS server listening on port ${port}`);
			});

			return server;
		} catch (error) {
			console.error("[MMM-ShareToMirror] HTTPS setup failed:", error.message);
			console.log("[MMM-ShareToMirror] Falling back to HTTP");
			return this.createHttpServer(app, port);
		}
	},

	stop () {
		console.log("[MMM-ShareToMirror] Node helper stopping...");
		if (this.server) {
			this.server.close(() => console.log("[MMM-ShareToMirror] Server closed"));
			this.server = null;
		}
	}
});
