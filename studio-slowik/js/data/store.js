// Sauvegardes locales : reglages (localStorage) et projets recents (IndexedDB).
var SL = self.SL = self.SL || {};
SL.store = (function () {
  const SETTINGS_KEY = 'slowik.compositeur';
  const MAX_PROJECTS = 10;
  const DEFAULTS = {
    chromaOn: true, tolerance: 50, softness: 30, spill: 50,
    mode: 'cover', format: 'JPEG', quality: 92, recursive: true,
  };

  function loadSettings() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* stockage plein ou bloque */ }
  }

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('slowik', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadProjects() {
    try { return (await idbGet('projets')) || []; } catch (e) { return []; }
  }

  // Un projet = nom + 3 dossiers (+ fonds coches). Le plus recent en tete, 10 maximum.
  async function addProject(p) {
    const list = await loadProjects();
    const kept = [];
    for (const old of list) {
      const same = old.name === p.name
        && await old.sources.isSameEntry(p.sources)
        && await old.fonds.isSameEntry(p.fonds)
        && await old.export.isSameEntry(p.export);
      if (!same) kept.push(old);
    }
    kept.unshift(Object.assign({ date: new Date().toLocaleString('fr-FR') }, p));
    const out = kept.slice(0, MAX_PROJECTS);
    try { await idbSet('projets', out); } catch (e) { /* ignore */ }
    return out;
  }

  return { DEFAULTS, loadSettings, saveSettings, loadProjects, addProject };
})();
