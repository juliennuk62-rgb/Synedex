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
    glisse: null,     // deplacement en cours dans l'apercu
    perso: {},        // placement propre a une classe : { 'classe/fichier': { haut, gauche, droite, bas } }
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
    r.police = S.police;
    r.couleur = $('cl-t-couleur').value;
    return r;
  }
  function appliquer(r) {
    for (const [k, id] of Object.entries(CHAMPS)) $(id).value = String(Math.round(r[k] * 100) / 100).replace('.', ',');
    choisirPolice(r.police);
    $('cl-t-couleur').value = r.couleur;
  }
  // Choix de la police : un exemple ecrit dans chaque police (nom de l'ecole tape, sinon un exemple).
  function choisirPolice(cle) {
    S.police = P.POLICES[cle] ? cle : P.REGLAGES.police;
    document.querySelectorAll('#cl-polices button').forEach(b => {
      const oui = b.dataset.police === S.police;
      b.classList.toggle('active', oui);
      b.setAttribute('aria-checked', oui ? 'true' : 'false');
    });
  }
  function exemples() {
    const texte = $('cl-ecole').value.trim() || 'École Jean Jaurès';
    document.querySelectorAll('#cl-polices .cl-exemple').forEach(e => { e.textContent = texte; });
  }
  function initPolices() {
    $('cl-polices').innerHTML = SL.u.html`${Object.entries(P.POLICES).map(([cle, p]) => SL.u.html`
      <button type="button" role="radio" data-police="${cle}"><span class="cl-exemple" style="font-family:${P.famille(cle)}"></span><span class="cl-nom-police">${p.nom}</span></button>`)}`;
    exemples();
    Object.keys(P.POLICES).forEach(cle => P.chargerPolice(cle).catch(() => { /* hors ligne : police de secours */ }));
    $('cl-polices').addEventListener('click', e => {
      const b = e.target.closest('button[data-police]');
      if (!b) return;
      choisirPolice(b.dataset.police);
      enregistrer();
      apercu();
    });
  }
  function enregistrer() {
    try { localStorage.setItem(PREFS, JSON.stringify({ ecole: $('cl-ecole').value, reglages: reglages(), perso: S.perso })); } catch (e) { /* stockage bloque */ }
  }

  // Placement commun a toutes les classes, ou propre a une classe (taille et position reglees pour
  // elle seule ; le texte reste commun).
  // (le nom du dossier des groupes en fait partie : une classe du meme nom l'an prochain repart du placement commun)
  const cleDe = g => `${S.dossiers.groupes ? S.dossiers.groupes.name : ''}/${g.classe || ''}/${g.name}`;
  const courant = () => S.groupes[S.index];
  const MARGES = ['haut', 'gauche', 'droite', 'bas'];
  function reglagesDe(g) {
    const r = reglages(), p = g && S.perso[cleDe(g)];
    return p ? Object.assign(r, p) : r;
  }
  const estPerso = () => !!(courant() && S.perso[cleDe(courant())]);
  function majMode() {
    const perso = estPerso();
    $('cl-mode-commun').classList.toggle('active', !perso);
    $('cl-mode-perso').classList.toggle('active', perso);
    $('cl-mode-commun').setAttribute('aria-pressed', String(!perso));
    $('cl-mode-perso').setAttribute('aria-pressed', String(perso));
    $('cl-mode-aide').textContent = perso
      ? 'Vos réglages ne changent que cette classe. « Commun à toutes » la remet au placement commun.'
      : 'Vos réglages changent toutes les classes qui suivent le placement commun.';
  }
  function choisirMode(perso) {
    const g = courant();
    if (!g) return;
    if (perso && !S.perso[cleDe(g)]) {
      const r = reglages();
      S.perso[cleDe(g)] = Object.fromEntries(MARGES.map(k => [k, r[k]]));
    }
    if (!perso) delete S.perso[cleDe(g)];
    enregistrer();
    majMode();
    compter();
    apercu();
  }
  function charger() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch (e) { /* ignore */ }
    $('cl-ecole').value = p.ecole || '';
    $('cl-annee').value = P.anneeScolaire();
    appliquer(Object.assign({}, P.REGLAGES, p.reglages));
    S.perso = p.perso && typeof p.perso === 'object' ? p.perso : {};
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
    const perso = S.groupes.filter(g => S.perso[cleDe(g)]).length;
    $('cl-compte').textContent = `${S.groupes.length} photo(s) de groupe × ${S.fonds.length} fond(s) = ${n} photo(s) de classe`
      + (perso ? ` (${perso} classe(s) avec un placement propre)` : '');
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
    majMode();
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
      await P.chargerPolice(S.police).catch(() => { /* police de secours */ });
      if (jeton !== S.jetonApercu) return;
      if (!S.cache.cadre) { info.textContent += ' — image entièrement transparente'; return; }
      S.cache.fond = fond;
      peindre();
      cv.classList.remove('hidden');
      if (!S.cache.cadre.transparent) info.textContent += ' — attention : pas de fond transparent';
      if (!f) info.textContent += ' — choisissez le dossier des fonds';
    } catch (e) {
      if (jeton === S.jetonApercu) info.textContent = `Aperçu impossible : ${e.message}`;
    }
  }

  // Dessin de l'apercu avec les images deja lues (rapide : suit la souris pendant un deplacement).
  const APERCU = { W: 1200, H: 900 };
  function peindre() {
    if (!S.cache.groupe || !S.cache.cadre) return;
    const cv = $('cl-canvas');
    if (cv.width !== APERCU.W) { cv.width = APERCU.W; cv.height = APERCU.H; }
    const ctx = cv.getContext('2d');
    const r = reglagesDe(courant());
    const place = P.dessiner(ctx, APERCU.W, APERCU.H, { groupe: S.cache.groupe, cadre: S.cache.cadre, fond: S.cache.fond,
      ecole: $('cl-ecole').value, annee: $('cl-annee').value, reglages: r });
    if ($('cl-reperes').checked || S.glisse) P.reperes(ctx, APERCU.W, APERCU.H, r, { groupe: place, centre: S.glisse && S.glisse.centre });
  }
  let image = 0;
  const repeindre = () => { if (!image) image = requestAnimationFrame(() => { image = 0; peindre(); }); };

  // --- placement a la main ------------------------------------------------------------------
  // Le groupe affiche se deplace (glisser), s'agrandit (coins) ; la ligne du texte monte ou descend.
  // Le cadre retenu est la place du groupe : chaque classe y est calee sur ses 4 bords (meme
  // largeur et meme hauteur au plus, centree), donc le reglage vaut pour toutes les photos.
  const { l: PL, h: PH } = P.PAGE;
  const arrondi = v => Math.round(v * 100) / 100;
  const borne = (v, a, b) => Math.min(b, Math.max(a, v));

  function placeActuelle() {
    return S.cache.cadre ? P.place(S.cache.cadre, reglagesDe(courant())) : null;
  }

  // Nouvelle place du groupe (cm) → marges.
  // Nouvelle place du groupe (cm) → marges : celles de la classe affichee si elle a un placement
  // propre, sinon le placement commun.
  function poser(rect, texteBas) {
    const r = reglages();
    if (rect) {
      const m = { gauche: arrondi(rect.x), haut: arrondi(rect.y), droite: arrondi(PL - rect.x - rect.w), bas: arrondi(PH - rect.y - rect.h) };
      if (estPerso()) S.perso[cleDe(courant())] = m;
      else Object.assign(r, m);
    }
    if (texteBas !== undefined) r.texteBas = arrondi(texteBas);
    appliquer(r);
    repeindre();
  }

  function pointCm(e) {
    const b = $('cl-canvas').getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width * PL, y: (e.clientY - b.top) / b.height * PH };
  }

  function cible(pt) {
    const p = placeActuelle();
    if (!p) return null;
    const r = reglages(), pres = 0.6;
    const coins = [[p.x, p.y, p.x + p.w, p.y + p.h], [p.x + p.w, p.y, p.x, p.y + p.h], [p.x, p.y + p.h, p.x + p.w, p.y], [p.x + p.w, p.y + p.h, p.x, p.y]];
    for (const [cx, cy, ax, ay] of coins) {
      if (Math.abs(pt.x - cx) < pres && Math.abs(pt.y - cy) < pres) return { mode: 'coin', ax, ay, p, cx, cy };
    }
    if (Math.abs(pt.y - (PH - r.texteBas)) < 0.45 && pt.x > r.gauche - 1 && pt.x < PL - r.droite + 1 && !(pt.x > p.x && pt.x < p.x + p.w && pt.y > p.y && pt.y < p.y + p.h)) {
      return { mode: 'texte', t0: r.texteBas };
    }
    if (pt.x > p.x && pt.x < p.x + p.w && pt.y > p.y && pt.y < p.y + p.h) return { mode: 'deplacer', p };
    return null;
  }

  const CURSEURS = { deplacer: 'move', texte: 'ns-resize' };
  function curseur(c) {
    if (!c) return 'default';
    if (c.mode !== 'coin') return CURSEURS[c.mode];
    return (c.cx < c.ax) === (c.cy < c.ay) ? 'nwse-resize' : 'nesw-resize';
  }

  function deplacerVers(p, x, y, aimant) {
    let nx = borne(x, 0, PL - p.w);
    const ny = borne(y, 0, PH - p.h);
    let centre = false;
    if (aimant && Math.abs(nx + p.w / 2 - PL / 2) < 0.25) { nx = PL / 2 - p.w / 2; centre = true; }
    return { rect: { x: nx, y: ny, w: p.w, h: p.h }, centre };
  }

  function glisser(e) {
    const g = S.glisse, pt = pointCm(e);
    if (g.mode === 'deplacer') {
      const d = deplacerVers(g.p, g.p.x + pt.x - g.depart.x, g.p.y + pt.y - g.depart.y, true);
      g.centre = d.centre;
      poser(d.rect);
    } else if (g.mode === 'coin') {
      // agrandi depuis le coin oppose, sans deformation, sans sortir de la feuille
      const versDroite = g.cx > g.ax, versBas = g.cy > g.ay;
      const maxW = versDroite ? PL - g.ax : g.ax, maxH = versBas ? PH - g.ay : g.ay;
      let s = Math.max(Math.abs(pt.x - g.ax) / g.p.w, Math.abs(pt.y - g.ay) / g.p.h);
      s = borne(s, 2 / g.p.w, Math.min(maxW / g.p.w, maxH / g.p.h));
      const w = g.p.w * s, h = g.p.h * s;
      poser({ x: versDroite ? g.ax : g.ax - w, y: versBas ? g.ay : g.ay - h, w, h });
    } else if (g.mode === 'texte') {
      poser(null, borne(PH - pt.y, 0.5, PH - 0.5));
    }
  }

  function zoom(f) {
    const p = placeActuelle();
    if (!p) return;
    const s = Math.min(f, PL / p.w, PH / p.h);
    const w = Math.max(2, p.w * s), h = p.h * w / p.w;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    poser(deplacerVers({ w, h }, cx - w / 2, cy - h / 2, false).rect);
    enregistrer();
  }

  function initPlacement() {
    const cv = $('cl-canvas');
    cv.addEventListener('pointerdown', e => {
      const c = cible(pointCm(e));
      if (!c) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      S.glisse = Object.assign(c, { depart: pointCm(e) });
      cv.focus({ preventScroll: true });
    });
    cv.addEventListener('pointermove', e => {
      if (S.glisse) glisser(e);
      else cv.style.cursor = curseur(cible(pointCm(e)));
    });
    const fin = () => {
      if (!S.glisse) return;
      S.glisse = null;
      enregistrer();
      repeindre();
    };
    cv.addEventListener('pointerup', fin);
    cv.addEventListener('pointercancel', fin);
    // clavier : fleches = 1 mm (Maj : 1 cm), + et - = agrandir / reduire
    cv.addEventListener('keydown', e => {
      const p = placeActuelle();
      if (!p) return;
      const pas = e.shiftKey ? 1 : 0.1;
      const d = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key];
      if (d) { e.preventDefault(); poser(deplacerVers(p, p.x + d[0], p.y + d[1], false).rect); enregistrer(); }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.02); }
      if (e.key === '-') { e.preventDefault(); zoom(1 / 1.02); }
    });
    $('cl-plus').addEventListener('click', () => zoom(1.05));
    $('cl-moins').addEventListener('click', () => zoom(1 / 1.05));
    $('cl-centrer').addEventListener('click', () => {
      const p = placeActuelle();
      if (p) { poser({ x: (PL - p.w) / 2, y: p.y, w: p.w, h: p.h }); enregistrer(); }
    });
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
      ecole: $('cl-ecole').value, annee: $('cl-annee').value, reglages: reglagesDe(g), reprendre: $('cl-reprendre').checked,
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
    initPolices();
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
    $('cl-ecole').addEventListener('input', exemples);
    ['cl-t-couleur', 'cl-fond', 'cl-reperes'].forEach(id => $(id).addEventListener('change', changer));
    $('cl-defaut').addEventListener('click', () => { appliquer(P.REGLAGES); changer(); });
    $('cl-defaut-2').addEventListener('click', () => {
      const d = Object.fromEntries(MARGES.map(k => [k, P.REGLAGES[k]]));
      if (estPerso()) S.perso[cleDe(courant())] = d;
      else appliquer(Object.assign(reglages(), d, { texteBas: P.REGLAGES.texteBas }));
      changer();
    });
    $('cl-mode-commun').addEventListener('click', () => choisirMode(false));
    $('cl-mode-perso').addEventListener('click', () => choisirMode(true));
    initPlacement();
    $('cl-prec').addEventListener('click', () => { if (S.groupes.length) { S.index = (S.index - 1 + S.groupes.length) % S.groupes.length; apercu(); } });
    $('cl-suiv').addEventListener('click', () => { if (S.groupes.length) { S.index = (S.index + 1) % S.groupes.length; apercu(); } });
    $('cl-go').addEventListener('click', () => SL.u.busy($('cl-go'), lancer));
    $('cl-stop').addEventListener('click', annuler);
    window.addEventListener('beforeunload', e => { if (S.enCours) { e.preventDefault(); e.returnValue = ''; } });
    await relire();
  }

  return { init, definir, etat: S };
})();
