// Onglet Planche contact : un PDF A4 par classe (sous-dossier) ou un seul PDF.
var SL = self.SL = self.SL || {};
SL.plancheUI = (function () {
  const $ = id => document.getElementById(id);
  const OUT_DIR = 'Planches contact';
  const KEY = 'slowik.planche';
  let dir = null;
  let ready = false;
  let running = false;

  function log(text, err) {
    const box = $('pc-log');
    const d = document.createElement('div');
    d.textContent = text;
    if (err) d.className = 'err';
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function prefs() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ecole: $('pc-ecole').value.trim(), grille: $('pc-grille').value, parClasse: $('pc-par-classe').checked }));
    } catch (e) { /* ignore */ }
  }

  async function pickFolder() {
    try {
      dir = await SL.fsa.pick('slowik-export', true);
      $('pc-dossier').textContent = dir.name;
      $('pc-dossier').classList.add('set');
      await count();
    } catch (e) {
      if (e.name !== 'AbortError') log(`ERREUR dossier : ${e.message}`, true);
    }
  }

  async function scan() {
    let out = null;
    try { out = await dir.getDirectoryHandle(OUT_DIR); } catch (e) { /* pas encore cree */ }
    return SL.images.scanSources(dir, $('pc-par-classe').checked, out ? [out] : []);
  }

  async function count() {
    if (!dir) return;
    const items = await scan();
    const classes = new Set(items.map(i => i.classe)).size;
    $('pc-count').textContent = `${items.length} photo(s)` + ($('pc-par-classe').checked ? ` dans ${classes} classe(s)` : '');
  }

  async function run(groups, writeTo) {
    const opts = { ecole: $('pc-ecole').value.trim(), grille: $('pc-grille').value };
    let n = 0;
    for (const [classe, photos] of groups) {
      log(`${classe || 'Photos'} : ${photos.length} photo(s)…`);
      const blob = await SL.plancheContact.build(photos, Object.assign({}, opts, {
        classe,
        onProgress: (i, t) => { $('pc-progress').textContent = `${classe || 'Photos'} : ${i}/${t}`; },
      }));
      const name = `Planche contact - ${SL.naming.clean(classe.replace(/\//g, ' - ')) || SL.naming.clean(opts.ecole) || 'photos'}.pdf`;
      if (writeTo) {
        const finalName = await SL.fsa.uniqueName(writeTo, name);
        await SL.fsa.writeFile(writeTo, finalName, blob);
        log(`OK  ${OUT_DIR}/${finalName}`);
      } else {
        SL.u.download(blob, name);
        log(`OK  ${name} (téléchargé)`);
      }
      n++;
    }
    return n;
  }

  async function startFolder() {
    if (running) return;
    if (!dir) { SL.u.alert('Choisissez d\'abord le dossier des photos avec « Parcourir ».', { title: 'Dossier manquant' }); return; }
    running = true;
    $('pc-start').disabled = true;
    $('pc-log').innerHTML = '';
    try {
      if (!(await SL.fsa.requestPermission(dir, true))) throw new Error(`Accès refusé au dossier « ${dir.name} ».`);
      savePrefs();
      const items = await scan();
      if (!items.length) throw new Error('Aucune photo dans ce dossier.');
      const groups = new Map();
      items.forEach(it => {
        const key = $('pc-par-classe').checked ? it.classe : '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ name: it.name, file: () => it.handle.getFile() });
      });
      const out = await dir.getDirectoryHandle(OUT_DIR, { create: true });
      const n = await run(groups, out);
      $('pc-progress').textContent = `Terminé : ${n} PDF dans « ${dir.name}/${OUT_DIR} ».`;
    } catch (e) {
      log(`ERREUR : ${e.message}`, true);
      $('pc-progress').textContent = '';
    } finally {
      running = false;
      $('pc-start').disabled = false;
    }
  }

  // Sans acces aux dossiers (telephone) : photos choisies a la main, un seul PDF telecharge.
  async function startFiles(files) {
    const list = Array.from(files || []).filter(f => SL.images.isImage(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    if (!list.length || running) return;
    running = true;
    $('pc-log').innerHTML = '';
    try {
      savePrefs();
      await run(new Map([['', list.map(f => ({ name: f.name, file: async () => f }))]]), null);
      $('pc-progress').textContent = 'Terminé.';
    } catch (e) {
      log(`ERREUR : ${e.message}`, true);
    } finally {
      running = false;
    }
  }

  function init() {
    if (ready) return;
    ready = true;
    const p = prefs();
    $('pc-ecole').value = p.ecole || '';
    $('pc-grille').value = p.grille || '4x5';
    $('pc-par-classe').checked = p.parClasse !== false;
    $('pc-folder-block').classList.toggle('hidden', !SL.fsa.supported);
    $('pc-pick').addEventListener('click', pickFolder);
    $('pc-par-classe').addEventListener('change', () => { savePrefs(); count(); });
    $('pc-grille').addEventListener('change', savePrefs);
    $('pc-ecole').addEventListener('change', savePrefs);
    $('pc-start').addEventListener('click', startFolder);
    $('pc-files').addEventListener('change', e => { startFiles(e.target.files); e.target.value = ''; });
  }

  return { init, setFolder: async h => { dir = h; $('pc-dossier').textContent = h.name; $('pc-dossier').classList.add('set'); await count(); } };
})();
