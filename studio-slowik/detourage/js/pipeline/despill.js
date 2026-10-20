// Couleurs du sujet : decontamination des bords, suppression du reflet vert, couleur des bords.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.despill = (function () {
  // En dessous de cette opacite, le demixage n'est plus amplifie : une petite erreur sur la
  // couleur du fond (ou la compression JPEG) donnerait sinon des lueurs rouges dans les cheveux.
  const AMIN = 0.4;

  // Couleur des pixels pleins du sujet autour de chaque endroit (grille reduite, ~320 cellules).
  // Deux portees : proche (0,6 % du grand cote) et large (4 %) pour les meches eloignees.
  function interieur(rgba, alpha, w, h) {
    const long = Math.max(w, h), s = Math.max(1, Math.ceil(long / 320));
    const gw = Math.ceil(w / s), gh = Math.ceil(h / s), n = gw * gh;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), N = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const ro = ((y / s) | 0) * gw;
      let i = y * w * 4;
      for (let x = 0; x < w; x++, i += 4) {
        if (alpha[y * w + x] !== 255) continue;
        const c = ro + ((x / s) | 0);
        const r = rgba[i], b = rgba[i + 2];
        let g = rgba[i + 1];
        const m = r > b ? r : b;
        if (g > m) g = m; // sans reflet vert
        R[c] += r; G[c] += g; B[c] += b; N[c]++;
      }
    }
    const { boxMean } = SL.dt.outils;
    const tmp = new Float32Array(n);
    const flou = (src, r) => {
      const a = new Float32Array(n), b = new Float32Array(n);
      boxMean(src, a, tmp, gw, gh, r);
      boxMean(a, b, tmp, gw, gh, r);
      return b;
    };
    const rs = Math.max(1, Math.round((0.006 * long) / s)), rl = Math.max(2, Math.round((0.04 * long) / s));
    const P = [R, G, B, N].map(a => flou(a, rs)), L = [R, G, B, N].map(a => flou(a, rl));
    const col = new Float32Array(n * 3), ok = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const np = P[3][c], nl = L[3][c];
      if (np <= 1e-6 && nl <= 1e-6) continue;
      let k = np / (s * s) / 0.05;
      if (k > 1) k = 1;
      for (let j = 0; j < 3; j++) {
        const proche = np > 1e-6 ? P[j][c] / np : 0, large = nl > 1e-6 ? L[j][c] / nl : proche;
        col[c * 3 + j] = proche * k + large * (1 - k);
      }
      ok[c] = 1;
    }
    return { s, gw, col, ok };
  }

  // Ecrit le resultat dans rgba (couleurs corrigees + alpha).
  // Bord semi-transparent : la couleur observee est un melange sujet / fond (C = a.F + (1 - a).B) ;
  // on retrouve la couleur du sujet F a partir de la couleur du fond B a cet endroit.
  // prot (optionnel, 0..255) : zones protegees (IA, pinceau « garder ») ou le vert est voulu.
  function appliquer(rgba, alpha, w, h, an, p, prot) {
    const force = p.reflet / 100;
    const lumin = (p.luminosite / 100) * 0.587;
    const moyenne = p.methode === 'moyenne';
    const ext = (p.bords || 0) / 100;
    const I = ext > 0 ? interieur(rgba, alpha, w, h) : null;
    const B = new Float32Array(w * 3);
    for (let y = 0; y < h; y++) {
      if (p.decontamination) SL.dt.fond.ligne(an, y, w, h, p.eclairage, B);
      let i = y * w * 4;
      const o = y * w;
      const ro = I ? ((y / I.s) | 0) * I.gw : 0;
      for (let x = 0; x < w; x++, i += 4) {
        const a = alpha[o + x];
        rgba[i + 3] = a;
        if (a === 0) continue;
        let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        if (p.decontamination && a < 255) {
          const af = a / 255 < AMIN ? AMIN : a / 255, inv = 1 - af;
          r = (r - inv * B[x * 3]) / af;
          g = (g - inv * B[x * 3 + 1]) / af;
          b = (b - inv * B[x * 3 + 2]) / af;
          r = r < 0 ? 0 : r > 255 ? 255 : r;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          b = b < 0 ? 0 : b > 255 ? 255 : b;
        }
        const f = prot && prot[o + x] ? force * (1 - prot[o + x] / 255) : force;
        if (f > 0) {
          // Peau (rouge > vert) : jamais touchee, le vert n'y est pas en exces.
          const lim = moyenne && r <= g ? (r + b) / 2 : (r > b ? r : b);
          if (g > lim) {
            const ex = (g - lim) * f;
            g -= ex;
            if (lumin > 0) {
              const add = ex * lumin;
              r += add; g += add; b += add;
              if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
            }
          }
        }
        // Bord : teinte des pixels pleins voisins, luminosite du bord conservee.
        // Plus le pixel est transparent, plus sa teinte (peu fiable) est remplacee.
        if (I && a < 255) {
          const c = ro + ((x / I.s) | 0);
          if (I.ok[c]) {
            const cr = I.col[c * 3], cg = I.col[c * 3 + 1], cb = I.col[c * 3 + 2];
            const k = (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * cr + 0.587 * cg + 0.114 * cb + 1);
            const wgt = ext * (1 - a / 255);
            r += (Math.min(255, cr * k) - r) * wgt;
            g += (Math.min(255, cg * k) - g) * wgt;
            b += (Math.min(255, cb * k) - b) * wgt;
          }
        }
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      }
    }
  }

  return { appliquer };
})();
