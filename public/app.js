/**
 * Share to MagicMirror² PWA Application
 * Handles video sharing, PWA installation, and settings management
 */

// Application state
const state = { deferredPrompt: null, isLoading: false };
const elements = {};

// Initialize DOM elements
document.addEventListener("DOMContentLoaded", () => {
	Object.assign(elements, {
		url: document.getElementById("url"),
		playButton: document.getElementById("play"),
		stopButton: document.getElementById("stop"),
		installButton: document.getElementById("install"),
		captionEnabled: document.getElementById("captionEnabled"),
		captionLang: document.getElementById("captionLang"),
		qualityTarget: document.getElementById("qualityTarget"),
		qualityLock: document.getElementById("qualityLock"),
		toast: document.getElementById("toast"),
		statusDot: document.getElementById("statusDot"),
		statusText: document.getElementById("statusText"),
		themeToggle: document.querySelector(".theme-toggle"),
		videoInfo: document.getElementById("videoInfo"),
		videoThumbnail: document.getElementById("videoThumbnail"),
		videoTitle: document.getElementById("videoTitle"),
		videoChannel: document.getElementById("videoChannel"),
		videoDuration: document.getElementById("videoDuration"),
		videoViews: document.getElementById("videoViews"),
		videoPublished: document.getElementById("videoPublished"),
		videoLikes: document.getElementById("videoLikes"),
		videoCategory: document.getElementById("videoCategory"),
		videoDescription: document.getElementById("videoDescription"),
		videoTags: document.getElementById("videoTags"),
		videoQuality: document.getElementById("videoQuality"),
		videoLanguage: document.getElementById("videoLanguage"),
		videoCaptions: document.getElementById("videoCaptions"),
		videoUrl: document.getElementById("videoUrl"),
		videoProgress: document.getElementById("videoProgress"),
		currentTime: document.getElementById("currentTime"),
		totalTime: document.getElementById("totalTime"),
		progressFill: document.getElementById("progressFill"),
		videoControls: document.getElementById("videoControls"),
		rewindButton: document.getElementById("rewind"),
		pauseButton: document.getElementById("pause"),
		forwardButton: document.getElementById("forward"),
		refreshStatus: document.getElementById("refreshStatus"),
		skipSelect: document.getElementById("skipSelect"),
		rewindText: document.getElementById("rewindText"),
		forwardText: document.getElementById("forwardText")
	});

	setupEventListeners();
	loadOptions();
	initializeTheme();
	updateSkipButtonText(); // Initialize button text
	checkInstallability(); // Check if app can be installed
	checkStatus();
	handleSharedUrl();
	// Check status more frequently for better responsiveness
	setInterval(checkStatus, 5000); // Check every 5 seconds instead of 30
});

// Safety fallback: if we detect header overlap, nudge once
window.addEventListener('load', () => {
	// Use requestAnimationFrame to ensure layout is complete
	requestAnimationFrame(() => {
		const hdr = document.querySelector('.appbar');
		if (!hdr) return;
		const r = hdr.getBoundingClientRect();
		if (r.top < 2) {
			// Use the actual appbar height from CSS custom property
			const appbarHeight = getComputedStyle(document.documentElement)
				.getPropertyValue('--appbar-h') || '56px';
			document.documentElement.style.setProperty('--infobar-h', appbarHeight);
		}
	});
});

// Service Worker registration
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("/sw.js").catch(console.error);
}

// PWA install handling - Enhanced for cross-browser compatibility with safe-area support
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
	// Prevent Chrome from auto-showing the prompt; keep a reference instead
	e.preventDefault();
	deferredInstallPrompt = e;
	state.deferredPrompt = e;
	// Add a body class and set CSS variable for infobar height
	document.body.classList.add('has-infobar');
	// Most Chrome builds use ~56px; tune if your device differs
	document.documentElement.style.setProperty('--infobar-h', '56px');
	
	// Enable install button
	if (elements.installButton) {
		elements.installButton.disabled = false;
		elements.installButton.querySelector('.button-text').textContent = "Install App";
	}
});

window.addEventListener('appinstalled', () => {
	deferredInstallPrompt = null;
	state.deferredPrompt = null;
	document.body.classList.add('pwa-installed');
	document.body.classList.remove('has-infobar');
	document.documentElement.style.setProperty('--infobar-h', '0px');
	showToast("App installed! You can now share videos directly from YouTube.", "success");
	
	// Hide install button
	if (elements.installButton) elements.installButton.style.display = "none";
});

