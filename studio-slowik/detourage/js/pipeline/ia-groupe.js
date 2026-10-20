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
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = 1 / (1 + Math.exp(-y[i]));
    return p;
  }

  // Ajoute la passe p (T x T, zone x0..x0+zw, y0..y0+zh de la grille) a acc, ponderee par wgt.
  function deposer(p, acc, poids, mw, x0, y0, zw, zh, wx, wy) {
    for (let y = 0; y < zh; y++) {
      let fy = ((y + 0.5) / zh) * T - 0.5;
      if (fy < 0) fy = 0; if (fy > T - 1) fy = T - 1;
      const a = fy | 0, b = Math.min(T - 1, a + 1), ty = fy - a;
      for (let x = 0; x < zw; x++) {
        let fx = ((x + 0.5) / zw) * T - 0.5;
        if (fx < 0) fx = 0; if (fx > T - 1) fx = T - 1;
        const c = fx | 0, d = Math.min(T - 1, c + 1), tx = fx - c;
        const v = (p[a * T + c] * (1 - tx) + p[a * T + d] * tx) * (1 - ty) + (p[b * T + c] * (1 - tx) + p[b * T + d] * tx) * ty;
        const q = (y0 + y) * mw + x0 + x, k = wx[x] * wy[y];
        acc[q] += v * k; poids[q] += k;
      }
    }
  }

  // Rampe des bords d'une tuile (cosinus) ; 1 contre le bord de l'image.
  function rampe(n, debut, fin) {
    const w = new Float32Array(n).fill(1), r = Math.max(1, Math.round(n * 0.25));
    for (let i = 0; i < r; i++) {
      const v = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / r);
      if (debut) w[i] = Math.min(w[i], v);
      if (fin) w[n - 1 - i] = Math.min(w[n - 1 - i], v);
    }
    for (let i = 0; i < n; i++) w[i] += 1e-4;
    return w;
  }

  // Silhouette des personnes. img : ImageBitmap de la photo (eventuellement reduite).
  // Precision maximale : photo entiere (+ miroir) puis 4 tuiles de detail. Les tuiles ne font
  // qu'affiner le contour : un morceau entier qu'une tuile retirerait ou ajouterait (une jambe
  // coupee du reste du corps dans la tuile, par exemple) reste celui de la photo entiere.
  // Retourne { m (Float32Array 0..1), mw, mh, ms, fournisseur, passes }.
  async function masque(img, opts) {
    const o = Object.assign({ tuiles: true, dossier: DOSSIER }, opts);
    const t0 = performance.now();
    const S = await session(o.dossier);
    const w = img.width, h = img.height, long = Math.max(w, h);
    const k = Math.min(1, 2048 / long);
    const mw = Math.max(1, Math.round(w * k)), mh = Math.max(1, Math.round(h * k)), n = mw * mh;
    const un = new Float32Array(Math.max(mw, mh)).fill(1);
    const accG = new Float32Array(n), pG = new Float32Array(n);
    for (const miroir of [false, true]) deposer(await passe(S, img, 0, 0, w, h, miroir), accG, pG, mw, 0, 0, mw, mh, un, un);
    const G = accG.map((v, i) => v / pG[i]);
    let passes = 2;
    if (!o.tuiles || long < 1200) return { m: G, mw, mh, ms: Math.round(performance.now() - t0), fournisseur: S.fournisseur, passes };
    const accT = new Float32Array(n), pT = new Float32Array(n);
    const tw = Math.round(mw * 0.6), th = Math.round(mh * 0.6);
    for (const y0 of [0, mh - th]) for (const x0 of [0, mw - tw]) {
      const p = await passe(S, img, (x0 / mw) * w, (y0 / mh) * h, (tw / mw) * w, (th / mh) * h, false);
      deposer(p, accT, pT, mw, x0, y0, tw, th, rampe(tw, x0 > 0, x0 + tw < mw), rampe(th, y0 > 0, y0 + th < mh));
      passes++;
    }
    const M = fusion(G, accT.map((v, i) => v / pT[i]), mw, mh);
    return { m: M, mw, mh, ms: Math.round(performance.now() - t0), fournisseur: S.fournisseur, passes };
  }

  // Contour des tuiles (bande de 1,5 % autour du contour de la photo entiere), sauf grands
  // desaccords (morceau entier).
  function fusion(G, Tl, w, h) {
    const n = w * h, long = Math.max(w, h);
    const { minMax, boxMean, zones } = SL.dt.outils;
    const bord = new Uint8Array(n), diff = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (G[i] > 0.02 && G[i] < 0.98) bord[i] = 255;
      if (Math.abs(Tl[i] - G[i]) > 0.5) diff[i] = 255;
    }
    const bande = minMax(bord, w, h, Math.max(1, Math.round(0.015 * long)), true);
    const z = zones(diff, w, h, 255, 255);
    const garde = new Uint8Array(n);
    const min = 0.0002 * n;
    for (let i = 0; i < z.n; i++) {
      if (z.area[z.root[i]] < min) continue;
      const o = z.Y[i] * w;
      for (let x = z.X0[i]; x <= z.X1[i]; x++) garde[o + x] = 255;
    }
    // poids des tuiles, adouci (pas de couture entre les deux masques)
    const r = Math.max(1, Math.round(0.002 * long));
    const g = minMax(garde, w, h, r, true);
    const wt = new Float32Array(n), tmp = new Float32Array(n), lisse = new Float32Array(n);
    for (let i = 0; i < n; i++) wt[i] = bande[i] && !g[i] ? 1 : 0;
    boxMean(wt, lisse, tmp, w, h, r);
    const M = new Float32Array(n);
    for (let i = 0; i < n; i++) M[i] = G[i] + lisse[i] * (Tl[i] - G[i]);
    return M;
  }

  return { masque, fusion, DOSSIER, CACHE };
})();
