// Photo de classe : groupe detoure (PNG transparent) pose sur un fond, tirage 24 x 18 cm (paysage).
// Le groupe est cale sur ses 4 bords (eleve le plus a gauche, le plus a droite, haut des tetes, bas
// du premier rang) dans le cadre interieur aux marges, sans deformation ; l'etablissement (a gauche)
// et l'annee scolaire (a droite) sont ecrits dans la marge du bas.
// Toutes les mesures sont en cm : le meme dessin sert a l'apercu (petit) et a l'export (300 dpi).
var SL = self.SL = self.SL || {};
SL.photoClasse = (function () {
  const PAGE = { l: 24, h: 18 };   // cm, paysage
  const DPI = 300;
  const REGLAGES = {
    haut: 3, gauche: 3, droite: 3, bas: 4.5,   // marges (cm)
    texteBas: 3,                               // milieu du texte, en cm depuis le bas de la feuille
    taille: 20,                                // points
    police: 'ecole', couleur: 'auto',
    ombre: 'normale',                          // ombre portee du texte : aucune, legere, normale, forte
  };
  // Polices du texte : livrees avec l'application (meme rendu sur tous les ordinateurs et dans
  // le fichier exporte), sauf Classique et Moderne (polices de l'ordinateur).
  const POLICES = {
    ecole: { nom: "Écriture d'école", fichier: 'playwrite-fr-trad.woff2' },
    ecoleModerne: { nom: "Écriture d'école moderne", fichier: 'playwrite-fr-moderne.woff2' },
    craie: { nom: 'Craie', fichier: 'schoolbell.woff2' },
    cahier: { nom: 'Cahier', fichier: 'patrick-hand.woff2' },
    ronde: { nom: 'Ronde', fichier: 'fredoka.woff2' },
    joyeuse: { nom: 'Joyeuse', fichier: 'pacifico.woff2' },
    bd: { nom: 'Bande dessinée', fichier: 'comic-neue.woff2' },
    classique: { nom: 'Classique', famille: 'Georgia, "Times New Roman", serif' },
    moderne: { nom: 'Moderne', famille: '"Segoe UI", Arial, Helvetica, sans-serif' },
  };
  const famille = cle => {
    const p = POLICES[cle] || POLICES.ecole;
    return p.famille || `"Slowik ${cle in POLICES ? cle : 'ecole'}", Georgia, serif`;
  };
  // Dossier des polices : js/vendor/polices (depuis js/core dans la page, depuis js/worker dans le calcul par lot).
  const DOSSIER_POLICES = new URL('../vendor/polices/', (self.document && document.currentScript && document.currentScript.src) || self.location.href).href;
  const chargees = new Map();
  // A attendre avant de dessiner avec une police livree (la page et le calcul par lot ont chacun les leurs).
  function chargerPolice(cle) {
    const p = POLICES[cle];
    if (!p || !p.fichier) return Promise.resolve();
    if (!chargees.has(cle)) {
      const ff = new FontFace(`Slowik ${cle}`, `url(${DOSSIER_POLICES}${p.fichier})`);
      chargees.set(cle, ff.load().then(f => { (self.fonts || document.fonts).add(f); }).catch(e => { chargees.delete(cle); throw e; }));
    }
    return chargees.get(cle);
  }

  const pixels = cm => Math.round(cm / 2.54 * DPI);
  const TAILLE_EXPORT = { w: pixels(PAGE.l), h: pixels(PAGE.h) };   // 2835 x 2126

  // Annee scolaire en cours : elle change au 1er septembre.
  function anneeScolaire(d = new Date()) {
    const y = d.getFullYear();
    return d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  }

  // --- les 4 bords du groupe -------------------------------------------------------------
  // alpha : Uint8ClampedArray RGBA d'une version reduite de la photo (w x h).
  // Les poussieres laissees par le detourage (petites taches isolees) sont ignorees : seules
  // comptent les zones d'au moins 2 % de la plus grande (un eleve un peu a l'ecart compte).
  function bords(data, w, h) {
    const SEUIL = 64;
    const plein = new Uint8Array(w * h);
    let transparent = false;
    for (let i = 0; i < w * h; i++) {
      const a = data[i * 4 + 3];
      if (a > SEUIL) plein[i] = 1;
      if (a < 250) transparent = true;
    }
    if (!transparent) return { x0: 0, y0: 0, x1: w, y1: h, transparent: false };
    const zone = new Int32Array(w * h).fill(-1);
    const zones = [];
    const pile = new Int32Array(w * h);
    for (let i0 = 0; i0 < w * h; i0++) {
      if (!plein[i0] || zone[i0] >= 0) continue;
      const z = { aire: 0, x0: w, y0: h, x1: 0, y1: 0 };
      const id = zones.length;
      let n = 0;
      pile[n++] = i0;
      zone[i0] = id;
      while (n) {
        const i = pile[--n], x = i % w, y = (i / w) | 0;
        z.aire++;
        if (x < z.x0) z.x0 = x; if (x + 1 > z.x1) z.x1 = x + 1;
        if (y < z.y0) z.y0 = y; if (y + 1 > z.y1) z.y1 = y + 1;
        if (x > 0 && plein[i - 1] && zone[i - 1] < 0) { zone[i - 1] = id; pile[n++] = i - 1; }
        if (x < w - 1 && plein[i + 1] && zone[i + 1] < 0) { zone[i + 1] = id; pile[n++] = i + 1; }
        if (y > 0 && plein[i - w] && zone[i - w] < 0) { zone[i - w] = id; pile[n++] = i - w; }
        if (y < h - 1 && plein[i + w] && zone[i + w] < 0) { zone[i + w] = id; pile[n++] = i + w; }
      }
      zones.push(z);
    }
    if (!zones.length) return null;
    const max = Math.max(...zones.map(z => z.aire));
    const gardees = zones.filter(z => z.aire >= Math.max(4, max * 0.02));
    return {
      x0: Math.min(...gardees.map(z => z.x0)), y0: Math.min(...gardees.map(z => z.y0)),
      x1: Math.max(...gardees.map(z => z.x1)), y1: Math.max(...gardees.map(z => z.y1)),
      transparent: true, ignorees: zones.length - gardees.length,
    };
  }

  // Bords du groupe dans les coordonnees de l'image complete (lus sur une version de 2000 px au plus :
  // precision d'environ 1 point sur le tirage).
  async function cadreDuGroupe(bmp) {
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const b = bords(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!b) return null;
    const sx = bmp.width / w, sy = bmp.height / h;
    return {
      x0: Math.max(0, Math.floor(b.x0 * sx)), y0: Math.max(0, Math.floor(b.y0 * sy)),
      x1: Math.min(bmp.width, Math.ceil(b.x1 * sx)), y1: Math.min(bmp.height, Math.ceil(b.y1 * sy)),
      transparent: b.transparent, ignorees: b.ignorees || 0,
    };
  }

  // --- mise en page --------------------------------------------------------------------------
  // Place du groupe sur la feuille (en cm) : le plus grand possible dans le cadre des marges,
  // centre ; il touche les marges gauche et droite (groupe large) ou haut et bas (groupe haut).
  function place(cadre, r) {
    const bw = PAGE.l - r.gauche - r.droite, bh = PAGE.h - r.haut - r.bas;
    const gw = cadre.x1 - cadre.x0, gh = cadre.y1 - cadre.y0;
    const s = Math.min(bw / gw, bh / gh);
    const w = gw * s, h = gh * s;
    return { x: r.gauche + (bw - w) / 2, y: r.haut + (bh - h) / 2, w, h };
  }

  // Fond : remplit toute la feuille (recadre au centre si ses proportions different).
  function couvrir(ctx, fond, W, H) {
    const s = Math.max(W / fond.width, H / fond.height);
    const sw = W / s, sh = H / s;
    ctx.drawImage(fond, (fond.width - sw) / 2, (fond.height - sh) / 2, sw, sh, 0, 0, W, H);
  }

  // Ombre portee : opacite, decalage et flou en part de la taille du texte.
  const OMBRES = {
    legere: { a: 0.4, d: 0.035, f: 0.06 },
    normale: { a: 0.6, d: 0.05, f: 0.09 },
    forte: { a: 0.8, d: 0.07, f: 0.13 },
  };

  // Couleur du texte lisible sur le fond (clair sur fond sombre).
  function couleurTexte(ctx, W, H, r, cm) {
    if (r.couleur === 'blanc') return '#ffffff';
    if (r.couleur === 'noir') return '#1b1b1b';
    const y = Math.round(H - r.texteBas * cm), demi = Math.max(1, Math.round(0.4 * cm));
    const d = ctx.getImageData(0, Math.max(0, y - demi), W, Math.min(H, 2 * demi)).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    return n && s / n < 140 ? '#ffffff' : '#1b1b1b';
  }

  // Dessine la photo de classe sur ctx (W x H pixels, proportions 24 x 18).
  // groupe : image du groupe, cadre : ses 4 bords (cadreDuGroupe), fond : image ou null.
  function dessiner(ctx, W, H, { groupe, cadre, fond, ecole, annee, reglages }) {
    const r = Object.assign({}, REGLAGES, reglages);
    const cm = W / PAGE.l;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (fond) couvrir(ctx, fond, W, H);
    const p = place(cadre, r);
    ctx.drawImage(groupe, cadre.x0, cadre.y0, cadre.x1 - cadre.x0, cadre.y1 - cadre.y0,
      p.x * cm, p.y * cm, p.w * cm, p.h * cm);
    // texte : etablissement a gauche, annee a droite, dans les memes marges que le groupe
    ecole = String(ecole || '').trim();
    annee = String(annee || '').trim();
    if (ecole || annee) {
      const couleur = couleurTexte(ctx, W, H, r, cm);
      const y = H - r.texteBas * cm;
      const gauche = r.gauche * cm, droite = W - r.droite * cm;
      let px = r.taille / 72 * 2.54 * cm;
      const police = famille(r.police);
      ctx.font = `${px}px ${police}`;
      // meme hauteur des minuscules quelle que soit la police (c'est elle que l'oeil compare ; en
      // ecriture d'ecole les majuscules sont bien plus grandes que les minuscules)
      const x = ctx.measureText('x').actualBoundingBoxAscent;
      if (x > 0) { px *= 0.48 * px / x; ctx.font = `${px}px ${police}`; }
      // nom tres long : texte reduit pour ne jamais toucher l'annee (1 cm d'ecart au moins)
      const dispo = droite - gauche - cm;
      const largeur = ctx.measureText(ecole).width + ctx.measureText(annee).width;
      if (largeur > dispo) { px *= dispo / largeur; ctx.font = `${px}px ${police}`; }
      ctx.fillStyle = couleur;
      // ombre portee vers le bas a droite, proportionnelle a la taille du texte (meme rendu dans
      // l'apercu et sur le tirage) ; plus discrete sous un texte fonce
      const ombre = OMBRES[r.ombre];
      if (ombre) {
        const fonce = couleur !== '#ffffff';
        ctx.shadowColor = `rgba(0, 0, 0, ${fonce ? ombre.a * 0.45 : ombre.a})`;
        ctx.shadowOffsetX = ctx.shadowOffsetY = ombre.d * px;
        ctx.shadowBlur = ombre.f * px;
      }
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      if (ecole) ctx.fillText(ecole, gauche, y);
      ctx.textAlign = 'right';
      if (annee) ctx.fillText(annee, droite, y);
    }
    ctx.restore();
    return place(cadre, r);
  }

  // Reperes de l'apercu : cadre des marges et ligne du texte (pointilles) ; avec groupe (place, en
  // cm) : poignees aux 4 coins pour l'agrandir ; centre : trait du milieu de la feuille (aimante).
  function reperes(ctx, W, H, reglages, { groupe, centre } = {}) {
    const r = Object.assign({}, REGLAGES, reglages);
    const cm = W / PAGE.l;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 64, 160, 0.9)';
    ctx.strokeRect(r.gauche * cm, r.haut * cm, W - (r.gauche + r.droite) * cm, H - (r.haut + r.bas) * cm);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(r.gauche * cm, H - r.texteBas * cm);
    ctx.lineTo(W - r.droite * cm, H - r.texteBas * cm);
    ctx.stroke();
    if (centre) {
      ctx.strokeStyle = 'rgba(255, 220, 0, 0.95)';
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
    }
    if (groupe) {
      ctx.setLineDash([]);
      const c = Math.max(8, 0.28 * cm);
      for (const [x, y] of [[groupe.x, groupe.y], [groupe.x + groupe.w, groupe.y], [groupe.x, groupe.y + groupe.h], [groupe.x + groupe.w, groupe.y + groupe.h]]) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(255, 64, 160, 1)';
        ctx.lineWidth = 2;
        ctx.fillRect(x * cm - c / 2, y * cm - c / 2, c, c);
        ctx.strokeRect(x * cm - c / 2, y * cm - c / 2, c, c);
      }
    }
    ctx.restore();
  }

  // Nom du fichier exporte : « CE1 B - Fond bleu.jpg ».
  const nomFichier = (groupe, fond) => `${SL.naming.clean(SL.naming.stem(groupe))} - ${SL.naming.clean(SL.naming.stem(fond))}.jpg`;

  return { PAGE, DPI, REGLAGES, POLICES, famille, chargerPolice, TAILLE_EXPORT, anneeScolaire, bords, cadreDuGroupe, place, dessiner, reperes, nomFichier };
})();
