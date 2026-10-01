// Registrerar service worker för PWA-stöd (offline-appskal + installerbar app).
// Körs tyst i bakgrunden – misslyckas det (t.ex. i http-utveckling utan https)
// påverkas inte resten av sidan.
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/service-worker.js').catch(() => { /* ingen offline-cache denna gång */ });
	});
}
