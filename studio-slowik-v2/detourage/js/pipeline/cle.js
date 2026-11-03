// Masque du sujet par difference de couleur (principe « Keylight »).
// Chaque pixel est compare a la couleur du fond A CET ENDROIT (carte d'eclairage) :
// un fond inegal ou un vignetage ne laissent pas de voile.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.cle = (function () {
  // Seuils du masque a partir des reglages (0-100).
  function seuils(p) {
    const noir = 0.02 + (p.tolerance / 100) * 0.4;
    const blanc = Math.max(noir + 0.05, 0.99 - (p.opacite / 100) * 0.4);
    return { noir, blanc };
  }

  // Valeur brute 0..1 (1 = sujet) d'un pixel face a la couleur du fond (br, bg, bb).
  // Ombre au sol : un pixel plus sombre que le fond mais de meme teinte est du fond.
  function brut(r, g, b, br, bg, bb, ombres) {
    const s = g - (r > b ? r : b);
    if (s <= 0) return 1;
    let sb = bg - (br > bb ? br : bb);
    if (sb < 8) sb = 8;
    let a = 1 - s / sb;
    if (ombres > 0 && g < bg && g > 0) {
      // Teinte comparee independamment de la luminosite. Les pixels tres sombres (cheveux noirs)
      // sont exclus : leur teinte n'est pas fiable.
      let wgt = (g / bg - 0.15) / 0.15;
      if (wgt > 1) wgt = 1;
      if (wgt > 0) {
        const ar = 1 - (s * bg) / (g * sb);
        if (ar < a) a += (ar - a) * wgt * ombres;
      }
    }
    return a;
  }

  function calculer(rgba, w, h, an, p) {
    const gpu = SL.dt.gpu && SL.dt.gpu.cle(rgba, w, h, an, p);
    if (gpu) return gpu;
    const { noir, blanc } = seuils(p);
    const k = 1 / (blanc - noir);
    const ombres = p.ombres / 100;
    const alpha = new Uint8Array(w * h);
    const B = new Float32Array(w * 3);
    for (let y = 0; y < h; y++) {
      SL.dt.fond.ligne(an, y, w, h, p.eclairage, B);
      let i = y * w * 4;
      const o = y * w;
      for (let x = 0; x < w; x++, i += 4) {
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        if (g <= r || g <= b) { alpha[o + x] = 255; continue; }
        const a = (brut(r, g, b, B[x * 3], B[x * 3 + 1], B[x * 3 + 2], ombres) - noir) * k;
        alpha[o + x] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0;
      }
    }
    return alpha;
  }

  return { calculer, brut, seuils };
})();
