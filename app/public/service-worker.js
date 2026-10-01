// Service worker för "Mina djur" – gör appskalet installationsbart och
// tillgängligt offline. API-anrop (/api/...) går alltid mot nätverket
// eftersom datan måste vara aktuell och är användarspecifik; endast de
// statiska sidorna/tillgångarna cachas för offline-bruk.
const CACHE_NAME = 'mina-djur-shell-v2';
const APP_SHELL = [
	'/',
	'/index.html',
	'/animal.html',
	'/login.html',
	'/register.html',
	'/styles.css',
	'/app.js',
	'/animal.js',
	'/dark-mode.js',
	'/breeds.js',
	'/example-images.js',
	'/manifest.webmanifest',
	'/icons/icon-192.png',
	'/icons/icon-512.png'
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => cache.addAll(APP_SHELL))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', event => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// Allt API-innehåll och uppladdade filer ska alltid vara färskt.
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

	event.respondWith(
		caches.match(request).then(cached => {
			const network = fetch(request)
				.then(response => {
					if (response && response.ok) {
						const copy = response.clone();
						caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
					}
					return response;
				})
				.catch(() => cached || caches.match('/index.html'));
			return cached || network;
		})
	);
});