// Check if app is already installed or can be installed
function checkInstallability() {
	if (!elements.installButton) return;

	// Check if already installed (standalone mode)
	if (window.matchMedia('(display-mode: standalone)').matches || 
		window.navigator.standalone === true) {
		elements.installButton.style.display = "none";
		return;
	}

	// Check for different browser capabilities
	const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
	const isEdge = /Edg/.test(navigator.userAgent);
	const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
	const isFirefox = /Firefox/.test(navigator.userAgent);
	const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

	// Enable install button with appropriate text based on browser
	if (state.deferredPrompt) {
		// Chrome/Edge with beforeinstallprompt support
		elements.installButton.disabled = false;
		elements.installButton.querySelector('.button-text').textContent = "Install App";
	} else if (isSafari && isMobile) {
		// Safari on iOS
		elements.installButton.disabled = false;
		elements.installButton.querySelector('.button-text').textContent = "Add to Home Screen";
	} else if (isFirefox && isMobile) {
		// Firefox on mobile
		elements.installButton.disabled = false;
		elements.installButton.querySelector('.button-text').textContent = "Add to Home Screen";
	} else if (isMobile) {
		// Other mobile browsers
		elements.installButton.disabled = false;
		elements.installButton.querySelector('.button-text').textContent = "Add to Home Screen";
	} else {
		// Desktop browsers without beforeinstallprompt
		elements.installButton.disabled = false;
		elements.installButton.querySelector('.button-text').textContent = "Install Instructions";
	}
}

// Show installation instructions for different browsers
function showInstallInstructions() {
	const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
	const isEdge = /Edg/.test(navigator.userAgent);
	const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
	const isFirefox = /Firefox/.test(navigator.userAgent);
	const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

	let instructions = "";

	if (isSafari && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
		instructions = "To install this app:\n\n1. Tap the Share button (⬆️) at the bottom\n2. Scroll down and tap 'Add to Home Screen'\n3. Tap 'Add' to confirm";
	} else if (isSafari) {
		instructions = "To install this app:\n\n1. Click the Share button in Safari\n2. Select 'Add to Dock' or bookmark this page\n3. You can also add it to your home screen on mobile";
	} else if (isFirefox && isMobile) {
		instructions = "To install this app:\n\n1. Tap the menu button (⋮)\n2. Tap 'Install'\n3. Or tap 'Add to Home Screen'";
	} else if (isFirefox) {
		instructions = "To install this app:\n\n1. Click the menu button (☰)\n2. Look for 'Install' option\n3. Or bookmark this page for quick access";
	} else if (isChrome && isMobile) {
		instructions = "To install this app:\n\n1. Tap the menu button (⋮)\n2. Tap 'Add to Home screen'\n3. Tap 'Add' to confirm";
	} else if (isChrome || isEdge) {
		instructions = "To install this app:\n\n1. Click the install icon (⊕) in the address bar\n2. Or click the menu button (⋮)\n3. Select 'Install Share to MagicMirror²'";
	} else if (isMobile) {
		instructions = "To install this app:\n\n1. Look for 'Add to Home Screen' in your browser menu\n2. Or bookmark this page for quick access\n3. Some browsers show an install prompt automatically";
	} else {
		instructions = "To install this app:\n\n1. Look for an install icon in your browser's address bar\n2. Or check your browser's menu for install options\n3. You can also bookmark this page for quick access";
	}

	// Create a modal-like toast for instructions
	const instructionToast = document.createElement('div');
	instructionToast.className = 'install-instructions';
	instructionToast.innerHTML = `
		<div class="install-instructions-content">
			<h3>Install App</h3>
			<pre>${instructions}</pre>
			<button class="install-close-btn">Got it!</button>
		</div>
	`;

	document.body.appendChild(instructionToast);

	// Close button functionality
	const closeBtn = instructionToast.querySelector('.install-close-btn');
	closeBtn.addEventListener('click', () => {
		document.body.removeChild(instructionToast);
	});

	// Auto-close after 10 seconds
	setTimeout(() => {
		if (document.body.contains(instructionToast)) {
			document.body.removeChild(instructionToast);
		}
	}, 10000);
}

// Utility functions
/**
 *
 * @param message
 * @param type
 */
function showToast (message, type = "info") {
	if (!elements.toast) return;
	elements.toast.textContent = message;
	elements.toast.className = `toast ${type} show`;
	setTimeout(() => elements.toast.classList.remove("show"), 4000);
}

