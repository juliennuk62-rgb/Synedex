// Ecran « Reglage » du detourage : photos temoins, reglages, apercus, loupe, prereglages, export PNG.
(function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;
  const STORE = 'slowik-detourage';
  const APERCU_MAX = 1280;
  const BUILTIN = {
    'Portraits (par défaut)': { type: 'portraits', params: SL.dt.DEFAUTS.portraits },
    'Groupes (par défaut)': { type: 'groupes', params: SL.dt.DEFAUTS.groupes },
  };
  const DEFAUT_DE = { portraits: 'Portraits (par défaut)', groupes: 'Groupes (par défaut)' };
  const NOMS_VUES = { original: 'Original', masque: 'Masque', damier: 'Damier', fond: 'Sur fond' };

  // ---------------------------------------------------------------------------------
  // Etat et memoire (navigateur uniquement)
  // ---------------------------------------------------------------------------------
  function lire() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }
  const memo = lire();
  // Reglages enregistres avant une amelioration des valeurs par defaut : les anciennes valeurs par
  // defaut sont remplacees (une valeur choisie a la main est gardee).
  const VERSION = 3;
  if ((memo.version || 1) < 2) {
    const maj = p => {
      if (!p || typeof p !== 'object') return;
      if (p.methode === 'limite') p.methode = 'moyenne';
      if (p.trous === 20 || p.trous === 10) p.trous = 0;
    };
    maj(memo.params);
    Object.values(memo.presets || {}).forEach(x => x && maj(x.params));
  }
  // Version 3 : detourage hors du fond vert (IA de groupe), « Auto » pour les groupes.
  if ((memo.version || 1) < 3) {
    const maj = (p, type) => { if (p && typeof p === 'object' && !p.fondIA) p.fondIA = type === 'groupes' ? 'auto' : 'non'; };
    maj(memo.params, memo.type);
    Object.values(memo.presets || {}).forEach(x => x && maj(x.params, x.type));
  }
  const S = {
    presets: memo.presets && typeof memo.presets === 'object' ? memo.presets : {},
    preset: memo.preset || DEFAUT_DE.portraits,
    type: memo.type === 'groupes' ? 'groupes' : 'portraits',
    vue: memo.vue || 'cote',
    zoom: memo.zoom === 2 ? 2 : 1,
    bgColor: memo.bgColor || '#ffffff',
    params: null,
    photos: [], temoins: [], courant: -1,
    seq: 0, gen: 0, analyse: null,
    apercu: null,           // { bitmap, w, h, res (canvas), masque (canvas) }
    full: { w: 0, h: 0, pret: false, charge: null },
    bgImg: null, bgFit: null, split: 0.5, loupe: false,
    ia: null,               // masque de l'IA de la photo affichee (calcule par l'apercu)
    iaGroupe: null,         // silhouette de l'IA de groupe : { cle, m, mw, mh... } | { cle, attente | inutile | erreur }
    dernier: null,          // dernier resultat de l'apercu (affichage de l'analyse)
    retouches: { seance: [], classes: {}, photos: {} }, histo: [], refaire: [],
    outil: '', pinceau: { r: 12, durete: 0.6 }, portee: 'photo',
  };
  if (!presetDe(S.preset)) S.preset = DEFAUT_DE[S.type];
  S.params = normaliser(Object.assign({}, presetDe(S.preset).params, memo.params || {}));

  let saveTimer = null;
  function sauver() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({
          version: VERSION, presets: S.presets, preset: S.preset, type: S.type, vue: S.vue, zoom: S.zoom, bgColor: S.bgColor, params: S.params,
        }));
      } catch (e) { /* navigation privee : reglages non retenus */ }
    }, 200);
  }

  function presetDe(nom) { return BUILTIN[nom] || S.presets[nom] || null; }

  // Reglages surs : seulement les cles connues, valeurs bornees (fichiers importes compris).
  function normaliser(p) {
    const out = {};
    const base = SL.dt.DEFAUTS.portraits;
    for (const d of SL.dt.REGLAGES) {
      let v = p ? p[d.k] : undefined;
      if (d.type === 'bool') v = typeof v === 'boolean' ? v : base[d.k];
      else if (d.type === 'choix') v = d.options.some(o => o[0] === v) ? v : base[d.k];
      else {
        v = Number(v);
        if (!Number.isFinite(v)) v = base[d.k];
        v = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
        v = Math.round(v * 100) / 100;
      }
      out[d.k] = v;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------
  // Calculs (deux workers : apercu et pleine definition)
  // ---------------------------------------------------------------------------------
  function makeWorker() {
    const w = new Worker('js/worker/detourage-worker.js');
    let n = 0;
    const attente = new Map();
    w.onmessage = e => {
      const { id, ok, res, err } = e.data;
      const p = attente.get(id);
      attente.delete(id);
      if (p) ok ? p.resolve(res) : p.reject(new Error(err));
    };
    w.onerror = e => {
      e.preventDefault();
      for (const p of attente.values()) p.reject(new Error(e.message || 'Erreur de calcul.'));
      attente.clear();
    };
    return {
      call(type, args, transfer) {
        const id = ++n;
        return new Promise((resolve, reject) => {
          attente.set(id, { resolve, reject });
          w.postMessage({ id, type, args }, transfer || []);
        });
      },
    };
  }
  let W = null;
  const workers = () => (W = W || { apercu: makeWorker(), pleine: makeWorker() });

  // ---------------------------------------------------------------------------------
  // Reglages
  // ---------------------------------------------------------------------------------
  const fmt = (d, v) => (d.unite ? `${Number(v).toLocaleString('fr-FR')} ${d.unite}` : String(v));

  function construireReglages() {
    const bloc = d => {
      if (d.type === 'bool') {
        return html`<label class="switch"><input type="checkbox" data-k="${d.k}"><span class="slider-sw"></span>${d.label}</label>
          ${d.aide ? html`<p class="hint dt-aide">${d.aide}</p>` : ''}`;
      }
      if (d.type === 'choix') {
        return html`<div class="dt-param-choix">${d.label}
          <div class="segmented" data-k="${d.k}" role="group" aria-label="${d.label}">
            ${d.options.map(o => html`<button type="button" data-v="${o[0]}">${o[1]}</button>`)}
          </div>${d.aide ? html`<p class="hint dt-aide">${d.aide}</p>` : ''}</div>`;
      }
      return html`<div class="range" data-k="${d.k}"><span>${d.label}</span><output></output>
        <input type="range" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.label}">
        ${d.aide ? html`<p class="hint">${d.aide}</p>` : ''}</div>`;
    };
    $('params-essentiel').innerHTML = html`${SL.dt.REGLAGES.filter(d => d.groupe === 'essentiel').map(bloc)}`;
    $('params-avance').innerHTML = html`${SL.dt.REGLAGES.filter(d => !d.groupe).map(bloc)}`;
    $('params-groupe').innerHTML = html`${SL.dt.REGLAGES.filter(d => d.groupe === 'groupe').map(bloc)}`;
    const zone = $('params-essentiel').closest('aside');
    zone.addEventListener('input', e => {
      const el = e.target;
      const box = el.closest('[data-k]') || el;
      const k = el.dataset.k || box.dataset.k;
      const d = SL.dt.REGLAGES.find(x => x.k === k);
      if (!d) return;
      S.params[k] = d.type === 'bool' ? el.checked : Number(el.value);
      if (d.type !== 'bool') box.querySelector('output').textContent = fmt(d, S.params[k]);
      reglageChange();
    });
    zone.addEventListener('click', e => {
      const b = e.target.closest('.dt-param-choix button');
      if (!b) return;
      const k = b.parentElement.dataset.k;
      S.params[k] = b.dataset.v;
      afficherReglages();
      reglageChange();
    });
  }

  function afficherReglages() {
    for (const d of SL.dt.REGLAGES) {
      const v = S.params[d.k];
      if (d.type === 'bool') { document.querySelector(`input[data-k="${d.k}"]`).checked = !!v; continue; }
      if (d.type === 'choix') {
        document.querySelectorAll(`.segmented[data-k="${d.k}"] button`).forEach(b => {
          b.classList.toggle('active', b.dataset.v === v);
          b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false');
        });
        continue;
      }
      const box = document.querySelector(`.range[data-k="${d.k}"]`);
      box.querySelector('input').value = v;
      box.querySelector('output').textContent = fmt(d, v);
    }
    const p = presetDe(S.preset);
    $('preset-modified').classList.toggle('hidden', !p || JSON.stringify(normaliser(p.params)) === JSON.stringify(S.params));
  }

  function reglageChange() {
    S.gen++;
    S.full.pret = false;
    $('export-png').disabled = true;
    const p = presetDe(S.preset);
    $('preset-modified').classList.toggle('hidden', !p || JSON.stringify(normaliser(p.params)) === JSON.stringify(S.params));
    sauver();
    if (S.courant >= 0) { statutPleine('attente'); apercu(); iaGroupe(); }
  }

  // ---------------------------------------------------------------------------------
  // Prereglages et type de photos
  // ---------------------------------------------------------------------------------
  function afficherPresets() {
    const noms = Object.keys(S.presets).sort((a, b) => a.localeCompare(b, 'fr'));
    $('preset').innerHTML = html`
      <optgroup label="Par défaut">${Object.keys(BUILTIN).map(n => html`<option>${n}</option>`)}</optgroup>
      ${noms.length ? html`<optgroup label="Mes préréglages">${noms.map(n => html`<option>${n}</option>`)}</optgroup>` : ''}`;
    $('preset').value = S.preset;
    $('preset-delete').disabled = !!BUILTIN[S.preset];
    document.querySelectorAll('#type button').forEach(b => {
      b.classList.toggle('active', b.dataset.type === S.type);
      b.setAttribute('aria-pressed', b.dataset.type === S.type ? 'true' : 'false');
    });
  }

  function appliquerPreset(nom) {
    const p = presetDe(nom);
    if (!p) return;
    S.preset = nom;
    S.type = p.type === 'groupes' ? 'groupes' : 'portraits';
    S.params = normaliser(p.params);
    afficherPresets();
    afficherReglages();
    reglageChange();
  }

  function brancherPresets() {
    $('preset').addEventListener('change', e => appliquerPreset(e.target.value));
    $('type').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.dataset.type === S.type) return;
      appliquerPreset(DEFAUT_DE[b.dataset.type]);
      if (S.photos.length) choisirTemoins();
    });
    $('reset').addEventListener('click', () => appliquerPreset(S.preset));
    $('preset-form').addEventListener('submit', async e => {
      e.preventDefault();
      const nom = $('preset-name').value.trim().replace(/\s+/g, ' ');
      if (!nom) { SL.u.toast('Donnez un nom au préréglage.', 'error'); $('preset-name').focus(); return; }
      if (BUILTIN[nom]) { SL.u.toast('Ce nom est réservé aux préréglages par défaut.', 'error'); return; }
      if (S.presets[nom] && !(await SL.u.confirm(`Remplacer le préréglage « ${nom} » ?`, { ok: 'Remplacer' }))) return;
      S.presets[nom] = { type: S.type, params: Object.assign({}, S.params) };
      S.preset = nom;
      $('preset-name').value = '';
      afficherPresets();
      afficherReglages();
      sauver();
      SL.u.toast(`Préréglage « ${nom} » enregistré.`);
    });
    $('preset-delete').addEventListener('click', async () => {
      const nom = S.preset;
      if (BUILTIN[nom]) return;
      if (!(await SL.u.confirm(`Supprimer le préréglage « ${nom} » ?`, { ok: 'Supprimer', danger: true }))) return;
      delete S.presets[nom];
      appliquerPreset(DEFAUT_DE[S.type]);
      SL.u.toast('Préréglage supprimé.');
    });
    $('preset-export').addEventListener('click', () => {
      if (!Object.keys(S.presets).length) { SL.u.toast('Aucun préréglage personnel à exporter.', 'info'); return; }
      const data = { format: 'slowik-detourage-prereglages', version: 1, prereglages: S.presets };
      SL.u.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'prereglages-detourage.json');
    });
    $('preset-import').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let data = null;
      try { data = JSON.parse(await file.text()); } catch (err) { /* lu plus bas */ }
      if (!data || data.format !== 'slowik-detourage-prereglages' || typeof data.prereglages !== 'object') {
        SL.u.alert('Ce fichier n\'est pas un export de préréglages de détourage.', { title: 'Import impossible' });
        return;
      }
      let n = 0;
      for (const [nom, p] of Object.entries(data.prereglages)) {
        const propre = String(nom).trim().slice(0, 60);
        if (!propre || BUILTIN[propre] || !p || typeof p !== 'object') continue;
        S.presets[propre] = { type: p.type === 'groupes' ? 'groupes' : 'portraits', params: normaliser(p.params) };
        n++;
      }
      afficherPresets();
      sauver();
      SL.u.toast(n ? `${n} préréglage${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}.` : 'Aucun préréglage valable dans ce fichier.', n ? 'ok' : 'error');
    });
  }

  // ---------------------------------------------------------------------------------
  // Photos et temoins
  // ---------------------------------------------------------------------------------
  // sourceDir : dossier choisi (pour reprendre la seance plus tard), absent pour des fichiers isoles.
  async function definirPhotos(liste, sourceDir) {
    S.photos = liste;
    S.sourceDir = sourceDir || null;
    chargerRetouches();
    document.dispatchEvent(new CustomEvent('dt:photos'));
    const classes = new Set(liste.map(p => p.classe).filter(Boolean));
    $('photos-info').textContent = liste.length
      ? `${liste.length} photo${liste.length > 1 ? 's' : ''}${classes.size ? ` dans ${classes.size} classe${classes.size > 1 ? 's' : ''}` : ''}. Elles restent sur cet ordinateur.`
      : 'Aucune photo trouvée dans ce dossier.';
    if (!liste.length) return;
    await choisirTemoins();
  }

  async function ouvrirDossier(dir) {
    const items = await SL.images.scanSources(dir, true, []);
    await definirPhotos(items.map(it => ({ name: it.name, classe: it.classe, getFile: () => it.handle.getFile() })), dir);
  }

  // 3 photos temoins : sujet clair, sujet sombre, le plus de bords fins (cheveux).
  async function choisirTemoins() {
    const n = S.photos.length;
    const idx = n <= 12 ? [...Array(n).keys()] : Array.from({ length: 12 }, (_, i) => Math.round((i * (n - 1)) / 11));
    $('temoins').innerHTML = html`<p class="hint">Choix des photos témoins…</p>`;
    const files = await Promise.all(idx.map(i => S.photos[i].getFile()));
    const { liste } = await workers().apercu.call('echantillon', { files });
    const ok = liste.map((r, k) => Object.assign(r, { i: idx[k] })).filter(r => r.ok);
    if (!ok.length) {
      $('temoins').innerHTML = html`<p class="error-text small">Aucune de ces photos n'a pu être lue.</p>`;
      return;
    }
    let choix;
    if (ok.length <= 3) choix = ok.map((r, k) => ({ r, label: `Photo ${k + 1}` }));
    else {
      const restants = ok.slice();
      const prendre = (cmp, label) => {
        const best = restants.reduce((a, b) => (cmp(b, a) ? b : a));
        restants.splice(restants.indexOf(best), 1);
        return { r: best, label };
      };
      choix = [
        prendre((a, b) => a.lum > b.lum, 'Claire'),
        prendre((a, b) => a.lum < b.lum, 'Sombre'),
        prendre((a, b) => a.detail > b.detail, 'Cheveux'),
      ];
    }
    S.temoins = choix.map(c => ({ i: c.r.i, label: c.label, thumb: c.r.thumb }));
    afficherTemoins();
    await chargerPhoto(S.temoins[0].i);
  }

  function afficherTemoins() {
    const autres = S.photos.length > S.temoins.length;
    $('temoins').innerHTML = html`
      ${S.temoins.map((t, k) => html`<button type="button" class="dt-temoin" data-i="${t.i}" aria-pressed="false">
        <canvas width="${t.thumb.width}" height="${t.thumb.height}" data-k="${k}"></canvas>
        <span><b>${t.label}</b> · ${S.photos[t.i].name}</span></button>`)}
      ${autres ? html`<select class="dt-autre" id="autre" aria-label="Autre photo">
        <option value="">Autre photo…</option>
        ${S.photos.map((p, i) => html`<option value="${i}">${p.classe ? p.classe + ' / ' : ''}${p.name}</option>`)}
      </select>` : ''}`;
    $('temoins').querySelectorAll('canvas').forEach(c => c.getContext('2d').drawImage(S.temoins[+c.dataset.k].thumb, 0, 0));
    marquerTemoin();
  }

  function marquerTemoin() {
    $('temoins').querySelectorAll('.dt-temoin').forEach(b => b.setAttribute('aria-pressed', +b.dataset.i === S.courant ? 'true' : 'false'));
    const autre = $('autre');
    if (autre) autre.value = S.temoins.some(t => t.i === S.courant) ? '' : String(S.courant);
  }

  async function chargerPhoto(i) {
    const photo = S.photos[i];
    if (!photo) return;
    const seq = ++S.seq;
    S.courant = i;
    S.analyse = null;
    S.ia = null;
    S.iaGroupe = null;
    S.gen++;
    S.full = { w: 0, h: 0, pret: false, charge: null };
    if (S.apercu && S.apercu.bitmap) S.apercu.bitmap.close();
    S.apercu = null;
    $('export-png').disabled = true;
    marquerTemoin();
    afficherInfoRetouches();
    statutPleine('chargement');
    try {
      const file = await photo.getFile();
      const w = workers();
      S.full.charge = w.pleine.call('charger', { file }).then(r => { if (seq === S.seq) { S.full.w = r.w; S.full.h = r.h; } return r; });
      S.full.charge.catch(() => {});
      const r = await w.apercu.call('charger', { file, max: APERCU_MAX, apercu: true });
      if (seq !== S.seq) { r.bitmap.close(); return; }
      const mk = () => { const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; return c; };
      S.apercu = { bitmap: r.bitmap, w: r.w, h: r.h, res: mk(), masque: mk(), pret: false };
      S.bgFit = null;
      construireVues();
      apercu();
      iaGroupe();
    } catch (e) {
      if (seq !== S.seq) return;
      statutPleine('erreur', e.message);
      SL.u.toast(`Lecture impossible de ${photo.name} : ${e.message}`, 'error');
    }
  }

  // ---------------------------------------------------------------------------------
  // Apercu (image reduite) puis pleine definition
  // ---------------------------------------------------------------------------------
  let enCours = false, encore = false, iaCharge = false;
  async function apercu() {
    if (enCours) { encore = true; return; }
    enCours = true;
    try {
      do {
        encore = false;
        const seq = S.seq;
        const t0 = performance.now();
        if (!S.ia && S.params.ia > 0 && !groupeActif()) $('analyse').insertAdjacentHTML('beforeend', html`<span class="hint" id="ia-chargement">IA : analyse de la photo…${iaCharge ? '' : ' (28 Mo à télécharger la première fois)'}</span>`);
        const r = await workers().apercu.call('detourer', {
          params: Object.assign({}, S.params), analyse: S.analyse, renvoyer: true, type: S.type, ia: S.ia, iaGroupe: groupeActif(), retouches: traitsCourants(),
        });
        if (!S.apercu) break; // photo en cours de lecture : relance a la fin du chargement
        if (seq !== S.seq || r.w !== S.apercu.w || r.h !== S.apercu.h) { encore = true; continue; }
        if (!S.analyse) S.analyse = r.analyse;
        if (r.ia && !r.ia.erreur) { S.ia = r.ia; iaCharge = true; }
        const img = new ImageData(r.rgba, r.w, r.h);
        S.apercu.res.getContext('2d').putImageData(img, 0, 0);
        const m = new ImageData(r.w, r.h);
        for (let i = 0; i < r.rgba.length; i += 4) { const a = r.rgba[i + 3]; m.data[i] = m.data[i + 1] = m.data[i + 2] = a; m.data[i + 3] = 255; }
        S.apercu.masque.getContext('2d').putImageData(m, 0, 0);
        S.apercu.pret = true;
        dessiner();
        afficherAnalyse(r, Math.round(performance.now() - t0));
      } while (encore);
    } catch (e) {
      SL.u.toast(`Détourage impossible : ${e.message}`, 'error');
    } finally {
      enCours = false;
    }
    planifierPleine();
  }

  // IA de groupe : silhouette calculee une fois par photo (et par mode), puis l'apercu est refait.
  const groupeActif = () => (S.params.fondIA !== 'non' && S.iaGroupe && S.iaGroupe.m ? S.iaGroupe : null);
  async function iaGroupe() {
    const mode = S.params.fondIA, photo = S.photos[S.courant];
    if (!photo || mode === 'non' || SL.dt.iaGroupeClient.estInstalle() === false) return;
    const cle = `${S.courant}|${mode}|${S.params.chaises}`;
    if (S.iaGroupe && S.iaGroupe.cle === cle && !S.iaGroupe.absente) return;
    const seq = S.seq;
    S.iaGroupe = { cle, attente: true };
    redessinerAnalyse();
    let r;
    try { r = await SL.dt.iaGroupeClient.masque(await photo.getFile(), mode, { chaises: S.params.chaises }); } catch (e) { r = { erreur: e.message }; }
    if (seq !== S.seq || !S.iaGroupe || S.iaGroupe.cle !== cle) return;
    S.iaGroupe = Object.assign({ cle }, r || { absente: true });
    if (r && r.erreur) SL.u.toast(`IA de groupe : ${r.erreur}`, 'error');
    if (r && r.m) reglageChange();
    else redessinerAnalyse();
  }
  SL.dt.iaGroupeClient.abonner(() => iaGroupe());

  function redessinerAnalyse() {
    if (S.dernier && S.apercu) afficherAnalyse(S.dernier.r, S.dernier.ms);
  }

  let pleineTimer = null, pleineEnCours = false, pleineEncore = false;
  function planifierPleine() {
    clearTimeout(pleineTimer);
    if (S.courant < 0 || S.full.pret) return;
    pleineTimer = setTimeout(pleine, 400);
  }

  async function pleine() {
    if (pleineEnCours) { pleineEncore = true; return; }
    pleineEnCours = true;
    try {
      do {
        pleineEncore = false;
        const seq = S.seq, gen = S.gen;
        if (!S.full.charge || !S.analyse) break; // relancee apres l'apercu
        statutPleine('calcul');
        await S.full.charge;
        const r = await workers().pleine.call('detourer', {
          params: Object.assign({}, S.params), analyse: S.analyse, renvoyer: false, type: S.type, ia: S.ia, iaGroupe: groupeActif(), retouches: traitsCourants(),
        });
        if (seq === S.seq && gen === S.gen) {
          S.full.pret = true;
          $('export-png').disabled = false;
          statutPleine('pret', r);
        } else pleineEncore = !S.full.pret && S.courant >= 0;
      } while (pleineEncore);
    } catch (e) {
      statutPleine('erreur', e.message);
    } finally {
      pleineEnCours = false;
    }
  }

  function statutPleine(etat, info) {
    const el = $('full-status');
    const txt = {
      chargement: 'Lecture de la photo…',
      attente: 'Pleine définition : en attente…',
      calcul: 'Pleine définition : calcul…',
      pret: info && info.w ? `Pleine définition prête (${info.w} × ${info.h} px, ${(info.total / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s)` : 'Pleine définition prête',
      erreur: `Pleine définition impossible : ${info || ''}`,
    }[etat] || '';
    el.textContent = txt;
    el.dataset.etat = etat;
    el.classList.toggle('error-text', etat === 'erreur');
  }

  function etatGroupe() {
    if (S.params.fondIA === 'non') return '';
    const g = S.iaGroupe;
    if (!g || g.absente) {
      const an = S.analyse;
      return an && an.bordVert < 0.5 && SL.dt.iaGroupeClient.estInstalle() === false
        ? html`<span class="badge wait">Fond vert incomplet : installez l'IA de groupe pour retirer la salle</span>` : '';
    }
    if (g.attente) return html`<span class="hint" id="iag-photo">IA de groupe : détourage des personnes…</span>`;
    if (g.erreur) return html`<span class="badge wait" id="iag-photo">IA de groupe indisponible : ${g.erreur}</span>`;
    if (g.inutile) return html`<span class="hint" id="iag-photo">Fond vert complet : IA de groupe inutile</span>`;
    const s = (g.ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return html`<span class="hint" id="iag-photo">IA de groupe : ${g.passes} passes, ${s} s (${g.fournisseur})</span>`;
  }

  function afficherAnalyse(r, ms) {
    S.dernier = { r, ms };
    const an = S.analyse || r.analyse;
    const [cr, cg, cb] = an.cle;
    // Fond vert partiel ou absent : prevu quand l'IA de groupe detoure le reste.
    const alertes = an.alertes.filter(a => !(a.couverture && groupeActif()));
    $('analyse').innerHTML = html`
      <span class="dt-swatch" style="background: rgb(${cr}, ${cg}, ${cb})" title="Couleur du fond détectée"></span>
      <span>Fond détecté</span>
      ${alertes.length
        ? alertes.map(a => html`<span class="badge ${a.niveau === 'erreur' ? 'lock' : a.niveau === 'attention' ? 'wait' : ''}">${a.texte}</span>`)
        : html`<span class="badge ok">Fond correct</span>`}
      ${r.confiance ? html`<span class="badge ${r.confiance.aVerifier ? 'wait' : 'ok'}" id="confiance"
        title="${r.confiance.motifs.map(m => m.texte).join('\n') || 'Aucun doute détecté'}">Confiance : ${r.confiance.score}</span>` : ''}
      ${etatGroupe()}
      ${S.params.ia > 0 && !groupeActif() ? (r.iaErreur
        ? html`<span class="badge wait" title="${r.iaErreur}">IA indisponible : vêtements verts non protégés</span>`
        : S.ia ? html`<span class="hint">IA : ${S.ia.fournisseur}</span>` : '') : ''}
      <span class="hint" id="apercu-ms">Aperçu : ${ms} ms</span>`;
  }

  // ---------------------------------------------------------------------------------
  // Vues : cote a cote, original, masque, damier, sur fond, avant / apres
  // ---------------------------------------------------------------------------------
  function construireVues() {
    const box = $('views');
    box.classList.toggle('cote', S.vue === 'cote');
    document.querySelectorAll('#vue button').forEach(b => {
      b.classList.toggle('active', b.dataset.vue === S.vue);
      b.setAttribute('aria-pressed', b.dataset.vue === S.vue ? 'true' : 'false');
    });
    if (!S.apercu) return;
    const { w, h } = S.apercu;
    const fig = v => html`<figure class="dt-fig ${v === 'damier' ? 'dt-damier' : ''}">
      <canvas width="${w}" height="${h}" data-vue="${v}"></canvas><figcaption>${NOMS_VUES[v]}</figcaption></figure>`;
    if (S.vue === 'cote') box.innerHTML = html`${['original', 'masque', 'damier', 'fond'].map(fig)}`;
    else if (S.vue === 'avantapres') {
      box.innerHTML = html`<figure class="dt-fig">
        <canvas width="${w}" height="${h}" data-vue="avantapres"></canvas>
        <figcaption>Avant ◂ ▸ Après</figcaption>
        <div class="dt-split-line" id="split-line"></div>
        <input type="range" class="dt-split" id="split" min="0" max="1000" value="${Math.round(S.split * 1000)}" aria-label="Séparation avant / après">
      </figure>`;
      $('split').addEventListener('input', e => { S.split = e.target.value / 1000; dessiner(); });
    } else box.innerHTML = html`${fig(S.vue)}`;
    dessiner();
  }

  function fondAjuste(w, h) {
    if (!S.bgImg) return null;
    if (!S.bgFit || S.bgFit.width !== w || S.bgFit.height !== h) S.bgFit = SL.chroma.fit(S.bgImg, w, h, 'cover');
    return S.bgFit;
  }

  function dessinerFond(ctx, w, h) {
    const f = fondAjuste(w, h);
    if (f) ctx.drawImage(f, 0, 0);
    else { ctx.fillStyle = S.bgColor; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(S.apercu.res, 0, 0);
  }

  function dessiner() {
    const A = S.apercu;
    if (!A) return;
    $('views').querySelectorAll('canvas[data-vue]').forEach(c => {
      const ctx = c.getContext('2d');
      const v = c.dataset.vue;
      ctx.clearRect(0, 0, A.w, A.h);
      if (v === 'original' || !A.pret) ctx.drawImage(A.bitmap, 0, 0);
      else if (v === 'masque') ctx.drawImage(A.masque, 0, 0);
      else if (v === 'damier') ctx.drawImage(A.res, 0, 0);
      else if (v === 'fond') dessinerFond(ctx, A.w, A.h);
      else if (v === 'avantapres') {
        dessinerFond(ctx, A.w, A.h);
        const x = Math.round(S.split * A.w);
        if (x > 0) ctx.drawImage(A.bitmap, 0, 0, x, A.h, 0, 0, x, A.h);
        const line = $('split-line');
        if (line) {
          const rect = c.getBoundingClientRect(), fig = c.parentElement.getBoundingClientRect();
          line.style.left = `${rect.left - fig.left + S.split * rect.width - 1}px`;
        }
      }
      if (S.outil) dessinerTraits(ctx, A.w, A.h, traitsCourants());
    });
  }

  // ---------------------------------------------------------------------------------
  // Retouches au pinceau (garder, retirer, affiner le bord), par photo, classe ou seance
  // ---------------------------------------------------------------------------------
  const TEINTES = { garder: 'rgba(60, 220, 120, .45)', retirer: 'rgba(240, 70, 70, .45)', bord: 'rgba(80, 160, 255, .45)' };
  const cleRetouches = () => `slowik-detourage-retouches:${S.sourceDir ? S.sourceDir.name : 'fichiers'}`;
  const clePhoto = p => (p.classe ? `${p.classe}/${p.name}` : p.name);

  function chargerRetouches() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(cleRetouches())); } catch (e) { /* rien */ }
    S.retouches = r && r.photos ? r : { seance: [], classes: {}, photos: {} };
    S.histo = [];
    S.refaire = [];
    afficherInfoRetouches();
  }

  function sauverRetouches() {
    try { localStorage.setItem(cleRetouches(), JSON.stringify(S.retouches)); } catch (e) { /* plein ou prive */ }
    afficherInfoRetouches();
  }

  // Traits qui s'appliquent a une photo : seance + classe + photo.
  function traitsPour(photo) {
    if (!photo) return [];
    const R = S.retouches;
    return [...R.seance, ...(R.classes[photo.classe || ''] || []), ...(R.photos[clePhoto(photo)] || [])];
  }
  const traitsCourants = () => traitsPour(S.photos[S.courant]);

  function liste(portee, photo, creer) {
    const R = S.retouches;
    if (portee === 'seance') return R.seance;
    const [obj, k] = portee === 'classe' ? [R.classes, photo.classe || ''] : [R.photos, clePhoto(photo)];
    if (!obj[k] && creer) obj[k] = [];
    return obj[k] || [];
  }

  function afficherInfoRetouches() {
    const photo = S.photos[S.courant];
    const el = $('retouches-info');
    if (!el) return;
    if (!photo) { el.textContent = ''; return; }
    const n = k => liste(k, photo, false).length;
    el.textContent = `Retouches : ${n('photo')} sur cette photo, ${n('classe')} sur la classe, ${n('seance')} sur la séance.`;
    $('retouche-annuler').disabled = !S.histo.length;
    $('retouche-retablir').disabled = !S.refaire.length;
  }

  function dessinerTraits(ctx, w, h, traits) {
    const L = Math.max(w, h);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of traits) {
      ctx.strokeStyle = ctx.fillStyle = TEINTES[t.mode];
      ctx.lineWidth = Math.max(1, (2 * t.r * L) / 1000);
      ctx.beginPath();
      if (t.pts.length === 1) { ctx.arc(t.pts[0][0] * w, t.pts[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); } else {
        ctx.moveTo(t.pts[0][0] * w, t.pts[0][1] * h);
        for (const [u, v] of t.pts.slice(1)) ctx.lineTo(u * w, v * h);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function retoucheChange() {
    S.gen++;
    S.full.pret = false;
    $('export-png').disabled = true;
    sauverRetouches();
    if (S.courant >= 0) { statutPleine('attente'); apercu(); }
  }

  function annulerRetouche() {
    const a = S.histo.pop();
    if (!a) return;
    const i = a.liste.indexOf(a.trait);
    if (i >= 0) a.liste.splice(i, 1);
    S.refaire.push(a);
    retoucheChange();
  }

  function retablirRetouche() {
    const a = S.refaire.pop();
    if (!a) return;
    a.liste.push(a.trait);
    S.histo.push(a);
    retoucheChange();
  }

  function brancherRetouches() {
    let trait = null, canvas = null;
    const pos = (c, e) => {
      const r = c.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    $('views').addEventListener('pointerdown', e => {
      const c = e.target.closest('canvas[data-vue]');
      if (!S.outil || !c || !S.apercu || e.button > 0) return;
      e.preventDefault();
      canvas = c;
      c.setPointerCapture(e.pointerId);
      trait = { mode: S.outil, r: S.pinceau.r, durete: S.pinceau.durete, pts: [pos(c, e)] };
      dessinerTraits(c.getContext('2d'), c.width, c.height, [trait]);
    });
    $('views').addEventListener('pointermove', e => {
      if (!trait) return;
      const p = pos(canvas, e), last = trait.pts[trait.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return;
      trait.pts.push(p);
      dessinerTraits(canvas.getContext('2d'), canvas.width, canvas.height, [{ ...trait, pts: [last, p] }]);
    });
    const fin = () => {
      if (!trait) return;
      const photo = S.photos[S.courant];
      trait.pts = trait.pts.map(([u, v]) => [Math.round(u * 1e4) / 1e4, Math.round(v * 1e4) / 1e4]);
      const l = liste(S.portee, photo, true);
      l.push(trait);
      S.histo.push({ liste: l, trait });
      S.refaire = [];
      trait = null;
      canvas = null;
      retoucheChange();
    };
    $('views').addEventListener('pointerup', fin);
    $('views').addEventListener('pointercancel', fin);
    $('outil').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      S.outil = b.dataset.o;
      afficherOutil();
      dessiner();
    });
    $('pinceau-taille').addEventListener('input', e => { S.pinceau.r = Number(e.target.value); });
    $('pinceau-durete').addEventListener('input', e => { S.pinceau.durete = Number(e.target.value) / 100; });
    $('portee').addEventListener('change', e => { S.portee = e.target.value; });
    $('retouche-annuler').addEventListener('click', annulerRetouche);
    $('retouche-retablir').addEventListener('click', retablirRetouche);
    $('retouche-effacer').addEventListener('click', async () => {
      const photo = S.photos[S.courant];
      if (!photo) return;
      const noms = { photo: 'de cette photo', classe: 'de toute la classe', seance: 'de toute la séance' };
      const l = liste(S.portee, photo, false);
      if (!l.length) { SL.u.toast(`Aucune retouche ${noms[S.portee]}.`, 'info'); return; }
      if (!(await SL.u.confirm(`Effacer les ${l.length} retouche${l.length > 1 ? 's' : ''} ${noms[S.portee]} ?`, { ok: 'Effacer', danger: true }))) return;
      l.splice(0);
      S.histo = S.histo.filter(a => a.liste !== l);
      retoucheChange();
    });
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); annulerRetouche(); }
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); retablirRetouche(); }
    });
  }

  function afficherOutil() {
    document.querySelectorAll('#outil button').forEach(b => {
      b.classList.toggle('active', b.dataset.o === S.outil);
      b.setAttribute('aria-pressed', b.dataset.o === S.outil ? 'true' : 'false');
    });
    $('views').classList.toggle('pinceau-on', !!S.outil);
  }

  // ---------------------------------------------------------------------------------
  // Loupe (pleine definition, calculee par le worker)
  // ---------------------------------------------------------------------------------
  let loupeAttente = null, loupeOccupee = false;
  function brancherLoupe() {
    const box = $('loupe-box'), lc = $('loupe-canvas');
    const lctx = lc.getContext('2d');
    const cacher = () => { box.classList.add('hidden'); loupeAttente = null; };
    $('views').addEventListener('pointermove', e => {
      const c = e.target.closest && e.target.closest('figure');
      const canvas = c && c.querySelector('canvas[data-vue]');
      if (!S.loupe || S.outil || !canvas || !S.apercu) { cacher(); return; }
      const r = canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      if (u < 0 || v < 0 || u > 1 || v > 1) { cacher(); return; }
      box.classList.remove('hidden');
      const bx = e.clientX + 24 + 244 > innerWidth ? e.clientX - 24 - 244 : e.clientX + 24;
      const by = Math.min(innerHeight - 250, Math.max(4, e.clientY - 122));
      box.style.left = `${bx}px`;
      box.style.top = `${by}px`;
      let vue = canvas.dataset.vue;
      if (vue === 'avantapres') vue = u < S.split ? 'original' : 'fond';
      loupeAttente = { u, v, vue, canvas };
      tirer();
    });
    $('views').addEventListener('pointerleave', cacher);

    async function tirer() {
      if (loupeOccupee || !loupeAttente) return;
      const q = loupeAttente;
      loupeAttente = null;
      loupeOccupee = true;
      try {
        const taille = 240 / S.zoom;
        lctx.imageSmoothingEnabled = false;
        if (!S.full.pret || !S.full.w) {
          // pas encore de pleine definition : agrandissement de l'apercu
          const k = S.apercu.w / (S.full.w || S.apercu.w);
          const s = Math.max(4, taille * k);
          lctx.fillStyle = '#808080';
          lctx.fillRect(0, 0, 240, 240);
          lctx.drawImage(q.canvas, q.u * S.apercu.w - s / 2, q.v * S.apercu.h - s / 2, s, s, 0, 0, 240, 240);
        } else {
          const r = await workers().pleine.call('loupe', { u: q.u, v: q.v, taille, vue: q.vue, couleur: S.bgColor });
          if (r.vide) return;
          const tmp = new OffscreenCanvas(r.s, r.s);
          tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.s, r.s), 0, 0);
          if (q.vue === 'damier') {
            for (let y = 0; y < 240; y += 12) for (let x = 0; x < 240; x += 12) {
              lctx.fillStyle = ((x + y) / 12) % 2 ? '#9a9a9a' : '#cfcfcf';
              lctx.fillRect(x, y, 12, 12);
            }
          } else lctx.clearRect(0, 0, 240, 240);
          lctx.drawImage(tmp, 0, 0, 240, 240);
        }
        $('loupe-box').dataset.source = S.full.pret ? 'pleine' : 'apercu';
      } catch (e) { /* loupe : on ignore une erreur passagere */ } finally {
        loupeOccupee = false;
        if (loupeAttente) tirer();
      }
    }
  }

  // ---------------------------------------------------------------------------------
  // Branchements
  // ---------------------------------------------------------------------------------
  function brancher() {
    if (!SL.fsa.supported) { $('pick-dir').disabled = true; $('unsupported').classList.remove('hidden'); }
    $('pick-dir').addEventListener('click', async () => {
      let dir;
      try { dir = await SL.fsa.pick('slowik-detourage', false); } catch (e) { return; /* fenetre fermee */ }
      await SL.u.busy($('pick-dir'), () => ouvrirDossier(dir));
    });
    $('pick-files').addEventListener('change', async e => {
      const files = Array.from(e.target.files).filter(f => SL.images.isImage(f.name));
      e.target.value = '';
      if (!files.length) { SL.u.toast('Aucune image reconnue (JPEG, PNG, TIFF…).', 'error'); return; }
      await definirPhotos(files.map(f => ({ name: f.name, classe: '', getFile: async () => f })));
    });
    $('temoins').addEventListener('click', e => {
      const b = e.target.closest('.dt-temoin');
      if (b && +b.dataset.i !== S.courant) chargerPhoto(+b.dataset.i);
    });
    $('temoins').addEventListener('change', e => {
      if (e.target.id === 'autre' && e.target.value !== '') chargerPhoto(+e.target.value);
    });
    $('vue').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      S.vue = b.dataset.vue;
      sauver();
      construireVues();
    });
    $('loupe').addEventListener('change', e => {
      S.loupe = e.target.checked;
      $('views').classList.toggle('loupe-on', S.loupe);
    });
    $('zoom').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      S.zoom = +b.dataset.z;
      afficherZoom();
      sauver();
    });
    $('bg-color').value = S.bgColor;
    $('bg-color').addEventListener('input', e => { S.bgColor = e.target.value; sauver(); dessiner(); });
    $('bg-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const bmp = await SL.images.decode(file, 3000);
        if (S.bgImg) S.bgImg.close();
        S.bgImg = bmp;
        S.bgFit = null;
        $('bg-clear').classList.remove('hidden');
        dessiner();
        const copie = await createImageBitmap(bmp);
        workers().pleine.call('fond', { bitmap: copie }, [copie]);
      } catch (err) {
        SL.u.toast(`Image de fond illisible : ${err.message}`, 'error');
      }
    });
    $('bg-clear').addEventListener('click', () => {
      if (S.bgImg) S.bgImg.close();
      S.bgImg = null;
      S.bgFit = null;
      $('bg-clear').classList.add('hidden');
      if (W) W.pleine.call('fond', {});
      dessiner();
    });
    $('export-png').addEventListener('click', () => SL.u.busy($('export-png'), async () => {
      const photo = S.photos[S.courant];
      try {
        const { blob } = await workers().pleine.call('png');
        const nom = `${SL.naming.clean(SL.naming.stem(photo.name))}_detoure.png`;
        SL.u.download(blob, nom);
        SL.u.toast(`${nom} enregistré dans vos téléchargements.`);
      } catch (e) {
        SL.u.toast(`Enregistrement impossible : ${e.message}`, 'error');
      }
    }));
    addEventListener('resize', () => { if (S.vue === 'avantapres') dessiner(); });
  }

  function afficherZoom() {
    document.querySelectorAll('#zoom button').forEach(b => {
      b.classList.toggle('active', +b.dataset.z === S.zoom);
      b.setAttribute('aria-pressed', +b.dataset.z === S.zoom ? 'true' : 'false');
    });
  }

  construireReglages();
  brancherPresets();
  brancherLoupe();
  brancherRetouches();
  brancher();
  afficherPresets();
  afficherReglages();
  afficherZoom();
  afficherOutil();
  construireVues();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => { /* pas de hors ligne */ });

  // Partage avec l'ecran « Traitement par lot » (et les tests automatiques).
  SL.dt.ui = {
    etat: S, ouvrirDossier, definirPhotos, chargerPhoto, traitsPour, clePhoto,
    aDesRetouches: photo => !!(S.retouches.photos[clePhoto(photo)] || []).length,
    presetModifie: () => { const p = presetDe(S.preset); return !p || JSON.stringify(normaliser(p.params)) !== JSON.stringify(S.params); },
  };
})();
