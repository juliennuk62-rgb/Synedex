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
  { k: 'fondIA', label: 'Détourer aussi hors du fond vert', groupe: 'groupe', type: 'choix',
    options: [['non', 'Non'], ['auto', 'Auto'], ['oui', 'Toujours']],
    aide: 'Auto : quand le fond vert ne couvre pas tout le cadre (salle, sol visibles), l\'IA de groupe détoure les personnes ; la clé verte reste utilisée devant le fond vert.' },
  { k: 'ia', label: 'Protection des personnes par l\'IA', min: 0, max: 100, step: 1,
    aide: 'Garde les vêtements verts : l\'IA reconnaît les personnes. 0 = désactivée.' },
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
    tolerance: 35, cheveux: 65, reflet: 80, opacite: 40, eclairage: true, ombres: 100, matting: 100, ia: 100,
    bande: 4, decontamination: true, bords: 80, methode: 'moyenne', luminosite: 30, erosion: 0, adoucissement: 0,
    ilots: 30, trous: 0, fondIA: 'non',
  },
  groupes: {
    tolerance: 35, cheveux: 55, reflet: 80, opacite: 40, eclairage: true, ombres: 100, matting: 100, ia: 100,
    bande: 2.5, decontamination: true, bords: 80, methode: 'moyenne', luminosite: 30, erosion: 0, adoucissement: 0,
    ilots: 15, trous: 0, fondIA: 'auto',
  },
};

// type : 'portraits' ou 'groupes' (sert au score de confiance).
// extra : { ia (masque de l'IA, voir ia.js), retouches (traits de pinceau, voir retouches.js),
//   iaGroupe (silhouette de toutes les personnes, voir ia-groupe.js : detourage hors du fond vert) }.
SL.dt.detourer = function detourer(rgba, w, h, params, analyse, type, extra) {
  const { ia, retouches, iaGroupe } = extra || {};
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
  // Fond vert incomplet : la cle pres du fond vert, l'IA de groupe ailleurs (salle, sol).
  let vert = null;
  if (iaGroupe) {
    const ai = SL.dt.groupe.agrandir(iaGroupe, w, h);
    vert = SL.dt.groupe.poidsVert(rgba, alpha, ai, w, h, an);
    SL.dt.groupe.combiner(alpha, ai, vert, w, h);
  }
  lap('groupe');
  const carte = retouches && retouches.length && typeof OffscreenCanvas !== 'undefined'
    ? SL.dt.retouches.rasteriser(retouches, w, h) : null;
  let bande = 0;
  const zoneBord = carte ? SL.dt.retouches.zoneBord(carte, w, h) : null;
  if (p.matting > 0 || zoneBord) {
    const R = Math.max(1, Math.round(px(p.bande)));
    let zone = p.matting > 0 ? SL.dt.matting.bande(alpha, w, h, R) : new Uint8Array(w * h);
    if (zoneBord) for (let i = 0; i < zone.length; i++) zone[i] |= zoneBord[i];
    bande = SL.dt.matting.affiner(rgba, alpha, w, h, {
      R, r: Math.max(1, Math.round(R * 0.6)), eps: Math.pow(10, -(1.5 + (p.cheveux / 100) * 2.5)), mix: Math.max(p.matting, zoneBord ? 100 : 0) / 100, zone, reduction: p.reduction,
    });
  }
  lap('bords');
  // IA : interieur des personnes protege (vetement vert). Les bords restent ceux de la cle.
  let prot = null, protege = 0;
  const iaP = iaGroupe || ia;
  if (iaP && p.ia > 0) ({ prot, ajoute: protege } = SL.dt.ia.proteger(alpha, w, h, iaP, p.ia / 100, { surfaceMin: type === 'groupes' ? 0.004 : 0.02, mesures: (extra || {}).mesuresIA }));
  lap('ia');
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
  if (carte) {
    if (!prot) prot = new Uint8Array(w * h);
    SL.dt.retouches.appliquer(a, w, h, carte, prot);
  }
  lap('affinage');
  // Score : mesures statistiques, calculees sur une version reduite (1 500 px) des grandes images.
  let confiance = null;
  if (SL.dt.score) {
    const k = Math.max(1, Math.ceil(long / 1500));
    let [sr, sa, sw, sh] = [rgba, a, w, h];
    if (k > 1) {
      sw = Math.ceil(w / k); sh = Math.ceil(h / k);
      sr = new Uint8ClampedArray(sw * sh * 4); sa = new Uint8Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const q = y * k * w + x * k, d = y * sw + x;
        sa[d] = a[q];
        sr[d * 4] = rgba[q * 4]; sr[d * 4 + 1] = rgba[q * 4 + 1]; sr[d * 4 + 2] = rgba[q * 4 + 2];
      }
    }
    confiance = SL.dt.score.calculer(sr, sa, sw, sh, an, p, type || 'portraits', { protege: protege / (k * k), ia: !!iaP && p.ia > 0, groupe: !!vert });
  }
  lap('score');
  const orig = vert ? new Uint8ClampedArray(rgba) : null;
  SL.dt.despill.appliquer(rgba, a, w, h, an, p, prot);
  if (vert) SL.dt.groupe.couleurs(orig, rgba, a, vert, w, h);
  lap('couleurs');
  return { alpha: a, analyse: an, temps, bande, confiance, protege, groupe: !!vert };
};