/**
 *
 * @param endpoint
 * @param options
 */
async function apiRequest (endpoint, options = {}) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

	try {
		const response = await fetch(endpoint, {
			headers: { "Content-Type": "application/json", ...options.headers },
			signal: controller.signal,
			...options
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text().catch(() => response.statusText);
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		return response.json();
	} catch (error) {
		clearTimeout(timeoutId);

		if (error.name === "AbortError") {
			throw new Error("Request timeout - please check your connection");
		}

		throw error;
	}
}

/**
 *
 * @param loading
 */
function setLoading (loading) {
	state.isLoading = loading;
	if (elements.playButton) {
		elements.playButton.disabled = loading;
		const buttonText = elements.playButton.querySelector(".button-text");
		if (buttonText) {
			buttonText.innerHTML = loading ? "<span class=\"loading\"></span> Playing..." : "Play";
		}
	}
	if (elements.stopButton) elements.stopButton.disabled = loading;
}

/**
 *
 * @param online
 * @param text
 */
function updateStatus (online, text) {
	if (elements.statusDot) {
		elements.statusDot.className = `status-dot ${online ? "online" : "offline"}`;
	}
	if (elements.statusText) {
		elements.statusText.textContent = text;
	}
}

// Main functions
/**
 *
 * @param url
 */
async function playVideo (url) {
	if (!url?.trim()) {
		showToast("Please enter a YouTube URL", "warning");
		if (elements.url) elements.url.focus();
		return;
	}

	setLoading(true);
	const isSharedUrl = sessionStorage.getItem("isSharedUrl") === "true";

	try {
		const result = await apiRequest("/api/play", {
			method: "POST",
			body: JSON.stringify({ url })
		});

		if (result.ok) {
			showToast("Playing on MagicMirror²", "success");
			if (elements.url) elements.url.value = "";

			// Fetch and display video information
			if (result.videoId) {
				fetchVideoInfo(result.videoId).then((videoData) => {
					if (videoData) {
						updateVideoInfo(videoData);
					}
				});
			}

			// Show video controls when video starts playing
			showVideoControls();

			// Close window if this was a shared URL from another app
			if (isSharedUrl) {
				// Clear the flag
				sessionStorage.removeItem("isSharedUrl");

				setTimeout(() => {
					// Try multiple closing strategies
					try {
						// Strategy 1: Try to close the window
						window.close();
					} catch (e) {
						// Strategy 2: Try to go back in history
						try {
							if (window.history.length > 1) {
								window.history.back();
							} else {
								// Strategy 3: Redirect to done page
								window.location.href = "/done.html";
							}
						} catch (e2) {
							// Strategy 4: Force redirect to done page
							window.location.replace("/done.html");
						}
					}
				}, 1000); // Reduced delay for faster closing
			}
		} else {
			throw new Error(result.error || "Failed to play video");
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	} finally {
		setLoading(false);
	}
}

/**
 *
 */
async function stopPlayback () {
	setLoading(true);
	try {
		const result = await apiRequest("/api/stop", { method: "POST" });
		if (result.ok) {
			showToast("Playback stopped", "success");
			hideVideoControls();
		} else {
			throw new Error(result.error || "Failed to stop playback");
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	} finally {
		setLoading(false);
	}
}

/**
 * Show video info and controls when a video is playing
 */
function showVideoControls () {
	if (elements.videoInfo) {
		elements.videoInfo.style.display = "block";
	}
	if (elements.videoControls) {
		elements.videoControls.style.display = "block";
	}
}

/**
 * Hide video info and controls when no video is playing
 */
function hideVideoControls () {
	if (elements.videoInfo) {
		elements.videoInfo.style.display = "none";
	}
	if (elements.videoControls) {
		elements.videoControls.style.display = "none";
	}
}

/**
 * Update video information display
 * @param {object} videoData - Video information object
 */
function updateVideoInfo (videoData) {
	if (!videoData || !elements.videoInfo) return;

	// Update thumbnail
	if (elements.videoThumbnail && videoData.thumbnail) {
		elements.videoThumbnail.src = videoData.thumbnail;
		elements.videoThumbnail.alt = `Thumbnail for ${videoData.title || "video"}`;
	}

	// Update title
	if (elements.videoTitle) {
		elements.videoTitle.textContent = videoData.title || "Unknown Title";
	}

	// Update channel
	if (elements.videoChannel) {
		elements.videoChannel.textContent = videoData.channel || "YouTube";
	}

	// Update duration
	if (elements.videoDuration && videoData.duration) {
		elements.videoDuration.textContent = formatDuration(videoData.duration);
	}

	// Update views
	if (elements.videoViews && videoData.views) {
		elements.videoViews.textContent = formatViews(videoData.views);
	}

	// Update published date
	if (elements.videoPublished && videoData.publishedAt) {
		elements.videoPublished.textContent = formatDate(videoData.publishedAt);
	}

	// Update likes
	if (elements.videoLikes && videoData.likes) {
		elements.videoLikes.textContent = formatLikes(videoData.likes);
	}

	// Update category
	if (elements.videoCategory && videoData.category) {
		elements.videoCategory.textContent = videoData.category;
	}

	// Update description
	if (elements.videoDescription && videoData.description) {
		elements.videoDescription.textContent = truncateDescription(videoData.description, 200);
	}

	// Update tags
	if (elements.videoTags && videoData.tags && videoData.tags.length > 0) {
		elements.videoTags.innerHTML = "";
		videoData.tags.slice(0, 8).forEach((tag) => {
			const tagElement = document.createElement("span");
			tagElement.className = "video-tag";
			tagElement.textContent = `#${tag}`;
			elements.videoTags.appendChild(tagElement);
		});
	}

	// Update quality info
	if (elements.videoQuality && videoData.quality) {
		elements.videoQuality.textContent = `Quality: ${videoData.quality}`;
	}

	// Update language
	if (elements.videoLanguage && videoData.language) {
		elements.videoLanguage.textContent = `Language: ${videoData.language}`;
	}

	// Update captions info
	if (elements.videoCaptions && videoData.captions) {
		const captionCount = Array.isArray(videoData.captions) ? videoData.captions.length : 0;
		elements.videoCaptions.textContent = captionCount > 0 ? `${captionCount} caption(s)` : "No captions";
	}

	// Update video URL
	if (elements.videoUrl && videoData.url) {
		elements.videoUrl.textContent = videoData.url;
		elements.videoUrl.title = "Click to copy URL";
		elements.videoUrl.addEventListener("click", () => {
			navigator.clipboard.writeText(videoData.url).then(() => {
				showToast("URL copied to clipboard!", "success");
			}).catch(() => {
				showToast("Failed to copy URL", "error");
			});
		});
	}

	// Update progress info if available
	if (videoData.currentTime !== undefined && videoData.duration) {
		updateVideoProgress(videoData.currentTime, videoData.duration);
	}
}

/**
 * Fetch video information from YouTube API (via backend)
 * @param {string} videoId - YouTube video ID
 */
async function fetchVideoInfo (videoId) {
	if (!videoId) return null;

	try {
		const result = await apiRequest("/api/video-info", {
			method: "POST",
			body: JSON.stringify({ videoId })
		});
		if (result.ok && result.data) {
			return result.data;
		}
		// Handle fallback data from server error response
		if (!result.ok && result.fallback) {
			return result.fallback;
		}
	} catch (error) {
		console.warn("Failed to fetch video info:", error);
	}

	// Final fallback: create basic info from video ID
	return {
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
	};
}

/**
 * Format duration from seconds to MM:SS or HH:MM:SS
 * @param {number} seconds - Duration in seconds
 */
function formatDuration (seconds) {
	if (!seconds || seconds <= 0) return "";

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format view count to human readable format
 * @param {number} views - Number of views
 */
function formatViews (views) {
	if (!views || views <= 0) return "";

	if (views >= 1000000000) {
		return `${(views / 1000000000).toFixed(1)}B views`;
	}
	if (views >= 1000000) {
		return `${(views / 1000000).toFixed(1)}M views`;
	}
	if (views >= 1000) {
		return `${(views / 1000).toFixed(1)}K views`;
	}
	return `${views} views`;
}

/**
 * Format date to relative time (e.g., "2 days ago")
 * @param {string} dateString - ISO date string
 */
function formatDate (dateString) {
	if (!dateString) return "";

	try {
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now - date;
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return "Today";
		if (diffDays === 1) return "Yesterday";
		if (diffDays < 7) return `${diffDays} days ago`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
		if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
		return `${Math.floor(diffDays / 365)} years ago`;
	} catch (error) {
		return "";
	}
}

/**
 * Format like count to human readable format
 * @param {number} likes - Number of likes
 */
function formatLikes (likes) {
	if (!likes || likes <= 0) return "";

	if (likes >= 1000000000) {
		return `${(likes / 1000000000).toFixed(1)}B likes`;
	}
	if (likes >= 1000000) {
		return `${(likes / 1000000).toFixed(1)}M likes`;
	}
	if (likes >= 1000) {
		return `${(likes / 1000).toFixed(1)}K likes`;
	}
	return `${likes} likes`;
}

/**
 * Truncate description text to specified length
 * @param {string} description - Full description text
 * @param {number} maxLength - Maximum length before truncation
 */
function truncateDescription (description, maxLength = 200) {
	if (!description || description.length <= maxLength) return description;

	const truncated = description.substring(0, maxLength);
	const lastSpace = truncated.lastIndexOf(" ");

	// Cut at last space to avoid cutting words in half
	if (lastSpace > maxLength * 0.8) {
		return `${truncated.substring(0, lastSpace)}...`;
	}

	return `${truncated}...`;
}

/**
 * Update video progress display
 * @param {number} currentTime - Current playback time in seconds
 * @param {number} duration - Total video duration in seconds
 */
function updateVideoProgress (currentTime, duration) {
	if (!elements.videoProgress || !duration) return;

	// Show progress section
	elements.videoProgress.style.display = "block";

	// Update time displays
	if (elements.currentTime) {
		elements.currentTime.textContent = formatDuration(currentTime);
	}
	if (elements.totalTime) {
		elements.totalTime.textContent = formatDuration(duration);
	}

	// Update progress bar
	if (elements.progressFill) {
		const percentage = Math.min(100, Math.max(0, (currentTime / duration) * 100));
		elements.progressFill.style.width = `${percentage}%`;
	}
}

/**
 * Get the current skip interval from the custom dropdown
 * @returns {number} Skip interval in seconds
 */
function getSkipInterval () {
	if (!elements.skipSelect) return 10; // Default fallback
	return parseInt(elements.skipSelect.dataset.value, 10) || 10;
}

/**
 * Format seconds to human readable format for button text
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted text (e.g., "10s", "1m", "2m")
 */
function formatSkipInterval (seconds) {
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m`;
}

/**
 * Update the button text to reflect current skip interval
 */
function updateSkipButtonText () {
	const interval = getSkipInterval();
	const formattedInterval = formatSkipInterval(interval);
	
	if (elements.rewindText) {
		elements.rewindText.textContent = `-${formattedInterval}`;
	}
	if (elements.forwardText) {
		elements.forwardText.textContent = `+${formattedInterval}`;
	}
	
	// Update button titles for accessibility
	if (elements.rewindButton) {
		elements.rewindButton.title = `Rewind ${formattedInterval}`;
	}
	if (elements.forwardButton) {
		elements.forwardButton.title = `Forward ${formattedInterval}`;
	}
}

/**
 * Rewind video by the selected interval
 */
async function rewindVideo () {
	const seconds = getSkipInterval();
	const formattedInterval = formatSkipInterval(seconds);
	
	try {
		const result = await apiRequest("/api/control", {
			method: "POST",
			body: JSON.stringify({ action: "rewind", seconds })
		});

		if (result.ok) {
			showToast(`Rewound ${formattedInterval}`, "success");
		} else {
			throw new Error(result.error || "Failed to rewind video");
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	}
}

/**
 * Forward video by the selected interval
 */
async function forwardVideo () {
	const seconds = getSkipInterval();
	const formattedInterval = formatSkipInterval(seconds);
	
	try {
		const result = await apiRequest("/api/control", {
			method: "POST",
			body: JSON.stringify({ action: "forward", seconds })
		});

		if (result.ok) {
			showToast(`Forwarded ${formattedInterval}`, "success");
		} else {
			throw new Error(result.error || "Failed to forward video");
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	}
}

/**
 * Toggle pause/resume video
 */
async function togglePause () {
	const isPaused = elements.pauseButton?.classList.contains("paused");
	const action = isPaused ? "resume" : "pause";

	try {
		const result = await apiRequest("/api/control", {
			method: "POST",
			body: JSON.stringify({ action })
		});

		if (result.ok) {
			if (elements.pauseButton) {
				if (isPaused) {
					elements.pauseButton.classList.remove("paused");
					elements.pauseButton.querySelector(".button-text").textContent = "Pause";
				} else {
					elements.pauseButton.classList.add("paused");
					elements.pauseButton.querySelector(".button-text").textContent = "Resume";
				}
			}
			showToast(isPaused ? "Video resumed" : "Video paused", "success");
		} else {
			throw new Error(result.error || `Failed to ${action} video`);
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	}
}

/**
 * Set overlay mode on MagicMirror
 * @param {string} action - "fullscreen", "windowed", or "toggle"
 */
async function setOverlay (action) {
	try {
		const result = await apiRequest("/api/overlay", {
			method: "POST",
			body: JSON.stringify({ action })
		});

		if (result.ok) {
			const actionText = action === "fullscreen" ? "Fullscreen" : 
			                  action === "windowed" ? "Windowed" : "Toggled";
			showToast(`${actionText} mode activated`, "success");
		} else {
			throw new Error(result.error || "Failed to set overlay mode");
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	}
}

/**
 *
 */
async function saveOptions () {
	if (!elements.captionEnabled) return;

	const options = {
		caption: {
			enabled: elements.captionEnabled.value === "on",
			lang: elements.captionLang.value
		},
		quality: {
			target: elements.qualityTarget.value,
			lock: elements.qualityLock.value === "on"
		}
	};

	try {
		const result = await apiRequest("/api/options", {
			method: "POST",
			body: JSON.stringify(options)
		});

		if (result.ok) {
			localStorage.setItem("stmOptions", JSON.stringify(options));
			showToast("Settings saved", "success");
		} else {
			throw new Error(result.error || "Failed to save options");
		}
	} catch (error) {
		showToast(`Error: ${error.message}`, "error");
	}
}

/**
 *
 */
async function loadOptions () {
	try {
		let options = null;
		const saved = localStorage.getItem("stmOptions");

		if (saved) {
			options = JSON.parse(saved);
		} else {
			const result = await apiRequest("/api/status");
			if (result.ok && result.state) {
				options = {
					caption: result.state.caption,
					quality: result.state.quality
				};
			}
		}

		if (options && elements.captionEnabled) {
			elements.captionEnabled.value = options.caption.enabled ? "on" : "off";
			elements.captionLang.value = options.caption.lang || "en";
			elements.qualityTarget.value = options.quality.target || "auto";
			elements.qualityLock.value = options.quality.lock ? "on" : "off";
		}
	} catch (error) {
		console.error("Failed to load options:", error);
	}
}

/**
 * Enhanced status checking with better video detection
 */
async function checkStatus () {
	try {
		const result = await apiRequest("/api/status");
		updateStatus(true, "Connected");

		// Check if a video is currently playing and show controls if needed
		if (result.ok && result.state) {
			if (result.state.playing && result.state.lastVideoId) {
				// Video is playing - show controls and load video info
				showVideoControls();

				// Always refresh video information to ensure it's current
				try {
					const videoData = await fetchVideoInfo(result.state.lastVideoId);
					if (videoData) {
						updateVideoInfo(videoData);
						console.log("[PWA] Updated video info for:", result.state.lastVideoId);
					}
				} catch (videoError) {
					console.warn("[PWA] Failed to fetch video info:", videoError);
				}
			} else {
				// No video playing - hide controls
				hideVideoControls();
			}
		}
	} catch (error) {
		console.warn("[PWA] Status check failed:", error);
		// Fallback to health check if status endpoint fails
		try {
			await apiRequest("/api/health");
			updateStatus(true, "Connected");
		} catch (healthError) {
			updateStatus(false, "Disconnected");
		}
	}
}

/**
 *
 */
function handleSharedUrl () {
	const urlParams = new URLSearchParams(window.location.search);
	const sharedUrl = urlParams.get("url") || urlParams.get("text");

	if (sharedUrl) {
		// Mark this as a shared URL before clearing the URL
		sessionStorage.setItem("isSharedUrl", "true");
		playVideo(sharedUrl);
		window.history.replaceState({}, document.title, "/");
	}
}

// Theme functions
/**
 *
 */
function initializeTheme () {
	const savedTheme = localStorage.getItem("theme");
	const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const theme = savedTheme || (systemPrefersDark ? "dark" : "light");

	setTheme(theme);

	// Listen for system theme changes
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
		if (!localStorage.getItem("theme")) {
			setTheme(e.matches ? "dark" : "light");
		}
	});
}

/**
 *
 * @param theme
 */
function setTheme (theme) {
	document.documentElement.setAttribute("data-theme", theme);

	if (elements.themeToggle) {
		elements.themeToggle.setAttribute("aria-checked", theme === "light" ? "true" : "false");
	}

	// Update meta theme-color for mobile browsers
	const metaThemeColor = document.querySelector("meta[name=\"theme-color\"]");
	if (metaThemeColor) {
		metaThemeColor.setAttribute("content", theme === "light" ? "#f6f7fb" : "#0b0b0b");
	}

	localStorage.setItem("theme", theme);
}

/**
 *
 */
function toggleTheme () {
	const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
	const newTheme = currentTheme === "dark" ? "light" : "dark";
	setTheme(newTheme);
	showToast(`Switched to ${newTheme} theme`, "success");
}

/**
 *
 */
function setupEventListeners () {
	// Theme toggle
	if (elements.themeToggle) {
		elements.themeToggle.addEventListener("click", toggleTheme);
		elements.themeToggle.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				toggleTheme();
			}
		});
	}

	// Install button - Enhanced for cross-browser compatibility
	if (elements.installButton) {
		elements.installButton.addEventListener("click", async () => {
			if (state.deferredPrompt) {
				// Chrome/Edge with beforeinstallprompt support
				try {
					state.deferredPrompt.prompt();
					const { outcome } = await state.deferredPrompt.userChoice;

					if (outcome === "accepted") {
						showToast("App installed successfully!", "success");
						// Update infobar state after successful install
						document.body.classList.add('pwa-installed');
						document.body.classList.remove('has-infobar');
						document.documentElement.style.setProperty('--infobar-h', '0px');
					} else {
						showToast("Installation cancelled", "info");
					}

					state.deferredPrompt = null;
					deferredInstallPrompt = null;
					elements.installButton.disabled = true;
				} catch (error) {
					console.error("Install failed:", error);
					showToast("Installation failed", "error");
				}
			} else {
				// Other browsers - show instructions
				showInstallInstructions();
			}
		});
	}


	// Play/Stop buttons
	if (elements.playButton) {
		elements.playButton.addEventListener("click", () => playVideo(elements.url.value));
	}
	if (elements.stopButton) {
		elements.stopButton.addEventListener("click", stopPlayback);
	}

	// URL input
	if (elements.url) {
		elements.url.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				playVideo(elements.url.value);
			}
		});
	}

	// Video control buttons
	if (elements.rewindButton) {
		elements.rewindButton.addEventListener("click", rewindVideo);
	}
	if (elements.pauseButton) {
		elements.pauseButton.addEventListener("click", togglePause);
	}
	if (elements.forwardButton) {
		elements.forwardButton.addEventListener("click", forwardVideo);
	}

	// Overlay control buttons
	const mmFSOnButton = document.getElementById("mmFSOn");
	const mmFSOffButton = document.getElementById("mmFSOff");
	if (mmFSOnButton) {
		mmFSOnButton.addEventListener("click", () => setOverlay("fullscreen"));
	}
	if (mmFSOffButton) {
		mmFSOffButton.addEventListener("click", () => setOverlay("windowed"));
	}

	// Refresh status button
	if (elements.refreshStatus) {
		elements.refreshStatus.addEventListener("click", () => {
			elements.refreshStatus.disabled = true;
			checkStatus().finally(() => {
				setTimeout(() => {
					elements.refreshStatus.disabled = false;
				}, 1000); // Prevent spam clicking
			});
		});
	}

	// Custom skip interval dropdown
	initializeCustomDropdown();

	// Options
	[elements.captionEnabled, elements.captionLang, elements.qualityTarget, elements.qualityLock]
		.filter(Boolean)
		.forEach((element) => element.addEventListener("change", saveOptions));

	// Network status
	window.addEventListener("online", () => {
		updateStatus(true, "Connected");
		checkStatus();
	});
	window.addEventListener("offline", () => updateStatus(false, "Offline"));

	// Chrome banner functionality
	initializeChromeBanner();
}

/**
 * Initialize Chrome installation banner for non-Chrome browsers
 */
function initializeChromeBanner() {
	// Check if we should show the Chrome banner
	if (shouldShowChromeBanner()) {
		showChromeBanner();
	}
}

/**
 * Check if Chrome banner should be shown
 * @returns {boolean} True if banner should be shown
 */
function shouldShowChromeBanner() {
	// Don't show if user has dismissed it or app is in standalone mode
	if (localStorage.getItem('chromeBannerDismissed') === 'true' ||
		window.matchMedia('(display-mode: standalone)').matches || 
		window.navigator.standalone === true) {
		return false;
	}

	// Show banner for browsers with poor share target support
	const userAgent = navigator.userAgent;
	const vendor = navigator.vendor || '';
	
	const isRealChrome = /Chrome/.test(userAgent) && /Google Inc/.test(vendor) && 
	                    !/Edg|OPR|DuckDuckGo|Samsung|Huawei/.test(userAgent);
	const isEdge = /Edg/.test(userAgent);
	
	return !isRealChrome && !isEdge;
}

/**
 * Show the Chrome installation banner
 */
function showChromeBanner() {
	const banner = document.getElementById('chromeBanner');
	if (!banner) return;

	banner.style.display = 'block';
	document.body.classList.add('chrome-banner-visible');

	// Setup close button
	const closeButton = document.getElementById('chromeBannerClose');
	if (closeButton) {
		closeButton.addEventListener('click', dismissChromeBanner);
	}

	// Auto-dismiss after 30 seconds
	setTimeout(() => {
		if (banner.style.display !== 'none') {
			dismissChromeBanner();
		}
	}, 30000);
}

/**
 * Dismiss the Chrome banner
 */
function dismissChromeBanner() {
	const banner = document.getElementById('chromeBanner');
	if (!banner) return;

	banner.style.display = 'none';
	document.body.classList.remove('chrome-banner-visible');
	localStorage.setItem('chromeBannerDismissed', 'true');
}

/**
 * Initialize custom dropdown functionality
 */
function initializeCustomDropdown() {
	if (!elements.skipSelect) return;

	const root = elements.skipSelect;
	const btn = root.querySelector('.mm-select__button');
	const menu = root.querySelector('.mm-select__menu');
	const label = root.querySelector('#skipLabel');

	if (!btn || !menu || !label) return;

	function open() {
		root.classList.add('open');
		btn.setAttribute('aria-expanded', 'true');
	}

	function close() {
		root.classList.remove('open');
		btn.setAttribute('aria-expanded', 'false');
	}

	// Toggle dropdown on button click
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		root.classList.contains('open') ? close() : open();
	});

	// Close dropdown when clicking outside
	document.addEventListener('click', (e) => {
		if (!root.contains(e.target)) {
			close();
		}
	});

	// Handle option selection
	menu.addEventListener('click', (e) => {
		const li = e.target.closest('li[role="option"]');
		if (!li) return;

		// Update selection state
		menu.querySelectorAll('li[aria-selected="true"]').forEach(n => n.removeAttribute('aria-selected'));
		li.setAttribute('aria-selected', 'true');

		// Update dropdown value and label
		const seconds = Number(li.dataset.val);
		root.dataset.value = seconds;
		label.textContent = li.textContent.trim();

		// Update skip button text
		updateSkipButtonText();

		// Close dropdown
		close();

		// Optional: Save preference to localStorage
		try {
			localStorage.setItem('skipInterval', seconds.toString());
		} catch (error) {
			console.warn('Failed to save skip interval preference:', error);
		}
	});

	// Keyboard navigation support
	btn.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			root.classList.contains('open') ? close() : open();
		} else if (e.key === 'Escape') {
			close();
		}
	});

	menu.addEventListener('keydown', (e) => {
		const options = Array.from(menu.querySelectorAll('li[role="option"]'));
		const currentIndex = options.findIndex(opt => opt.getAttribute('aria-selected') === 'true');

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const nextIndex = (currentIndex + 1) % options.length;
			options[nextIndex].click();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
			options[prevIndex].click();
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			const selectedOption = options[currentIndex];
			if (selectedOption) selectedOption.click();
		} else if (e.key === 'Escape') {
			close();
			btn.focus();
		}
	});

	// Load saved preference
	try {
		const savedInterval = localStorage.getItem('skipInterval');
		if (savedInterval) {
			const seconds = parseInt(savedInterval, 10);
			const option = menu.querySelector(`li[data-val="${seconds}"]`);
			if (option) {
				// Update selection
				menu.querySelectorAll('li[aria-selected="true"]').forEach(n => n.removeAttribute('aria-selected'));
				option.setAttribute('aria-selected', 'true');
				root.dataset.value = seconds;
				label.textContent = option.textContent.trim();
			}
		}
	} catch (error) {
		console.warn('Failed to load skip interval preference:', error);
	}
}
