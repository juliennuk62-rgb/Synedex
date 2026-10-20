// Onglet Module 1 : compositeur fond vert.
var SL = self.SL = self.SL || {};
SL.compositeur = (function () {
  const $ = id => document.getElementById(id);
  const PREVIEW_MAX = 1000;
  const THUMB = 160;

  const state = {
    handles: { sources: null, fonds: null, export: null },
    sources: [],
    fonds: [],            // {name, handle, key, checked, el}
    selectedFond: null,   // cle du fond de l'apercu
    previewIndex: 0,
    history: [],
    pending: [],          // dossiers en attente d'autorisation
    running: null,
    scanToken: 0,
    fondsToken: 0,
    previewToken: 0,
  };
  const previewCache = { srcKey: null, src: null, bgs: new Map() };
  let previewTimer = null;

  // ------------------------------------------------------------- reglages
  function settings() {
    const s = {
      chromaOn: $('chromaOn').checked,
      mode: document.querySelector('#mode button.active')?.dataset.mode || 'cover',
      format: $('format').value,
      recursive: $('recursive').checked,
      resume: $('resume').checked,
    };
    document.querySelectorAll('.range').forEach(r => { s[r.dataset.key] = Number(r.querySelector('input').value); });
    return s;
  }

  function applySettings(s) {
    $('chromaOn').checked = s.chromaOn;
    $('format').value = s.format;
    $('recursive').checked = s.recursive;
    $('resume').checked = s.resume !== false;
    setMode(s.mode);
    document.querySelectorAll('.range').forEach(r => {
      const input = r.querySelector('input');
      input.value = s[r.dataset.key];
      r.querySelector('output').textContent = input.value;
    });
    updateDisabled();
  }

  function save() { SL.store.saveSettings(settings()); }

  function setMode(mode) {
    document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }

  function updateDisabled() {
    const on = $('chromaOn').checked;
    ['tolerance', 'softness', 'spill'].forEach(k => {
      const r = document.querySelector(`.range[data-key="${k}"]`);
      r.classList.toggle('disabled', !on);
      r.querySelector('input').disabled = !on;
    });
    const q = document.querySelector('.range[data-key="quality"]');
    q.classList.toggle('disabled', $('format').value === 'PNG');
    q.querySelector('input').disabled = $('format').value === 'PNG';
  }

  // ------------------------------------------------------------- journal
  function log(text, isError) {
    const box = $('log');
    const line = document.createElement('div');
    const t = new Date().toLocaleTimeString('fr-FR');
    line.textContent = `[${t}] ${text}`;
    if (isError || /^ERREUR/.test(text)) line.className = 'err';
    box.appendChild(line);
    while (box.childElementCount > 3000) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------- dossiers
  async function pick(role) {
    try {
      const h = await SL.fsa.pick(`slowik-${role}`, role === 'export');
      await setFolder(role, h);
    } catch (e) {
      if (e.name !== 'AbortError') log(`ERREUR dossier : ${e.message}`);
    }
  }

  async function setFolder(role, handle, checkedFonds) {
    state.handles[role] = handle;
    const el = $(`name-${role}`);
    el.textContent = handle ? handle.name : '—';
    el.classList.toggle('set', !!handle);
    if (role === 'fonds') await loadFonds(checkedFonds);
    await rescan();
  }

  async function usable(role) {
    const h = state.handles[role];
    return !!h && await SL.fsa.hasPermission(h, role === 'export');
  }

  async function rescan() {
    const token = ++state.scanToken;
    let items = [];
    if (await usable('sources')) {
      const exclude = [];
      for (const r of ['export', 'fonds']) if (state.handles[r]) exclude.push(state.handles[r]);
      try {
        items = await SL.images.scanSources(state.handles.sources, $('recursive').checked, exclude);
      } catch (e) {
        log(`ERREUR lecture des sources : ${e.message}`);
      }
    }
    if (token !== state.scanToken) return;
    state.sources = items;
    if (state.previewIndex >= items.length) state.previewIndex = 0;
    updateCounter();
    schedulePreview();
  }

  // ------------------------------------------------------------- galerie
  async function loadFonds(checkedNames) {
    const token = ++state.fondsToken;
    const box = $('thumbs');
    box.innerHTML = '';
    state.fonds = [];
    state.selectedFond = null;
    previewCache.bgs.clear();
    let files = [];
    if (await usable('fonds')) {
      try { files = await SL.images.listImages(state.handles.fonds); } catch (e) { log(`ERREUR fonds : ${e.message}`); }
    }
    if (token !== state.fondsToken) return;
    if (!files.length) {
      box.innerHTML = `<div class="placeholder">${state.handles.fonds ? 'Aucune image dans ce dossier.' : 'Choisissez le dossier des fonds.'}</div>`;
    }
    const checked = checkedNames ? new Set(checkedNames) : null;
    files.forEach((f, i) => {
      const fond = { name: f.name, handle: f.handle, key: `${i}:${f.name}`, checked: checked ? checked.has(f.name) : true };
      const card = document.createElement('div');
      card.className = 'thumb';
      card.innerHTML = '<canvas width="1" height="1"></canvas><label><input type="checkbox"><span></span></label>';
      card.querySelector('span').textContent = SL.naming.stem(f.name);
      card.title = f.name;
      const cb = card.querySelector('input');
      cb.checked = fond.checked;
      cb.addEventListener('change', () => { fond.checked = cb.checked; updateCounter(); });
      card.querySelector('canvas').addEventListener('click', () => selectFond(fond.key));
      fond.el = card;
      box.appendChild(card);
      state.fonds.push(fond);
    });
    const first = state.fonds.find(f => f.checked) || state.fonds[0];
    selectFond(first ? first.key : null);
    updateCounter();
    for (const fond of state.fonds) {
      if (token !== state.fondsToken) return;
      try {
        const bmp = await SL.images.decode(await fond.handle.getFile(), THUMB * 2);
        const cv = fond.el.querySelector('canvas');
        const s = Math.min(THUMB / bmp.width, THUMB / bmp.height, 1);
        cv.width = Math.round(bmp.width * s);
        cv.height = Math.round(bmp.height * s);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        bmp.close();
      } catch (e) {
        fond.el.querySelector('span').textContent += ' (illisible)';
      }
    }
  }

  function selectFond(key) {
    state.selectedFond = key;
    state.fonds.forEach(f => f.el.classList.toggle('selected', f.key === key));
    schedulePreview();
  }

  function setAll(value) {
    state.fonds.forEach(f => { f.checked = value; f.el.querySelector('input').checked = value; });
    updateCounter();
  }

  function updateCounter() {
    const nSrc = state.sources.length;
    const nBg = state.fonds.filter(f => f.checked).length;
    let txt = `${nSrc} photo(s) × ${nBg} fond(s) = ${nSrc * nBg} export(s)`;
    if ($('recursive').checked && nSrc) txt += `\n${new Set(state.sources.map(s => s.classe)).size} classe(s)`;
    $('counter').textContent = txt;
    $('gallery-title').textContent = `Fonds (${nBg} coché(s) sur ${state.fonds.length})`;
  }

  // ------------------------------------------------------------- apercu
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }

  function showPreviewText(text) {
    $('preview-canvas').style.display = 'none';
    $('preview-text').textContent = text;
    $('preview-text').style.display = '';
  }

  async function renderPreview() {
    const token = ++state.previewToken;
    if (!state.sources.length) {
      $('preview-info').textContent = '';
      showPreviewText(state.handles.sources ? 'Aucune photo source.' : 'Choisissez le dossier des photos sources.');
      return;
    }
    const item = state.sources[state.previewIndex];
    const label = item.classe ? `${item.classe}/${item.name}` : item.name;
    $('preview-info').textContent = `${state.previewIndex + 1}/${state.sources.length} : ${label}`;
    try {
      const srcKey = `${item.classe}/${item.name}`;
      if (previewCache.srcKey !== srcKey) {
        const bmp = await SL.images.decode(await item.handle.getFile(), PREVIEW_MAX);
        if (previewCache.src) previewCache.src.close();
        previewCache.src = bmp;
        previewCache.srcKey = srcKey;
      }
      let bg = null;
      const fond = state.fonds.find(f => f.key === state.selectedFond);
      if (fond) {
        if (!previewCache.bgs.has(fond.key)) {
          previewCache.bgs.set(fond.key, await SL.images.decode(await fond.handle.getFile(), PREVIEW_MAX * 2));
        }
        bg = previewCache.bgs.get(fond.key);
      }
      if (token !== state.previewToken) return;
      const s = settings();
      const subject = SL.chroma.extract(previewCache.src, s);
      const out = SL.chroma.compose(subject, bg, s.mode);
      const cv = $('preview-canvas');
      cv.width = out.width;
      cv.height = out.height;
      cv.getContext('2d').drawImage(out, 0, 0);
      cv.style.display = 'block';
      $('preview-text').style.display = 'none';
    } catch (e) {
      if (token === state.previewToken) showPreviewText(`Impossible d'afficher cette photo : ${e.message || e}`);
    }
  }

  function step(delta) {
    if (!state.sources.length) return;
    state.previewIndex = (state.previewIndex + delta + state.sources.length) % state.sources.length;
    schedulePreview();
  }

  // ------------------------------------------------------------- historique
  async function refreshHistory() {
    state.history = await SL.store.loadProjects();
    const sel = $('history');
    sel.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = state.history.length ? 'Projets récents…' : '(aucun projet récent)';
    sel.appendChild(first);
    state.history.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${p.name || p.sources.name || 'sans nom'}  (${p.date})`;
      sel.appendChild(o);
    });
  }

  async function loadProject(index) {
    const p = state.history[index];
    $('history').value = '';
    if (!p) return;
    $('project').value = p.name || '';
    $('recursive').checked = p.recursive !== false;
    state.pendingChecked = p.checkedFonds;
    state.handles = { sources: p.sources, fonds: p.fonds, export: p.export };
    for (const role of ['sources', 'fonds', 'export']) {
      const el = $(`name-${role}`);
      el.textContent = state.handles[role].name;
      el.classList.add('set');
    }
    await grantPending(true);
    log(`Projet rechargé : ${p.name || '(sans nom)'}`);
  }

  // Demande les autorisations manquantes (le navigateur exige un clic).
  async function grantPending(fromClick) {
    let missing = 0;
    for (const role of ['sources', 'fonds', 'export']) {
      const h = state.handles[role];
      if (!h) continue;
      let ok = await SL.fsa.hasPermission(h, role === 'export');
      if (!ok && fromClick) {
        try { ok = await SL.fsa.requestPermission(h, role === 'export'); } catch (e) { ok = false; }
      }
      if (!ok) missing++;
    }
    $('permission-banner').classList.toggle('hidden', missing === 0);
    await loadFonds(state.pendingChecked);
    await rescan();
  }

  // ------------------------------------------------------------- export
  async function start() {
    if (state.running || state.starting) return;
    state.starting = true;
    $('start').disabled = true;
    try {
      await prepareAndRun();
    } finally {
      state.starting = false;
      if (!state.running) $('start').disabled = false;
    }
  }

  async function prepareAndRun() {
    const errors = [];
    const h = state.handles;
    if (!h.sources) errors.push('Choisissez le dossier des photos sources.');
    if (!h.fonds) errors.push('Choisissez le dossier des fonds.');
    if (!h.export) errors.push("Choisissez le dossier d'export.");
    if (errors.length) { SL.u.alert(errors.join('\n'), { title: 'Export impossible' }); return; }
    try {
      for (const role of ['sources', 'fonds', 'export']) {
        if (!(await SL.fsa.requestPermission(h[role], role === 'export'))) {
          SL.u.alert(`Accès refusé au dossier « ${h[role].name} ».`, { title: 'Export impossible' });
          return;
        }
      }
    } catch (e) {
      SL.u.alert(`Accès aux dossiers impossible : ${e.message}`, { title: 'Export impossible' });
      return;
    }
    await rescan();
    const fonds = state.fonds.filter(f => f.checked);
    if (!state.sources.length) { SL.u.alert('Aucune photo trouvée dans le dossier des sources.', { title: 'Export impossible' }); return; }
    if (!fonds.length) { SL.u.alert('Cochez au moins un fond dans la galerie.', { title: 'Export impossible' }); return; }

    const s = settings();
    s.project = $('project').value.trim();
    save();
    await SL.store.addProject({
      name: s.project, sources: h.sources, fonds: h.fonds, export: h.export,
      recursive: s.recursive, checkedFonds: fonds.map(f => f.name),
    });
    await refreshHistory();

    // Une tache = une photo source (n repart a 1 dans chaque classe).
    const counters = new Map();
    const tasks = state.sources.map(item => {
      const n = (counters.get(item.classe) || 0) + 1;
      counters.set(item.classe, n);
      return {
        name: item.name, handle: item.handle, classe: item.classe, classPath: item.classPath, n,
        outRoot: h.export, settings: s,
        fonds: fonds.map(f => ({ name: f.name, handle: f.handle, key: f.key })),
      };
    });
    runBatch(tasks, fonds.length);
  }

  function runBatch(tasks, perTask) {
    const total = tasks.length * perTask;
    const run = { total, done: 0, ok: 0, existed: 0, errors: 0, cancelled: false, start: Date.now(), workers: [], queue: tasks.slice() };
    state.running = run;
    $('log').innerHTML = '';
    log(`Début de l'export : ${tasks[0].settings.project || '(sans nom de projet)'}`);
    log(`${tasks.length} photo(s) × ${perTask} fond(s) = ${total} export(s)`);
    $('start').disabled = true;
    $('cancel').disabled = false;
    updateProgress();

    // Calculs en parallele selon l'ordinateur : 1 par coeur libre, 2 Go de memoire chacun, 4 au plus.
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 2;
    const count = Math.max(1, Math.min(4, cores - 1, Math.floor(mem / 2)));
    const cacheMB = Math.max(150, Math.min(800, Math.round(mem * 1024 * 0.25 / count)));
    tasks.forEach(t => { t.settings = Object.assign({}, t.settings, { cacheMB }); });
    log(`${count} calcul(s) en parallèle.`);
    let active = 0;
    const feed = (w) => {
      const task = run.cancelled ? null : run.queue.shift();
      if (task) {
        active++;
        w.postMessage({ type: 'task', task });
      }
    };
    for (let i = 0; i < Math.min(count, tasks.length); i++) {
      const w = new Worker('js/worker/batch-worker.js');
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'log') log(m.text);
        else if (m.type === 'step') {
          if (!m.skipped) {
            run.done++;
            if (m.existed) run.existed++;
            else if (m.ok) run.ok++;
            else run.errors++;
          }
          updateProgress();
        } else if (m.type === 'taskDone') {
          active--;
          feed(w);
          if (active === 0) finish();
        }
      };
      w.onerror = (e) => { log(`ERREUR interne : ${e.message}`); e.preventDefault(); };
      run.workers.push(w);
      feed(w);
    }
  }

  function updateProgress() {
    const r = state.running;
    if (!r) return;
    $('progress').value = r.total ? r.done / r.total : 0;
    $('progress-label').textContent = `${r.done} / ${r.total}`;
  }

  function cancel() {
    const r = state.running;
    if (!r) return;
    r.cancelled = true;
    r.workers.forEach(w => w.postMessage({ type: 'cancel' }));
    $('cancel').disabled = true;
    log('Annulation demandée…');
  }

  function finish() {
    const r = state.running;
    if (!r) return;
    r.workers.forEach(w => w.terminate());
    state.running = null;
    $('start').disabled = false;
    $('cancel').disabled = true;
    const sec = Math.round((Date.now() - r.start) / 1000);
    let msg = `${r.ok} fichier(s) exporté(s)${r.existed ? `, ${r.existed} déjà présent(s) ignoré(s)` : ''}, ${r.errors} erreur(s), en ${Math.floor(sec / 60)} min ${sec % 60} s.`;
    if (r.existed && !r.ok) msg += ' Pour refaire ces photos (réglages modifiés), décochez « Reprendre ».';
    if (r.cancelled) msg = 'Export annulé. ' + msg;
    log(msg, r.errors > 0);
    $('progress-label').textContent = msg + (r.ok ? ` Fichiers dans « ${state.handles.export.name} ».` : '');
  }

  // ------------------------------------------------------------- demarrage
  async function init() {
    if (!SL.fsa.supported) {
      $('unsupported').classList.remove('hidden');
      document.querySelectorAll('#page-compositeur button, #page-compositeur input, #page-compositeur select')
        .forEach(el => { el.disabled = true; });
      return;
    }
    applySettings(SL.store.loadSettings());

    document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pick(b.dataset.pick)));
    $('recursive').addEventListener('change', () => { save(); rescan(); });
    $('resume').addEventListener('change', save);
    $('chromaOn').addEventListener('change', () => { updateDisabled(); save(); schedulePreview(); });
    $('format').addEventListener('change', () => { updateDisabled(); save(); });
    document.querySelectorAll('.range').forEach(r => {
      const input = r.querySelector('input');
      input.addEventListener('input', () => {
        r.querySelector('output').textContent = input.value;
        if (r.dataset.key !== 'quality') schedulePreview();
      });
      input.addEventListener('change', save);
    });
    document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => {
      setMode(b.dataset.mode); save(); schedulePreview();
    }));
    $('reset').addEventListener('click', () => {
      const d = SL.store.DEFAULTS;
      applySettings(Object.assign(settings(), { tolerance: d.tolerance, softness: d.softness, spill: d.spill }));
      save();
      schedulePreview();
    });
    $('prev').addEventListener('click', () => step(-1));
    $('next').addEventListener('click', () => step(1));
    $('check-all').addEventListener('click', () => setAll(true));
    $('uncheck-all').addEventListener('click', () => setAll(false));
    $('history').addEventListener('change', e => { if (e.target.value !== '') loadProject(Number(e.target.value)); });
    $('permission-btn').addEventListener('click', () => grantPending(true));
    $('start').addEventListener('click', start);
    $('cancel').addEventListener('click', cancel);
    window.addEventListener('beforeunload', e => {
      if (state.running) { e.preventDefault(); e.returnValue = ''; }
    });
    await refreshHistory();
    await recevoir();
  }

  // Dossier « Détourés » envoye par le module de detourage : photos deja detourees, une classe
  // par sous-dossier.
  async function recevoir() {
    const e = await SL.envoi.reprendre('compositeur');
    if (!e || !e.dossier) return;
    $('recursive').checked = true;
    $('chromaOn').checked = false;
    updateDisabled();
    save();
    await setFolder('sources', e.dossier);
    if (!(await SL.fsa.hasPermission(e.dossier, false))) $('permission-banner').classList.remove('hidden');
    SL.u.toast(`Photos détourées reçues (dossier « ${e.dossier.name} »). Choisissez les fonds et le dossier d'export.`, 'info', 8000);
  }

  return { init, setFolder, state };
})();
