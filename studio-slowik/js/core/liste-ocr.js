// Lecture d'une liste d'eleves photographiee : le texte est lu sur l'appareil (Tesseract, rien
// n'est envoye), puis seuls le nom et le prenom de chaque eleve sont gardes.
//   1. photo nettoyee : ombres et eclairage inegal effaces (fond du papier ramene au blanc) ;
//   2. lecture des mots avec leur position ;
//   3. mots regroupes en lignes (photo un peu penchee corrigee) ;
//   4. ligne d'en-tete reperee (« Nom », « Prénom », « Nom et prénom », « Élève ») : chaque mot est
//      range dans sa colonne, les autres colonnes (date de naissance, sexe...) sont ignorees ;
//      sans en-tete : NOM en majuscules, Prenom en minuscules, dates et numeros ecartes.
var SL = self.SL = self.SL || {};
SL.listeOcr = (function () {
  const DOSSIER = new URL('../vendor/ocr/', (document.currentScript && document.currentScript.src) || location.href).href;
  const COTE_MAX = 3000;     // photo lue a cette taille au plus (cote le plus long)
  const CONFIANCE = 85;      // en dessous : nom a verifier (lettres mal lues : 75 a 82)
  let moteurPret = null;
  let suivi = null;

  function chargerScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Lecteur de texte introuvable : vérifiez votre accès à Internet (première utilisation).'));
      document.head.appendChild(s);
    });
  }

  // Moteur charge a la premiere lecture (8 Mo, garde ensuite pour fonctionner hors ligne).
  function moteur() {
    if (!moteurPret) {
      moteurPret = (async () => {
        if (!self.Tesseract) await chargerScript(DOSSIER + 'tesseract.min.js');
        const w = await self.Tesseract.createWorker('fra', 1, {
          workerPath: DOSSIER + 'worker.min.js', corePath: DOSSIER, langPath: DOSSIER, gzip: true,
          workerBlobURL: false, cacheMethod: 'none', logger: m => suivi && suivi(m),
        });
        await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
        return w;
      })();
      moteurPret.catch(() => { moteurPret = null; });
    }
    return moteurPret;
  }

  // --- 1. photo nettoyee --------------------------------------------------------------
  // Niveaux de gris divises par le fond local du papier (le plus clair de chaque carre de 16 px,
  // adouci) : ombre de la main, coin sombre, papier jaune deviennent blancs, l'ecriture reste noire.
  function nettoyer(bmp, quart) {
    const rot = quart % 2 === 1;
    const w = rot ? bmp.height : bmp.width, h = rot ? bmp.width : bmp.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.translate(w / 2, h / 2);
    ctx.rotate(quart * Math.PI / 2);
    ctx.filter = 'blur(0.8px)';  // grain de la photo adouci
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    ctx.filter = 'none';
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const B = 16, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const gris = new Float32Array(w * h), fond = new Float32Array(bw * bh);
    for (let y = 0, i = 0; y < h; y++) {
      const by = (y / B | 0) * bw;
      for (let x = 0; x < w; x++, i++) {
        const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        gris[i] = g;
        const k = by + (x / B | 0);
        if (g > fond[k]) fond[k] = g;
      }
    }
    // carres entierement sous le texte ou un trait : adoucis par leurs voisins (deux passes 3 x 3)
    for (let pass = 0; pass < 2; pass++) {
      const src = fond.slice();
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          let s = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const yy = y + dy, xx = x + dx;
              if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += src[yy * bw + xx]; n++; }
            }
          }
          fond[y * bw + x] = Math.max(src[y * bw + x] * 0.85, s / n);
        }
      }
    }
    for (let y = 0, i = 0; y < h; y++) {
      const fy = Math.min(bh - 1, Math.max(0, y / B - 0.5)), y0 = fy | 0, y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++, i++) {
        const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5)), x0 = fx | 0, x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
        const f = (fond[y0 * bw + x0] * (1 - tx) + fond[y0 * bw + x1] * tx) * (1 - ty)
          + (fond[y1 * bw + x0] * (1 - tx) + fond[y1 * bw + x1] * tx) * ty;
        // grain du papier (bruit de la photo) ramene au blanc, encre au noir
        const v = Math.min(255, Math.max(0, 255 * (gris[i] / Math.max(f, 40) - 0.35) / 0.47));
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    return effacerTraits(redresser(cv));
  }

  // Feuille penchee : angle qui aligne le mieux les points sombres en lignes horizontales
  // (profil des lignes le plus contraste), puis image tournee d'autant.
  function redresser(cv) {
    const k = Math.min(1, 900 / Math.max(cv.width, cv.height));
    const pw = Math.round(cv.width * k), ph = Math.round(cv.height * k);
    const p = document.createElement('canvas');
    p.width = pw; p.height = ph;
    const pc = p.getContext('2d', { willReadFrequently: true });
    pc.drawImage(cv, 0, 0, pw, ph);
    const d = pc.getImageData(0, 0, pw, ph).data;
    const xs = [], ys = [];
    for (let y = 0, i = 0; y < ph; y++) for (let x = 0; x < pw; x++, i += 4) if (d[i] < 140) { xs.push(x); ys.push(y); }
    if (xs.length < 50) return cv;
    const score = deg => {
      const a = deg * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a);
      const n = ph + pw, h = new Float32Array(n);
      for (let j = 0; j < xs.length; j++) { const r = Math.round(-xs[j] * sn + ys[j] * cs + pw); if (r >= 0 && r < n) h[r]++; }
      let s = 0;
      for (let r = 1; r < n; r++) s += (h[r] - h[r - 1]) ** 2;
      return s;
    };
    let best = 0, bs = score(0);
    for (let deg = -10; deg <= 10; deg += 0.5) { const s = score(deg); if (s > bs) { bs = s; best = deg; } }
    for (let deg = best - 0.4; deg <= best + 0.4; deg += 0.1) { const s = score(deg); if (s > bs) { bs = s; best = deg; } }
    if (Math.abs(best) < 0.15) return cv;
    const a = best * Math.PI / 180;
    const out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const oc = out.getContext('2d', { willReadFrequently: true });
    oc.fillStyle = '#fff';
    oc.fillRect(0, 0, out.width, out.height);
    oc.translate(out.width / 2, out.height / 2);
    oc.rotate(-a);
    oc.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return out;
  }

  // Traits du tableau effaces (longues suites de points sombres, horizontales ou verticales) :
  // colles aux lettres, ils font lire n'importe quoi.
  function effacerTraits(cv) {
    const w = cv.width, h = cv.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const L = Math.max(50, Math.round(Math.max(w, h) / 40));
    const noir = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) noir[i] = d[i * 4] < 200 ? 1 : 0;  // traits gris compris (photo floue)
    const efface = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {           // horizontaux (1 point de tolerance en hauteur)
      let debut = -1;
      for (let x = 0; x <= w; x++) {
        const n = x < w && (noir[y * w + x] || (y > 0 && noir[(y - 1) * w + x]) || (y < h - 1 && noir[(y + 1) * w + x]));
        if (n && debut < 0) debut = x;
        if (!n && debut >= 0) {
          if (x - debut >= L) for (let k = debut; k < x; k++) if (noir[y * w + k]) efface[y * w + k] = 1;
          debut = -1;
        }
      }
    }
    for (let x = 0; x < w; x++) {           // verticaux (tolerance d'un point : perspective)
      let debut = -1;
      for (let y = 0; y <= h; y++) {
        const n = y < h && (noir[y * w + x] || (x > 0 && noir[y * w + x - 1]) || (x < w - 1 && noir[y * w + x + 1]));
        if (n && debut < 0) debut = y;
        if (!n && debut >= 0) {
          if (y - debut >= L) for (let k = debut; k < y; k++) if (noir[k * w + x]) efface[k * w + x] = 1;
          debut = -1;
        }
      }
    }
    // le trait et son halo (1 point autour)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (efface[i] || efface[i - 1] || efface[i + 1] || efface[i - w] || efface[i + w]) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // --- 3 et 4. analyse des mots -------------------------------------------------------
  const LETTRE = "A-Za-zÀ-ÖØ-öø-ÿŒœ";
  const NOM_PROPRE = new RegExp(`^[${LETTRE}][${LETTRE}'’-]*$`);
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const cle = s => norm(s).replace(/[^a-z]/g, '');
  const enMajuscules = t => /[A-Za-zÀ-ÿ]/.test(t) && t === t.toUpperCase() && t.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2;
  // Mots d'une ligne qui n'est pas un eleve (titre, total en bas de page...).
  const HORS_LISTE = new Set(['total', 'effectif', 'effectifs', 'garcons', 'filles', 'classe', 'ecole', 'annee', 'liste',
    'enseignant', 'enseignante', 'directeur', 'directrice', 'page', 'signature', 'niveau', 'cycle', 'imprime', 'edite']);
  const TITRE_PERSONNE = /^(mme|mmes|mlle|madame|monsieur|mr|mrs|maitresse|maître|maîtresse|maitre)$/i;
  const NIVEAU = /^(tps|ps|ms|gs|cp|ce1|ce2|cm1|cm2|ulis|segpa|6e|5e|4e|3e)$/i;
  // En-tetes de colonnes connus (une ligne qui en contient plusieurs est la ligne d'en-tete).
  const AUTRES_TITRES = new Set(['date', 'naissance', 'ne', 'nee', 'sexe', 'classe', 'niveau', 'n', 'no', 'num', 'numero',
    'ine', 'age', 'observations', 'observation', 'regime', 'adresse', 'responsable', 'responsables', 'telephone', 'cantine']);

  const MOTS_EN_TETE = new Set([...AUTRES_TITRES, 'de', 'le', 'la', 'du', 'et', 'nom', 'noms', 'prenom', 'prenoms',
    'eleve', 'eleves', 'enfant', 'enfants', 'usage', 'famille']);

  // Mot lu nettoye : traits du tableau et ponctuation autour retires. '' si ce n'est pas un mot.
  function motPropre(t) {
    const m = String(t).replace(/^[^A-Za-zÀ-ÿŒœ]+|[^A-Za-zÀ-ÿŒœ]+$/g, '').replace(/’/g, "'");
    return NOM_PROPRE.test(m) && !(m.length === 1 && /[lIi|]/.test(m)) ? m : '';
  }

  const mediane = v => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

  // Mots regroupes en lignes du tableau, de haut en bas, apres correction de l'inclinaison.
  function lignesDuTableau(mots, bases) {
    const angles = bases.filter(b => b.x1 - b.x0 > 60).map(b => Math.atan2(b.y1 - b.y0, b.x1 - b.x0));
    const a = angles.length ? mediane(angles) : 0, cos = Math.cos(a), sin = Math.sin(a);
    const hauteur = mediane(mots.map(m => m.y1 - m.y0)) || 10;
    const pts = mots.map(m => {
      const cx = (m.x0 + m.x1) / 2, cy = (m.y0 + m.y1) / 2;
      return Object.assign({}, m, { x: cx * cos + cy * sin, y: -cx * sin + cy * cos, l: m.x1 - m.x0 });
    }).sort((p, q) => p.y - q.y);
    const lignes = [];
    for (const p of pts) {
      const l = lignes[lignes.length - 1];
      if (l && Math.abs(p.y - l.y) < hauteur * 0.6) { l.mots.push(p); l.y = l.mots.reduce((s, m) => s + m.y, 0) / l.mots.length; }
      else lignes.push({ y: p.y, mots: [p] });
    }
    lignes.forEach(l => l.mots.sort((p, q) => p.x - q.x));
    return { lignes, hauteur };
  }

  // Cases d'une ligne : mots proches regroupes (un grand espace separe deux colonnes).
  function cases(ligne, hauteur) {
    const out = [];
    for (const m of ligne.mots) {
      const c = out[out.length - 1];
      if (c && m.x - m.l / 2 - c.x1 < hauteur * 1.2) { c.mots.push(m); c.x1 = m.x + m.l / 2; }
      else out.push({ x0: m.x - m.l / 2, x1: m.x + m.l / 2, mots: [m] });
    }
    out.forEach(c => {
      const mots = c.mots.map(m => cle(m.t)).filter(Boolean);
      const tout = mots.join('');
      const aPrenom = mots.some(m => m.startsWith('prenom'));
      const aNom = mots.some(m => m === 'nom' || m === 'noms' || (m.startsWith('nom') && !m.startsWith('nomb') && m.length <= 12 && !m.startsWith('nomin')));
      if (aPrenom && (aNom || mots.length > 1 && /nom/.test(tout.replace(/prenoms?/g, '')))) { c.type = 'deux'; c.explicite = true; }
      else if (aPrenom) c.type = 'prenom';
      else if (aNom) c.type = 'nom';
      else if (mots.length <= 2 && mots.some(m => ['eleve', 'eleves', 'enfant', 'enfants', 'identite'].includes(m))) c.type = 'deux';
      else c.type = mots.some(m => AUTRES_TITRES.has(m)) ? 'titre' : 'autre';
    });
    return out;
  }

  function scoreEnTete(cs) {
    let s = 0;
    for (const c of cs) s += c.type === 'nom' || c.type === 'prenom' || c.explicite ? 2 : c.type === 'deux' ? 1.5 : c.type === 'titre' ? 1 : 0;
    return cs.some(c => c.type !== 'autre' && c.type !== 'titre') ? s : 0;
  }

  // NOM Prenom (ou Prenom NOM) a partir de la casse : les majuscules forment le nom. Seules les deux
  // premieres suites de mots comptent (« DUPONT Léa PAI » : PAI est une autre colonne).
  function separer(mots) {
    const suites = [];
    for (const m of mots) {
      const maj = enMajuscules(m.t), s = suites[suites.length - 1];
      if (s && s.maj === maj) s.mots.push(m); else suites.push({ maj, mots: [m] });
    }
    if (suites.length >= 2) {
      const [a, b] = suites;
      return a.maj ? { nom: a.mots, prenom: b.mots } : { nom: b.mots, prenom: a.mots };
    }
    if (mots.length >= 2) return { nom: mots.slice(0, 1), prenom: mots.slice(1), douteux: true };
    return { nom: mots, prenom: [], douteux: true };
  }

  // Trema et accents parfois perdus a la lecture (Anaïs lu « Anais ») : remis pour les prenoms connus.
  const PRENOMS = ('Anaïs Anaëlle Aëlys Aïcha Aïda Aïssa Aïssatou Aliénor Amélie Anaé Andréa Aurélie Aurélien Bérénice Cécile ' +
    'Cédric Célia Célian Céleste Chloé Clémence Clément Daphné Désiré Désirée Dorothée Éléa Éléna Éléonore Élia Élias Élie Élina ' +
    'Élisa Élise Éloane Élodie Éloïse Élyne Émeline Émile Émilie Émilien Énora Énola Ève Félix Françoise François Frédéric Gaël ' +
    'Gaëlle Gaétan Gaëtan Gaïa Géraldine Grégoire Hélène Héloïse Honoré Ilyès Inès Irène Ismaël Israël Jérémie Jérémy Jérôme ' +
    'Joël Joëlle José Joséphine Josué Kaïs Laïa Léa Léana Léandre Léane Léna Lénaïc Lénaïg Léo Léon Léonard Léonie Léontine ' +
    'Lélio Loïc Loïs Lyès Maé Maël Maëlle Maëlys Maélys Maéna Mahé Maïa Maïssa Maïwenn Mathéo Mathéis Matéo Mélanie Mélina ' +
    'Méline Mélissa Méloé Mickaël Michaël Moïse Naël Naïa Naïm Nathanaël Nathéo Noé Noël Noëlle Noélie Noémie Océane ' +
    'Pénélope Raïssa Raphaël Raphaëlle Rémi Rémy René Renée Romée Salomé Sébastien Séléna Sélène Séraphine Siméon Solène ' +
    'Stéphane Stéphanie Thaïs Théa Théo Théodore Thélio Timéo Timothée Valérie Yaël Yaëlle Zélie Zélia Zoé Zoë').split(' ');
  const PRENOM_ACCENTUE = new Map(PRENOMS.map(p => [norm(p), p]));
  const accents = t => (t.normalize('NFD').match(/[\u0300-\u036f]/g) || []).length;
  function accentuer(prenom) {
    let change = false;
    const out = prenom.split(/([ -])/).map(part => {
      const juste = PRENOM_ACCENTUE.get(norm(part));
      if (juste && juste !== part && accents(part) < accents(juste)) { change = true; return juste; }
      return part;
    }).join('');
    return { prenom: out, change };
  }

  const zoneDe = ms => ({ x0: Math.min(...ms.map(m => m.x0)), y0: Math.min(...ms.map(m => m.y0)),
    x1: Math.max(...ms.map(m => m.x1)), y1: Math.max(...ms.map(m => m.y1)) });

  function eleve(r, zone) {
    const utilises = r.nom.concat(r.prenom);
    const confiance = Math.round(Math.min(...utilises.map(m => m.c == null ? 100 : m.c)));
    const p = accentuer(r.prenom.map(m => m.t).join(' '));
    const raison = r.douteux ? 'nom et prénom difficiles à séparer' : confiance < CONFIANCE ? 'lecture incertaine'
      : p.change ? 'accent ajouté' : '';
    // extrait de la feuille : le nom et le prenom seulement (lisible sur un telephone)
    return { nom: r.nom.map(m => m.t).join(' '), prenom: p.prenom, confiance, verifier: !!raison, raison, zone: zoneDe(utilises), ligne: zone };
  }

  // Mots → eleves, dans l'ordre de la feuille. mots : [{ t, c (confiance 0..100), x0, y0, x1, y1 }],
  // bases : traits de base des lignes lues (inclinaison). Une ligne de la liste mal lue n'est jamais
  // sautee (cela decalerait tous les noms suivants) : elle est gardee « a verifier ».
  function analyser(mots, bases) {
    mots = mots.filter(m => String(m.t).trim() && !(m.c != null && m.c < 30));
    if (!mots.length) return { eleves: [], enTete: false, classe: '' };
    const { lignes, hauteur } = lignesDuTableau(mots, bases || []);
    let iEnTete = -1, colonnes = null, meilleur = 1.9;
    lignes.forEach((l, i) => {
      const cs = cases(l, hauteur);
      const s = scoreEnTete(cs);
      if (s > meilleur) { meilleur = s; iEnTete = i; colonnes = cs; }
    });
    // « Classe : CP A » en haut de la feuille : propose comme nom de la liste
    let classe = '';
    for (const l of lignes.slice(0, iEnTete >= 0 ? iEnTete : 6)) {
      const txt = l.mots.map(m => m.t).join(' ');
      const m = /\bclasse\s*[:\-–]?\s*(.{1,40})$/i.exec(txt);
      if (m) { classe = m[1].split(/\s+[—–-]\s+|\s+ann[ée]e\b|\s{3,}/i)[0].replace(/\s+/g, ' ').trim(); break; }
    }
    // colonne d'un mot : limites a mi-chemin entre deux titres
    const col = x => {
      let k = 0;
      while (k < colonnes.length - 1 && x > (colonnes[k].x1 + colonnes[k + 1].x0) / 2) k++;
      return colonnes[k].type;
    };
    // colonnes « Nom » et « Prénom » bien lues : chaque mot va dans la sienne ; sinon les noms sont
    // pris partout sauf dans les colonnes connues (date de naissance, sexe, numero...) et separes
    // par la casse (NOM en majuscules).
    const deuxColonnes = !!colonnes && colonnes.some(c => c.type === 'nom') && colonnes.some(c => c.type === 'prenom');
    const rangs = [];
    for (let i = iEnTete + 1; i < lignes.length; i++) {
      const l = lignes[i];
      const propres = l.mots.map(m => Object.assign({}, m, { t: motPropre(m.t) })).filter(m => m.t);
      if (propres.length && (HORS_LISTE.has(cle(propres[0].t)) || propres.some(m => TITRE_PERSONNE.test(m.t))
        || (!colonnes && NIVEAU.test(propres[0].t)))) continue;  // titre, « CP de Mme Durand », total
      if (propres.length && propres.every(m => MOTS_EN_TETE.has(cle(m.t)))) continue;  // en-tete mal reconnu
      let r = null, partiel = null;
      if (deuxColonnes) {
        const par = { nom: [], prenom: [] };
        propres.forEach(m => { const t = col(m.x); if (par[t]) par[t].push(m); });
        if (par.nom.length && par.prenom.length) r = par;
        else partiel = par;  // une case non lue : la ligne sera relue
      } else {
        const noms = propres.filter(m => (!colonnes || col(m.x) !== 'titre') && (m.t.length >= 2 || /^[A-Z]'/.test(m.t)));
        if (noms.length) r = separer(noms);
      }
      const zone = zoneDe(l.mots);
      if (r && r.nom.length && r.prenom.length) rangs.push({ y: l.y, eleve: eleve(r, zone) });
      // ligne lue en partie (numero, date de naissance, un seul nom...) : a relire
      else if (l.mots.some(m => m.c >= 60 && String(m.t).replace(/[^0-9A-Za-zÀ-ÿ]/g, '').length >= 2)) {
        const p = partiel || r || { nom: [], prenom: [] };
        rangs.push({ y: l.y, eleve: { nom: p.nom.map(m => m.t).join(' '), prenom: p.prenom.map(m => m.t).join(' '), confiance: 0,
          verifier: true, raison: 'ligne mal lue', aRelire: true, zone } });
      }
    }
    // seulement la liste : rien avant le premier eleve bien lu ni apres le dernier
    const sur = x => !x.eleve.aRelire && x.eleve.raison !== 'nom et prénom difficiles à séparer';
    const premiers = rangs.findIndex(sur);
    let derniers = rangs.length - 1;
    while (derniers >= 0 && !sur(rangs[derniers])) derniers--;
    const liste = premiers < 0 ? [] : rangs.slice(premiers, derniers + 1);
    // ligne entierement illisible : un trou dans l'espacement regulier des lignes
    const ecarts = liste.slice(1).map((x, k) => x.y - liste[k].y);
    const pas = mediane(ecarts);
    const rangee = e => e.ligne || e.zone;
    const cadre = liste.length ? { x0: mediane(liste.map(x => rangee(x.eleve).x0)), x1: mediane(liste.map(x => rangee(x.eleve).x1)) } : null;
    const eleves = [];
    liste.forEach((x, k) => {
      if (k && liste.length >= 5 && ecarts[k - 1] > pas * 1.6) {
        const manque = Math.round(ecarts[k - 1] / pas) - 1;
        const prec = rangee(liste[k - 1].eleve);
        for (let n = 1; n <= manque; n++) {
          const y0 = prec.y0 + pas * n, y1 = prec.y1 + pas * n;
          eleves.push({ nom: '', prenom: '', confiance: 0, verifier: true, raison: 'ligne non lue', aRelire: true,
            zone: { x0: cadre.x0, x1: cadre.x1, y0, y1 } });
        }
      }
      eleves.push(x.eleve);
    });
    return { eleves, enTete: !!colonnes, classe, hauteur, pas, cadre };
  }

  // --- 2. lecture ----------------------------------------------------------------------
  function motsLus(data) {
    const mots = [], bases = [];
    for (const b of data.blocks || []) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          if (l.baseline && l.baseline.has_baseline !== false) bases.push(l.baseline);
          for (const w of l.words || []) mots.push({ t: w.text, c: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
        }
      }
    }
    return { mots, bases };
  }

  // Deuxieme passage sur les lignes mal lues : chaque ligne relue seule (mode « une ligne »), puis
  // la feuille analysee a nouveau avec ces mots.
  async function relire(w, r, progression) {
    const aRelire = r.eleves.filter(e => e.aRelire);
    if (!aRelire.length || aRelire.length > 20 || !r.cadre) return r;
    const marge = r.hauteur * 0.45;
    const zones = aRelire.map(e => ({
      left: Math.max(0, Math.round(Math.min(r.cadre.x0, e.zone.x0) - marge * 2)),
      top: Math.max(0, Math.round(e.zone.y0 - marge)),
      right: Math.min(r.image.width, Math.round(Math.max(r.cadre.x1, e.zone.x1) + marge * 2)),
      bottom: Math.min(r.image.height, Math.round(e.zone.y1 + marge)),
    }));
    const ajout = [];
    try {
      await w.setParameters({ tessedit_pageseg_mode: '7' });
      for (const [k, z] of zones.entries()) {
        if (progression) progression(0.95, `Relecture des lignes difficiles (${k + 1}/${zones.length})`);
        const rectangle = { left: z.left, top: z.top, width: z.right - z.left, height: z.bottom - z.top };
        const { data } = await w.recognize(r.blob, { rectangle }, { blocks: true, text: false });
        ajout.push(...motsLus(data).mots);
      }
    } finally {
      await w.setParameters({ tessedit_pageseg_mode: '11' });
    }
    const dedans = m => zones.some(z => (m.x0 + m.x1) / 2 > z.left && (m.x0 + m.x1) / 2 < z.right
      && (m.y0 + m.y1) / 2 > z.top && (m.y0 + m.y1) / 2 < z.bottom);
    const r2 = analyser(r.mots.filter(m => !dedans(m)).concat(ajout), r.bases);
    const bons = x => x.eleves.filter(e => !e.aRelire).length;
    return bons(r2) >= bons(r) ? Object.assign(r2, { relues: zones.length }) : r;
  }

  // Lit une photo de liste. Retourne { eleves, enTete, classe, image (photo nettoyee, pour verifier) }.
  // progression(part 0..1, texte)
  async function lire(fichier, progression) {
    const bmp = await SL.images.decode(fichier, COTE_MAX);
    try {
      suivi = m => {
        if (!progression) return;
        if (m.status === 'recognizing text') progression(0.1 + 0.9 * m.progress, 'Lecture du texte');
        else progression(0.05, 'Préparation du lecteur (la première fois : quelques secondes)');
      };
      const w = await moteur();
      let meilleur = null;
      const essais = [];
      // photo prise de travers (feuille tournee d'un quart de tour) : on essaie les autres sens
      for (const quart of [0, 1, 3, 2]) {
        const cv = nettoyer(bmp, quart);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const { data } = await w.recognize(blob, {}, { blocks: true, text: false });
        const { mots, bases } = motsLus(data);
        let r = analyser(mots, bases);
        r.image = cv;
        r.blob = blob;
        r.mots = mots;
        r.bases = bases;
        // noms lus avec assurance : le bon sens de lecture en a beaucoup plus que les autres
        r.score = r.eleves.filter(e => e.confiance >= CONFIANCE).length + (r.enTete ? 2 : 0);
        essais.push({ quart, eleves: r.eleves.length, score: r.score });
        if (!meilleur || r.score > meilleur.score) meilleur = r;
        if (r.score >= 5) break;
      }
      const final = await relire(w, meilleur, progression);
      final.essais = essais;
      final.image = meilleur.image;
      return final;
    } finally {
      suivi = null;
      bmp.close();
    }
  }

  return { lire, analyser, nettoyer, DOSSIER };
})();
