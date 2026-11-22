/* Service worker : garde l'appli en cache pour l'ouvrir SANS réseau.
 * Il ne s'active que sur une adresse sécurisée (https:// ou localhost) :
 * c'est une règle des navigateurs. Sur http://192.168…, l'appli marche
 * quand même tant que l'onglet reste ouvert (les votes sont toujours gardés). */
const CACHE = 'lhvc-savim-edition-1.1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data/fiches.js', 'data/exposants.js', 'vendor/qrcode.js', 'vendor/sha256.js', 'vendor/jsQR.js',
  'rankings.js', 'resultats.html', 'manifest.webmanifest', 'img/logo.jpg', 'img/icon-192.png', 'img/icon-512.png', 'img/favicon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;      // les envois au serveur ne passent jamais par le cache
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match('index.html'))));
});
