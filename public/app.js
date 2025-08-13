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
		themeToggle: document.querySelector(".theme-toggle")
	});

	setupEventListeners();
	loadOptions();
	initializeTheme();
	checkStatus();
	handleSharedUrl();
	setInterval(checkStatus, 30000);
});

// Service Worker registration
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("/sw.js").catch(console.error);
}

// PWA install handling
window.addEventListener("beforeinstallprompt", (event) => {
	event.preventDefault();
	state.deferredPrompt = event;
	if (elements.installButton) elements.installButton.disabled = false;
});

window.addEventListener("appinstalled", () => {
	showToast("App installed! You can now share videos directly from YouTube.", "success");
	if (elements.installButton) elements.installButton.style.display = "none";
});

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
 *
 */
async function checkStatus () {
	try {
		await apiRequest("/api/health");
		updateStatus(true, "Connected");
	} catch (error) {
		updateStatus(false, "Disconnected");
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

	// Install button
	if (elements.installButton) {
		elements.installButton.addEventListener("click", async () => {
			if (!state.deferredPrompt) {
				showToast("Use your browser's menu to install this app", "warning");
				return;
			}

			try {
				state.deferredPrompt.prompt();
				const { outcome } = await state.deferredPrompt.userChoice;

				if (outcome === "accepted") {
					showToast("App installed successfully!", "success");
				}

				state.deferredPrompt = null;
				elements.installButton.disabled = true;
			} catch (error) {
				console.error("Install failed:", error);
				showToast("Installation failed", "error");
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
}
