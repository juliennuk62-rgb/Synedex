// Photo de classe : groupe detoure (PNG transparent) pose sur un fond, tirage 24 x 18 cm (paysage).
// Le groupe est cale sur ses 4 bords (eleve le plus a gauche, le plus a droite, haut des tetes, bas
// du premier rang) dans le cadre interieur aux marges, sans deformation. L'etablissement et l'annee
// scolaire ont chacun leur place sur la feuille, independante du groupe (par defaut dans la marge du
// bas, l'etablissement a gauche et l'annee a droite).
// Toutes les mesures sont en cm : le meme dessin sert a l'apercu (petit) et a l'export (300 dpi).
var SL = self.SL = self.SL || {};
SL.photoClasse = (function () {
  const PAGE = { l: 24, h: 18 };   // cm, paysage
  const DPI = 300;
  const REGLAGES = {
    haut: 3, gauche: 3, droite: 3, bas: 4.5,   // marges (cm)
    // place du texte, independante du groupe (cm) : bord gauche de l'etablissement depuis la gauche
    // de la feuille, bord droit de l'annee depuis la droite, milieu de chaque texte depuis le bas
    ecoleGauche: 3, ecoleBas: 3, anneeDroite: 3, anneeBas: 3,
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

  // Couleur du texte lisible sur ce qu'il y a dessous (clair sur fond sombre), zone en pixels.
  function couleurTexte(ctx, r, x0, y0, x1, y1) {
    if (r.couleur === 'blanc') return '#ffffff';
    if (r.couleur === 'noir') return '#1b1b1b';
    const W = ctx.canvas.width, H = ctx.canvas.height;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 - x0 < 1 || y1 - y0 < 1) return '#1b1b1b';
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    return n && s / n < 140 ? '#ffffff' : '#1b1b1b';
  }

  // Place des deux textes (cm), depuis les reglages ; anciens reglages (une seule ligne de texte
  // dans les marges du groupe) : meme rendu qu'avant.
  function placesTexte(r) {
    const v = (k, ancien) => (Number.isFinite(r[k]) ? r[k] : ancien);
    return {
      ecole: { x: v('ecoleGauche', r.gauche), bas: v('ecoleBas', r.texteBas) },
      annee: { x: PAGE.l - v('anneeDroite', r.droite), bas: v('anneeBas', r.texteBas) },
    };
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
    // texte : l'etablissement part de sa place vers la droite, l'annee finit a sa place ; chacun
    // est pose ou on l'a mis, quelle que soit la place du groupe
    ecole = String(ecole || '').trim();
    annee = String(annee || '').trim();
    const textes = [];
    if (ecole || annee) {
      const pl = placesTexte(r);
      const ye = H - pl.ecole.bas * cm, ya = H - pl.annee.bas * cm;
      const xe = pl.ecole.x * cm, xa = pl.annee.x * cm;
      let px = r.taille / 72 * 2.54 * cm;
      const police = famille(r.police);
      ctx.font = `${px}px ${police}`;
      // meme hauteur des minuscules quelle que soit la police (c'est elle que l'oeil compare ; en
      // ecriture d'ecole les majuscules sont bien plus grandes que les minuscules)
      const x = ctx.measureText('x').actualBoundingBoxAscent;
      if (x > 0) { px *= 0.48 * px / x; ctx.font = `${px}px ${police}`; }
      // texte trop long : reduit pour rester sur la feuille et, sur la meme ligne, ne jamais toucher
      // l'autre texte (1 cm d'ecart au moins)
      const we = ecole ? ctx.measureText(ecole).width : 0, wa = annee ? ctx.measureText(annee).width : 0;
      let k = 1;
      const bord = 0.3 * cm;
      if (we) k = Math.min(k, Math.max(cm, W - bord - xe) / we);
      if (wa) k = Math.min(k, Math.max(cm, xa - bord) / wa);
      if (we && wa && Math.abs(ye - ya) < px && xa > xe) k = Math.min(k, Math.max(cm, xa - xe - cm) / (we + wa));
      if (k < 1) { px *= k; ctx.font = `${px}px ${police}`; }
      ctx.textBaseline = 'middle';
      const boite = (t, x0, y) => {
        const m = ctx.measureText(t);
        return { x0, x1: x0 + m.width, y0: y - Math.max(m.actualBoundingBoxAscent, px * 0.35), y1: y + Math.max(m.actualBoundingBoxDescent, px * 0.15) };
      };
      const items = [];
      if (ecole) items.push({ cle: 'ecole', t: ecole, align: 'left', x: xe, y: ye, b: boite(ecole, xe, ye) });
      if (annee) items.push({ cle: 'annee', t: annee, align: 'right', x: xa, y: ya, b: boite(annee, xa - ctx.measureText(annee).width, ya) });
      // couleurs lues sur l'image avant d'ecrire (un texte ne change pas la couleur de l'autre)
      items.forEach(it => { it.couleur = couleurTexte(ctx, r, it.b.x0, it.b.y0, it.b.x1, it.b.y1); });
      const ombre = OMBRES[r.ombre];
      items.forEach(it => {
        ctx.save();
        ctx.fillStyle = it.couleur;
        // ombre portee vers le bas a droite, proportionnelle a la taille du texte (meme rendu dans
        // l'apercu et sur le tirage) ; plus discrete sous un texte fonce
        if (ombre) {
          const fonce = it.couleur !== '#ffffff';
          ctx.shadowColor = `rgba(0, 0, 0, ${fonce ? ombre.a * 0.45 : ombre.a})`;
          ctx.shadowOffsetX = ctx.shadowOffsetY = ombre.d * px;
          ctx.shadowBlur = ombre.f * px;
        }
        ctx.textAlign = it.align;
        ctx.fillText(it.t, it.x, it.y);
        ctx.restore();
        textes.push({ cle: it.cle, x0: it.b.x0 / cm, x1: it.b.x1 / cm, y0: it.b.y0 / cm, y1: it.b.y1 / cm });
      });
    }
    ctx.restore();
    // place du groupe et des textes (cm), pour les reperes et le placement a la main
    return Object.assign(place(cadre, r), { textes });
  }

  // Reperes de l'apercu : cadre des marges (pointilles) ; avec groupe (place, en cm) : poignees aux
  // 4 coins pour l'agrandir et cadre de chaque texte ; guides : traits d'alignement aimantes
  // ({ x } vertical ou { y } horizontal, en cm).
  function reperes(ctx, W, H, reglages, { groupe, guides = [] } = {}) {
    const r = Object.assign({}, REGLAGES, reglages);
    const cm = W / PAGE.l;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 64, 160, 0.9)';
    ctx.strokeRect(r.gauche * cm, r.haut * cm, W - (r.gauche + r.droite) * cm, H - (r.haut + r.bas) * cm);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.95)';
    ((groupe && groupe.textes) || []).forEach(t => {
      const m = 0.15;
      ctx.strokeRect((t.x0 - m) * cm, (t.y0 - m) * cm, (t.x1 - t.x0 + 2 * m) * cm, (t.y1 - t.y0 + 2 * m) * cm);
    });
    ctx.strokeStyle = 'rgba(255, 220, 0, 0.95)';
    guides.forEach(g => {
      ctx.beginPath();
      if (g.x !== undefined) { ctx.moveTo(g.x * cm, 0); ctx.lineTo(g.x * cm, H); }
      else { ctx.moveTo(0, g.y * cm); ctx.lineTo(W, g.y * cm); }
      ctx.stroke();
    });
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

  return { PAGE, DPI, REGLAGES, POLICES, placesTexte, famille, chargerPolice, TAILLE_EXPORT, anneeScolaire, bords, cadreDuGroupe, place, dessiner, reperes, nomFichier };
})();
