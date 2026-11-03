// Onglet Seances (V2) : creer la seance d'une ecole (son dossier, choisi une fois) et trier les classes :
// les photos de TIFF en vignettes, dans l'ordre de prise de vue ; on designe les groupes, on coupe entre
// les classes, on rattache la liste d'eleves : chaque vignette porte alors le nom de son eleve.
var SL = self.SL = self.SL || {};
SL.seancesUI = (function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;
  const S = {
    seance: null,        // entree du registre { id, ecole, annee, dossier, maj }
    data: null,          // contenu de slowik-seance.json
    photos: [],          // [{ name, handle }] de TIFF, dans l'ordre
    vignettes: new Map(),// nom -> url
    pret: false,
    nouveauDossier: null,
  };

  // --- vignettes (calcul hors de la page, gardees dans le navigateur) -----------------------------
  const travailleurs = [];
  let file = [], enAttente = new Map(), suivant = 0;
  function travailleur() {
    if (!travailleurs.length) {
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      for (let i = 0; i < n; i++) {
        const w = new Worker('js/worker/vignettes-worker.js');
        w.libre = true;
        w.onmessage = e => {
          const p = enAttente.get(e.data.id);
          enAttente.delete(e.data.id);
          w.libre = true;
          if (p) p(e.data);
          pomper();
        };
        travailleurs.push(w);
      }
    }
  }
  function pomper() {
    for (const w of travailleurs) {
      if (!w.libre || !file.length) continue;
      const t = file.shift();
      w.libre = false;
      const id = ++suivant;
      enAttente.set(id, t.fin);
      w.postMessage({ id, file: t.fichier });
    }
  }
  const cleVignette = (f, nom) => `vignette:${S.seance.id}:${nom}:${f.size}:${f.lastModified}`;
  async function vignette(p) {
    if (S.vignettes.has(p.name)) return S.vignettes.get(p.name);
    const f = await p.handle.getFile();
    const cle = cleVignette(f, p.name);
    let blob = null;
    try { blob = await SL.store.idbGet(cle); } catch (e) { /* pas de cache */ }
    if (!blob) {
      travailleur();
      const r = await new Promise(fin => { file.push({ fichier: f, fin }); pomper(); });
      if (r.erreur) throw new Error(r.erreur);
      blob = r.blob;
      try { await SL.store.idbSet(cle, blob); } catch (e) { /* stockage plein */ }
    }
    const url = URL.createObjectURL(blob);
    S.vignettes.set(p.name, url);
    return url;
  }
  async function chargerVignettes() {
    const total = S.photos.length;
    let faites = 0;
    const jeton = S.seance && S.seance.id;
    const etat = () => { $('se-vignettes').textContent = faites < total ? `Vignettes : ${faites} / ${total}` : ''; };
    etat();
    await Promise.all(S.photos.map(p => vignette(p).then(url => {
      if (!S.seance || S.seance.id !== jeton) return;
      document.querySelectorAll(`#se-tri img[data-photo="${CSS.escape(p.name)}"]`).forEach(i => { i.src = url; });
    }).catch(() => {}).finally(() => { faites++; etat(); })));
  }

  // --- liste des seances / nouvelle seance --------------------------------------------------------
  async function afficherListe() {
    $('se-vue').classList.add('hidden');
    $('se-accueil').classList.remove('hidden');
    S.seance = null;
    const liste = await SL.seances.toutes();
    $('se-liste').innerHTML = liste.length ? html`${liste.map(s => html`<button type="button" class="ac-carte se-carte" data-seance="${s.id}">
        <span class="ac-type">Séance ${s.annee}</span><strong>${s.ecole.nom || 'École sans nom'}</strong>
        <span class="hint">Dossier « ${s.dossier ? s.dossier.name : '?'} » · ${s.resume || ''}</span></button>`)}`
      : html`<p class="hint">Aucune séance pour l'instant : crée celle de ta première école ci-dessous.</p>`;
  }

  async function remplirEcoles(preselection) {
    const sel = $('se-ecole');
    let ecoles = [];
    if (SL.cloud.configured) { try { ecoles = (await SL.cloud.ecoles.list()).filter(e => !e.archivee); } catch (e) { /* hors ligne ou sans compte */ } }
    sel.innerHTML = html`${ecoles.map(e => html`<option value="${e.id}">${e.nom}</option>`)}<option value="">Autre école (taper son nom)</option>`;
    if (preselection && ecoles.some(e => e.id === preselection)) sel.value = preselection;
    S.ecoles = ecoles;
    majEcoleLibre();
  }
  function majEcoleLibre() { $('se-ecole-libre-champ').classList.toggle('hidden', $('se-ecole').value !== ''); }

  async function choisirDossier() {
    let dir;
    try { dir = await SL.fsa.pick('slowik2-seance', true); } catch (e) { if (e.name !== 'AbortError') SL.u.toast(e.message, 'error'); return; }
    await definirNouveauDossier(dir);
  }

  async function definirNouveauDossier(dir) {
    S.nouveauDossier = dir;
    const ex = await SL.seances.examiner(dir);
    const json = await SL.seances.lireJson(dir);
    S.nouveauJson = json;
    $('se-dossier').textContent = dir.name;
    $('se-dossier').classList.add('set');
    const lignes = [];
    if (!ex.tiff) lignes.push(html`<span class="error-text">Pas de dossier TIFF dans « ${dir.name} » : choisis le dossier de l'école (celui qui contient SOURCE, TIFF…).</span>`);
    else lignes.push(html`<span>${ex.photos} photo(s) dans TIFF.</span>`);
    if (ex.tiff && ex.manquants.length) lignes.push(html`<span>Seront créés : ${ex.manquants.join(', ')}.</span>`);
    if (json) lignes.push(html`<span class="ok-text">Une séance existe déjà dans ce dossier (${json.ecole && json.ecole.nom}) : elle sera reprise.</span>`);
    $('se-examen').innerHTML = html`${lignes.map(l => html`<div>${l}</div>`)}`;
    $('se-creer').disabled = !ex.tiff;
  }

  async function creer() {
    const dir = S.nouveauDossier;
    if (!dir) return;
    if (!(await SL.fsa.requestPermission(dir, true).catch(() => false))) { SL.u.toast('Accès au dossier refusé.', 'error'); return; }
    const idEcole = $('se-ecole').value;
    const e = (S.ecoles || []).find(x => x.id === idEcole);
    const ecole = e ? { id: e.id, nom: e.nom } : { nom: $('se-ecole-libre').value.trim() };
    if (!ecole.nom && !S.nouveauJson) { SL.u.alert('Choisis l\'école ou tape son nom.', { title: 'Nouvelle séance' }); return; }
    await SL.seances.creerSorties(dir);
    const data = S.nouveauJson || SL.seances.nouvelleSeance({ ecole, annee: $('se-annee').value.trim() || SL.seances.anneeScolaire() });
    if (!S.nouveauJson) await SL.seances.ecrireJson(dir, data);
    const entree = { id: data.id, ecole: data.ecole, annee: data.annee, dossier: dir, maj: Date.now(), resume: 'à trier' };
    await SL.seances.memoriser(entree);
    S.nouveauDossier = null;
    $('se-nouvelle').classList.add('hidden');
    await ouvrir(entree.id);
  }

  // --- une seance ---------------------------------------------------------------------------------
  async function ouvrir(id) {
    const s = await SL.seances.get(id);
    if (!s) return;
    S.seance = s;
    S.vignettes.forEach(u => URL.revokeObjectURL(u));
    S.vignettes = new Map();
    $('se-accueil').classList.add('hidden');
    $('se-vue').classList.remove('hidden');
    $('se-titre').textContent = `${s.ecole.nom || 'École sans nom'} · ${s.annee}`;
    $('se-chemin').textContent = `Dossier « ${s.dossier.name} »`;
    const ok = await SL.fsa.hasPermission(s.dossier, true).catch(() => false);
    $('se-acces').classList.toggle('hidden', ok);
    $('se-acces-nom').textContent = s.dossier.name;
    if (ok) await charger();
    else { $('se-tri').innerHTML = ''; $('se-resume').textContent = ''; }
  }

  async function autoriser() {
    if (!(await SL.fsa.requestPermission(S.seance.dossier, true).catch(() => false))) return;
    $('se-acces').classList.add('hidden');
    await charger();
  }

  async function charger() {
    const dir = S.seance.dossier;
    S.photos = await SL.seances.photos(dir);
    S.data = (await SL.seances.lireJson(dir)) || SL.seances.nouvelleSeance({ ecole: S.seance.ecole, annee: S.seance.annee });
    SL.seances.normaliser(S.data, S.photos.map(p => p.name));
    await afficher();
    chargerVignettes();
    production();
  }

  let attente = null;
  function enregistrer() {
    clearTimeout(attente);
    attente = setTimeout(async () => {
      const tranches = SL.seances.decouper(S.data, S.photos.map(p => p.name));
      S.data.maj = Date.now();
      try {
        await SL.seances.ecrireJson(S.seance.dossier, S.data);
        S.seance.maj = S.data.maj;
        S.seance.resume = `${tranches.length} classe(s), ${tranches.filter(t => t.classe.eleves.length).length} avec leur liste`;
        await SL.seances.memoriser(S.seance);
        $('se-enregistre').textContent = `Enregistré dans « ${S.seance.dossier.name}/${SL.seances.FICHIER} »`;
      } catch (e) {
        SL.u.toast(`Enregistrement impossible : ${e.message}`, 'error');
      }
    }, 300);
  }

  function changer(fn) {
    fn();
    SL.seances.normaliser(S.data, S.photos.map(p => p.name));
    afficher();
    enregistrer();
    clearTimeout(S.prodAttente);
    S.prodAttente = setTimeout(production, 500);
  }

  const nomEleve = e => (e ? [e.nom, e.prenom].filter(Boolean).join(' ') : '');

  async function afficher() {
    const noms = S.photos.map(p => p.name);
    const tranches = SL.seances.decouper(S.data, noms);
    const listes = await SL.listes.toutes();
    const ecartees = new Set(S.data.ecartees || []);
    const sansGroupe = tranches.filter(t => !t.groupe).length;
    const aVerifier = tranches.filter(t => t.classe.eleves.length && t.manque !== 0).length;
    $('se-resume').innerHTML = html`<strong>${noms.length}</strong> photo(s) dans TIFF · <strong>${tranches.length}</strong> classe(s)
      · ${ecartees.size} écartée(s)${sansGroupe ? html` · <span class="warn-text">${sansGroupe} classe(s) sans photo de groupe</span>` : ''}${aVerifier ? html` · <span class="warn-text">${aVerifier} classe(s) où photos et noms ne correspondent pas</span>` : ''}`;
    if (!noms.length) { $('se-tri').innerHTML = html`<p class="hint">Le dossier TIFF est vide : exporte ta sélection Lightroom dedans, puis rouvre la séance.</p>`; return; }
    $('se-tri').innerHTML = html`${tranches.map(t => {
      const c = t.classe, nb = t.portraits.length, ne = c.eleves.length;
      const etat = !ne ? html`<span class="hint">${nb} portrait(s) · choisis la liste de la classe</span>`
        : t.manque === 0 ? html`<span class="ok-text">${nb} portraits · ${ne} élèves ✓</span>`
        : t.manque > 0 ? html`<span class="warn-text">${nb} portraits pour ${ne} élèves : il manque ${t.manque} photo(s) (ou coupe plus loin)</span>`
        : html`<span class="warn-text">${nb} portraits pour ${ne} élèves : ${-t.manque} photo(s) de trop (coupe plus tôt ou écarte)</span>`;
      return html`<section class="se-classe" data-debut="${c.debut}">
        <header class="se-tete">
          <span class="se-num">Classe ${t.k + 1}</span>
          <input type="text" class="se-nom" data-champ="nom" value="${c.nom}" placeholder="Nom (ex : CP A)" aria-label="Nom de la classe ${t.k + 1}">
          <select class="se-liste" data-champ="liste" aria-label="Liste d'élèves de la classe ${t.k + 1}">
            <option value="">— liste d'élèves —</option>
            ${listes.map(l => html`<option value="${l.id}" ${l.id === c.liste ? 'selected' : ''}>${l.nom} (${l.eleves.length})</option>`)}
          </select>
          <span class="se-etat">${etat}</span>
          <span class="se-boutons">
            ${ne ? html`<button type="button" class="btn small secondary" data-act="couper-liste" title="La classe suivante commence après ${ne} portraits">Couper après ${ne} portraits</button>` : ''}
            ${t.k ? html`<button type="button" class="btn small secondary" data-act="fusionner" title="Supprimer cette coupure">Fusionner avec la précédente</button>` : ''}
          </span>
        </header>
        <div class="se-grille">
          ${t.photos.map(n => {
            const groupe = n === t.groupe, ecartee = ecartees.has(n), eleve = t.noms.get(n);
            const etiquette = groupe ? 'Photo de groupe' : ecartee ? 'Écartée' : eleve ? nomEleve(eleve) : (ne ? 'Pas de nom' : '');
            return html`<figure class="se-photo${groupe ? ' groupe' : ''}${ecartee ? ' ecartee' : ''}${!groupe && !ecartee && ne && !eleve ? ' sans-nom' : ''}" data-photo="${n}">
              <img data-photo="${n}" alt="" ${S.vignettes.has(n) ? html`src="${S.vignettes.get(n)}"` : ''}>
              <figcaption><span class="se-eleve">${etiquette}</span><span class="se-fichier">${n}</span></figcaption>
              <div class="se-actions">
                <button type="button" data-act="groupe" title="${groupe ? 'Ce n\'est pas le groupe' : 'Photo de groupe de cette classe'}" aria-pressed="${groupe}">★</button>
                ${n !== c.debut ? html`<button type="button" data-act="couper" title="Nouvelle classe à partir de cette photo">✂</button>` : ''}
                <button type="button" data-act="ecarter" title="${ecartee ? 'Reprendre cette photo' : 'Écarter (photo ratée, en double…)'}" aria-pressed="${ecartee}">✕</button>
              </div>
            </figure>`;
          })}
        </div>
      </section>`;
    })}`;
  }

  // Actions dans le tri (une seule ecoute pour tout le tableau).
  function actionTri(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const section = b.closest('.se-classe'), debut = section.dataset.debut;
    const fig = b.closest('.se-photo'), photo = fig && fig.dataset.photo;
    const noms = S.photos.map(p => p.name);
    const classe = () => S.data.classes.find(c => c.debut === debut);
    changer(() => {
      if (b.dataset.act === 'groupe') { const c = classe(); c.groupe = c.groupe === photo ? null : photo; S.data.ecartees = S.data.ecartees.filter(n => n !== photo); }
      if (b.dataset.act === 'ecarter') {
        const ec = new Set(S.data.ecartees);
        if (ec.has(photo)) ec.delete(photo); else { ec.add(photo); const c = classe(); if (c.groupe === photo) c.groupe = null; }
        S.data.ecartees = [...ec];
      }
      if (b.dataset.act === 'couper') SL.seances.couper(S.data, noms, photo);
      if (b.dataset.act === 'fusionner') SL.seances.fusionner(S.data, noms, debut);
      if (b.dataset.act === 'couper-liste') SL.seances.couperSelonListe(S.data, noms, debut);
    });
  }

  async function champTri(e) {
    const el = e.target.closest('[data-champ]');
    if (!el) return;
    const debut = el.closest('.se-classe').dataset.debut;
    const c = S.data.classes.find(x => x.debut === debut);
    if (el.dataset.champ === 'nom') { c.nom = el.value; enregistrer(); return; }
    if (el.dataset.champ === 'liste') {
      const l = el.value ? await SL.listes.get(el.value) : null;
      changer(() => {
        c.liste = l ? l.id : null;
        c.eleves = l ? l.eleves.map(x => ({ nom: x.nom, prenom: x.prenom })) : [];
        if (l && !c.nom) c.nom = l.nom;
      });
    }
  }

  // --- production depuis la seance ------------------------------------------------------------------
  // Dossier d'une classe dans PNG et JPEGS DEF : son nom (ou « Classe 2 » si elle n'en a pas).
  const dossierClasse = t => SL.naming.clean(t.classe.nom) || `Classe ${t.k + 1}`;
  const stem = n => SL.naming.stem(n).toLowerCase();
  const FONDS = annee => `fonds-saison:${annee}`;

  async function sousDossier(dir, nom, creer) {
    if (!dir) return null;
    try { return await dir.getDirectoryHandle(nom, { create: !!creer }); } catch (e) { return null; }
  }
  // sous-dossier sans tenir compte des majuscules (INDIVIDUELS, Individuels…)
  async function sousDossierLibre(dir, nom) {
    if (!dir) return null;
    for await (const [n, h] of dir.entries()) if (h.kind === 'directory' && n.toLowerCase() === nom.toLowerCase()) return h;
    return null;
  }
  async function images(dir) { return dir ? SL.images.listImages(dir) : []; }

  async function fondsSaison() {
    let d = null;
    try { d = await SL.store.idbGet(FONDS(S.seance.annee)); } catch (e) { /* aucun */ }
    if (!d || !(await SL.fsa.hasPermission(d, false).catch(() => false))) return { dossier: d, ok: false };
    const ind = await sousDossierLibre(d, 'INDIVIDUELS'), cl = await sousDossierLibre(d, 'CLASSE');
    return { dossier: d, ok: true, individuels: ind, classe: cl, nInd: (await images(ind)).length, nCl: (await images(cl)).length };
  }

  async function choisirFonds() {
    let d;
    try { d = await SL.fsa.pick('slowik2-fonds-saison', false); } catch (e) { return; }
    await SL.store.idbSet(FONDS(S.seance.annee), d);
    await production();
  }

  // Etat de chaque etape : ce qui est deja dans PNG, les PNG de groupe, les fonds.
  async function etat() {
    const dir = S.seance.dossier, noms = S.photos.map(p => p.name);
    const tranches = SL.seances.decouper(S.data, noms);
    const png = await sousDossier(dir, 'PNG');
    const classes = [];
    for (const t of tranches) {
      const d = await sousDossier(png, dossierClasse(t));
      const fichiers = await images(d);
      const stems = new Map(fichiers.map(f => [stem(f.name), f]));
      classes.push({ t, dossier: dossierClasse(t), faits: t.portraits.filter(n => stems.has(stem(n))).length,
        groupe: t.groupe ? stems.get(stem(t.groupe)) || null : null });
    }
    return { tranches, classes, png, fonds: await fondsSaison() };
  }

  async function production() {
    const box = $('se-production');
    if (!S.seance || !S.data) { box.innerHTML = ''; return; }
    const e = await etat();
    S.etat = e;
    const portraits = e.classes.reduce((s, c) => s + c.t.portraits.length, 0), faits = e.classes.reduce((s, c) => s + c.faits, 0);
    const avecGroupe = e.classes.filter(c => c.t.groupe), groupesOk = avecGroupe.filter(c => c.groupe);
    const f = e.fonds;
    const ligne = (n, titre, etatHtml, bouton) => html`<li class="se-etape"><span class="ac-num">${n}</span>
      <span class="se-etape-txt"><strong>${titre}</strong><span class="hint">${etatHtml}</span></span>${bouton}</li>`;
    box.innerHTML = html`<h3>Production</h3>
      <div class="folder se-fonds">
        <span class="folder-label">Fonds de la saison ${S.seance.annee} (dossier FONDS avec INDIVIDUELS et CLASSE, choisi une fois pour toutes les écoles)</span>
        <span class="folder-name ${f.ok ? 'set' : ''}">${f.ok ? `${f.dossier.name} · INDIVIDUELS : ${f.individuels ? f.nInd : 'absent'} · CLASSE : ${f.classe ? f.nCl : 'absent'}` : f.dossier ? `${f.dossier.name} (accès à redonner)` : '—'}</span>
        <button class="btn" data-prod="fonds">${f.dossier ? 'Changer' : 'Choisir le dossier FONDS'}</button>
      </div>
      <ol class="se-etapes">
        ${ligne(1, 'Détourage des portraits', html`${faits} / ${portraits} portrait(s) détouré(s) dans PNG (groupes exclus : tu les détoures à la main)`,
          html`<button class="btn small ${faits < portraits ? 'primary' : 'secondary'}" data-prod="detourage" ${portraits ? '' : 'disabled'}>Détourer les portraits</button>`)}
        ${ligne(2, 'Groupes détourés à la main', avecGroupe.length
          ? html`${groupesOk.length} / ${avecGroupe.length} PNG de groupe déposé(s)${avecGroupe.filter(c => !c.groupe).map(c => html`<br>À déposer : <strong>PNG/${c.dossier}/${SL.naming.stem(c.t.groupe)}.png</strong>`)}`
          : 'Désigne les photos de groupe (★) dans le tri des classes ci-dessous.', html`<button class="btn small secondary" data-prod="actualiser">Actualiser</button>`)}
        ${ligne(3, 'Individuels sur fonds', html`${faits} portrait(s) prêt(s) × ${f.ok && f.individuels ? f.nInd : 0} fond(s) → JPEGS DEF/&lt;classe&gt;`,
          html`<button class="btn small secondary" data-prod="individuels" ${faits && f.ok && f.individuels ? '' : 'disabled'}>Ouvrir, prêt à lancer</button>`)}
        ${ligne(4, 'Photos de classe', html`${groupesOk.length} groupe(s) prêt(s) × ${f.ok && f.classe ? f.nCl : 0} fond(s) de classe → JPEGS DEF/&lt;classe&gt;`,
          html`<button class="btn small secondary" data-prod="classe" ${groupesOk.length && f.ok && f.classe ? '' : 'disabled'}>Ouvrir, prêt à lancer</button>`)}
        ${ligne(5, 'Planches contact', html`Un PDF par classe, avec les noms des élèves, dans EXTRA/Planches contact`,
          html`<button class="btn small secondary" data-prod="planches" ${portraits ? '' : 'disabled'}>Créer les planches</button>`)}
      </ol>
      <p class="hint" id="se-prod-etat"></p>`;
  }

  async function lancerEtape(quoi) {
    const dir = S.seance.dossier, e = S.etat || await etat();
    if (quoi === 'fonds') return choisirFonds();
    if (quoi === 'actualiser') return production();
    if (quoi === 'detourage') {
      const photos = [];
      e.classes.forEach(c => c.t.portraits.forEach(n => photos.push({ name: n, classe: c.dossier })));
      await SL.envoi.deposer('detourage-seance', { dossier: dir, photos, ecole: S.seance.ecole.nom, seance: S.seance.id });
      location.href = 'detourage/index.html';
      return;
    }
    if (quoi === 'individuels') {
      const garder = new Map(e.classes.map(c => [c.dossier, c.t.groupe ? stem(c.t.groupe) : null]));
      document.querySelector('#tabs .tab[data-tab=compositeur]').click();
      await SL.compositeur.depuisSeance({
        sources: e.png, fonds: e.fonds.individuels, export: await sousDossier(dir, 'JPEGS DEF', true),
        projet: S.seance.ecole.nom, ordre: e.classes.map(c => c.dossier),
        garder: it => garder.has(it.classe) && garder.get(it.classe) !== stem(it.name),
      });
      return;
    }
    if (quoi === 'classe') {
      const groupes = e.classes.filter(c => c.groupe).map(c => ({ name: `${c.dossier}.png`, handle: c.groupe.handle, classe: c.dossier, classPath: [c.dossier] }));
      document.querySelector('#tabs .tab[data-tab=classe]').click();
      await SL.photoClasseUI.depuisSeance({ groupes, png: e.png, fonds: e.fonds.classe, export: await sousDossier(dir, 'JPEGS DEF', true),
        ecole: S.seance.ecole.nom, annee: S.seance.annee });
      return;
    }
    if (quoi === 'planches') {
      const out = await sousDossier(await sousDossier(dir, 'EXTRA', true), 'Planches contact', true);
      const tiff = await dir.getDirectoryHandle('TIFF');
      let n = 0;
      for (const c of e.classes) {
        if (!c.t.portraits.length) continue;
        const photos = c.t.portraits.map(p => ({ name: nomEleve(c.t.noms.get(p)) || p, file: async () => (await tiff.getFileHandle(p)).getFile() }));
        const blob = await SL.plancheContact.build(photos, { ecole: S.seance.ecole.nom, classe: c.dossier, grille: '4x5',
          onProgress: (i, tot) => { $('se-prod-etat').textContent = `Planche ${c.dossier} : ${i} / ${tot}`; } });
        const nom = await SL.fsa.uniqueName(out, `Planche contact - ${c.dossier}.pdf`);
        await SL.fsa.writeFile(out, nom, blob);
        n++;
      }
      $('se-prod-etat').textContent = `${n} planche(s) contact dans EXTRA/Planches contact.`;
      SL.u.toast(`${n} planche(s) contact créée(s).`, 'ok');
    }
  }

  // Depuis l'Accueil : seance de l'ecole (ou nouvelle seance pour elle).
  async function pourEcole(ecoleId) {
    const annee = SL.seances.anneeScolaire();
    const s = (await SL.seances.toutes()).find(x => x.ecole.id === ecoleId && x.annee === annee);
    if (s) { await ouvrir(s.id); return; }
    await afficherListe();
    $('se-nouvelle').classList.remove('hidden');
    await remplirEcoles(ecoleId);
  }

  async function init() {
    if (!S.pret) {
      S.pret = true;
      $('se-nouvelle-btn').addEventListener('click', async () => {
        $('se-nouvelle').classList.remove('hidden');
        $('se-annee').value = SL.seances.anneeScolaire();
        await remplirEcoles();
      });
      $('se-ecole').addEventListener('change', majEcoleLibre);
      $('se-choisir').addEventListener('click', choisirDossier);
      $('se-creer').addEventListener('click', () => SL.u.busy($('se-creer'), creer));
      $('se-annuler').addEventListener('click', () => { $('se-nouvelle').classList.add('hidden'); S.nouveauDossier = null; });
      $('se-liste').addEventListener('click', e => { const b = e.target.closest('[data-seance]'); if (b) ouvrir(b.dataset.seance); });
      $('se-retour').addEventListener('click', afficherListe);
      $('se-acces-btn').addEventListener('click', autoriser);
      $('se-tri').addEventListener('click', actionTri);
      $('se-tri').addEventListener('input', e => { if (e.target.dataset.champ === 'nom') champTri(e); });
      $('se-tri').addEventListener('change', e => { if (e.target.dataset.champ === 'liste') champTri(e); });
      $('se-production').addEventListener('click', e => {
        const b = e.target.closest('[data-prod]');
        if (b) SL.u.busy(b, () => lancerEtape(b.dataset.prod).catch(err => SL.u.alert(err.message, { title: 'Production' })));
      });
      $('se-annee').value = SL.seances.anneeScolaire();
    }
    if (!S.seance) await afficherListe();
  }

  return { init, ouvrir, pourEcole, definirNouveauDossier, creer, etat: S };
})();
