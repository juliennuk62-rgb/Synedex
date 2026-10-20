// Detourage hors du fond vert : photo de groupe dont le fond ne couvre pas tout le cadre (salle,
// fenetres, sol visibles). L'IA de groupe (ia-groupe.js) trouve toutes les personnes. La cle garde
// le dernier mot la ou le fond vert est juste derriere (meches fines, reflet vert retire) ;
// ailleurs, le contour vient de l'IA, affine ensuite sur l'image (filtre guide).
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.groupe = (function () {
  // Masque de l'IA (grille mw x mh, 0..1) agrandi a la taille de la photo (0..255).
  function agrandir(ia, w, h) {
    const { m, mw, mh } = ia;
    const out = new Uint8Array(w * h);
    const row = new Float32Array(mw);
    const X0 = new Int32Array(w), TX = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let fx = ((x + 0.5) / w) * mw - 0.5;
      if (fx < 0) fx = 0; if (fx > mw - 1) fx = mw - 1;
      X0[x] = fx | 0; TX[x] = fx - X0[x];
    }
    for (let y = 0; y < h; y++) {
      let fy = ((y + 0.5) / h) * mh - 0.5;
      if (fy < 0) fy = 0; if (fy > mh - 1) fy = mh - 1;
      const y0 = fy | 0, y1 = Math.min(mh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < mw; x++) row[x] = m[y0 * mw + x] * (1 - ty) + m[y1 * mw + x] * ty;
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = X0[x], tx = TX[x];
        const v = row[x0] * (1 - tx) + row[x0 + 1 < mw ? x0 + 1 : x0] * tx;
        out[o + x] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
      }
    }
    return out;
  }

  // Poids de la cle (0..255) : 255 pres du fond vert visible, 0 ailleurs (salle).
  // Fond vert visible : la cle et l'IA y voient du fond, et la couleur est celle du fond.
  // Salle visible (l'IA y voit du fond, mais pas vert : mur, fenetre, support du fond) : la cle
  // n'y sert pas, meme a cote du tissu vert.
  function poidsVert(rgba, cle, ai, w, h, an) {
    const long = Math.max(w, h), s = Math.max(1, Math.ceil(long / 512));
    const gw = Math.ceil(w / s), gh = Math.ceil(h / s), n = gw * gh;
    const vert = new Float32Array(n), salle = new Float32Array(n), tot = new Float32Array(n);
    const [kR, kG, kB] = an.cle, kr = kR / kG, kb = kB / kG;
    const pas = Math.max(1, s >> 1);
    for (let y = 0; y < h; y += pas) {
      const ro = ((y / s) | 0) * gw;
      for (let x = 0; x < w; x += pas) {
        const q = y * w + x, c = ro + ((x / s) | 0);
        tot[c]++;
        if (ai[q] > 40) continue;
        const r = rgba[q * 4], g = rgba[q * 4 + 1], b = rgba[q * 4 + 2];
        if (cle[q] <= 12 && g >= kG * 0.2 && g > (r > b ? r : b) && Math.abs(r / g - kr) < 0.25 && Math.abs(b / g - kb) < 0.25) vert[c]++;
        else if (cle[q] > 200) salle[c]++;
      }
    }
    const bin = new Uint8Array(n), bs = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      if (!tot[c]) continue;
      if (vert[c] >= 0.3 * tot[c]) bin[c] = 255;
      if (salle[c] >= 0.3 * tot[c]) bs[c] = 255;
    }
    // Le contour des personnes devant le fond vert est a moins de 1 % du grand cote du vert visible.
    const { minMax, boxMean } = SL.dt.outils;
    const D = Math.max(1, Math.round((0.01 * long) / s));
    const d = minMax(bin, gw, gh, D, true), ds = minMax(bs, gw, gh, Math.max(1, Math.round((0.003 * long) / s)), true);
    const f = new Float32Array(n), g2 = new Float32Array(n), tmp = new Float32Array(n);
    for (let c = 0; c < n; c++) f[c] = ds[c] ? 0 : d[c];
    const rl = Math.max(1, D >> 2);
    boxMean(f, g2, tmp, gw, gh, rl);
    boxMean(g2, f, tmp, gw, gh, rl);
    return agrandir({ m: f.map(v => v / 255), mw: gw, mh: gh }, w, h);
  }

  // Masque combine (modifie cle). Pres du fond vert :
  // - pixel melange au vert (meches, bords) : la cle, limitee a la silhouette de l'IA un peu elargie ;
  // - pixel sans vert : la silhouette de l'IA (a 2 ou 3 pixels pres) ; un mur, une fenetre ou le
  //   pied du support du fond, juste a cote du tissu vert, ne deviennent pas du sujet.
  // Ailleurs (salle), l'IA.
  function combiner(cle, ai, vert, w, h) {
    const long = Math.max(w, h), { minMax } = SL.dt.outils;
    const large = minMax(ai, w, h, Math.max(1, Math.round(0.006 * long)), true);
    const proche = minMax(ai, w, h, Math.max(1, Math.round(0.0015 * long)), true);
    for (let i = 0; i < cle.length; i++) {
      const v = vert[i];
      if (!v) { cle[i] = ai[i]; continue; }
      let k;
      if (cle[i] >= 250) {
        k = proche[i] * 2;
        if (k > cle[i]) k = cle[i];
      } else {
        k = large[i] * 3;
        if (k > cle[i]) k = cle[i];
      }
      cle[i] = (v * k + (255 - v) * ai[i] + 127) / 255 | 0;
    }
  }

  // Couleurs hors du fond vert (apres la correction du reflet vert, faite sur rgba) :
  // - pixels pleins : couleurs d'origine (pas de correction de vert sur un vetement vert de la salle) ;
  // - bords semi-transparents : la couleur de la salle juste derriere (fond voisin) est retiree,
  //   comme le vert l'est pres du fond vert.
  function couleurs(orig, rgba, alpha, vert, w, h) {
    const long = Math.max(w, h), s = Math.max(1, Math.ceil(long / 640));
    const gw = Math.ceil(w / s), gh = Math.ceil(h / s), n = gw * gh;
    const S = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let y = 0; y < h; y++) {
      const ro = ((y / s) | 0) * gw;
      for (let x = 0; x < w; x++) {
        const q = y * w + x;
        if (alpha[q] || vert[q] > 128) continue;
        const c = ro + ((x / s) | 0);
        S[0][c] += orig[q * 4]; S[1][c] += orig[q * 4 + 1]; S[2][c] += orig[q * 4 + 2]; S[3][c]++;
      }
    }
    const rb = Math.max(1, Math.round((0.01 * long) / s));
    const tmp = new Float32Array(n), F = S.map(a => { const o = new Float32Array(n); SL.dt.outils.boxMean(a, o, tmp, gw, gh, rb); return o; });
    const AMIN = 0.4;
    for (let y = 0; y < h; y++) {
      const ro = ((y / s) | 0) * gw;
      for (let x = 0; x < w; x++) {
        const q = y * w + x, v = vert[q];
        if (v === 255) continue;
        const a = alpha[q], i = q * 4;
        if (!a) continue;
        let r = orig[i], g = orig[i + 1], b = orig[i + 2];
        if (a < 255) {
          const c = ro + ((x / s) | 0), nb = F[3][c];
          if (nb > 0.01) {
            const af = a / 255 < AMIN ? AMIN : a / 255, inv = 1 - af;
            r = (r - inv * F[0][c] / nb) / af; g = (g - inv * F[1][c] / nb) / af; b = (b - inv * F[2][c] / nb) / af;
            r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
          }
        }
        if (v) {
          const k = v / 255;
          r += (rgba[i] - r) * k; g += (rgba[i + 1] - g) * k; b += (rgba[i + 2] - b) * k;
        }
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      }
    }
  }

  return { agrandir, poidsVert, combiner, couleurs };
})();
