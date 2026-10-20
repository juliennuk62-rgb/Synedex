// Retouches au pinceau : garder, retirer, affiner le bord.
// Un trait = { mode, pts: [[u, v], ...] (0..1), r (rayon en ‰ du grand cote), durete (0..1) } :
// independant de la definition, il sert a l'apercu, a la pleine definition et aux photos suivantes.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.retouches = (function () {
  const COULEURS = { garder: 'rgb(255,0,0)', retirer: 'rgb(0,255,0)', bord: 'rgb(0,0,255)' };
  const MAX = 3000; // definition maximale de la carte des retouches (cote long)

  // Carte des retouches : canal rouge = garder, vert = retirer, bleu = affiner le bord.
  function rasteriser(traits, w, h) {
    if (!traits || !traits.length) return null;
    const s = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    const cv = new OffscreenCanvas(cw, ch);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighten';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const L = Math.max(cw, ch);
    for (const t of traits) {
      if (!COULEURS[t.mode] || !t.pts || !t.pts.length) continue;
      const r = Math.max(0.5, (t.r / 1000) * L);
      const flou = (1 - Math.min(1, Math.max(0, t.durete))) * r * 0.6;
      ctx.filter = flou >= 0.5 ? `blur(${flou.toFixed(1)}px)` : 'none';
      ctx.strokeStyle = ctx.fillStyle = COULEURS[t.mode];
      ctx.lineWidth = Math.max(1, 2 * r - flou);
      ctx.beginPath();
      if (t.pts.length === 1) {
        ctx.arc(t.pts[0][0] * cw, t.pts[0][1] * ch, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(t.pts[0][0] * cw, t.pts[0][1] * ch);
        for (const [u, v] of t.pts.slice(1)) ctx.lineTo(u * cw, v * ch);
        ctx.stroke();
      }
    }
    return { d: ctx.getImageData(0, 0, cw, ch).data, cw, ch, s };
  }

  // Zone « affiner le bord » en pleine definition (ajoutee a la bande du filtre guide).
  function zoneBord(R, w, h) {
    const z = new Uint8Array(w * h);
    let n = 0;
    for (let y = 0; y < h; y++) {
      const ro = Math.min(R.ch - 1, (y * R.s) | 0) * R.cw;
      for (let x = 0; x < w; x++) {
        if (R.d[(ro + Math.min(R.cw - 1, (x * R.s) | 0)) * 4 + 2] > 127) { z[y * w + x] = 1; n++; }
      }
    }
    return n ? z : null;
  }

  // Garder / retirer, directement dans alpha. prot (optionnel) recoit les zones gardees.
  function appliquer(alpha, w, h, R, prot) {
    for (let y = 0; y < h; y++) {
      const ro = Math.min(R.ch - 1, (y * R.s) | 0) * R.cw;
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const i = (ro + Math.min(R.cw - 1, (x * R.s) | 0)) * 4;
        const garder = R.d[i], retirer = R.d[i + 1];
        if (!garder && !retirer) continue;
        let a = alpha[o + x];
        if (garder > a) a = garder;
        if (retirer) a = (a * (255 - retirer) + 127) / 255 | 0;
        alpha[o + x] = a;
        if (prot && garder > prot[o + x]) prot[o + x] = garder;
      }
    }
  }

  return { rasteriser, zoneBord, appliquer, COULEURS };
})();
