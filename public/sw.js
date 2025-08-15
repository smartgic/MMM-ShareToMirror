/**
 * Service Worker for MMM-ShareToMirror PWA
 * Provides caching, offline functionality, and share target handling
 */

const CACHE_NAME = "stm-v1.6.6";
const STATIC_CACHE = [
	"/",
	"/index.html",
	"/app.js",
	"/styles.css",
	"/manifest.webmanifest",
	"/browserconfig.xml",
	"/favicon.png",
	"/icon-32.png",
	"/icon-48.png",
	"/icon-64.png",
	"/icon-128.png",
	"/icon-192.png",
	"/icon-256.png",
	"/icon-384.png",
	"/icon-512.png",
	"/done.html"
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(STATIC_CACHE))
			.then(() => self.skipWaiting())
	);
});

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys()
			.then((cacheNames) => {
				return Promise.all(
					cacheNames.map((cacheName) => {
						if (cacheName !== CACHE_NAME) {
							return caches.delete(cacheName);
						}
					})
				);
			})
			.then(() => self.clients.claim())
	);
});

// Fetch event - serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
	const { request } = event;

	// Skip non-GET requests
	if (request.method !== "GET") return;

	// Skip external requests
	if (!request.url.startsWith(self.location.origin)) return;

	event.respondWith(
		caches.match(request)
			.then((response) => {
				// Return cached version or fetch from network
				return response || fetch(request).then((fetchResponse) => {
					// Cache successful responses for static assets
					if (fetchResponse.ok && request.url.match(/\.(html|css|js|png|jpg|svg|ico|webmanifest)$/)) {
						const responseClone = fetchResponse.clone();
						caches.open(CACHE_NAME)
							.then((cache) => cache.put(request, responseClone));
					}
					return fetchResponse;
				});
			})
			).catch(() => {
				// Offline fallback for HTML requests
				if (request.headers.get("accept")?.includes("text/html")) {
					return caches.match("/index.html");
				}
			})
	);
});
