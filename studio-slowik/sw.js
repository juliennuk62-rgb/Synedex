// Fonctionnement hors ligne. Version et liste generees par scripts/build-sw.mjs (ne pas modifier a la main).
// - Pages : reseau d'abord (3 s maximum), sinon la version gardee en memoire.
// - Autres fichiers : memoire d'abord (ouverture immediate), mise a jour en arriere-plan.
const VERSION = '479b8523e3b2';
const CACHE = `slowik-${VERSION}`;
const FILES = [
  // FICHIERS:DEBUT
  './',
  'assets/logo-blanc.png',
  'assets/logo.png',
  'css/style.css',
  'detourage/css/detourage.css',
  'detourage/index.html',
  'detourage/js/data/seance.js',
  'detourage/js/pipeline/cle.js',
  'detourage/js/pipeline/despill.js',
  'detourage/js/pipeline/detourage.js',
  'detourage/js/pipeline/fond.js',
  'detourage/js/pipeline/gpu.js',
  'detourage/js/pipeline/groupe.js',
  'detourage/js/pipeline/ia-groupe.js',
  'detourage/js/pipeline/ia.js',
  'detourage/js/pipeline/matting.js',
  'detourage/js/pipeline/meta.js',
  'detourage/js/pipeline/outils.js',
  'detourage/js/pipeline/retouches.js',
  'detourage/js/pipeline/score.js',
  'detourage/js/ui/ia-groupe.js',
  'detourage/js/ui/lot.js',
  'detourage/js/ui/reglage.js',
  'detourage/js/worker/detourage-worker.js',
  'detourage/js/worker/ia-groupe-worker.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'js/config.js',
  'js/core/chroma.js',
  'js/core/facture-pdf.js',
  'js/core/fsa.js',
  'js/core/images.js',
  'js/core/liste-ocr.js',
  'js/core/naming.js',
  'js/core/planche-contact.js',
  'js/core/planche-demande.js',
  'js/core/utils.js',
  'js/data/choix-sync.js',
  'js/data/cloud.js',
  'js/data/envoi.js',
  'js/data/listes.js',
  'js/data/local-choix.js',
  'js/data/store.js',
  'js/ui/app.js',
  'js/ui/auth.js',
  'js/ui/choix-fonds.js',
  'js/ui/compositeur.js',
  'js/ui/ecoles.js',
  'js/ui/espace-ecole.js',
  'js/ui/facturation.js',
  'js/ui/listes.js',
  'js/ui/planche.js',
  'js/ui/renommage.js',
  'js/vendor/UTIF.js',
  'js/vendor/pako_inflate.min.js',
  'js/vendor/pdf-lib.min.js',
  'js/vendor/supabase.js',
  'js/worker/batch-worker.js',
  'manifest.webmanifest',
  // FICHIERS:FIN
];
const NETWORK_TIMEOUT = 3000;
// IA du detourage et lecteur de listes : cache separe, garde d'une version a l'autre (28 Mo et 8 Mo
// telecharges une seule fois, a la premiere utilisation).
const CACHE_IA = 'ia-slowik-1';
const DOSSIERS_IA = ['/detourage/ia/', '/js/vendor/ocr/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('slowik-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

function fromNetwork(req, cache, timeout) {
  return new Promise((resolve, reject) => {
    const timer = timeout ? setTimeout(() => reject(new Error('lent')), timeout) : null;
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (timer) clearTimeout(timer);
      if (res.ok) cache.put(req, res.clone());
      resolve(res);
    }, err => { if (timer) clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const scope = new URL('./', self.location).pathname;
  // Seulement les fichiers du site (pas la base en ligne ni les images privees).
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(scope)) return;
  if (DOSSIERS_IA.some(d => url.pathname.includes(d))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_IA);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      try {
        return await fromNetwork(req, cache, NETWORK_TIMEOUT);
      } catch (e) {
        // Dossier demande sans nom de page (ex : detourage/) : sa page index.html.
        const dossier = url.pathname.endsWith('/') ? await cache.match(new URL('index.html', url).href, { ignoreSearch: true }) : null;
        return (await cache.match(req, { ignoreSearch: true })) || dossier || (await cache.match('./')) || (await cache.match('index.html'))
          || new Response('Hors ligne', { status: 503 });
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      event.waitUntil(fromNetwork(req, cache).catch(() => {}));
      return hit;
    }
    return fromNetwork(req, cache);
  })());
});
