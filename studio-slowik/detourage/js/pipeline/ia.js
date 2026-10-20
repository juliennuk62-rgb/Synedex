// IA hors ligne : silhouette des personnes (modele MODNet, onnxruntime-web).
// Elle ne decoupe jamais seule : elle protege l'interieur des personnes (vetement vert) dans la cle.
// Le moteur et le modele (28 Mo) sont charges a la premiere utilisation puis gardes hors ligne.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.ia = (function () {
  // Dossier ia/ du module, depuis le worker (js/worker/) ou depuis la page (detourage/).
  const BASE = new URL(self.location.href.includes('/js/worker/') ? '../../ia/' : 'ia/', self.location.href).href;
  let chargement = null;
  let fournisseur = '';

  // Moteur ONNX Runtime (partage avec l'IA de groupe, voir ia-groupe.js).
  function moteur() {
    if (!self.ort) {
      if (typeof importScripts === 'function') importScripts(BASE + 'ort/ort.webgpu.min.js');
      else throw new Error('IA disponible seulement dans les calculs en arrière-plan.');
    }
    ort.env.wasm.wasmPaths = BASE + 'ort/';
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.logLevel = 'error';
    // PC a deux cartes (integree + dediee) : la plus puissante.
    if (ort.env.webgpu) ort.env.webgpu.powerPreference = 'high-performance';
    return self.ort;
  }

  function charger() {
    if (!chargement) {
      chargement = (async () => {
        moteur();
        const modele = BASE + 'modnet/modnet.onnx';
        if (self.navigator && navigator.gpu) {
          try {
            const s = await ort.InferenceSession.create(modele, { executionProviders: ['webgpu'] });
            fournisseur = 'carte graphique';
            return s;
          } catch (e) { /* pas de WebGPU utilisable : processeur */ }
        }
        const s = await ort.InferenceSession.create(modele, { executionProviders: ['wasm'] });
        fournisseur = 'processeur';
        return s;
      })();
      chargement.catch(() => { chargement = null; });
    }
    return chargement;
  }

  // Masque « personne » (0..1) basse definition. court : taille du petit cote envoye au modele.
  async function masque(rgba, w, h, court) {
    const t0 = performance.now();
    const session = await charger();
    const k = court / Math.min(w, h);
    const mw = Math.max(32, Math.round((w * k) / 32) * 32), mh = Math.max(32, Math.round((h * k) / 32) * 32);
    const bmp = await createImageBitmap(new ImageData(rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer), w, h),
      { resizeWidth: mw, resizeHeight: mh, resizeQuality: 'high' });
    const cv = new OffscreenCanvas(mw, mh);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const px = ctx.getImageData(0, 0, mw, mh).data;
    const n = mw * mh, input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      input[i] = px[i * 4] / 127.5 - 1;
      input[n + i] = px[i * 4 + 1] / 127.5 - 1;
      input[2 * n + i] = px[i * 4 + 2] / 127.5 - 1;
    }
    const sortie = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, mh, mw]) });
    const m = Float32Array.from(sortie[session.outputNames[0]].data);
    return { m, mw, mh, fournisseur, ms: Math.round(performance.now() - t0) };
  }

  // Protection : interieur des personnes (IA sure d'elle, marge retiree), en pleine definition.
  // Retourne une carte 0..255 et modifie alpha (max). Les bords et cheveux restent ceux de la cle.
  // Securite : une zone de l'IA n'est gardee que si elle recouvre deja du sujet trouve par la cle
  // (visage, mains, cheveux...) : une forme « inventee » dans le fond vert est ignoree.
  function proteger(alpha, w, h, ia, force, opts) {
    // Valeurs mesurees sur une photo reelle (combinaison recoloree en vert) : plus de vetement garde,
    // sans halo vert autour du sujet.
    const o2 = Object.assign({ lissage: 3, seuil: 0.6, plage: 0.25, erosion: 2, surfaceMin: 0.02 }, opts);
    const { mw, mh } = ia;
    let er = Float32Array.from(ia.m);
    // lissage : bouche les « trous » du masque quand le vetement a la couleur du fond
    if (o2.lissage > 0) {
      const tmp = new Float32Array(mw * mh), out = new Float32Array(mw * mh);
      SL.dt.outils.boxMean(er, out, tmp, mw, mh, o2.lissage);
      for (let i = 0; i < er.length; i++) er[i] = Math.max(er[i], out[i]);
    }
    // marge : erosion du masque pour ne jamais deborder sur le fond
    for (let passe = 0; passe < o2.erosion; passe++) {
      const src = er;
      er = new Float32Array(mw * mh);
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        let v = 1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(mh - 1, Math.max(0, y + dy)), xx = Math.min(mw - 1, Math.max(0, x + dx));
          const q = src[yy * mw + xx];
          if (q < v) v = q;
        }
        er[y * mw + x] = v;
      }
    }
    // zones de l'IA et part de sujet (cle) dans chacune
    const bin = new Uint8Array(mw * mh);
    for (let i = 0; i < bin.length; i++) bin[i] = er[i] >= o2.seuil ? 255 : 0;
    const z = SL.dt.outils.zones(bin, mw, mh, 255, 255);
    const sujet = new Float64Array(z.n), tot = new Float64Array(z.n);
    for (let i = 0; i < z.n; i++) {
      const y = Math.min(h - 1, Math.round(((z.Y[i] + 0.5) / mh) * h));
      for (let x = z.X0[i]; x <= z.X1[i]; x++) {
        const xx = Math.min(w - 1, Math.round(((x + 0.5) / mw) * w));
        tot[z.root[i]]++;
        if (alpha[y * w + xx] >= 128) sujet[z.root[i]]++;
      }
    }
    for (let i = 0; i < z.n; i++) {
      const r = z.root[i];
      if (sujet[r] / tot[r] < 0.15) for (let x = z.X0[i]; x <= z.X1[i]; x++) er[z.Y[i] * mw + x] = 0;
    }
    const prot = new Uint8Array(w * h);
    let ajoute = 0;
    const row = new Float32Array(mw);
    for (let y = 0; y < h; y++) {
      let fy = ((y + 0.5) / h) * mh - 0.5;
      if (fy < 0) fy = 0; if (fy > mh - 1) fy = mh - 1;
      const y0 = fy | 0, y1 = Math.min(mh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < mw; x++) row[x] = er[y0 * mw + x] * (1 - ty) + er[y1 * mw + x] * ty;
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let fx = ((x + 0.5) / w) * mw - 0.5;
        if (fx < 0) fx = 0; if (fx > mw - 1) fx = mw - 1;
        const x0 = fx | 0, tx = fx - x0;
        const v = row[x0] * (1 - tx) + row[Math.min(mw - 1, x0 + 1)] * tx;
        let p = (v - o2.seuil) / o2.plage;
        if (p <= 0) continue;
        if (p > 1) p = 1;
        prot[o + x] = (p * force * 255 + 0.5) | 0;
      }
    }
    // Zones que l'IA ajouterait au sujet. Seules les grandes (un vetement vert : au moins 2 % d'un
    // portrait, 0,4 % d'une photo de groupe) sont gardees. Les petits trous de fond entre des
    // boucles, ou un coin de fond sombre que l'IA prend pour la personne, restent du fond.
    const ajout = new Uint8Array(w * h);
    for (let i = 0; i < ajout.length; i++) if (prot[i] > alpha[i] + 8) ajout[i] = 1;
    const za = SL.dt.outils.zones(ajout, w, h, 1, 1);
    const min = o2.surfaceMin * w * h;
    for (let i = 0; i < za.n; i++) {
      if (za.area[za.root[i]] >= min) continue;
      const d = za.Y[i] * w;
      for (let x = za.X0[i]; x <= za.X1[i]; x++) prot[d + x] = 0;
    }
    if (o2.mesures) o2.mesures.zones = [...new Set(za.root)].filter(r => za.area[r] >= min)
      .map(r => ({ surface: +(za.area[r] / (w * h)).toFixed(4) }));
    for (let i = 0; i < prot.length; i++) {
      const pv = prot[i];
      if (!pv) continue;
      // Le vert n'est garde (reflet vert non retire) que dans ces grandes zones ajoutees : ailleurs
      // (cheveux, peau), le vert reste un reflet du fond a retirer.
      if (!ajout[i]) { prot[i] = 0; continue; }
      if (alpha[i] < pv) { if (pv - alpha[i] > 128) ajoute++; alpha[i] = pv; }
    }
    return { prot, ajoute };
  }

  return { masque, proteger, charger, moteur, BASE };
})();
