/* global Module, MM */

/**
 * MMM-ShareToMirror
 * Zoom-proof YouTube overlay (handles body { zoom } and avoids transforms)
 * Optional integration to pause MMM-MagicMover while playing.
 * @author Smart'Gic
 * @license MIT
 * @version 1.7.4
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
    quality: { target: "auto", floor: null, ceiling: null, lock: false },
    magicMoverIntegration: true      // send MAGIC_MOVER_OFF/ON around playback
  },

  /* ---------------- lifecycle ---------------- */
  start () {
    Log.info(`Starting module: ${this.name}`);
    this._fsOn = false;
    this._playing = false;
    this._onResize = null;
    this.ytPlayer = null;
    this.overlayEl = null;

    this._validateConfig();
    this.sendSocketNotification("STM_START", this.config);

    if (this.config.invisible) this.hide(0);
    this._setupOverlay();
  },

  stop () {
    this._stopVideo("module_stop");
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      window.removeEventListener("orientationchange", this._onResize);
      this._onResize = null;
    }
    if (this.overlayEl?.parentNode) this.overlayEl.parentNode.removeChild(this.overlayEl);
    this.overlayEl = null;

    try { this.ytPlayer?.destroy?.(); } catch (e) { Log.warn(`${this.name}: Destroy error:`, e); }
    if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady = null;
    Log.info(`${this.name}: Stopped`);
  },

  getStyles () { return ["MMM-ShareToMirror.css"]; },

  getDom () {
    const root = document.createElement("div");
    root.id = "ytc-root";
    root.style.position = "relative";

    // Overlay lives at <body> to escape region transforms
    this.overlayEl = document.createElement("div");
    this.overlayEl.id = "ytc-overlay";
    this.overlayEl.style.display = "none";
    this.overlayEl.setAttribute("role", "dialog");
    this.overlayEl.setAttribute("aria-label", "Video Player");
    this.overlayEl.setAttribute("aria-modal", "true");
    document.body.appendChild(this.overlayEl);

    return root;
  },

  /* ---------------- setup helpers ---------------- */
  _validateConfig () {
    const c = this.config;
    if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) {
      Log.warn(`${this.name}: Invalid port, using 8570`); c.port = 8570;
    }
    const langs = ["en","fr","es","de","it","pt","ja","ko","zh"];
    if (!langs.includes(c.caption.lang)) { Log.warn(`${this.name}: Bad caption lang, using en`); c.caption.lang = "en"; }
    const qs = ["auto","144p","240p","360p","480p","720p","1080p","1440p","2160p"];
    if (!qs.includes(c.quality.target)) { Log.warn(`${this.name}: Bad quality, using auto`); c.quality.target = "auto"; }
  },

  _setupOverlay () {
    // ESC to stop
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.overlayEl && this.overlayEl.style.display !== "none") {
        ev.preventDefault(); this._stopVideo("escape");
      }
    });
    // YouTube API
    if (!window.YT) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => Log.error(`${this.name}: Failed to load YouTube API`);
      document.head.appendChild(s);
    }
    // Relayout on resize/orientation
    this._onResize = () => this._reflow();
    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onResize);
  },

  /* ---------------- zoom/viewport math ---------------- */
  _zoomFromComputed () {
    const z = getComputedStyle(document.body).zoom;
    if (!z) return NaN;
    if (String(z).endsWith("%")) return parseFloat(z) / 100;
    return parseFloat(z);
  },
  _probeZoomVW () {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const rectW = probe.getBoundingClientRect().width || 0;
    document.body.removeChild(probe);
    const w = window.innerWidth || rectW || 1;
    const r = rectW / w;
    return (r > 0.5 && r < 3) ? r : NaN;
  },
  _getZoom () {
    let z = this._zoomFromComputed();
    if (!isFinite(z) || z <= 0) z = this._probeZoomVW();
    if (!isFinite(z) || z <= 0) {
      const vv = window.visualViewport;
      if (vv?.width && window.innerWidth) {
        const r = window.innerWidth / vv.width;
        if (r > 0.5 && r < 3) z = r;
      }
    }
    return (isFinite(z) && z > 0) ? z : 1;
  },
  _viewport () {
    const vv = window.visualViewport;
    const vw = Math.max(window.innerWidth || 0, vv?.width || 0);
    const vh = Math.max(window.innerHeight || 0, vv?.height || 0);
    let ox = vv?.offsetLeft || 0, oy = vv?.offsetTop || 0;
    if (Math.abs(ox) < 1) ox = 0; if (Math.abs(oy) < 1) oy = 0;
    return { vw, vh, ox, oy };
  },
  _px (val, axis, vw, vh) {
    if (val == null) return 0;
    const s = String(val).trim(); const n = parseFloat(s);
    if (s.endsWith("px")) return n;
    if (s.endsWith("vw")) return vw * (n / 100);
    if (s.endsWith("vh")) return vh * (n / 100);
    if (s.endsWith("%"))  return (axis === "x" ? vw : vh) * (n / 100);
    return Number.isFinite(n) ? n : 0;
  },
  _aspect () {
    const raw = (this.config.overlay.aspectRatio || "16 / 9").replace(/\s+/g, "");
    const m = raw.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    return m ? (parseFloat(m[1]) / parseFloat(m[2] || 1)) : 16 / 9;
  },

  /* ---------------- layout (windowed/fullscreen) ---------------- */
  _layoutWindowed () {
    if (!this.overlayEl) return;
    const { vw, vh } = this._viewport();
    const z = this._getZoom(), inv = 1 / z;
    const cfg = this.config.overlay, ar = this._aspect();

    const widthPx    = this._px(cfg.width,    "x", vw, vh);
    const maxWidthPx = this._px(cfg.maxWidth, "x", vw, vh);
    const cy         = this._px(cfg.top,      "y", vw, vh);
    const cx         = this._px(cfg.left,     "x", vw, vh);

    const boxW = Math.max(0, Math.min(widthPx || vw, maxWidthPx || Infinity));
    const boxH = Math.round(boxW / ar);
    const left = Math.round(cx - boxW / 2);
    const top  = Math.round(cy - boxH / 2);

    Object.assign(this.overlayEl.style, {
      position: "fixed",
      left: `${left}px`,
      top:  `${top}px`,
      width: `${boxW}px`,
      height:`${boxH}px`,
      maxWidth: `${boxW}px`,
      zIndex: String(cfg.zIndex),
      background: "black",
      borderRadius: cfg.borderRadius,
      boxShadow: cfg.boxShadow,
      overflow: "hidden",
      pointerEvents: "auto",
      transformOrigin: "top left",
      transform: `scale(${inv})`
    });

    const stage = this.overlayEl.querySelector(".ytc-stage");
    if (stage) {
      Object.assign(stage.style, {
        position: "absolute", left: "0", top: "0",
        width: "100%", height: "100%", margin: "0"
      });
    }
  },

  _layoutFullscreen () {
    if (!this.overlayEl) return;
    const { vw, vh, ox, oy } = this._viewport();
    const z = this._getZoom(), inv = 1 / z;
    const bleed = 1; // shave rounding seams

    Object.assign(this.overlayEl.style, {
      position: "fixed",
      left: `${-bleed}px`,
      top:  `${-bleed}px`,
      width:  `${Math.ceil(vw * z) + bleed * 2}px`,
      height: `${Math.ceil(vh * z) + bleed * 2}px`,
      maxWidth: `${Math.ceil(vw * z) + bleed * 2}px`,
      zIndex: "9999",
      background: "#000",
      borderRadius: "0",
      boxShadow: "none",
      overflow: "hidden",
      pointerEvents: "auto",
      transformOrigin: "top left",
      transform: `translate(${ox ? ox * z : 0}px, ${oy ? oy * z : 0}px) scale(${inv})`
    });

    // Letterbox stage to aspect, centered
    const ar = this._aspect();
    const tooWide = (vw / vh) > ar;
    const w = tooWide ? Math.round(vh * ar) : vw;
    const h = tooWide ? vh : Math.round(vw / ar);

    let stage = this.overlayEl.querySelector(".ytc-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "ytc-stage";
      this.overlayEl.innerHTML = "";
      this.overlayEl.appendChild(stage);
    }
    Object.assign(stage.style, {
      position: "absolute",
      width: `${w * z}px`,
      height:`${h * z}px`,
      left:  `${Math.round((vw - w) / 2) * z}px`,
      top:   `${Math.round((vh - h) / 2) * z}px`,
      margin: "0"
    });
  },

  _reflow () { this._fsOn ? this._layoutFullscreen() : this._layoutWindowed(); },

  /* ---------------- player helpers ---------------- */
  _mapQuality (q) {
    const m = { "144p":"tiny","240p":"small","360p":"medium","480p":"large","720p":"hd720","1080p":"hd1080","1440p":"hd1440","2160p":"hd2160" };
    return q === "auto" ? "default" : (m[q] || null);
  },
  _applyPlayerSettings () {
    if (!this.ytPlayer) return;
    try {
      if (this.config.caption.enabled) {
        this.ytPlayer.setOption("captions", "track", { languageCode: this.config.caption.lang });
        this.ytPlayer.setOption("captions", "reload", true);
      } else {
        this.ytPlayer.setOption("captions", "track", {});
      }
    } catch (e) { Log.warn(`${this.name}: Caption error:`, e); }

    try {
      const q = this._mapQuality(this.config.quality.target);
      if (q && this.ytPlayer.setPlaybackQuality) this.ytPlayer.setPlaybackQuality(q);
    } catch (e) { Log.warn(`${this.name}: Quality error:`, e); }
  },

  /* ---------------- play/stop ---------------- */
  _ensureStage () {
    let stage = this.overlayEl.querySelector(".ytc-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "ytc-stage";
      stage.style.width = "100%";
      stage.style.height = "100%";
      stage.style.position = "relative";
      this.overlayEl.innerHTML = "";
      this.overlayEl.appendChild(stage);
    }
    return stage;
  },

  _createPlayer (videoId) {
    const stage = this._ensureStage();
    const host = document.createElement("div");
    host.id = `stm-player-${Date.now()}`;
    host.style.cssText = "width:100%;height:100%";
    stage.innerHTML = "";
    stage.appendChild(host);

    this.ytPlayer = new YT.Player(host.id, {
      width: "100%", height: "100%", videoId,
      playerVars: {
        autoplay: 1, controls: 1, modestbranding: 1, rel: 0, iv_load_policy: 3,
        fs: 0, playsinline: 1, cc_load_policy: this.config.caption.enabled ? 1 : 0,
        hl: this.config.caption.lang
      },
      events: {
        onReady: (ev) => { ev.target.playVideo(); this._applyPlayerSettings(); },
        onApiChange: () => this._applyPlayerSettings(),
        onPlaybackQualityChange: () => { if (this.config.quality.lock) this._applyPlayerSettings(); },
        onStateChange: (e) => { if (e.data === 0) this._stopVideo("ended"); },
        onError: (e) => { Log.error(`${this.name}: Player error:`, e.data); this._stopVideo("error"); }
      }
    });
  },

  _playVideo (videoId) {
    if (!videoId || !this.overlayEl) return;
    this._fsOn = false;
    this.overlayEl.style.display = "block";
    this._reflow();

    if (window.YT && window.YT.Player) this._createPlayer(videoId);
    else window.onYouTubeIframeAPIReady = () => this._createPlayer(videoId);

    // Pause MagicMover while playing (if present)
    if (this.config.magicMoverIntegration && !this._playing) {
      this.sendNotification?.("MAGIC_MOVER_OFF");
    }
    this._playing = true;
  },

  _stopVideo (reason = "manual") {
    try { this.ytPlayer?.stopVideo?.(); } catch (e) { /* ignore */ }
    if (this.overlayEl) this.overlayEl.style.display = "none";
    this._fsOn = false;
    this.sendSocketNotification("STM_EMBEDDED_STOPPED", { reason });

    if (this.config.magicMoverIntegration && this._playing) {
      this.sendNotification?.("MAGIC_MOVER_ON");
    }
    this._playing = false;
  },

  _setOverlayFullscreen (on) { this._fsOn = !!on; this._reflow(); },
  _toggleOverlayFullscreen () { this._setOverlayFullscreen(!this._fsOn); },

  /* ---------------- sockets ---------------- */
  socketNotificationReceived (n, payload) {
    switch (n) {
      case "STM_PLAY_EMBED":
        if (payload?.videoId) this._playVideo(payload.videoId);
        break;
      case "STM_STOP_EMBED":
        this._stopVideo(payload?.reason || "api");
        break;
      case "STM_OPTIONS":
        if (payload?.caption) Object.assign(this.config.caption, payload.caption);
        if (payload?.quality) Object.assign(this.config.quality, payload.quality);
        this._applyPlayerSettings();
        break;
      case "STM_VIDEO_CONTROL":
        this._handleVideoControl(payload);
        break;
      case "STM_OVERLAY": {
        const a = (payload?.action || "toggle").toLowerCase();
        if (a === "fullscreen") this._setOverlayFullscreen(true);
        else if (a === "windowed") this._setOverlayFullscreen(false);
        else this._toggleOverlayFullscreen();
        break;
      }
    }
  },

  _handleVideoControl (payload) {
    if (!this.ytPlayer || !payload?.action) return;
    const { action } = payload; const seconds = Number(payload.seconds) || 10;
    try {
      if (action === "pause") this.ytPlayer.pauseVideo?.();
      else if (action === "resume") this.ytPlayer.playVideo?.();
      else if (action === "rewind") {
        const t = this.ytPlayer.getCurrentTime?.() || 0;
        this.ytPlayer.seekTo?.(Math.max(0, t - seconds), true);
      } else if (action === "forward") {
        const t = this.ytPlayer.getCurrentTime?.() || 0;
        const d = this.ytPlayer.getDuration?.() || t + 1;
        this.ytPlayer.seekTo?.(Math.min(d, t + seconds), true);
      }
    } catch (err) { Log.error(`${this.name}: Video control error:`, err); }
  }
});
