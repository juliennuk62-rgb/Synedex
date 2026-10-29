// Onglet Photo de classe : groupes detoures + fonds de classe → tirages 24 x 18 cm.
var SL = self.SL = self.SL || {};
SL.photoClasseUI = (function () {
  const $ = id => document.getElementById(id);
  const P = SL.photoClasse;
  const PREFS = 'slowik.photoClasse';
  const DOSSIERS = 'photo-classe-dossiers';
  const ROLES = { groupes: 'Photos de groupe détourées', fonds: 'Fonds des photos de classe', export: "Dossier d'export" };
  const S = {
    dossiers: { groupes: null, fonds: null, export: null },
    groupes: [],      // { name, handle, classe, classPath }
    fonds: [],        // { name, handle }
    index: 0,
    cache: { groupe: null, cle: null, cadre: null, fonds: new Map() },
    jetonLecture: 0,
    jetonApercu: 0,
    enCours: null,
    ready: false,
  };

  // --- reglages ---------------------------------------------------------------------------
  const CHAMPS = { haut: 'cl-m-haut', gauche: 'cl-m-gauche', droite: 'cl-m-droite', bas: 'cl-m-bas', texteBas: 'cl-t-bas', taille: 'cl-t-taille' };
  function reglages() {
    const r = {};
    for (const [k, id] of Object.entries(CHAMPS)) {
      const v = parseFloat(String($(id).value).replace(',', '.'));
      r[k] = Number.isFinite(v) && v >= 0 ? v : P.REGLAGES[k];
    }
    r.police = $('cl-t-police').value;
    r.couleur = $('cl-t-couleur').value;
    return r;
  }
  function appliquer(r) {
    for (const [k, id] of Object.entries(CHAMPS)) $(id).value = String(r[k]).replace('.', ',');
    $('cl-t-police').value = r.police;
    $('cl-t-couleur').value = r.couleur;
  }
  function enregistrer() {
    try { localStorage.setItem(PREFS, JSON.stringify({ ecole: $('cl-ecole').value, reglages: reglages() })); } catch (e) { /* stockage bloque */ }
  }
  function charger() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch (e) { /* ignore */ }
    $('cl-ecole').value = p.ecole || '';
    $('cl-annee').value = P.anneeScolaire();
    appliquer(Object.assign({}, P.REGLAGES, p.reglages));
  }

  // --- dossiers ---------------------------------------------------------------------------
  function log(texte) {
    const box = $('cl-log');
    const l = document.createElement('div');
    l.textContent = `[${new Date().toLocaleTimeString('fr-FR')}] ${texte}`;
    if (/^ERREUR/.test(texte)) l.className = 'err';
    box.appendChild(l);
    box.scrollTop = box.scrollHeight;
  }

  async function choisir(role) {
    try {
      await definir(role, await SL.fsa.pick(`slowik-classe-${role}`, role === 'export'));
    } catch (e) {
      if (e.name !== 'AbortError') SL.u.toast(`Dossier illisible : ${e.message}`, 'error');
    }
  }

  async function definir(role, dir) {
    S.dossiers[role] = dir;
    try { await SL.store.idbSet(DOSSIERS, S.dossiers); } catch (e) { /* ignore */ }
    afficherDossiers();
    await relire();
  }

  function afficherDossiers() {
    for (const role of Object.keys(ROLES)) {
      const el = $(`cl-nom-${role}`);
      el.textContent = S.dossiers[role] ? S.dossiers[role].name : '—';
      el.classList.toggle('set', !!S.dossiers[role]);
    }
  }

  async function accessible(role) {
    const d = S.dossiers[role];
    return !!d && await SL.fsa.hasPermission(d, role === 'export').catch(() => false);
  }

  async function relire() {
    const jeton = ++S.jetonLecture;
    let groupes = [], fonds = [];
    if (await accessible('groupes')) {
      const exclure = ['fonds', 'export'].map(r => S.dossiers[r]).filter(Boolean);
      try { groupes = await SL.images.scanSources(S.dossiers.groupes, true, exclure); } catch (e) { log(`ERREUR lecture des groupes : ${e.message}`); }
    }
    if (await accessible('fonds')) {
      try { fonds = await SL.images.listImages(S.dossiers.fonds); } catch (e) { log(`ERREUR lecture des fonds : ${e.message}`); }
    }
    if (jeton !== S.jetonLecture) return;
    S.groupes = groupes;
    S.fonds = fonds;
    if (S.index >= groupes.length) S.index = 0;
    const sel = $('cl-fond');
    const avant = sel.value;
    sel.innerHTML = SL.u.html`${fonds.map(f => SL.u.html`<option value="${f.name}">${SL.naming.stem(f.name)}</option>`)}`;
    if (fonds.some(f => f.name === avant)) sel.value = avant;
    const manque = Object.keys(ROLES).filter(r => S.dossiers[r]).length > 0
      && (await Promise.all(Object.keys(ROLES).filter(r => S.dossiers[r]).map(accessible))).some(ok => !ok);
    $('cl-acces').classList.toggle('hidden', !manque);
    compter();
    apercu();
  }

  function compter() {
    const n = S.groupes.length * S.fonds.length;
    $('cl-compte').textContent = `${S.groupes.length} photo(s) de groupe × ${S.fonds.length} fond(s) = ${n} photo(s) de classe`;
  }

  // --- apercu -----------------------------------------------------------------------------
  let minuteur = null;
  function apercu() {
    clearTimeout(minuteur);
    minuteur = setTimeout(dessinerApercu, 80);
  }

  async function dessinerApercu() {
    const jeton = ++S.jetonApercu;
    const cv = $('cl-canvas'), info = $('cl-info');
    const g = S.groupes[S.index];
    if (!g) {
      cv.classList.add('hidden');
      info.textContent = S.dossiers.groupes ? 'Aucune photo de groupe dans ce dossier.' : 'Choisissez le dossier des photos de groupe détourées.';
      return;
    }
    info.textContent = `${S.index + 1}/${S.groupes.length} : ${g.classe ? g.classe + '/' : ''}${g.name}`;
    try {
      const cle = `${g.classe}/${g.name}`;
      if (S.cache.cle !== cle) {
        const bmp = await SL.images.decode(await g.handle.getFile(), 2000);
        if (S.cache.groupe) S.cache.groupe.close();
        S.cache = Object.assign(S.cache, { groupe: bmp, cle, cadre: await P.cadreDuGroupe(bmp) });
      }
      const f = S.fonds.find(x => x.name === $('cl-fond').value) || S.fonds[0];
      let fond = null;
      if (f) {
        if (!S.cache.fonds.has(f.name)) S.cache.fonds.set(f.name, await SL.images.decode(await f.handle.getFile(), 2400));
        fond = S.cache.fonds.get(f.name);
      }
      if (jeton !== S.jetonApercu) return;
      if (!S.cache.cadre) { info.textContent += ' — image entièrement transparente'; return; }
      const W = 1200, H = Math.round(W * P.PAGE.h / P.PAGE.l);
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      P.dessiner(ctx, W, H, { groupe: S.cache.groupe, cadre: S.cache.cadre, fond, ecole: $('cl-ecole').value, annee: $('cl-annee').value, reglages: reglages() });
      if ($('cl-reperes').checked) P.reperes(ctx, W, H, reglages());
      cv.classList.remove('hidden');
      if (!S.cache.cadre.transparent) info.textContent += ' — attention : pas de fond transparent';
      if (!f) info.textContent += ' — choisissez le dossier des fonds';
    } catch (e) {
      if (jeton === S.jetonApercu) info.textContent = `Aperçu impossible : ${e.message}`;
    }
  }

  // --- export -----------------------------------------------------------------------------
  async function lancer() {
    const manque = Object.keys(ROLES).filter(r => !S.dossiers[r]);
    if (manque.length) { SL.u.alert(`Choisissez : ${manque.map(r => ROLES[r].toLowerCase()).join(', ')}.`, { title: 'Dossiers manquants' }); return; }
    for (const role of Object.keys(ROLES)) {
      if (!(await SL.fsa.requestPermission(S.dossiers[role], role === 'export').catch(() => false))) {
        SL.u.alert(`Accès refusé au dossier « ${S.dossiers[role].name} ».`, { title: 'Accès aux dossiers' });
        return;
      }
    }
    await relire();
    if (!S.groupes.length || !S.fonds.length) {
      SL.u.alert(!S.groupes.length ? 'Aucune photo de groupe trouvée.' : 'Aucun fond trouvé.', { title: 'Rien à créer' });
      return;
    }
    if (!$('cl-ecole').value.trim() && !(await SL.u.confirm('Aucun nom d\'établissement : continuer sans ?', { title: 'Texte', ok: 'Continuer' }))) return;
    enregistrer();
    const total = S.groupes.length * S.fonds.length;
    const run = { total, fait: 0, ok: 0, existait: 0, erreurs: 0, debut: Date.now(), annule: false };
    S.enCours = run;
    $('cl-log').innerHTML = '';
    log(`${S.groupes.length} photo(s) de groupe × ${S.fonds.length} fond(s) = ${total} photo(s) de classe (24 × 18 cm, 300 dpi)`);
    $('cl-go').disabled = true;
    $('cl-stop').disabled = false;
    progression();
    const w = new Worker('js/worker/classe-worker.js');
    run.worker = w;
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'log') log(m.text);
      else if (m.type === 'etape') {
        if (!m.saute) { run.fait++; if (m.existait) run.existait++; else if (m.ok) run.ok++; else run.erreurs++; }
        progression();
      } else if (m.type === 'fini') terminer();
    };
    w.onerror = e => { log(`ERREUR interne : ${e.message}`); e.preventDefault(); terminer(); };
    w.postMessage({ type: 'taches', taches: S.groupes.map(g => ({
      nom: g.name, handle: g.handle, classe: g.classe, classPath: g.classPath, export: S.dossiers.export,
      fonds: S.fonds.map(f => ({ nom: f.name, handle: f.handle })),
      ecole: $('cl-ecole').value, annee: $('cl-annee').value, reglages: reglages(), reprendre: $('cl-reprendre').checked,
    })) });
  }

  function progression() {
    const r = S.enCours;
    if (!r) return;
    $('cl-progress').value = r.total ? r.fait / r.total : 0;
    $('cl-etat').textContent = `${r.fait} / ${r.total}`;
  }

  function terminer() {
    const r = S.enCours;
    if (!r) return;
    r.worker.terminate();
    S.enCours = null;
    $('cl-go').disabled = false;
    $('cl-stop').disabled = true;
    const sec = Math.round((Date.now() - r.debut) / 1000);
    let msg = `${r.ok} photo(s) de classe créée(s)${r.existait ? `, ${r.existait} déjà présente(s) ignorée(s)` : ''}, ${r.erreurs} erreur(s), en ${Math.floor(sec / 60)} min ${sec % 60} s.`;
    if (r.annule) msg = 'Création annulée. ' + msg;
    log(msg);
    $('cl-etat').textContent = msg + (r.ok ? ` Fichiers dans « ${S.dossiers.export.name} ».` : '');
  }

  function annuler() {
    if (!S.enCours) return;
    S.enCours.annule = true;
    S.enCours.worker.postMessage({ type: 'annuler' });
    $('cl-stop').disabled = true;
  }

  // --- demarrage --------------------------------------------------------------------------
  async function init() {
    if (S.ready) { relire(); return; }
    S.ready = true;
    charger();
    try {
      const d = await SL.store.idbGet(DOSSIERS);
      if (d) S.dossiers = Object.assign(S.dossiers, d);
    } catch (e) { /* ignore */ }
    afficherDossiers();
    document.querySelectorAll('[data-cl-pick]').forEach(b => b.addEventListener('click', () => choisir(b.dataset.clPick)));
    $('cl-acces-btn').addEventListener('click', async () => {
      for (const role of Object.keys(ROLES)) {
        if (S.dossiers[role]) await SL.fsa.requestPermission(S.dossiers[role], role === 'export').catch(() => false);
      }
      relire();
    });
    const changer = () => { enregistrer(); apercu(); };
    ['cl-ecole', 'cl-annee', ...Object.values(CHAMPS)].forEach(id => $(id).addEventListener('input', changer));
    ['cl-t-police', 'cl-t-couleur', 'cl-fond', 'cl-reperes'].forEach(id => $(id).addEventListener('change', changer));
    $('cl-defaut').addEventListener('click', () => { appliquer(P.REGLAGES); changer(); });
    $('cl-prec').addEventListener('click', () => { if (S.groupes.length) { S.index = (S.index - 1 + S.groupes.length) % S.groupes.length; apercu(); } });
    $('cl-suiv').addEventListener('click', () => { if (S.groupes.length) { S.index = (S.index + 1) % S.groupes.length; apercu(); } });
    $('cl-go').addEventListener('click', () => SL.u.busy($('cl-go'), lancer));
    $('cl-stop').addEventListener('click', annuler);
    window.addEventListener('beforeunload', e => { if (S.enCours) { e.preventDefault(); e.returnValue = ''; } });
    await relire();
  }

  return { init, definir, etat: S };
})();
