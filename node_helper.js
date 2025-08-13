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

		// Share target - support both GET and POST
		const handleShareTarget = (req, res) => {
			const url = req.body?.url || req.body?.text || req.body?.title || 
			           req.query?.url || req.query?.text || req.query?.title;
			const videoId = parseYouTubeId(url);

			if (videoId) {
				this.playVideo(videoId, url);
			}

			res.sendFile(path.join(__dirname, "public", "done.html"));
		};

		app.post("/share-target", upload.none(), handleShareTarget);
		app.get("/share-target", handleShareTarget);

		// API endpoints - using simple paths only
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

		app.post("/api/control", (req, res) => {
			const { action, seconds } = req.body;

			if (!action) {
				return res.status(400).json({ ok: false, error: "Action is required" });
			}

			const validActions = ["pause", "resume", "rewind", "forward"];
			if (!validActions.includes(action)) {
				return res.status(400).json({ ok: false, error: "Invalid action" });
			}

			// For rewind/forward, validate seconds parameter
			if ((action === "rewind" || action === "forward") && (!seconds || seconds <= 0)) {
				return res.status(400).json({ ok: false, error: "Valid seconds parameter required for rewind/forward" });
			}

			this.sendSocketNotification("STM_VIDEO_CONTROL", { action, seconds });
			res.json({ ok: true, action, seconds: seconds || null });
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

		app.post("/api/video-info", async (req, res) => {
			const { videoId } = req.body;

			// Validate video ID format
			if (!videoId || !(/^[a-zA-Z0-9_-]{11}$/).test(videoId)) {
				return res.status(400).json({ ok: false, error: "Invalid video ID format" });
			}

			try {
				const videoInfo = await this.fetchYouTubeVideoInfo(videoId);
				res.json({ ok: true, data: videoInfo });
			} catch (error) {
				console.error("[MMM-ShareToMirror] Failed to fetch video info:", error);
				res.status(500).json({
					ok: false,
					error: "Failed to fetch video information",
					fallback: {
						title: "YouTube Video",
						channel: "YouTube",
						thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
						url: `https://www.youtube.com/watch?v=${videoId}`,
						description: "Video information could not be loaded",
						duration: null,
						views: null,
						publishedAt: null,
						likes: null,
						category: null,
						tags: [],
						quality: "Auto",
						language: "en",
						captions: []
					}
				});
			}
		});

		app.get("/api/health", (req, res) => {
			res.json({
				ok: true,
				status: "healthy",
				uptime: process.uptime(),
				timestamp: new Date().toISOString()
			});
		});
	},

	/**
	 * Fetch YouTube video information using multiple methods
	 * @param {string} videoId - YouTube video ID
	 * @returns {Promise<object>} Video information object
	 */
	async fetchYouTubeVideoInfo (videoId) {
		// Try multiple methods to get video info
		const methods = [
			() => this.fetchVideoInfoFromOEmbed(videoId),
			() => this.fetchVideoInfoFromYouTubeAPI(videoId),
			() => this.fetchVideoInfoFromScraping(videoId)
		];

		for (const method of methods) {
			try {
				const result = await method();
				if (result && result.title) {
					return result;
				}
			} catch (error) {
				console.warn("[MMM-ShareToMirror] Video info method failed:", error.message);
			}
		}

		// Final fallback
		return this.createFallbackVideoInfo(videoId);
	},

	/**
	 * Fetch video info using YouTube oEmbed API (most reliable)
	 * @param {string} videoId - YouTube video ID
	 */
	async fetchVideoInfoFromOEmbed (videoId) {
		const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

		return new Promise((resolve, reject) => {
			const request = https.get(url, { 
				timeout: 3000,
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; MMM-ShareToMirror/1.6.0)"
				}
			}, (response) => {
				let data = "";

				// Handle non-200 status codes
				if (response.statusCode !== 200) {
					reject(new Error(`oEmbed API returned status ${response.statusCode}`));
					return;
				}

				response.on("data", (chunk) => {
					data += chunk;
				});

				response.on("end", () => {
					try {
						const oembedData = JSON.parse(data);

						if (oembedData.title) {
							resolve({
								title: oembedData.title,
								channel: oembedData.author_name || "YouTube",
								thumbnail: oembedData.thumbnail_url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
								url: `https://www.youtube.com/watch?v=${videoId}`,
								description: `Video by ${oembedData.author_name || "YouTube"}`,
								duration: null, // oEmbed doesn't provide duration
								views: null,
								likes: null,
								publishedAt: null,
								category: null,
								tags: [],
								quality: "Auto",
								language: "en",
								captions: []
							});
						} else {
							reject(new Error("No title in oEmbed response"));
						}
					} catch (error) {
						reject(new Error(`Failed to parse oEmbed response: ${error.message}`));
					}
				});
			});

			request.on("error", (error) => {
				reject(new Error(`oEmbed request failed: ${error.message}`));
			});

			request.on("timeout", () => {
				request.destroy();
				reject(new Error("oEmbed request timeout"));
			});

			// Set a shorter timeout
			request.setTimeout(3000, () => {
				request.destroy();
				reject(new Error("oEmbed request timeout"));
			});
		});
	},

	/**
	 * Fetch video info using YouTube Data API v3 (requires API key)
	 * @param {string} videoId - YouTube video ID
	 */
	async fetchVideoInfoFromYouTubeAPI (videoId) {
		// This would require a YouTube API key from config
		// For now, we'll skip this method unless API key is configured
		if (!this.config?.youtubeApiKey) {
			throw new Error("YouTube API key not configured");
		}

		const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.config.youtubeApiKey}&part=snippet,statistics,contentDetails`;

		return new Promise((resolve, reject) => {
			const request = https.get(url, { timeout: 5000 }, (response) => {
				let data = "";

				response.on("data", (chunk) => {
					data += chunk;
				});

				response.on("end", () => {
					try {
						const apiData = JSON.parse(data);

						if (apiData.items && apiData.items.length > 0) {
							const video = apiData.items[0];
							const snippet = video.snippet;
							const statistics = video.statistics;
							const contentDetails = video.contentDetails;

							resolve({
								title: snippet.title,
								channel: snippet.channelTitle || "YouTube",
								thumbnail: snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
								url: `https://www.youtube.com/watch?v=${videoId}`,
								description: snippet.description || "",
								duration: this.parseISO8601Duration(contentDetails.duration),
								views: parseInt(statistics.viewCount) || null,
								likes: parseInt(statistics.likeCount) || null,
								publishedAt: snippet.publishedAt,
								category: snippet.categoryId,
								tags: snippet.tags || [],
								quality: "Auto",
								language: snippet.defaultLanguage || snippet.defaultAudioLanguage || "en",
								captions: contentDetails.caption === "true" ? ["en"] : []
							});
						} else {
							reject(new Error("No video data in API response"));
						}
					} catch (error) {
						reject(new Error(`Failed to parse API response: ${error.message}`));
					}
				});
			});

			request.on("error", (error) => {
				reject(new Error(`API request failed: ${error.message}`));
			});

			request.on("timeout", () => {
				request.destroy();
				reject(new Error("API request timeout"));
			});
		});
	},

	/**
	 * Fetch video info by scraping YouTube page (fallback method)
	 * @param {string} videoId - YouTube video ID
	 */
	async fetchVideoInfoFromScraping (videoId) {
		const url = `https://www.youtube.com/watch?v=${videoId}`;

		return new Promise((resolve, reject) => {
			const request = https.get(url, {
				timeout: 8000,
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.5",
					"Accept-Encoding": "gzip, deflate, br",
					"DNT": "1",
					"Connection": "keep-alive",
					"Upgrade-Insecure-Requests": "1"
				}
			}, (response) => {
				// Handle non-200 status codes
				if (response.statusCode !== 200) {
					reject(new Error(`YouTube page returned status ${response.statusCode}`));
					return;
				}

				let data = "";
				const maxSize = 2 * 1024 * 1024; // 2MB limit
				let receivedSize = 0;

				response.on("data", (chunk) => {
					receivedSize += chunk.length;
					if (receivedSize > maxSize) {
						request.destroy();
						reject(new Error("Response too large"));
						return;
					}
					data += chunk;

					// Early termination if we find the data we need
					if (data.includes("var ytInitialPlayerResponse = {") && data.includes("};")) {
						request.destroy();
						processData();
					}
				});

				response.on("end", () => {
					processData();
				});

				function processData() {
					try {
						// Extract JSON data from the page
						const jsonMatch = data.match(/var ytInitialPlayerResponse = ({.+?});/);
						if (jsonMatch) {
							const playerData = JSON.parse(jsonMatch[1]);
							const videoDetails = playerData.videoDetails;

							if (videoDetails) {
								// Format duration from seconds to readable format
								const formatDuration = (seconds) => {
									if (!seconds) return null;
									const hrs = Math.floor(seconds / 3600);
									const mins = Math.floor((seconds % 3600) / 60);
									const secs = seconds % 60;
									if (hrs > 0) {
										return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
									}
									return `${mins}:${secs.toString().padStart(2, '0')}`;
								};

								// Format view count
								const formatViews = (views) => {
									if (!views) return null;
									const num = parseInt(views);
									if (num >= 1000000000) return `${(num / 1000000000).toFixed(1)}B views`;
									if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M views`;
									if (num >= 1000) return `${(num / 1000).toFixed(1)}K views`;
									return `${num} views`;
								};

								resolve({
									title: videoDetails.title,
									channel: videoDetails.author || "YouTube",
									thumbnail: videoDetails.thumbnail?.thumbnails?.[2]?.url || videoDetails.thumbnail?.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
									url: `https://www.youtube.com/watch?v=${videoId}`,
									description: videoDetails.shortDescription || "",
									duration: parseInt(videoDetails.lengthSeconds) || null,
									durationFormatted: formatDuration(parseInt(videoDetails.lengthSeconds)),
									views: parseInt(videoDetails.viewCount) || null,
									viewsFormatted: formatViews(videoDetails.viewCount),
									likes: null, // Not available in player response
									publishedAt: null, // Not available in player response
									category: null,
									tags: videoDetails.keywords || [],
									quality: "Auto",
									language: "en",
									captions: []
								});
								return;
							}
						}

						// Fallback: try to extract title from page title
						const titleMatch = data.match(/<title>(.+?) - YouTube<\/title>/);
						if (titleMatch) {
							resolve({
								title: titleMatch[1],
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
							reject(new Error("Could not extract video information from page"));
						}
					} catch (error) {
						reject(new Error(`Failed to parse scraped data: ${error.message}`));
					}
				}
			});

			request.on("error", (error) => {
				reject(new Error(`Scraping request failed: ${error.message}`));
			});

			request.on("timeout", () => {
				request.destroy();
				reject(new Error("Scraping request timeout"));
			});

			// Set timeout
			request.setTimeout(8000, () => {
				request.destroy();
				reject(new Error("Scraping request timeout"));
			});
		});
	},

	/**
	 * Create fallback video info when all methods fail
	 * @param {string} videoId - YouTube video ID
	 */
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

	/**
	 * Parse ISO 8601 duration format (PT4M13S) to seconds
	 * @param {string} duration - ISO 8601 duration string
	 */
	parseISO8601Duration (duration) {
		if (!duration) return null;

		const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
		if (!match) return null;

		const hours = parseInt(match[1]) || 0;
		const minutes = parseInt(match[2]) || 0;
		const seconds = parseInt(match[3]) || 0;

		return hours * 3600 + minutes * 60 + seconds;
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
