/* global Module, MM */

/**
 * MMM-ShareToMirror
 * A MagicMirror² module for sharing YouTube videos from mobile devices
 * @author Smart'Gic
 * @license MIT
 * @version 1.6.0
 */
Module.register("MMM-ShareToMirror", {
	defaults: {
		port: 8570,
		https: { enabled: false, keyPath: "", certPath: "" },
		invisible: true,
		overlay: {
			width: "70vw",
			maxWidth: "1280px",
			aspectRatio: "16 / 9",
			top: "50%",
			left: "50%",
			zIndex: 9999,
			borderRadius: "18px",
			boxShadow: "0 10px 40px rgba(0,0,0,.55)"
		},
		caption: { enabled: false, lang: "en" },
		quality: { target: "auto", floor: null, ceiling: null, lock: false }
	},

	start () {
		Log.info(`Starting module: ${this.name}`);

		this.validateConfig();
		this.initializeState();
		this.sendSocketNotification("STM_START", this.config);

		if (this.config.invisible) this.hide(0);
		this.setupOverlay();
	},

	validateConfig () {
		const { config } = this;

		// Validate port
		if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
			Log.warn(`${this.name}: Invalid port, using default 8570`);
			config.port = 8570;
		}

		// Validate caption language
		const validLangs = ["en", "fr", "es", "de", "it", "pt", "ja", "ko", "zh"];
		if (!validLangs.includes(config.caption.lang)) {
			Log.warn(`${this.name}: Invalid caption language, using 'en'`);
			config.caption.lang = "en";
		}

		// Validate quality
		const validQualities = ["auto", "144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"];
		if (!validQualities.includes(config.quality.target)) {
			Log.warn(`${this.name}: Invalid quality target, using 'auto'`);
			config.quality.target = "auto";
		}
	},

	initializeState () {
		this.ytPlayer = null;
		this.overlayRoot = null;
		this.playerContainer = null;
		this.keydownHandler = null;
	},

	setupOverlay () {
		if (this.overlayRoot) return;

		const overlay = this.createOverlayElement();
		const container = this.createPlayerContainer();

		overlay.appendChild(container);
		document.body.appendChild(overlay);

		this.overlayRoot = overlay;
		this.playerContainer = container;
		this.setupKeyboardHandler();
		this.loadYouTubeAPI();
	},

	createOverlayElement () {
		const overlay = document.createElement("div");
		const { overlay: config } = this.config;

		overlay.setAttribute("role", "dialog");
		overlay.setAttribute("aria-label", "Video Player");
		overlay.setAttribute("aria-modal", "true");

		Object.assign(overlay.style, {
			position: "fixed",
			top: config.top,
			left: config.left,
			transform: "translate(-50%, -50%)",
			width: config.width,
			maxWidth: config.maxWidth,
			aspectRatio: config.aspectRatio,
			zIndex: config.zIndex,
			display: "none",
			background: "black",
			borderRadius: config.borderRadius,
			boxShadow: config.boxShadow,
			overflow: "hidden",
			pointerEvents: "none"
		});

		return overlay;
	},

	createPlayerContainer () {
		const container = document.createElement("div");
		container.id = "stm-player-container";
		Object.assign(container.style, {
			width: "100%",
			height: "100%",
			position: "relative",
			pointerEvents: "auto"
		});
		return container;
	},

	setupKeyboardHandler () {
		this.keydownHandler = (event) => {
			if (event.key === "Escape" && this.overlayRoot.style.display !== "none") {
				event.preventDefault();
				this.stopVideo("escape");
			}
		};
		window.addEventListener("keydown", this.keydownHandler);
	},

	loadYouTubeAPI () {
		if (!window.YT) {
			const script = document.createElement("script");
			script.src = "https://www.youtube.com/iframe_api";
			script.onerror = () => Log.error(`${this.name}: Failed to load YouTube API`);
			document.head.appendChild(script);
		}
	},

	mapQuality (quality) {
		const qualityMap = {
			"144p": "tiny",
			"240p": "small",
			"360p": "medium",
			"480p": "large",
			"720p": "hd720",
			"1080p": "hd1080",
			"1440p": "hd1440",
			"2160p": "hd2160"
		};
		return quality === "auto" ? "default" : qualityMap[quality] || null;
	},

	applyPlayerSettings () {
		if (!this.ytPlayer) return;

		// Apply captions
		try {
			if (this.config.caption.enabled) {
				this.ytPlayer.setOption("captions", "track", { languageCode: this.config.caption.lang });
				this.ytPlayer.setOption("captions", "reload", true);
			} else {
				this.ytPlayer.setOption("captions", "track", {});
			}
		} catch (error) {
			Log.warn(`${this.name}: Caption error:`, error);
		}

		// Apply quality
		try {
			const quality = this.mapQuality(this.config.quality.target);
			if (quality && this.ytPlayer.setPlaybackQuality) {
				this.ytPlayer.setPlaybackQuality(quality);
			}
		} catch (error) {
			Log.warn(`${this.name}: Quality error:`, error);
		}
	},

	playVideo (videoId) {
		if (!videoId || !this.overlayRoot) return;

		this.overlayRoot.style.display = "block";
		this.overlayRoot.focus();

		const createPlayer = () => {
			const playerDiv = document.createElement("div");
			playerDiv.id = `stm-player-${Date.now()}`;
			playerDiv.style.cssText = "width:100%;height:100%";

			this.playerContainer.innerHTML = "";
			this.playerContainer.appendChild(playerDiv);

			this.ytPlayer = new YT.Player(playerDiv.id, {
				width: "100%",
				height: "100%",
				videoId,
				playerVars: {
					autoplay: 1,
					controls: 1,
					modestbranding: 1,
					rel: 0,
					iv_load_policy: 3,
					fs: 0,
					playsinline: 1,
					cc_load_policy: this.config.caption.enabled ? 1 : 0,
					hl: this.config.caption.lang
				},
				events: {
					onReady: (event) => {
						event.target.playVideo();
						this.applyPlayerSettings();
					},
					onApiChange: () => this.applyPlayerSettings(),
					onPlaybackQualityChange: () => {
						if (this.config.quality.lock) this.applyPlayerSettings();
					},
					onStateChange: (event) => {
						if (event.data === 0) this.stopVideo("ended");
					},
					onError: (event) => {
						Log.error(`${this.name}: Player error:`, event.data);
						this.stopVideo("error");
					}
				}
			});
		};

		if (window.YT && window.YT.Player) {
			createPlayer();
		} else {
			window.onYouTubeIframeAPIReady = createPlayer;
		}
	},

	stopVideo (reason = "manual") {
		try {
			if (this.ytPlayer && this.ytPlayer.stopVideo) {
				this.ytPlayer.stopVideo();
			}
		} catch (error) {
			Log.warn(`${this.name}: Stop error:`, error);
		}

		if (this.overlayRoot) {
			this.overlayRoot.style.display = "none";
		}

		this.sendSocketNotification("STM_EMBEDDED_STOPPED", { reason });
	},

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "STM_PLAY_EMBED":
				if (payload?.videoId) this.playVideo(payload.videoId);
				break;
			case "STM_STOP_EMBED":
				this.stopVideo(payload?.reason || "api");
				break;
			case "STM_OPTIONS":
				this.updateOptions(payload);
				break;
			case "STM_VIDEO_CONTROL":
				this.handleVideoControl(payload);
				break;
		}
	},

	handleVideoControl (payload) {
		if (!this.ytPlayer || !payload?.action) return;

		const { action, seconds } = payload;

		try {
			switch (action) {
				case "pause":
					if (this.ytPlayer.pauseVideo) {
						this.ytPlayer.pauseVideo();
					}
					break;
				case "resume":
					if (this.ytPlayer.playVideo) {
						this.ytPlayer.playVideo();
					}
					break;
				case "rewind":
					if (this.ytPlayer.getCurrentTime && this.ytPlayer.seekTo) {
						const currentTime = this.ytPlayer.getCurrentTime();
						const newTime = Math.max(0, currentTime - (seconds || 10));
						this.ytPlayer.seekTo(newTime, true);
					}
					break;
				case "forward":
					if (this.ytPlayer.getCurrentTime && this.ytPlayer.seekTo && this.ytPlayer.getDuration) {
						const currentTime = this.ytPlayer.getCurrentTime();
						const duration = this.ytPlayer.getDuration();
						const newTime = Math.min(duration, currentTime + (seconds || 10));
						this.ytPlayer.seekTo(newTime, true);
					}
					break;
				default:
					Log.warn(`${this.name}: Unknown video control action: ${action}`);
			}
		} catch (error) {
			Log.error(`${this.name}: Video control error:`, error);
		}
	},

	updateOptions (options) {
		if (!options) return;

		if (options.caption) {
			Object.assign(this.config.caption, options.caption);
		}
		if (options.quality) {
			Object.assign(this.config.quality, options.quality);
		}

		this.applyPlayerSettings();
	},

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.style.display = "none";
		wrapper.setAttribute("aria-hidden", "true");
		return wrapper;
	},

	stop () {
		this.stopVideo("module_stop");

		// Clean up event listeners
		if (this.keydownHandler) {
			window.removeEventListener("keydown", this.keydownHandler);
			this.keydownHandler = null;
		}

		// Clean up DOM elements
		if (this.overlayRoot?.parentNode) {
			this.overlayRoot.parentNode.removeChild(this.overlayRoot);
		}

		// Clean up YouTube player
		if (this.ytPlayer?.destroy) {
			try {
				this.ytPlayer.destroy();
			} catch (error) {
				Log.warn(`${this.name}: Destroy error:`, error);
			}
		}

		// Clean up YouTube API callback
		if (window.onYouTubeIframeAPIReady) {
			window.onYouTubeIframeAPIReady = null;
		}

		// Reset state
		this.initializeState();

		Log.info(`${this.name}: Module stopped and cleaned up`);
	}
});
