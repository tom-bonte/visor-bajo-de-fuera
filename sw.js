// Service Worker para Visor Bajo de Fuera (PWA & Offline App Shell)
const CACHE_NAME = 'bdf-cache-v7.3';

const PRECACHE_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './error-reporter.js',
    './config.js',
    './utils.js',
    './bdf-logic.js',
    './state.js',
    './firebase-service.js',
    './export.js',
    './ui.js',
    './app.js',
    './manifest.json',
    './visor_favicon.webp',
    './apple-touch-icon.png',
    './icon-192.png',
    './icon-512.png',
    './ACBRM logo.png'
];

// Instalación: precache del shell de la aplicación
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                console.warn('[SW] Algunos recursos no pudieron precachearse:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Activación: limpieza de cachés antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: estrategia para red y caché
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // No interceptar peticiones de Firestore, Firebase Auth, Google APIs ni extensiones
    if (
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('identitytoolkit.googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.protocol === 'chrome-extension:'
    ) {
        return;
    }

    // Network-first con fallback a caché para navegación principal (HTML)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match('./index.html') || caches.match(request))
        );
        return;
    }

    // El código de la app (JS y CSS propios) va SIEMPRE a la red primero, con la
    // caché sólo como paracaídas si no hay cobertura.
    //
    // Antes era al revés ("stale-while-revalidate"): se servía la copia guardada
    // y la nueva se descargaba para la PRÓXIMA vez. Eso significa que tras cada
    // despliegue la primera carga seguía ejecutando el código viejo, y peor aún,
    // podía mezclar ficheros nuevos con ficheros viejos, con errores imposibles
    // de entender. Para una app que se actualiza a diario, eso no vale.
    const esCodigoPropio = url.origin === self.location.origin &&
        /\.(js|css|html)$/.test(url.pathname);

    if (esCodigoPropio) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Stale-While-Revalidate para imágenes, fuentes y CDNs: eso sí puede ser viejo.
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
