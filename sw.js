/* GeoTrace – cache de l'application pour un démarrage rapide et hors connexion.
   Les fonds de carte ne sont pas mis en cache : ils demandent une connexion. */
const CACHE = 'geotrace-v2.9.4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/app.css', 'assets/app.js', 'assets/boot.js', 'assets/config.js', 'assets/geo.js', 'assets/maquette.js', 'assets/chantier.js', 'assets/devs.js', 'assets/engins.js', 'assets/engins3d.js', 'assets/look3d.js', 'assets/rig.js', 'assets/rigkin.js', 'assets/art.js', 'assets/phases.js', 'assets/nets.js', 'assets/dtpdf.js', 'assets/planning.js', 'assets/repere.js', 'assets/repere-core.js', 'assets/reseaux.js', 'assets/net3d.js', 'assets/site3d.js', 'vendor/three/utils/BufferGeometryUtils.js', 'assets/symlib.js', 'assets/photoproj.js', 'assets/autocal.js', 'assets/zones3d.js',
  'assets/symbol.png', 'assets/wordmark.svg', 'assets/wordmark-dark.svg', 'assets/sturno-emblem.png', 'assets/logo-geotrace.png', 'assets/favicon.png',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/MarkerCluster.css', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.markercluster.js',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png', 'vendor/leaflet/images/marker-icon.png',
  'vendor/exifr.js', 'vendor/jszip.min.js',
    'vendor/fonts/barlow-latin-400-normal.woff2', 'vendor/fonts/barlow-latin-500-normal.woff2', 'vendor/fonts/barlow-latin-600-normal.woff2', 'vendor/fonts/barlow-latin-700-normal.woff2', 'vendor/fonts/barlow-semi-condensed-latin-600-normal.woff2', 'vendor/fonts/barlow-semi-condensed-latin-700-normal.woff2',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Réseau d'abord pour la page et les scripts (mises à jour), cache en secours hors connexion.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
