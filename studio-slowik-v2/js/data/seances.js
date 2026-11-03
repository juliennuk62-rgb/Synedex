// Seances (V2) : une ecole, une annee, un dossier sur le PC (celui de l'ecole), choisi une seule fois.
// Le dossier garde le rangement de Julien : SOURCE (la carte, jamais touche), TIFF (selection
// Lightroom sur fond vert, une photo par eleve, groupes melanges : point de depart), PNG, JPEGS DEF,
// EXTRA (crees s'ils manquent). La memoire de la seance (classes, groupes, noms) est ecrite dans
// slowik-seance.json, dans le dossier : elle se reprend sur un autre PC ou apres un nettoyage du navigateur.
var SL = self.SL = self.SL || {};
SL.seances = (function () {
  const REGISTRE = 'seances';           // liste des seances de cet ordinateur (IndexedDB, avec les dossiers)
  const FICHIER = 'slowik-seance.json';
  const DEPART = 'TIFF';
  const SORTIES = ['PNG', 'JPEGS DEF', 'EXTRA'];
  const ordre = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

  const nouvelId = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const anneeScolaire = (d = new Date()) => { const y = d.getFullYear(); return d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };

  // --- registre (cet ordinateur) -----------------------------------------------------------
  async function toutes() {
    try { return ((await SL.store.idbGet(REGISTRE)) || []).sort((a, b) => b.maj - a.maj); } catch (e) { return []; }
  }
  async function get(id) { return (await toutes()).find(s => s.id === id) || null; }
  async function memoriser(s) {
    const l = (await toutes()).filter(x => x.id !== s.id);
    l.push(s);
    await SL.store.idbSet(REGISTRE, l);
  }
  async function oublier(id) {
    await SL.store.idbSet(REGISTRE, (await toutes()).filter(x => x.id !== id));
  }

  // --- dossier de l'ecole ------------------------------------------------------------------
  async function sousDossier(dir, nom, creer) {
    try { return await dir.getDirectoryHandle(nom, { create: !!creer }); } catch (e) {
      if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
      throw e;
    }
  }

  // Ce que contient le dossier choisi : TIFF present ? sorties manquantes ?
  async function examiner(dir) {
    const tiff = await sousDossier(dir, DEPART, false);
    const manquants = [];
    for (const n of SORTIES) if (!(await sousDossier(dir, n, false))) manquants.push(n);
    const photos = tiff ? (await SL.images.listImages(tiff)).length : 0;
    return { tiff: !!tiff, photos, manquants };
  }

  async function creerSorties(dir) {
    for (const n of SORTIES) await sousDossier(dir, n, true);
  }

  async function lireJson(dir) {
    try {
      const fh = await dir.getFileHandle(FICHIER);
      return JSON.parse(await (await fh.getFile()).text());
    } catch (e) { return null; }
  }

  async function ecrireJson(dir, data) {
    await SL.fsa.writeFile(dir, FICHIER, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  // Photos de depart (TIFF), dans l'ordre de prise de vue (nom de fichier, ordre naturel).
  async function photos(dir) {
    const tiff = await sousDossier(dir, DEPART, false);
    if (!tiff) return [];
    return (await SL.images.listImages(tiff)).sort((a, b) => ordre.compare(a.name, b.name));
  }

  // --- classes ------------------------------------------------------------------------------
  // data.classes = [{ debut: 'IMG_0001.tif', nom, groupe: 'IMG_0001.tif' | null, liste: id | null,
  //   eleves: [{ nom, prenom }] }] ; data.ecartees = ['IMG_0450.tif'] (photos ratees, hors classe).
  // Une classe va de sa photo « debut » jusqu'a la photo avant le debut de la classe suivante.
  function nouvelleSeance({ ecole, annee }) {
    return { version: 1, id: nouvelId(), ecole: ecole || { nom: '' }, annee: annee || anneeScolaire(), classes: [], ecartees: [], maj: Date.now() };
  }

  // Classes avec leurs photos, a partir de la liste ordonnee des noms de fichiers.
  function decouper(data, noms) {
    if (!noms.length) return [];
    const index = new Map(noms.map((n, i) => [n, i]));
    let classes = (data.classes || []).filter(c => index.has(c.debut)).sort((a, b) => index.get(a.debut) - index.get(b.debut));
    if (!classes.length || index.get(classes[0].debut) !== 0) {
      // la premiere photo commence toujours une classe
      classes = [{ debut: noms[0], nom: '', groupe: null, liste: null, eleves: [] }, ...classes];
    }
    const ecartees = new Set(data.ecartees || []);
    return classes.map((c, k) => {
      const de = index.get(c.debut), a = k + 1 < classes.length ? index.get(classes[k + 1].debut) : noms.length;
      const toutes = noms.slice(de, a);
      const groupe = toutes.includes(c.groupe) ? c.groupe : null;
      const portraits = toutes.filter(n => n !== groupe && !ecartees.has(n));
      const eleves = c.eleves || [];
      return {
        classe: c, k, photos: toutes, groupe, portraits,
        noms: new Map(portraits.map((n, i) => [n, eleves[i] || null])),   // photo -> eleve (dans l'ordre)
        manque: eleves.length - portraits.length,                         // > 0 : moins de photos que de noms
      };
    });
  }

  // Ecrit les classes normalisees (premiere classe sur la premiere photo, groupes valides).
  function normaliser(data, noms) {
    data.classes = decouper(data, noms).map(d => Object.assign({}, d.classe, { groupe: d.groupe }));
    data.ecartees = (data.ecartees || []).filter(n => noms.includes(n));
    return data;
  }

  // Nouvelle classe a partir de cette photo (coupure).
  function couper(data, noms, nom) {
    if (decouper(data, noms).some(d => d.classe.debut === nom)) return data;
    data.classes = [...(data.classes || []), { debut: nom, nom: '', groupe: null, liste: null, eleves: [] }];
    return normaliser(data, noms);
  }

  // Supprime la coupure : la classe rejoint la precedente.
  function fusionner(data, noms, debut) {
    data.classes = (data.classes || []).filter((c, k) => c.debut !== debut || k === 0);
    return normaliser(data, noms);
  }

  // Coupure placee apres autant de portraits que d'eleves dans la liste de la classe : la classe
  // suivante commence juste apres (ses reglages, nom et liste, la suivent).
  function couperSelonListe(data, noms, debut) {
    const tranches = decouper(data, noms);
    const k = tranches.findIndex(x => x.classe.debut === debut);
    const d = tranches[k];
    if (!d || !(d.classe.eleves || []).length) return data;
    const n = d.classe.eleves.length, ecartees = new Set(data.ecartees || []);
    const compte = nom => nom !== d.classe.groupe && !ecartees.has(nom);
    let vus = 0, i = noms.indexOf(debut);
    while (i < noms.length && vus < n) { if (compte(noms[i])) vus++; i++; }
    // le groupe de la classe (ou une photo ecartee) juste apres les portraits reste dans la classe
    while (i < noms.length && !compte(noms[i])) i++;
    const suivante = tranches[k + 1];
    if (suivante) data.classes = data.classes.filter(c => c.debut !== suivante.classe.debut);
    if (i < noms.length) {
      const reprise = suivante ? suivante.classe : { nom: '', groupe: null, liste: null, eleves: [] };
      data.classes = data.classes.filter(c => c.debut !== noms[i]);
      data.classes.push(Object.assign({}, reprise, { debut: noms[i] }));
    }
    return normaliser(data, noms);
  }

  return {
    FICHIER, DEPART, SORTIES, anneeScolaire, toutes, get, memoriser, oublier,
    examiner, creerSorties, lireJson, ecrireJson, photos, nouvelleSeance, decouper, normaliser, couper, fusionner, couperSelonListe,
  };
})();
