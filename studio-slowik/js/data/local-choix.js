// Choix des fonds sur place : tout est enregistre sur l'appareil (IndexedDB), rien sur Internet.
var SL = self.SL = self.SL || {};
SL.localChoix = (function () {
  const DB_NAME = 'slowik-choix';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('fonds', { keyPath: 'id' });
          req.result.createObjectStore('groupes', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error("Stockage de l'appareil indisponible (navigation privée ?)."));
      });
      // Demande au navigateur de ne pas effacer ces donnees.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      let result;
      Promise.resolve(fn(tx.objectStore(store))).then(r => { result = r; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Enregistrement impossible (espace plein ?).'));
    });
  }

  const req2p = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const all = store => run(store, 'readonly', s => req2p(s.getAll()));
  const get = (store, id) => run(store, 'readonly', s => req2p(s.get(id)));
  const put = (store, obj) => run(store, 'readwrite', s => { s.put(obj); return obj; });
  const del = (store, id) => run(store, 'readwrite', s => { s.delete(id); });

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

  // --- images : version allegee en JPEG, compatible telephone ------------------
  function loadImg(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
      img.src = url;
    });
  }

  async function shrink(file, maxSize, quality) {
    let src, w, h, done;
    try {
      const { img, url } = await loadImg(file);
      src = img; w = img.naturalWidth; h = img.naturalHeight; done = () => URL.revokeObjectURL(url);
    } catch (e) {
      const bmp = await SL.images.decode(file); // TIFF...
      src = bmp; w = bmp.width; h = bmp.height; done = () => bmp.close();
    }
    const s = Math.min(1, maxSize / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * s));
    cv.height = Math.max(1, Math.round(h * s));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    done();
    return new Promise((resolve, reject) => cv.toBlob(
      b => (b ? resolve(b) : reject(new Error('Conversion impossible.'))), 'image/jpeg', quality || 0.85));
  }

  // --- fonds -------------------------------------------------------------------
  const fonds = {
    async list() {
      return (await all('fonds')).sort((a, b) => (a.ordre - b.ordre) || collator.compare(a.nom, b.nom));
    },
    async add(file) {
      const list = await all('fonds');
      const f = {
        id: newId(), nom: SL.naming.stem(file.name), blob: await shrink(file, 1600, 0.85),
        actif: true, ordre: list.length, created: Date.now(),
      };
      return put('fonds', f);
    },
    async update(id, values) {
      const f = await get('fonds', id);
      return put('fonds', Object.assign(f, values));
    },
    async remove(id) {
      const used = (await all('groupes')).some(g => (g.choix || []).some(c => c.fondId === id));
      if (used) throw new Error('Ce fond a déjà été choisi : décochez « Proposé » plutôt que de le supprimer.');
      return del('fonds', id);
    },
  };

  // --- groupes et choix -----------------------------------------------------------
  const groupes = {
    async list() {
      return (await all('groupes')).sort((a, b) => collator.compare(a.ecole, b.ecole) || collator.compare(a.nom, b.nom));
    },
    get: id => get('groupes', id),
    async save(g, photoFile) {
      const cur = g.id ? await get('groupes', g.id) : null;
      const out = Object.assign({ id: newId(), choix: [], created: Date.now() }, cur || {}, {
        ecole: (g.ecole || '').trim(),
        nom: (g.nom || '').trim(),
        nbAdultes: Math.max(1, Math.min(30, parseInt(g.nbAdultes, 10) || 1)),
        updated: Date.now(),
      });
      if (photoFile) out.photo = await shrink(photoFile, 2000, 0.85);
      // Jamais plus de choix que d'adultes.
      out.choix = (out.choix || []).filter(c => c.rang <= out.nbAdultes);
      return put('groupes', out);
    },
    async setChoix(id, rang, values) {
      const g = await get('groupes', id);
      if (!g || rang < 1 || rang > g.nbAdultes) throw new Error('Adulte invalide.');
      const list = (g.choix || []).filter(c => c.rang !== rang);
      const cur = (g.choix || []).find(c => c.rang === rang) || { rang, fondId: null, nomAdulte: '' };
      const next = Object.assign({}, cur, values);
      if (next.fondId || next.nomAdulte) list.push(next);
      g.choix = list.sort((a, b) => a.rang - b.rang);
      g.updated = Date.now();
      return put('groupes', g);
    },
    remove: id => del('groupes', id),
  };

  // --- recapitulatif CSV ------------------------------------------------------------
  async function csv() {
    const [gs, fs] = await Promise.all([groupes.list(), fonds.list()]);
    const nom = id => (fs.find(f => f.id === id) || {}).nom || '';
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['École', 'Groupe', 'Adultes', 'Adulte n°', "Nom de l'adulte", 'Fond']];
    gs.forEach(g => {
      for (let r = 1; r <= g.nbAdultes; r++) {
        const c = (g.choix || []).find(x => x.rang === r) || {};
        lines.push([g.ecole, g.nom, g.nbAdultes, r, c.nomAdulte || '', c.fondId ? nom(c.fondId) : '(pas encore choisi)']);
      }
    });
    return new Blob(['﻿' + lines.map(l => l.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }

  // --- sauvegarde / restauration (fichier) ---------------------------------------------
  const toDataUrl = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const fromDataUrl = async url => (url ? (await fetch(url)).blob() : null);

  async function backup() {
    const [fs, gs] = await Promise.all([all('fonds'), all('groupes')]);
    const data = {
      app: 'studio-slowik-choix', version: 1, date: new Date().toISOString(),
      fonds: await Promise.all(fs.map(async f => Object.assign({}, f, { blob: await toDataUrl(f.blob) }))),
      groupes: await Promise.all(gs.map(async g => Object.assign({}, g, { photo: g.photo ? await toDataUrl(g.photo) : null }))),
    };
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  async function restore(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error("Ce fichier n'est pas une sauvegarde valide."); }
    if (!data || data.app !== 'studio-slowik-choix') throw new Error("Ce fichier n'est pas une sauvegarde Studio SLOWIK.");
    for (const f of data.fonds || []) await put('fonds', Object.assign({}, f, { blob: await fromDataUrl(f.blob) }));
    for (const g of data.groupes || []) await put('groupes', Object.assign({}, g, { photo: await fromDataUrl(g.photo) }));
    return { fonds: (data.fonds || []).length, groupes: (data.groupes || []).length };
  }

  return { fonds, groupes, csv, backup, restore };
})();
