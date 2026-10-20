// Ecran « Traitement par lot » : detourage de toute une seance, reprise, galerie de controle.
(function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;
  const ui = SL.dt.ui;
  const S = ui.etat;
  const seance = SL.dt.seance;
  const STATUTS = { fait: 'Détourée', verifier: 'À vérifier', valide: 'Validée', erreur: 'Erreur' };

  const L = {
    exportDir: null, racine: null, etat: null,
    actif: false, pause: false, arret: false, enAttente: [],
    file: [], total: 0, faits: 0, sautes: 0, debut: 0,
    filtre: 'toutes', tri: 'score', urls: new Map(), reserves: new Set(),
  };

  // Exports choisis (gardes dans le navigateur ; le dossier des fonds avec la derniere seance).
  const EXPORTS = 'slowik-detourage-exports';
  const X = Object.assign({ png: true, masque: false, surFonds: false, format: 'JPEG', qualite: 92, mode: 'cover', projet: '', coches: null },
    (() => { try { return JSON.parse(localStorage.getItem(EXPORTS)) || {}; } catch (e) { return {}; } })());
  X.fondsDir = null;
  X.fonds = [];
  const sauverExports = () => {
    try {
      localStorage.setItem(EXPORTS, JSON.stringify({ png: X.png, masque: X.masque, surFonds: X.surFonds, format: X.format, qualite: X.qualite,
        mode: X.mode, projet: X.projet, coches: X.fonds.length ? X.fonds.filter(f => f.coche).map(f => f.name) : X.coches }));
    } catch (e) { /* prive */ }
  };
  const DOSSIER_FONDS = 'Sur fonds', DOSSIER_MASQUES = 'Masques';
  const fondsCoches = () => (X.surFonds ? X.fonds.filter(f => f.coche) : []);
  // Signature des exports : une photo deja faite avec d'autres exports est refaite (reprise).
  const signature = () => JSON.stringify({
    png: X.png, masque: X.masque, fonds: fondsCoches().map(f => f.name).sort(),
    format: fondsCoches().length ? X.format : '', qualite: fondsCoches().length && X.format !== 'PNG' ? X.qualite : 0,
    mode: fondsCoches().length ? X.mode : '', projet: fondsCoches().length ? X.projet : '',
  });
  const SIGNATURE_LOT2 = JSON.stringify({ png: true, masque: false, fonds: [], format: '', qualite: 0, mode: '', projet: '' });

  // ---------------------------------------------------------------------------------
  // Ecrans Reglage / Lot
  // ---------------------------------------------------------------------------------
  function montrer(ecran) {
    document.querySelectorAll('.topbar .tab').forEach(t => {
      const on = t.dataset.ecran === ecran;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    $('ecran-reglage').classList.toggle('hidden', ecran !== 'reglage');
    $('ecran-lot').classList.toggle('hidden', ecran !== 'lot');
    if (ecran === 'lot') afficherInfos();
  }

  // ---------------------------------------------------------------------------------
  // Dossiers et seance
  // ---------------------------------------------------------------------------------
  async function definirExport(dir) {
    L.exportDir = dir;
    $('lot-export-name').textContent = dir.name;
    $('lot-export-name').classList.add('set');
    const { racine, etat } = await seance.ouvrir(dir);
    L.racine = racine;
    L.etat = etat;
    for (const u of L.urls.values()) URL.revokeObjectURL(u);
    L.urls.clear();
    await chargerVignettes();
    memoriser();
    afficherInfos();
    afficherCartes();
  }

  function memoriser() {
    if (S.sourceDir && L.exportDir) seance.memoriser({ source: S.sourceDir, export: L.exportDir, fonds: X.fondsDir, date: new Date().toISOString() });
  }

  async function chargerVignettes() {
    const photos = S.photos.filter(p => L.etat.photos[seance.cle(p)] && L.etat.photos[seance.cle(p)].vignette);
    await Promise.all(photos.map(async p => {
      const e = L.etat.photos[seance.cle(p)];
      const f = await seance.lireVignette(L.racine, e.vignette);
      if (f) L.urls.set(seance.cle(p), URL.createObjectURL(f));
    }));
  }

  // Derniere seance (dossiers memorises par le navigateur) : reprise en un clic.
  async function proposerDerniere() {
    const d = await seance.derniere();
    if (!d || !d.source || !d.export) return;
    const box = $('lot-derniere');
    box.innerHTML = html`<span>Dernière séance : <b>${d.source.name}</b> → <b>${d.export.name}</b></span>
      <button class="btn small" type="button" id="lot-derniere-btn">Reprendre</button>`;
    box.classList.remove('hidden');
    $('lot-derniere-btn').addEventListener('click', () => SL.u.busy($('lot-derniere-btn'), async () => {
      const okS = await SL.fsa.requestPermission(d.source, false).catch(() => false);
      const okE = await SL.fsa.requestPermission(d.export, true).catch(() => false);
      if (!okS || !okE) { SL.u.toast('Accès aux dossiers refusé.', 'error'); return; }
      await ui.ouvrirDossier(d.source);
      await definirExport(d.export);
      if (d.fonds && await SL.fsa.requestPermission(d.fonds, false).catch(() => false)) await definirFonds(d.fonds);
      box.classList.add('hidden');
    }));
  }

  // ---------------------------------------------------------------------------------
  // Affichage : informations, progression, statistiques, galerie
  // ---------------------------------------------------------------------------------
  function afficherInfos() {
    const n = S.photos.length;
    const classes = new Set(S.photos.map(p => p.classe).filter(Boolean)).size;
    $('lot-photos').textContent = n
      ? `${n} photo${n > 1 ? 's' : ''}${classes ? ` dans ${classes} classe${classes > 1 ? 's' : ''}` : ''}${S.sourceDir ? ` (dossier « ${S.sourceDir.name} »)` : ''}.`
      : 'Aucune photo : choisissez le dossier de la séance.';
    $('lot-reglages').textContent = `Préréglage « ${S.preset} »${ui.presetModifie() ? ', modifié dans l\'écran Réglage' : ''} — ${S.type === 'groupes' ? 'photos de groupe' : 'portraits'}.`;
    $('lot-start').disabled = L.actif;
    $('lot-vers-choix').classList.toggle('hidden', S.type !== 'groupes');
    afficherExports();
    afficherStats();
  }

  function compter() {
    const c = { fait: 0, verifier: 0, valide: 0, erreur: 0, retouchee: 0 };
    if (!L.etat) return c;
    for (const p of S.photos) {
      const e = L.etat.photos[seance.cle(p)];
      if (e && c[e.statut] !== undefined) c[e.statut]++;
      if (e && e.retouchee) c.retouchee++;
    }
    return c;
  }

  function afficherStats() {
    const c = compter();
    const total = c.fait + c.verifier + c.valide + c.erreur; // une photo retouchee a aussi un statut
    $('lot-stats').innerHTML = html`
      <div class="stat"><span>Détourées</span><b>${total - c.erreur}</b></div>
      <div class="stat ${c.verifier ? 'warn' : ''}"><span>À vérifier</span><b>${c.verifier}</b></div>
      <div class="stat"><span>Validées</span><b>${c.valide}</b></div>
      <div class="stat ${c.erreur ? 'warn' : ''}"><span>Erreurs</span><b>${c.erreur}</b></div>`;
    document.querySelectorAll('#lot-filtre button').forEach(b => {
      const n = b.dataset.f === 'toutes' ? total : c[b.dataset.f];
      b.textContent = `${{ toutes: 'Toutes', verifier: 'À vérifier', valide: 'Validées', retouchee: 'Retouchées', erreur: 'Erreurs' }[b.dataset.f]} (${n})`;
      b.classList.toggle('active', b.dataset.f === L.filtre);
      b.setAttribute('aria-pressed', b.dataset.f === L.filtre ? 'true' : 'false');
    });
    $('lot-journal').disabled = !L.etat || !total;
  }

  function photosAffichees() {
    if (!L.etat) return [];
    const liste = S.photos.map((p, i) => ({ p, i, e: L.etat.photos[seance.cle(p)] }))
      .filter(x => x.e && (L.filtre === 'toutes' || (L.filtre === 'retouchee' ? x.e.retouchee : x.e.statut === L.filtre)));
    if (L.tri === 'score') {
      const rang = x => (x.e.statut === 'erreur' ? -1 : x.e.statut === 'valide' ? 1000 : x.e.score ?? 0);
      liste.sort((a, b) => rang(a) - rang(b) || a.i - b.i);
    }
    return liste;
  }

  let cartesTimer = null;
  function planifierCartes() {
    if (cartesTimer) return;
    cartesTimer = setTimeout(() => { cartesTimer = null; afficherCartes(); }, 600);
  }

  function afficherCartes() {
    afficherStats();
    const liste = photosAffichees();
    const box = $('lot-cartes');
    if (!liste.length) {
      box.innerHTML = html`<p class="placeholder">${L.etat
        ? (L.filtre === 'toutes' ? 'Aucune photo détourée pour l\'instant.' : 'Aucune photo dans ce filtre.')
        : 'Choisissez le dossier d\'export : les photos détourées apparaîtront ici, les plus douteuses en premier.'}</p>`;
      return;
    }
    box.innerHTML = html`${liste.map(({ p, i, e }) => {
      const k = seance.cle(p);
      const url = L.urls.get(k);
      const badge = e.statut === 'erreur' ? 'lock' : e.statut === 'verifier' ? 'wait' : 'ok';
      return html`<article class="dt-carte ${e.statut}" data-i="${i}">
        <div class="dt-vignette">${url ? html`<img src="${url}" alt="" loading="lazy">` : ''}</div>
        <div class="dt-carte-txt">
          <b title="${k}">${p.name}</b>
          ${p.classe ? html`<span class="hint">${p.classe}</span>` : ''}
          <span><span class="badge ${badge}">${STATUTS[e.statut]}</span>
            ${e.score !== undefined && e.score !== null ? html`<span class="badge dt-score" title="Score de confiance">${e.score}</span>` : ''}
            ${e.retouchee ? html`<span class="badge" title="Retouchée au pinceau">Retouchée</span>` : ''}</span>
          ${e.statut === 'erreur' ? html`<span class="small error-text">${e.erreur}</span>`
            : (e.motifs || []).map(m => html`<span class="small dt-motif">${m}</span>`)}
        </div>
        <div class="dt-carte-actions">
          ${e.statut === 'verifier' ? html`<button class="btn small" type="button" data-a="valider">Valider</button>` : ''}
          <button class="btn small secondary" type="button" data-a="ouvrir">Ouvrir</button>
          <button class="btn small ghost" type="button" data-a="refaire">Refaire</button>
        </div>
      </article>`;
    })}`;
  }

  function progression() {
    const fini = L.faits + L.sautes;
    $('lot-progress').max = Math.max(1, L.total);
    $('lot-progress').value = fini;
    let txt = `${fini} / ${L.total}`;
    if (L.sautes) txt += ` (${L.sautes} déjà faite${L.sautes > 1 ? 's' : ''}, sautée${L.sautes > 1 ? 's' : ''})`;
    if (L.actif && L.faits) {
      const ecoule = (performance.now() - L.debut) / 1000;
      const reste = Math.round(((L.total - fini) * ecoule) / L.faits);
      txt += ` — reste ≈ ${reste < 60 ? `${reste} s` : `${Math.round(reste / 60)} min`}`;
    }
    if (L.pause && L.actif) txt += ' — en pause (les photos en cours se terminent)';
    $('lot-progress-label').textContent = txt;
  }

  // ---------------------------------------------------------------------------------
  // Traitement
  // ---------------------------------------------------------------------------------
  let sauverTimer = null;
  function planifierSauvegarde(immediat) {
    clearTimeout(sauverTimer);
    const f = () => seance.enregistrer(L.racine, L.etat).catch(e => SL.u.toast(`Sauvegarde de la séance impossible : ${e.message}`, 'error'));
    if (immediat) return f();
    sauverTimer = setTimeout(f, 1500);
    return null;
  }

  function nbWorkers() {
    const coeurs = navigator.hardwareConcurrency || 2;
    const memoire = navigator.deviceMemory || 4;
    const n = Math.max(1, Math.min(4, coeurs - 1, Math.floor(memoire / 2)));
    return S.type === 'groupes' ? Math.min(2, n) : n; // 45 Mpx : beaucoup de memoire par photo
  }

  function makeWorker() {
    const w = new Worker('js/worker/detourage-worker.js');
    let n = 0;
    const attente = new Map();
    w.onmessage = e => {
      const p = attente.get(e.data.id);
      attente.delete(e.data.id);
      if (p) e.data.ok ? p.resolve(e.data.res) : p.reject(new Error(e.data.err));
    };
    w.onerror = e => {
      e.preventDefault();
      for (const p of attente.values()) p.reject(new Error(e.message || 'Erreur de calcul (mémoire insuffisante ?).'));
      attente.clear();
    };
    return {
      call(type, args) { const id = ++n; return new Promise((resolve, reject) => { attente.set(id, { resolve, reject }); w.postMessage({ id, type, args }); }); },
      terminate: () => w.terminate(),
    };
  }

  // Nom de sortie libre (jamais d'ecrasement), y compris entre photos traitees en meme temps.
  async function nomLibre(dir, cle, nom) {
    let n = await SL.fsa.uniqueName(dir, nom);
    const stem = SL.naming.stem(nom), ext = nom.slice(stem.length);
    for (let k = 2; L.reserves.has(`${cle}/${n}`); k++) n = await SL.fsa.uniqueName(dir, `${stem}-${k}${ext}`);
    L.reserves.add(`${cle}/${n}`);
    return n;
  }

  // Sous-dossier de classe dans un dossier de l'export (« Détourés », « Sur fonds », « Masques »).
  async function dossierSortie(nom, classe) {
    return SL.fsa.subdir(await L.exportDir.getDirectoryHandle(nom, { create: true }), classe ? classe.split('/') : []);
  }

  // Fichiers d'une photo, chemins depuis le dossier d'export (seances du lot 2 : PNG seul).
  const fichiersDe = e => (e ? e.fichiers || (e.sortie ? [`${seance.DOSSIER}/${e.sortie}`] : []) : []);

  // Messages du navigateur (souvent en anglais) traduits pour la galerie et le journal.
  function messageErreur(e) {
    const m = String(e && e.message || e);
    if (/decod|could not be|invalid image|TIFF illisible/i.test(m)) return 'Photo illisible (fichier abîmé ou format non pris en charge).';
    if (/memory|allocation|out of/i.test(m)) return 'Mémoire insuffisante pour cette photo : fermez d\'autres programmes puis refaites-la.';
    if (/NotAllowed|permission/i.test(m)) return 'Accès au dossier refusé.';
    if (/NoModificationAllowed|QuotaExceeded|space/i.test(m)) return 'Écriture impossible (disque plein ou fichier ouvert ailleurs).';
    return m;
  }

  async function traiterUne(w, photo, params, prereglage, n) {
    const k = seance.cle(photo);
    const ancien = L.etat.photos[k];
    try {
      // Photo deja faite que l'on refait : les anciens fichiers sont deplaces, jamais effaces.
      for (const f of fichiersDe(ancien)) if (await seance.fichierExiste(L.exportDir, f)) await seance.archiver(L.exportDir, f);
      const classe = photo.classe || '';
      const stem = SL.naming.clean(SL.naming.stem(photo.name));
      const chemin = (racine, nom) => [racine, classe, nom].filter(Boolean).join('/');
      const exports = { fonds: [], mode: X.mode };
      const fichiers = [];
      let sortie = null;
      if (X.png) {
        const dir = await seance.dossierClasse(L.racine, classe);
        const nom = await nomLibre(dir, `png:${classe}`, `${stem}.png`);
        exports.png = { dir, nom };
        sortie = classe ? `${classe}/${nom}` : nom;
        fichiers.push(chemin(seance.DOSSIER, nom));
      }
      if (X.masque) {
        const dir = await dossierSortie(DOSSIER_MASQUES, classe);
        const nom = await nomLibre(dir, `masque:${classe}`, `${stem}_masque.png`);
        exports.masque = { dir, nom };
        fichiers.push(chemin(DOSSIER_MASQUES, nom));
      }
      const fmt = SL.naming.FORMATS[X.format] || SL.naming.FORMATS.JPEG;
      exports.format = { type: fmt.mime, quality: X.qualite / 100 };
      for (const f of fondsCoches()) {
        const dir = await dossierSortie(DOSSIER_FONDS, classe);
        const nom = await nomLibre(dir, `fonds:${classe}`, SL.naming.build(X.projet, n, photo.name, f.name, fmt.ext));
        exports.fonds.push({ file: await f.handle.getFile(), cle: `${f.name}|${f.taille}`, dir, nom });
        fichiers.push(chemin(DOSSIER_FONDS, nom));
      }
      const vdir = await seance.dossierVignettes(L.racine, classe);
      const nomV = `${stem}.webp`;
      exports.vignette = { dir: vdir, nom: nomV };
      const r = await w.call('traiter', { file: await photo.getFile(), params, type: S.type, retouches: ui.traitsPour(photo), exports });
      L.etat.photos[k] = {
        statut: r.aVerifier ? 'verifier' : 'fait', score: r.score, motifs: r.motifs, sortie, fichiers, sig: signature(),
        vignette: classe ? `${classe}/${nomV}` : nomV, duree: r.duree, taille: [r.w, r.h], prereglage, date: new Date().toISOString(),
        retouchee: ui.aDesRetouches(photo), ia: r.ia, dpi: r.dpi, profil: r.profil, gpu: r.gpu,
      };
      if (L.urls.has(k)) URL.revokeObjectURL(L.urls.get(k));
      L.urls.set(k, URL.createObjectURL(r.vignette));
      L.faits++;
    } catch (e) {
      L.etat.photos[k] = { statut: 'erreur', erreur: messageErreur(e), date: new Date().toISOString(), fichiers: fichiersDe(ancien) };
      L.faits++;
    }
    planifierSauvegarde();
    progression();
    planifierCartes();
  }

  async function lancer(liste, forcer) {
    if (L.actif) return;
    if (!S.photos.length) { SL.u.alert('Choisissez d\'abord le dossier des photos de la séance.', { title: 'Aucune photo' }); return; }
    if (!L.exportDir) { SL.u.alert('Choisissez le dossier d\'export : les PNG détourés y seront rangés dans « Détourés ».', { title: 'Dossier d\'export manquant' }); return; }
    if (!(await SL.fsa.requestPermission(L.exportDir, true).catch(() => false))) { SL.u.toast('Accès au dossier d\'export refusé.', 'error'); return; }
    if (X.surFonds && !fondsCoches().length) { SL.u.alert('Choisissez le dossier des fonds et cochez au moins un fond, ou décochez « Photos posées sur des fonds ».', { title: 'Aucun fond' }); return; }
    if (!X.png && !X.masque && !fondsCoches().length) { SL.u.alert('Cochez au moins un export.', { title: 'Rien à exporter' }); return; }
    if (X.fondsDir && fondsCoches().length && !(await SL.fsa.requestPermission(X.fondsDir, false).catch(() => false))) { SL.u.toast('Accès au dossier des fonds refusé.', 'error'); return; }
    const params = Object.assign({}, S.params);
    const prereglage = S.preset + (ui.presetModifie() ? ' (modifié)' : '');
    const reprise = !forcer && $('lot-reprise').checked;
    L.actif = true; L.pause = false; L.arret = false;
    L.faits = 0; L.sautes = 0; L.reserves.clear();
    L.file = [];
    const cibles = liste || S.photos;
    L.total = cibles.length;
    $('lot-progress-label').textContent = 'Préparation…';
    // n : numero de la photo dans sa classe (comme le compositeur).
    const numeros = new Map(), compteurs = new Map();
    for (const p of S.photos) {
      const n = (compteurs.get(p.classe || '') || 0) + 1;
      compteurs.set(p.classe || '', n);
      numeros.set(p, n);
    }
    const sig = signature();
    for (const p of cibles) {
      const e = L.etat.photos[seance.cle(p)];
      if (reprise && e && e.statut !== 'erreur' && (e.sig || SIGNATURE_LOT2) === sig && await toutExiste(e)) { L.sautes++; continue; }
      L.file.push(p);
    }
    boutons();
    progression();
    L.debut = performance.now();
    const pool = Array.from({ length: Math.min(nbWorkers(), Math.max(1, L.file.length)) }, makeWorker);
    await Promise.all(pool.map(async w => {
      while (!L.arret && L.file.length) {
        if (L.pause) { await new Promise(r => L.enAttente.push(r)); continue; }
        const p = L.file.shift();
        await traiterUne(w, p, params, prereglage, numeros.get(p));
      }
      w.terminate();
    }));
    L.actif = false;
    await planifierSauvegarde(true);
    try { await SL.fsa.writeFile(L.racine, 'journal-detourage.csv', seance.journal(L.etat, S.photos)); } catch (e) { /* journal : facultatif */ }
    boutons();
    progression();
    afficherCartes();
    const c = compter();
    const fin = L.arret ? 'Traitement arrêté' : 'Traitement terminé';
    $('lot-progress-label').textContent = `${fin} : ${L.faits} photo${L.faits > 1 ? 's' : ''} traitée${L.faits > 1 ? 's' : ''}`
      + `${L.sautes ? `, ${L.sautes} sautée${L.sautes > 1 ? 's' : ''}` : ''}. À vérifier : ${c.verifier}. Erreurs : ${c.erreur}.`;
    SL.u.toast(`${fin}. ${c.verifier} photo${c.verifier > 1 ? 's' : ''} à vérifier.`, c.erreur ? 'error' : 'ok');
  }

  async function toutExiste(e) {
    const f = fichiersDe(e);
    if (!f.length) return false;
    for (const c of f) if (!(await seance.fichierExiste(L.exportDir, c))) return false;
    return true;
  }

  function relacher() {
    L.enAttente.splice(0).forEach(r => r());
  }

  function boutons() {
    $('lot-start').classList.toggle('hidden', L.actif);
    $('lot-pause').classList.toggle('hidden', !L.actif);
    $('lot-stop').classList.toggle('hidden', !L.actif);
    $('lot-pause').textContent = L.pause ? 'Reprendre' : 'Pause';
    $('lot-pick-export').disabled = L.actif;
    $('lot-pick-dir').disabled = L.actif;
    $('lot-refaire-tout').disabled = L.actif;
  }

  // ---------------------------------------------------------------------------------
  // Exports : PNG, masques, photos posees sur des fonds
  // ---------------------------------------------------------------------------------
  async function definirFonds(dir) {
    X.fondsDir = dir;
    $('exp-fonds-nom').textContent = dir.name;
    $('exp-fonds-nom').classList.add('set');
    const liste = await SL.images.listImages(dir);
    X.fonds = await Promise.all(liste.map(async f => ({
      name: f.name, handle: f.handle, taille: (await f.handle.getFile()).size, coche: !X.coches || X.coches.includes(f.name),
    })));
    sauverExports();
    afficherExports();
    memoriser();
  }

  function afficherExports() {
    $('exp-png').checked = X.png;
    $('exp-masque').checked = X.masque;
    $('exp-fonds').checked = X.surFonds;
    $('exp-fonds-options').classList.toggle('hidden', !X.surFonds);
    $('exp-fonds-liste').innerHTML = X.fondsDir
      ? (X.fonds.length
        ? html`${X.fonds.map((f, i) => html`<label class="check"><input type="checkbox" data-fond="${i}" ${f.coche ? SL.u.raw('checked') : ''}><span title="${f.name}">${SL.naming.stem(f.name)}</span></label>`)}`
        : html`<p class="hint">Aucune image dans ce dossier.</p>`)
      : '';
    $('exp-projet').value = X.projet;
    document.querySelectorAll('#exp-mode button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === X.mode);
      b.setAttribute('aria-pressed', b.dataset.mode === X.mode ? 'true' : 'false');
    });
    $('exp-format').value = X.format;
    $('exp-qualite').value = X.qualite;
    $('exp-qualite-box').querySelector('output').textContent = X.qualite;
    $('exp-qualite-box').classList.toggle('disabled', X.format === 'PNG');
    const fond = fondsCoches()[0] || X.fonds[0];
    const p = S.photos[0];
    $('exp-exemple').textContent = fond && p
      ? `Exemple : ${SL.naming.build(X.projet, 1, p.name, fond.name, (SL.naming.FORMATS[X.format] || SL.naming.FORMATS.JPEG).ext)}`
      : '';
  }

  function brancherExports() {
    const changer = () => { sauverExports(); afficherExports(); };
    $('exp-png').addEventListener('change', e => { X.png = e.target.checked; changer(); });
    $('exp-masque').addEventListener('change', e => { X.masque = e.target.checked; changer(); });
    $('exp-fonds').addEventListener('change', e => { X.surFonds = e.target.checked; changer(); });
    $('exp-fonds-pick').addEventListener('click', async () => {
      let dir;
      try { dir = await SL.fsa.pick('slowik-detourage-fonds', false); } catch (e) { return; }
      await SL.u.busy($('exp-fonds-pick'), () => definirFonds(dir));
    });
    $('exp-fonds-liste').addEventListener('change', e => {
      const i = e.target.dataset.fond;
      if (i === undefined) return;
      X.fonds[+i].coche = e.target.checked;
      changer();
    });
    $('exp-projet').addEventListener('input', e => { X.projet = e.target.value.trim(); sauverExports(); afficherExports(); });
    $('exp-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { X.mode = b.dataset.mode; changer(); } });
    $('exp-format').addEventListener('change', e => { X.format = e.target.value; changer(); });
    $('exp-qualite').addEventListener('input', e => { X.qualite = Number(e.target.value); changer(); });
    if (!SL.fsa.supported) $('exp-fonds-pick').disabled = true;
  }

  // ---------------------------------------------------------------------------------
  // Envoi vers le compositeur et le choix des fonds (Studio SLOWIK)
  // ---------------------------------------------------------------------------------
  async function versCompositeur() {
    if (!L.racine || !compter().fait && !compter().verifier && !compter().valide) {
      SL.u.alert('Lancez d\'abord le détourage : le compositeur recevra le dossier « Détourés ».', { title: 'Rien à envoyer' });
      return;
    }
    await SL.envoi.deposer('compositeur', { dossier: L.racine });
    location.href = '../index.html#compositeur';
  }

  async function versChoix() {
    const photos = L.etat ? S.photos.filter(p => { const e = L.etat.photos[seance.cle(p)]; return e && e.statut !== 'erreur' && e.sortie; }) : [];
    if (!photos.length) {
      SL.u.alert('Aucune photo de groupe détourée en PNG à envoyer.', { title: 'Rien à envoyer' });
      return;
    }
    const fichiers = [];
    for (const p of photos) {
      const e = L.etat.photos[seance.cle(p)];
      try {
        const parts = `${seance.DOSSIER}/${e.sortie}`.split('/');
        let d = L.exportDir;
        for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
        fichiers.push(await (await d.getFileHandle(parts[parts.length - 1])).getFile());
      } catch (err) { /* fichier deplace : ignore */ }
    }
    if (!(await SL.u.confirm(`Envoyer ${fichiers.length} photo${fichiers.length > 1 ? 's' : ''} de groupe au choix des fonds ? Chacune devient une classe (Classe 1, 2…).`, { ok: 'Envoyer' }))) return;
    await SL.envoi.deposer('choix', { fichiers });
    location.href = '../index.html#choix';
  }

  // ---------------------------------------------------------------------------------
  // Branchements
  // ---------------------------------------------------------------------------------
  function brancher() {
    brancherExports();
    $('lot-vers-compositeur').addEventListener('click', () => SL.u.busy($('lot-vers-compositeur'), versCompositeur));
    $('lot-vers-choix').addEventListener('click', () => SL.u.busy($('lot-vers-choix'), versChoix));
    document.querySelector('.topbar .tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (t) montrer(t.dataset.ecran);
    });
    document.querySelector('.topbar .tabs').addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...document.querySelectorAll('.topbar .tab')];
      const i = tabs.indexOf(document.activeElement);
      const t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      montrer(t.dataset.ecran);
      t.focus();
    });
    document.addEventListener('dt:photos', () => { afficherInfos(); afficherCartes(); memoriser(); });
    if (!SL.fsa.supported) { $('lot-pick-export').disabled = true; $('lot-pick-dir').disabled = true; }
    $('lot-pick-dir').addEventListener('click', () => $('pick-dir').click());
    $('lot-pick-export').addEventListener('click', async () => {
      let dir;
      try { dir = await SL.fsa.pick('slowik-detourage-export', true); } catch (e) { return; }
      await SL.u.busy($('lot-pick-export'), () => definirExport(dir));
    });
    $('lot-start').addEventListener('click', () => lancer());
    $('lot-pause').addEventListener('click', () => {
      L.pause = !L.pause;
      if (!L.pause) relacher();
      boutons();
      progression();
    });
    $('lot-stop').addEventListener('click', async () => {
      if (!(await SL.u.confirm('Arrêter le traitement ? Les photos en cours se terminent ; vous pourrez reprendre plus tard.', { ok: 'Arrêter' }))) return;
      L.arret = true;
      L.file = [];
      L.pause = false;
      relacher();
    });
    $('lot-filtre').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      L.filtre = b.dataset.f;
      afficherCartes();
    });
    $('lot-tri').addEventListener('change', e => { L.tri = e.target.value; afficherCartes(); });
    $('lot-cartes').addEventListener('click', async e => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      const i = +b.closest('.dt-carte').dataset.i;
      const photo = S.photos[i];
      const k = seance.cle(photo);
      if (b.dataset.a === 'valider') {
        L.etat.photos[k].statut = 'valide';
        planifierSauvegarde();
        afficherCartes();
      } else if (b.dataset.a === 'ouvrir') {
        montrer('reglage');
        ui.chargerPhoto(i);
      } else if (b.dataset.a === 'refaire') {
        lancer([photo], true);
      }
    });
    $('lot-valider-tout').addEventListener('click', async () => {
      const liste = photosAffichees().filter(x => x.e.statut === 'verifier');
      if (!liste.length) { SL.u.toast('Aucune photo à valider dans cet affichage.', 'info'); return; }
      if (!(await SL.u.confirm(`Valider ${liste.length} photo${liste.length > 1 ? 's' : ''} sans les ouvrir ?`, { ok: 'Valider' }))) return;
      liste.forEach(x => { x.e.statut = 'valide'; });
      planifierSauvegarde();
      afficherCartes();
    });
    $('lot-refaire-tout').addEventListener('click', async () => {
      const liste = photosAffichees().map(x => x.p);
      if (!liste.length) { SL.u.toast('Aucune photo dans cet affichage.', 'info'); return; }
      if (!(await SL.u.confirm(`Refaire ${liste.length} photo${liste.length > 1 ? 's' : ''} avec les réglages actuels ? Les anciennes versions sont rangées dans « _anciennes versions ».`, { ok: 'Refaire' }))) return;
      lancer(liste, true);
    });
    $('lot-journal').addEventListener('click', () => {
      SL.u.download(seance.journal(L.etat, S.photos), 'journal-detourage.csv');
    });
  }

  brancher();
  afficherInfos();
  proposerDerniere();

  // Pour les tests automatiques.
  SL.dt.lot = { etat: L, exports: X, definirExport, definirFonds, montrer };
})();
