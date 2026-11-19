/* Hors connexion : chaque fichier de l'application est gardé au premier chargement.
   Réseau d'abord, sans le cache du navigateur (les mises à jour arrivent tout de suite) ; sans réseau, la copie gardée est servie. */
const CACHE = 'roulpiano-v2';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });   // anciennes copies (ex-versions « TEL ») effacées
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: false }).then(r => r || caches.match(req, { ignoreSearch: true }))));
});
