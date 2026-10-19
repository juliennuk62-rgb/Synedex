// Affinage du bord (cheveux) : filtre guide en couleur (He et al.), calcule seulement dans une
// bande autour de la silhouette. L'alpha y devient localement proportionnel aux couleurs de
// l'image : les meches fines restent semi-transparentes au lieu d'etre coupees net.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.matting = (function () {
  const T = 128; // taille des carreaux de calcul

  // Bande incertaine : pixels de bord (alpha intermediaire ou changement brutal), elargie de R.
  function bande(alpha, w, h, R) {
    const E = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const a = alpha[o + x];
        if (a !== 0 && a !== 255) { E[o + x] = 1; continue; }
        if (x + 1 < w && alpha[o + x + 1] !== a) { E[o + x] = 1; E[o + x + 1] = 1; }
        if (y + 1 < h && alpha[o + w + x] !== a) { E[o + x] = 1; E[o + w + x] = 1; }
      }
    }
    return SL.dt.outils.minMax(E, w, h, R, true);
  }

  // Filtre guide couleur sur une zone (rw x rh). I : RVB 0..1 (3 tableaux), P : alpha 0..1.
  function guide(Ir, Ig, Ib, P, rw, rh, r, eps, buf) {
    const n = rw * rh;
    const { boxMean } = SL.dt.outils;
    const tmp = buf.tmp, prod = buf.prod;
    const mean = (src, dst) => boxMean(src, dst, tmp, rw, rh, r);
    const mul = (a, b) => { for (let i = 0; i < n; i++) prod[i] = a[i] * b[i]; return prod; };
    const [mR, mG, mB, mP, rr, rg, rb, gg, gb, bb, rp, gp, bp] = buf.m;
    mean(Ir, mR); mean(Ig, mG); mean(Ib, mB); mean(P, mP);
    mean(mul(Ir, Ir), rr); mean(mul(Ir, Ig), rg); mean(mul(Ir, Ib), rb);
    mean(mul(Ig, Ig), gg); mean(mul(Ig, Ib), gb); mean(mul(Ib, Ib), bb);
    mean(mul(Ir, P), rp); mean(mul(Ig, P), gp); mean(mul(Ib, P), bp);
    const [aR, aG, aB, bK] = buf.a;
    for (let i = 0; i < n; i++) {
      const mr = mR[i], mg = mG[i], mb = mB[i], mp = mP[i];
      // covariance de l'image (3 x 3) + eps, et covariance image / alpha
      const s11 = rr[i] - mr * mr + eps, s12 = rg[i] - mr * mg, s13 = rb[i] - mr * mb;
      const s22 = gg[i] - mg * mg + eps, s23 = gb[i] - mg * mb, s33 = bb[i] - mb * mb + eps;
      const c1 = rp[i] - mr * mp, c2 = gp[i] - mg * mp, c3 = bp[i] - mb * mp;
      // inverse par cofacteurs
      const i11 = s22 * s33 - s23 * s23, i12 = s13 * s23 - s12 * s33, i13 = s12 * s23 - s13 * s22;
      const i22 = s11 * s33 - s13 * s13, i23 = s12 * s13 - s11 * s23, i33 = s11 * s22 - s12 * s12;
      const det = s11 * i11 + s12 * i12 + s13 * i13;
      const inv = det > 1e-12 ? 1 / det : 0;
      const a1 = (i11 * c1 + i12 * c2 + i13 * c3) * inv;
      const a2 = (i12 * c1 + i22 * c2 + i23 * c3) * inv;
      const a3 = (i13 * c1 + i23 * c2 + i33 * c3) * inv;
      aR[i] = a1; aG[i] = a2; aB[i] = a3;
      bK[i] = mp - a1 * mr - a2 * mg - a3 * mb;
    }
    // moyennes des coefficients, puis q = a . I + b
    mean(aR, mR); mean(aG, mG); mean(aB, mB); mean(bK, mP);
    const q = buf.q;
    for (let i = 0; i < n; i++) q[i] = mR[i] * Ir[i] + mG[i] * Ig[i] + mB[i] * Ib[i] + mP[i];
    return q;
  }

  function buffers(n) {
    const f = () => new Float32Array(n);
    return {
      n, tmp: f(), prod: f(), q: f(), Ir: f(), Ig: f(), Ib: f(), P: f(),
      m: Array.from({ length: 13 }, f), a: Array.from({ length: 4 }, f),
    };
  }

  // Modifie alpha (Uint8Array) dans la bande. Retourne le nombre de pixels de bande.
  // opts : { R (largeur de bande, px), r (rayon du filtre, px), eps, mix 0..1, zone (optionnel) }
  function affiner(rgba, alpha, w, h, opts) {
    const { R, r, eps, mix } = opts;
    if (mix <= 0) return 0;
    const U = opts.zone || bande(alpha, w, h, R);
    const M = 2 * r;  // marge : deux moyennes successives
    const tw = Math.ceil(w / T), th = Math.ceil(h / T);
    let buf = null, total = 0;
    const src = new Uint8Array(alpha); // le filtre lit l'alpha d'origine
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const cx0 = tx * T, cy0 = ty * T, cx1 = Math.min(w, cx0 + T), cy1 = Math.min(h, cy0 + T);
      let any = false;
      for (let y = cy0; y < cy1 && !any; y++) for (let x = cx0, o = y * w; x < cx1; x++) if (U[o + x]) { any = true; break; }
      if (!any) continue;
      const rx0 = Math.max(0, cx0 - M), ry0 = Math.max(0, cy0 - M);
      const rx1 = Math.min(w, cx1 + M), ry1 = Math.min(h, cy1 + M);
      const rw = rx1 - rx0, rh = ry1 - ry0, n = rw * rh;
      if (!buf || buf.n < n) buf = buffers(Math.max(n, (T + 2 * M) * (T + 2 * M)));
      for (let y = 0; y < rh; y++) {
        let i = ((ry0 + y) * w + rx0) * 4, so = (ry0 + y) * w + rx0;
        for (let x = 0, ro = y * rw; x < rw; x++, i += 4) {
          buf.Ir[ro + x] = rgba[i] / 255; buf.Ig[ro + x] = rgba[i + 1] / 255; buf.Ib[ro + x] = rgba[i + 2] / 255;
          buf.P[ro + x] = src[so + x] / 255;
        }
      }
      const sub = k => buf[k].subarray(0, n);
      const view = {
        tmp: buf.tmp.subarray(0, n), prod: buf.prod.subarray(0, n), q: buf.q.subarray(0, n),
        m: buf.m.map(a => a.subarray(0, n)), a: buf.a.map(a => a.subarray(0, n)),
      };
      const q = guide(sub('Ir'), sub('Ig'), sub('Ib'), sub('P'), rw, rh, r, eps, view);
      for (let y = cy0; y < cy1; y++) {
        const o = y * w, ro = (y - ry0) * rw - rx0;
        for (let x = cx0; x < cx1; x++) {
          if (!U[o + x]) continue;
          total++;
          const a0 = src[o + x] / 255;
          let v = a0 + (q[ro + x] - a0) * mix;
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          alpha[o + x] = (v * 255 + 0.5) | 0;
        }
      }
    }
    return total;
  }

  return { affiner, bande, guide, buffers };
})();
