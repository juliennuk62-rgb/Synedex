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
    const pres = new Uint8Array(n); // cellules qui contiennent un bord (pixel semi-transparent)
    for (let y = 0; y < h; y++) {
      const ro = ((y / s) | 0) * gw;
      let i = y * w * 4;
      for (let x = 0; x < w; x++, i += 4) {
        const av = alpha[y * w + x];
        if (av !== 255) { if (av) pres[ro + ((x / s) | 0)] = 1; continue; }
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
    const col = new Float32Array(n * 3), pur = new Float32Array(n * 3), ok = new Uint8Array(n);
    const vert = (r, g, b) => g / Math.max(r, b, 1);
    for (let c = 0; c < n; c++) {
      const np = P[3][c], nl = L[3][c];
      if (np <= 1e-6 && nl <= 1e-6) continue;
      let k = np / (s * s) / 0.05;
      if (k > 1) k = 1;
      const pr = [0, 0, 0], la = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        pr[j] = np > 1e-6 ? P[j][c] / np : 0;
        la[j] = nl > 1e-6 ? L[j][c] / nl : pr[j];
        col[c * 3 + j] = pr[j] * k + la[j] * (1 - k);
      }
      // couleur « pure » du sujet : la moins verte des deux portees (meches teintees par le fond)
      const ref = np > 1e-6 && vert(pr[0], pr[1], pr[2]) <= vert(la[0], la[1], la[2]) ? pr : la;
      pur[c * 3] = ref[0]; pur[c * 3 + 1] = ref[1]; pur[c * 3 + 2] = ref[2];
      ok[c] = 1;
    }
    // ok : 1 = couleur connue, 2 = connue et pres d'un bord : a moins de 2,5 % du grand cote d'un
    // pixel semi-transparent (toute la masse des cheveux frises ou boucles)
    const portee = SL.dt.outils.minMax(pres, gw, gh, Math.max(1, Math.ceil((0.025 * long) / s)), true);
    for (let c = 0; c < n; c++) if (ok[c] && portee[c]) ok[c] = 2;
    return { s, gw, col, pur, ok };
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
    if (SL.dt.gpu && SL.dt.gpu.couleurs(rgba, alpha, w, h, an, p, prot, I, AMIN)) return;
    const B = new Float32Array(w * 3);
    const demix = p.decontamination && force > 0 && p.demixage !== false;
    for (let y = 0; y < h; y++) {
      let ligneB = false;
      if (p.decontamination) { SL.dt.fond.ligne(an, y, w, h, p.eclairage, B); ligneB = true; }
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
        // Pixel pres du contour dont la couleur est un melange entre le sujet voisin et le fond
        // (meches fines devant le fond vert : la lumiere traverse les cheveux blonds) : il prend la
        // teinte du sujet voisin, progressivement. Un pixel dont la couleur n'est pas sur le segment
        // sujet - fond (dentelle jaune, col blanc, reflet clair, peau) n'est pas touche.
        if (I && demix) {
          const c0 = ro + ((x / I.s) | 0);
          if (a < 255 ? I.ok[c0] : I.ok[c0] === 2) {
            if (!ligneB) { SL.dt.fond.ligne(an, y, w, h, p.eclairage, B); ligneB = true; }
            const fr = I.pur[c0 * 3], fg = I.pur[c0 * 3 + 1], fb = I.pur[c0 * 3 + 2];
            const br = B[x * 3], bg = B[x * 3 + 1], bb = B[x * 3 + 2];
            const dr = fr - br, dg = fg - bg, db = fb - bb, dd = dr * dr + dg * dg + db * db;
            const wv = (g / Math.max(r, b, 1) - fg / Math.max(fr, fb, 1)) / 0.06;
            if (dd > 900 && wv > 0) {
              const t = ((r - br) * dr + (g - bg) * dg + (b - bb) * db) / dd;
              const er = r - br - t * dr, eg = g - bg - t * dg, eb = b - bb - t * db;
              const wgt = Math.min(1, wv) * Math.min(1, Math.max(0, (1.15 - t) / 0.15)) * Math.min(1, Math.max(0, (t - 0.1) / 0.1))
                * Math.max(0, 1 - (er * er + eg * eg + eb * eb) / (0.25 * dd)) * (prot && prot[o + x] ? force * (1 - prot[o + x] / 255) : force);
              if (wgt > 0) {
                // teinte du sujet voisin, luminosite du pixel gardee
                const k = (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * fr + 0.587 * fg + 0.114 * fb + 1);
                r += (Math.min(255, fr * k) - r) * wgt;
                g += (Math.min(255, fg * k) - g) * wgt;
                b += (Math.min(255, fb * k) - b) * wgt;
              }
            }
          }
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
        const c = I ? ro + ((x / I.s) | 0) : 0;
        // Reflet vert local, pres du contour : un pixel n'est pas plus vert que le sujet plein a
        // cote (cheveux blonds : sinon une teinte olive reste dans les meches).
        if (I && f > 0 && (a < 255 ? I.ok[c] : I.ok[c] === 2)) {
          const cr = I.col[c * 3], cg = I.col[c * 3 + 1], cb = I.col[c * 3 + 2];
          const mi = cr > cb ? cr : cb, m = r > b ? r : b;
          const lim = m * (mi > 1 ? Math.max(cg / mi, 0.5) : 1);
          if (g > lim) g -= (g - lim) * f;
        }
        // Bord : teinte des pixels pleins voisins, luminosite du bord conservee.
        // Plus le pixel est transparent, plus sa teinte (peu fiable) est remplacee.
        if (I && a < 255) {
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
