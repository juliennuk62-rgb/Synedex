// Traitement par lot : une photo source x tous les fonds coches.
importScripts('../vendor/pako_inflate.min.js', '../vendor/UTIF.js',
  '../core/naming.js', '../core/images.js', '../core/chroma.js', '../core/fsa.js');

const MB = 1024 * 1024;
let cancelled = false;
let warnedOpaque = false;

// Petit cache memoire « le plus ancien sort en premier », limite en octets.
function makeCache(budget, size) {
  const map = new Map();
  let used = 0;
  return {
    get(key) {
      const v = map.get(key);
      if (v) { map.delete(key); map.set(key, v); }
      return v;
    },
    set(key, v) {
      const cost = size(v);
      if (cost > budget) return v;          // trop gros : on ne garde pas
      while (map.size && used + cost > budget) {
        const [k, old] = map.entries().next().value;
        map.delete(k);
        used -= size(old);
        if (old.close) old.close();
      }
      map.set(key, v);
      used += cost;
      return v;
    },
  };
}
const px = v => v.width * v.height * 4;
let originals = null;   // fonds decodes
let fitted = null;      // fonds deja ajustes a la taille des photos

async function getFitted(fond, w, h, mode) {
  const key = `${fond.key}|${w}x${h}|${mode}`;
  const hit = fitted.get(key);
  if (hit) return hit;
  let bmp = originals.get(fond.key);
  if (!bmp) bmp = originals.set(fond.key, await SL.images.decode(await fond.handle.getFile()));
  return fitted.set(key, SL.chroma.fit(bmp, w, h, mode));
}

async function runTask(t) {
  const s = t.settings;
  if (!originals) {
    originals = makeCache((s.cacheMB || 250) * MB * 0.35, px);
    fitted = makeCache((s.cacheMB || 250) * MB * 0.65, px);
  }
  const fmt = SL.naming.FORMATS[s.format] || SL.naming.FORMATS.JPEG;
  const label = t.classe ? `${t.classe}/${t.name}` : t.name;
  let outDir;
  try {
    outDir = await SL.fsa.subdir(t.outRoot, t.classPath);
  } catch (e) {
    postMessage({ type: 'log', text: `ERREUR dossier d'export ${label} : ${e.message || e}` });
    for (let i = 0; i < t.fonds.length; i++) postMessage({ type: 'step', ok: false });
    return;
  }

  // Reprise : les fichiers deja exportes (meme nom) sont sautes.
  const todo = [];
  for (const fond of t.fonds) {
    const name = SL.naming.build(s.project, t.n, t.name, fond.name, fmt.ext);
    if (s.resume && await SL.fsa.exists(outDir, name)) {
      postMessage({ type: 'log', text: `Déjà présent, ignoré : ${t.classe ? t.classe + '/' : ''}${name}` });
      postMessage({ type: 'step', ok: true, existed: true });
    } else {
      todo.push({ fond, name });
    }
  }
  if (!todo.length) return;

  let subject;
  try {
    const bmp = await SL.images.decode(await t.handle.getFile());
    subject = SL.chroma.extract(bmp, s);
    bmp.close();
    if (!s.chromaOn && !warnedOpaque && !SL.chroma.hasTransparency(subject)) {
      warnedOpaque = true;
      postMessage({ type: 'log', text: 'Attention : photo sans transparence et détourage désactivé, le fond ne sera pas visible.' });
    }
  } catch (e) {
    postMessage({ type: 'log', text: `ERREUR lecture ${label} : ${e.message || e}` });
    for (let i = 0; i < todo.length; i++) postMessage({ type: 'step', ok: false });
    return;
  }

  for (const { fond, name: base } of todo) {
    if (cancelled) {
      postMessage({ type: 'step', ok: false, skipped: true });
      continue;
    }
    try {
      const bg = await getFitted(fond, subject.width, subject.height, s.mode);
      const out = SL.chroma.compose(subject, bg, 'stretch');
      const blob = await out.convertToBlob({ type: fmt.mime, quality: s.quality / 100 });
      const name = await SL.fsa.uniqueName(outDir, base);
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
