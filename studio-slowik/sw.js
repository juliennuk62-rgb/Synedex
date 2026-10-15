// Fonctionnement hors ligne : les fichiers du site sont gardes en memoire.
// Avec Internet : toujours la derniere version. Sans Internet : la version gardee.
const CACHE = 'slowik-v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/vendor/supabase.js', 'js/vendor/pako_inflate.min.js', 'js/vendor/UTIF.js',
  'js/config.js', 'js/core/naming.js', 'js/core/images.js', 'js/core/chroma.js', 'js/core/fsa.js',
  'js/data/store.js', 'js/data/cloud.js', 'js/data/local-choix.js',
  'js/ui/compositeur.js', 'js/ui/auth.js', 'js/ui/ecoles.js', 'js/ui/choix-fonds.js',
  'js/ui/espace-ecole.js', 'js/ui/app.js', 'js/worker/batch-worker.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('slowik-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Seulement les fichiers du site (pas la base en ligne ni les images privees).
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw e;
    }
  })());
});
