// Traitement par lot : une photo source x tous les fonds coches.
importScripts('../vendor/pako_inflate.min.js', '../vendor/UTIF.js',
  '../core/naming.js', '../core/images.js', '../core/chroma.js', '../core/fsa.js');

const BG_BUDGET = 250 * 1024 * 1024; // memoire max pour les fonds en cache
const bgCache = new Map();
let bgBytes = 0;
let cancelled = false;
let warnedOpaque = false;

async function getBackground(fond) {
  const key = fond.key;
  if (bgCache.has(key)) {
    const bmp = bgCache.get(key);
    bgCache.delete(key);
    bgCache.set(key, bmp); // plus recent
    return bmp;
  }
  const bmp = await SL.images.decode(await fond.handle.getFile());
  const cost = bmp.width * bmp.height * 4;
  while (bgCache.size && bgBytes + cost > BG_BUDGET) {
    const [oldKey, old] = bgCache.entries().next().value;
    bgCache.delete(oldKey);
    bgBytes -= old.width * old.height * 4;
    old.close();
  }
  bgCache.set(key, bmp);
  bgBytes += cost;
  return bmp;
}

async function runTask(t) {
  const s = t.settings;
  const fmt = SL.naming.FORMATS[s.format] || SL.naming.FORMATS.JPEG;
  const label = t.classe ? `${t.classe}/${t.name}` : t.name;
  let subject;
  let outDir;
  try {
    const bmp = await SL.images.decode(await t.handle.getFile());
    subject = SL.chroma.extract(bmp, s);
    bmp.close();
    if (!s.chromaOn && !warnedOpaque && !SL.chroma.hasTransparency(subject)) {
      warnedOpaque = true;
      postMessage({ type: 'log', text: 'Attention : photo sans transparence et détourage désactivé, le fond ne sera pas visible.' });
    }
    outDir = await SL.fsa.subdir(t.outRoot, t.classPath);
  } catch (e) {
    postMessage({ type: 'log', text: `ERREUR lecture ${label} : ${e.message || e}` });
    for (let i = 0; i < t.fonds.length; i++) postMessage({ type: 'step', ok: false });
    return;
  }

  for (const fond of t.fonds) {
    if (cancelled) {
      postMessage({ type: 'step', ok: false, skipped: true });
      continue;
    }
    try {
      const bg = await getBackground(fond);
      const out = SL.chroma.compose(subject, bg, s.mode);
      const blob = await out.convertToBlob({ type: fmt.mime, quality: s.quality / 100 });
      const name = await SL.fsa.uniqueName(outDir, SL.naming.build(s.project, t.n, t.name, fond.name, fmt.ext));
      await SL.fsa.writeFile(outDir, name, blob);
      postMessage({ type: 'log', text: `OK  ${label}  →  ${name}` });
      postMessage({ type: 'step', ok: true });
    } catch (e) {
      postMessage({ type: 'log', text: `ERREUR ${label} + ${fond.name} : ${e.message || e}` });
      postMessage({ type: 'step', ok: false });
    }
  }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'cancel') {
    cancelled = true;
  } else if (m.type === 'task') {
    await runTask(m.task);
    postMessage({ type: 'taskDone' });
  }
};
