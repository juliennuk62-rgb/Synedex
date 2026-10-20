// IA de groupe hors ligne : silhouette de toutes les personnes d'une photo (modele BiRefNet,
// onnxruntime-web). Sert quand le fond vert ne couvre pas tout le cadre (voir groupe.js).
// Modele : environ 500 Mo (poids en demi-precision, calcul en pleine precision), en morceaux de
// moins de 100 Mo, installe une seule fois (ecran Reglage) puis garde hors ligne.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.iaGroupe = (function () {
  const CACHE = 'ia-slowik-1';
  const DOSSIER = new URL('birefnet-1/', SL.dt.ia.BASE).href;
  const T = 1024; // entree du modele (T x T)
  const MOY = [0.485, 0.456, 0.406], ECART = [0.229, 0.224, 0.225];
  const sessions = new Map(); // dossier -> Promise<{ s, fournisseur }>

  async function lire(url, cache) {
    const r = (cache && await cache.match(url, { ignoreSearch: true })) || await fetch(url);
    if (!r.ok) throw new Error(`IA de groupe non installée (${r.status}).`);
    return r;
  }

  // Modele complet (morceaux mis bout a bout).
  async function octets(dossier) {
    const cache = self.caches ? await caches.open(CACHE).catch(() => null) : null;
    const man = await (await lire(dossier + 'manifeste.json', cache)).json();
    const out = new Uint8Array(man.taille);
    let pos = 0;
    for (const m of man.morceaux) {
      const b = new Uint8Array(await (await lire(dossier + m.nom, cache)).arrayBuffer());
      if (b.length !== m.taille || pos + b.length > out.length) throw new Error('IA de groupe incomplète : réinstallez-la.');
      out.set(b, pos);
      pos += b.length;
    }
    if (pos !== out.length) throw new Error('IA de groupe incomplète : réinstallez-la.');
    return out;
  }

  // Carte graphique (WebGPU) si possible ; sinon processeur (beaucoup plus lent).
  function session(dossier) {
    if (!sessions.has(dossier)) {
      const p = (async () => {
        const ort = SL.dt.ia.moteur();
        const bytes = await octets(dossier);
        if (self.navigator && navigator.gpu) {
          try {
            return { s: await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }), fournisseur: 'carte graphique' };
          } catch (e) { /* pas de WebGPU utilisable : processeur */ }
        }
        return { s: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }), fournisseur: 'processeur' };
      })();
      p.catch(() => sessions.delete(dossier));
      sessions.set(dossier, p);
    }
    return sessions.get(dossier);
  }

  // Une passe du modele sur la zone (sx, sy, sw, sh) de l'image : probabilite « personne » (T x T).
  async function passe(S, img, sx, sy, sw, sh, miroir) {
    const cv = new OffscreenCanvas(T, T);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, T, T);
    const px = ctx.getImageData(0, 0, T, T).data;
    const n = T * T, x = new Float32Array(3 * n);
    for (let y = 0; y < T; y++) for (let c = 0; c < T; c++) {
      const i = (y * T + (miroir ? T - 1 - c : c)) * 4, o = y * T + c;
      x[o] = (px[i] / 255 - MOY[0]) / ECART[0];
      x[n + o] = (px[i + 1] / 255 - MOY[1]) / ECART[1];
      x[2 * n + o] = (px[i + 2] / 255 - MOY[2]) / ECART[2];
    }
    let sortie;
    try {
      sortie = await S.s.run({ [S.s.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, T, T]) });
    } catch (e) {
      // Sans carte graphique, le calcul depasse la memoire permise au navigateur (4 Go).
      if (S.fournisseur === 'processeur') throw new Error('calcul impossible sans carte graphique (WebGPU) : utilisez Chrome ou Edge à jour sur un ordinateur équipé d\'une carte graphique.');
      throw new Error(`calcul impossible sur la carte graphique (${e && e.message ? e.message : e}) : mémoire de la carte insuffisante ?`);
    }
    const y = sortie[S.s.outputNames[0]].data;
    // Passe en miroir : le resultat est remis a l'endroit.
    const p = new Float32Array(n);
    for (let r = 0; r < T; r++) for (let c = 0; c < T; c++) p[r * T + c] = 1 / (1 + Math.exp(-y[r * T + (miroir ? T - 1 - c : c)]));
    return p;
  }

  // Ajoute la passe p (T x T) a acc, agrandie a la grille mw x mh.
  function deposer(p, acc, mw, mh) {
    for (let y = 0; y < mh; y++) {
      let fy = ((y + 0.5) / mh) * T - 0.5;
      if (fy < 0) fy = 0; if (fy > T - 1) fy = T - 1;
      const a = fy | 0, b = Math.min(T - 1, a + 1), ty = fy - a;
      for (let x = 0; x < mw; x++) {
        let fx = ((x + 0.5) / mw) * T - 0.5;
        if (fx < 0) fx = 0; if (fx > T - 1) fx = T - 1;
        const c = fx | 0, d = Math.min(T - 1, c + 1), tx = fx - c;
        acc[y * mw + x] += (p[a * T + c] * (1 - tx) + p[a * T + d] * tx) * (1 - ty) + (p[b * T + c] * (1 - tx) + p[b * T + d] * tx) * ty;
      }
    }
  }

  // Silhouette des personnes. img : ImageBitmap de la photo (eventuellement reduite).
  // Photo entiere et son miroir, moyennes. Pas de tuiles de detail : sur une photo reelle, une tuile
  // qui coupe une personne a mi-corps ne la reconnait plus, et le raccord des tuiles laissait des
  // degrades gris (visage et jambes a moitie transparents).
  // Retourne { m (Float32Array 0..1), mw, mh, ms, fournisseur, passes }.
  async function masque(img, opts) {
    const o = Object.assign({ dossier: DOSSIER }, opts);
    const t0 = performance.now();
    const S = await session(o.dossier);
    const w = img.width, h = img.height;
    const k = Math.min(1, 2048 / Math.max(w, h));
    const mw = Math.max(1, Math.round(w * k)), mh = Math.max(1, Math.round(h * k));
    const m = new Float32Array(mw * mh);
    for (const miroir of [false, true]) deposer(await passe(S, img, 0, 0, w, h, miroir), m, mw, mh);
    for (let i = 0; i < m.length; i++) m[i] *= 0.5;
    return { m, mw, mh, ms: Math.round(performance.now() - t0), fournisseur: S.fournisseur, passes: 2 };
  }

  return { masque, DOSSIER, CACHE };
})();
