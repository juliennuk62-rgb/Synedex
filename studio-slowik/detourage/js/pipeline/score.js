// Score de confiance d'un detourage (0-100) et motifs de doute, pour trier les photos a verifier.
// Calcule sur les couleurs d'origine (avant correction du reflet vert) et le masque final.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.score = (function () {
  const SEUIL = 75; // en dessous : photo « a verifier »

  function calculer(rgba, alpha, w, h, an, p, type) {
    const N = w * h;
    const [kR, kG, kB] = an.cle;
    const kr = kR / kG, kb = kB / kG;
    let plein = 0, partiel = 0, vertGarde = 0, ombre = 0, ombreY = 0;
    // Pixels retires alors que la cle seule y voyait un peu de sujet (vert sombre, pale, ombre) :
    // une grande zone haut placee peut etre un vetement vert.
    const { noir, blanc } = SL.dt.cle.seuils(p);
    const B = new Float32Array(w * 3);
    for (let y = 0, q = 0, i = 0; y < h; y++) {
      let ligne = false;
      for (let x = 0; x < w; x++, q++, i += 4) {
      const a = alpha[q];
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (a <= 12) {
        if (g > r && g > b) {
          if (!ligne) { SL.dt.fond.ligne(an, y, w, h, p.eclairage, B); ligne = true; }
          const sans = (SL.dt.cle.brut(r, g, b, B[x * 3], B[x * 3 + 1], B[x * 3 + 2], 0) - noir) / (blanc - noir);
          if (sans > 0.15) { ombre++; ombreY += y; }
        }
        continue;
      }
      const m = r > b ? r : b;
      if (a >= 243) {
        plein++;
        // pixel garde (plein) mais de la couleur du fond : vetement ou objet vert, fond mal retire
        if (g > 40 && g - m > 15 && Math.abs(r / g - kr) < 0.15 && Math.abs(b / g - kb) < 0.15) vertGarde++;
      } else partiel++;
      }
    }
    const motifs = [];
    let score = 100;
    const retirer = (pts, code, texte) => { score -= pts; motifs.push({ code, texte }); };

    for (const al of an.alertes) {
      if (al.niveau === 'erreur') retirer(60, 'fond', al.texte);
      else if (al.niveau === 'attention') retirer(15, 'fond', al.texte);
      else retirer(5, 'fond', al.texte);
    }
    const part = plein / N;
    if (part < 0.02) retirer(40, 'sujet', 'Sujet presque absent : photo vide ou fond seul ?');
    if (part > 0.97) retirer(40, 'sujet', 'Presque rien n\'a été retiré : est-ce bien un fond vert ?');
    if (plein) {
      const v = vertGarde / plein;
      if (v > 0.003) retirer(Math.min(35, 10 + v * 1000), 'vert', 'Vert conservé dans le sujet (vêtement ou objet vert ?).');
      const t = partiel / plein;
      if (t > 0.12) retirer(Math.min(35, 10 + (t - 0.12) * 150), 'transparence', 'Grandes zones semi-transparentes (vêtement vert, reflet ?).');
    }
    // Portrait (buste) : le sujet touche toujours le bas de l'image. Sinon le buste a ete retire.
    if (type === 'portraits' && plein) {
      let bas = 0;
      const y0 = Math.max(0, h - Math.max(1, Math.round(h * 0.01)));
      for (let q = y0 * w; q < N; q++) if (alpha[q] >= 128) bas++;
      if (bas / ((h - y0) * w) < 0.05) retirer(30, 'buste', 'Le sujet ne touche pas le bas de la photo : buste retiré (vêtement vert ?).');
    }
    if (an.sombre > 0.02) {
      retirer(25, 'sombre', 'Zone verte très sombre au milieu de l\'image, retirée comme le fond : vêtement vert foncé ou ombre portée ?');
    }
    if (ombre > 0.04 * N && ombreY / ombre < 0.8 * h) {
      retirer(25, 'ombre', 'Grande zone verte retirée (ombre ou vêtement vert ?) : vérifiez le sujet.');
    }
    // Trous fermes dans le sujet (assez grands pour ne pas etre du bruit) et taches isolees.
    const { zones } = SL.dt.outils;
    const zt = zones(alpha, w, h, 0, 12);
    let trous = 0;
    const vus = new Uint8Array(zt.n);
    for (let i = 0; i < zt.n; i++) {
      const r = zt.root[i];
      if (vus[r]) continue;
      vus[r] = 1;
      if (!zt.border[r] && zt.area[r] > 0.0005 * N) trous += zt.area[r];
    }
    if (trous > 0.002 * N) retirer(15, 'trou', 'Zone de fond fermée dans le sujet (entre un bras et le corps, ou vêtement vert ?).');
    const zf = zones(alpha, w, h, 13, 255);
    let taches = 0;
    const vus2 = new Uint8Array(zf.n);
    for (let i = 0; i < zf.n; i++) {
      const r = zf.root[i];
      if (vus2[r]) continue;
      vus2[r] = 1;
      if (zf.area[r] > 0.00005 * N && zf.area[r] < 0.003 * N) taches++;
    }
    if (taches) retirer(Math.min(20, taches * 5), 'taches', `${taches} tache${taches > 1 ? 's' : ''} isolée${taches > 1 ? 's' : ''} autour du sujet.`);
    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      score, motifs, aVerifier: score < SEUIL,
      mesures: {
        sujet: +part.toFixed(4), sombre: +(an.sombre || 0).toFixed(4), vertGarde: plein ? +(vertGarde / plein).toFixed(4) : 0,
        transparence: plein ? +(partiel / plein).toFixed(4) : 0, ombre: +(ombre / N).toFixed(4), trous: +(trous / N).toFixed(4), taches,
      },
    };
  }

  return { calculer, SEUIL };
})();
