// Chaine complete de detourage d'une photo, et definition des reglages.
// Toutes les distances sont en ‰ du grand cote : meme rendu en apercu et en pleine definition.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.REGLAGES = [
  { k: 'tolerance', label: 'Tolérance', groupe: 'essentiel', min: 0, max: 100, step: 1,
    aide: 'Plus haut : retire davantage de vert, y compris dans les bords.' },
  { k: 'cheveux', label: 'Détail des cheveux', groupe: 'essentiel', min: 0, max: 100, step: 1,
    aide: 'Plus haut : mèches plus fines et plus transparentes.' },
  { k: 'reflet', label: 'Reflet vert', groupe: 'essentiel', min: 0, max: 100, step: 1,
    aide: 'Retire la teinte verte renvoyée par le fond sur le sujet.' },
  { k: 'opacite', label: 'Opacité du sujet', min: 0, max: 100, step: 1,
    aide: 'Plus haut : le sujet devient plein plus vite (moins de transparences parasites).' },
  { k: 'eclairage', label: 'Corriger l\'éclairage du fond', type: 'bool',
    aide: 'Compense un fond plus sombre dans les coins ou en bas.' },
  { k: 'ombres', label: 'Suppression des ombres au sol', min: 0, max: 100, step: 1 },
  { k: 'matting', label: 'Affinage des bords', min: 0, max: 100, step: 1,
    aide: 'Recalcule finement la transparence le long de la silhouette.' },
  { k: 'bande', label: 'Largeur du bord affiné', min: 0.5, max: 8, step: 0.5, unite: '‰' },
  { k: 'decontamination', label: 'Nettoyer la couleur des bords', type: 'bool',
    aide: 'Retire le vert mélangé dans les pixels semi-transparents (cheveux).' },
  { k: 'bords', label: 'Couleur des bords prise dans le sujet', min: 0, max: 100, step: 1,
    aide: 'Évite les lueurs colorées (rouges, vertes) autour des cheveux.' },
  { k: 'methode', label: 'Méthode du reflet vert', type: 'choix',
    options: [['limite', 'Standard'], ['moyenne', 'Forte']] },
  { k: 'luminosite', label: 'Compensation de luminosité', min: 0, max: 100, step: 1,
    aide: 'Rend la lumière retirée avec le vert (évite les bords trop sombres).' },
  { k: 'erosion', label: 'Rétrécir (+) / élargir (−) le contour', min: -5, max: 5, step: 0.5, unite: '‰' },
  { k: 'adoucissement', label: 'Adoucissement du contour', min: 0, max: 5, step: 0.1, unite: '‰' },
  { k: 'ilots', label: 'Taches isolées à retirer', min: 0, max: 100, step: 1 },
  { k: 'trous', label: 'Trous à boucher dans le sujet', min: 0, max: 100, step: 1,
    aide: 'Attention : un trop grand réglage peut boucher l\'espace entre un bras et le corps.' },
];

SL.dt.DEFAUTS = {
  portraits: {
    tolerance: 35, cheveux: 65, reflet: 80, opacite: 40, eclairage: true, ombres: 100, matting: 100,
    bande: 4, decontamination: true, bords: 80, methode: 'limite', luminosite: 30, erosion: 0, adoucissement: 0,
    ilots: 30, trous: 20,
  },
  groupes: {
    tolerance: 35, cheveux: 55, reflet: 80, opacite: 40, eclairage: true, ombres: 100, matting: 100,
    bande: 2.5, decontamination: true, bords: 80, methode: 'limite', luminosite: 30, erosion: 0, adoucissement: 0,
    ilots: 15, trous: 10,
  },
};

// type : 'portraits' ou 'groupes' (sert au score de confiance).
SL.dt.detourer = function detourer(rgba, w, h, params, analyse, type) {
  const p = Object.assign({}, SL.dt.DEFAUTS.portraits, params);
  const temps = {};
  let t = performance.now();
  const lap = k => { const n = performance.now(); temps[k] = Math.round(n - t); t = n; };
  const long = Math.max(w, h);
  const px = v => (v / 1000) * long;

  const an = analyse || SL.dt.fond.analyser(rgba, w, h);
  lap('analyse');
  const alpha = SL.dt.cle.calculer(rgba, w, h, an, p);
  lap('cle');
  let bande = 0;
  if (p.matting > 0) {
    const R = Math.max(1, Math.round(px(p.bande)));
    bande = SL.dt.matting.affiner(rgba, alpha, w, h, {
      R, r: Math.max(1, Math.round(R * 0.6)), eps: Math.pow(10, -(1.5 + (p.cheveux / 100) * 2.5)), mix: p.matting / 100,
    });
  }
  lap('bords');
  // Taches et trous : seuils en part de la surface de l'image (0,2 % au maximum).
  const { zones, fillZones, minMax } = SL.dt.outils;
  if (p.ilots > 0) {
    const max = (p.ilots / 100) * 0.002 * w * h;
    fillZones(alpha, w, zones(alpha, w, h, 13, 255), area => area < max, 0);
  }
  if (p.trous > 0) {
    const max = (p.trous / 100) * 0.002 * w * h;
    fillZones(alpha, w, zones(alpha, w, h, 0, 242), (area, border) => !border && area < max, 255);
  }
  let a = alpha;
  const er = Math.round(px(Math.abs(p.erosion)));
  if (er >= 1) a = minMax(a, w, h, er, p.erosion < 0);
  const sigma = px(p.adoucissement);
  if (sigma >= 0.3) a = SL.chroma.blurEdges(a, w, h, sigma);
  lap('affinage');
  const confiance = SL.dt.score ? SL.dt.score.calculer(rgba, a, w, h, an, p, type || 'portraits') : null;
  lap('score');
  SL.dt.despill.appliquer(rgba, a, w, h, an, p);
  lap('couleurs');
  return { alpha: a, analyse: an, temps, bande, confiance };
};
