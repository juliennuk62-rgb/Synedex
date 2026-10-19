// Couleurs du sujet : decontamination des bords et suppression du reflet vert.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.despill = (function () {
  // Ecrit le resultat dans rgba (couleurs corrigees + alpha).
  // Bord semi-transparent : la couleur observee est un melange sujet / fond (C = a.F + (1 - a).B) ;
  // on retrouve la couleur du sujet F a partir de la couleur du fond B a cet endroit.
  function appliquer(rgba, alpha, w, h, an, p) {
    const force = p.reflet / 100;
    const lumin = (p.luminosite / 100) * 0.587;
    const moyenne = p.methode === 'moyenne';
    const B = new Float32Array(w * 3);
    for (let y = 0; y < h; y++) {
      if (p.decontamination) SL.dt.fond.ligne(an, y, w, h, p.eclairage, B);
      let i = y * w * 4;
      const o = y * w;
      for (let x = 0; x < w; x++, i += 4) {
        const a = alpha[o + x];
        rgba[i + 3] = a;
        if (a === 0) continue;
        let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        if (p.decontamination && a < 255) {
          const af = a / 255, inv = 1 - af;
          r = (r - inv * B[x * 3]) / af;
          g = (g - inv * B[x * 3 + 1]) / af;
          b = (b - inv * B[x * 3 + 2]) / af;
          r = r < 0 ? 0 : r > 255 ? 255 : r;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          b = b < 0 ? 0 : b > 255 ? 255 : b;
        }
        if (force > 0) {
          // Peau (rouge > vert) : jamais touchee, le vert n'y est pas en exces.
          const lim = moyenne && r <= g ? (r + b) / 2 : (r > b ? r : b);
          if (g > lim) {
            const ex = (g - lim) * force;
            g -= ex;
            if (lumin > 0) {
              const add = ex * lumin;
              r += add; g += add; b += add;
              if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
            }
          }
        }
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      }
    }
  }

  return { appliquer };
})();
