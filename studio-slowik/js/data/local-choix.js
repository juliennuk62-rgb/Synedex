// Choix des fonds : tout est enregistre sur l'appareil (IndexedDB) et marche sans Internet.
// Quand vous etes connecte, SL.choixSync envoie les modifications (dirty) vers votre base.
// Une suppression laisse une trace (deleted) pour etre transmise aux autres appareils.
// Fonds numerotes (Fond 1, 2, 3...) ; classes numerotees (Classe 1, 2, 3...) a partir des PNG importes.
// Pour chaque classe : nombre d'exemplaires offerts et quantite choisie par fond (total <= exemplaires).
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
  const byNumero = (a, b) => a.numero - b.numero;
  const nextNumero = list => list.reduce((m, x) => Math.max(m, x.numero || 0), 0) + 1;
  let queue = Promise.resolve();
  const serial = fn => (queue = queue.then(fn, fn));

  // Toute modification locale : horodatee et marquee a envoyer.
  const listeners = [];
  async function touch(store, obj) {
    obj.updated = Date.now();
    obj.dirty = true;
    await put(store, obj);
    listeners.forEach(fn => { try { fn(store); } catch (e) { /* ignore */ } });
    return obj;
  }
  const alive = list => list.filter(x => !x.deleted);

  // --- images (compatible telephone) -------------------------------------------
  function loadImg(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
      img.src = url;
    });
  }

  // png = true : garde la transparence (classes detourees).
  async function shrink(file, maxSize, png) {
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
    if (!png) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    done();
    return new Promise((resolve, reject) => cv.toBlob(
      b => (b ? resolve(b) : reject(new Error('Conversion impossible.'))),
      png ? 'image/png' : 'image/jpeg', png ? undefined : 0.85));
  }

  // Numeros uniques : on garde les numeros existants, les doublons ou absents
  // (donnees d'une version precedente) prennent les numeros suivants. Corrige en base.
  async function uniqueNumbers(store, list) {
    list.sort((a, b) => (a.numero || 1e9) - (b.numero || 1e9) || ((a.created || 0) - (b.created || 0)));
    const seen = new Set();
    const toFix = [];
    list.forEach(x => {
      if (x.numero > 0 && !seen.has(x.numero)) seen.add(x.numero); else toFix.push(x);
    });
    let next = seen.size ? Math.max(...seen) + 1 : 1;
    for (const x of toFix) {
      x.numero = next++;
      await touch(store, x);
    }
    return list.sort(byNumero);
  }

  // Remet d'aplomb les donnees d'une version precedente.
  function normFond(f) {
    if (f.actif === undefined) f.actif = true;
    return f;
  }
  function normGroupe(g) {
    if (!g.nb) g.nb = g.nbAdultes || 1;
    if (Array.isArray(g.choix)) { // ancienne forme : un fond par adulte
      const q = {};
      g.choix.forEach(c => { if (c.fondId) q[c.fondId] = (q[c.fondId] || 0) + 1; });
      g.choix = q;
    }
    if (!g.choix) g.choix = {};
    return g;
  }
  const total = g => Object.values(g.choix || {}).reduce((a, b) => a + b, 0);

  // --- fonds -------------------------------------------------------------------
  const fonds = {
    async list() {
      return uniqueNumbers('fonds', alive(await all('fonds')).map(normFond));
    },
    addMany: (files, onProgress) => {
      const list = Array.from(files).sort((a, b) => collator.compare(a.name, b.name)); // copie immediate
      return serial(async () => {
      let numero = nextNumero(await fonds.list());
      for (let i = 0; i < list.length; i++) {
        if (onProgress) onProgress(i + 1, list.length);
        await touch('fonds', {
          id: newId(), numero: numero++, nom: SL.naming.stem(list[i].name),
          blob: await shrink(list[i], 1600, false), actif: true, created: Date.now(), blobChanged: true,
        });
      }
      return list.length;
      });
    },
    async update(id, values) {
      const f = await get('fonds', id);
      return touch('fonds', Object.assign(f, values));
    },
    async remove(id) {
      const used = alive(await all('groupes')).some(g => normGroupe(g).choix[id]);
      if (used) throw new Error('Ce fond a déjà été choisi : décochez « Proposé » plutôt que de le supprimer.');
      const f = await get('fonds', id);
      if (f) await touch('fonds', Object.assign(f, { deleted: true, blob: null, blobChanged: false }));
    },
  };

  // --- classes -------------------------------------------------------------------
  const groupes = {
    async list() {
      return uniqueNumbers('groupes', alive(await all('groupes')).map(normGroupe));
    },
    async get(id) {
      const g = await get('groupes', id);
      return g && !g.deleted ? normGroupe(g) : null;
    },
    // Chaque PNG devient une classe, numerotee dans l'ordre des noms de fichiers.
    addMany: (files, onProgress) => {
      const list = Array.from(files).sort((a, b) => collator.compare(a.name, b.name)); // copie immediate
      return serial(async () => {
      let numero = nextNumero(await groupes.list());
      for (let i = 0; i < list.length; i++) {
        if (onProgress) onProgress(i + 1, list.length);
        await touch('groupes', {
          id: newId(), numero: numero++, fichier: list[i].name, photo: await shrink(list[i], 1600, true),
          nb: 1, choix: {}, created: Date.now(), blobChanged: true,
        });
      }
      return list.length;
      });
    },
    async setPhoto(id, file) {
      const g = await groupes.get(id);
      g.photo = await shrink(file, 1600, true);
      g.fichier = file.name;
      g.blobChanged = true;
      return touch('groupes', g);
    },
    // Nombre d'exemplaires offerts ; si on baisse, les derniers choix sont retires.
    async setNb(id, nb) {
      const g = await groupes.get(id);
      g.nb = Math.max(1, Math.min(30, nb));
      const ids = Object.keys(g.choix);
      while (total(g) > g.nb && ids.length) {
        const last = ids[ids.length - 1];
        g.choix[last]--;
        if (g.choix[last] <= 0) { delete g.choix[last]; ids.pop(); }
      }
      return touch('groupes', g);
    },
    // Quantite d'exemplaires avec un fond donne ; le total ne depasse jamais nb.
    async setQty(id, fondId, qty) {
      const g = await groupes.get(id);
      const others = total(g) - (g.choix[fondId] || 0);
      qty = Math.max(0, qty);
      if (others + qty > g.nb) throw new Error(`Déjà ${g.nb} exemplaire(s) choisi(s) sur ${g.nb}.`);
      if (qty) g.choix[fondId] = qty; else delete g.choix[fondId];
      return touch('groupes', g);
    },
    // Remplace tous les choix d'une classe (import de la planche remplie).
    async replaceChoix(id, map) {
      const g = await groupes.get(id);
      g.choix = {};
      Object.entries(map).forEach(([fondId, q]) => { if (q > 0) g.choix[fondId] = q; });
      return touch('groupes', g);
    },
    async remove(id) {
      const g = await get('groupes', id);
      if (g) await touch('groupes', Object.assign(g, { deleted: true, photo: null, blobChanged: false }));
    },
    async clearAll() {
      for (const g of alive(await all('groupes'))) {
        await touch('groupes', Object.assign(g, { deleted: true, photo: null, blobChanged: false }));
      }
    },
    total,
  };

  // --- recapitulatif CSV ------------------------------------------------------------
  async function csv() {
    const [gs, fs] = await Promise.all([groupes.list(), fonds.list()]);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Classe', 'Fichier', 'Exemplaires offerts', 'Fond n°', 'Nom du fond', 'Quantité']];
    gs.forEach(g => {
      const chosen = fs.filter(f => g.choix[f.id]);
      if (!chosen.length) lines.push([`Classe ${g.numero}`, g.fichier, g.nb, '', '(pas encore choisi)', '']);
      chosen.forEach(f => lines.push([`Classe ${g.numero}`, g.fichier, g.nb, f.numero, f.nom, g.choix[f.id]]));
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
  const fromDataUrl = async u => (u ? (await fetch(u)).blob() : null);

  async function backup() {
    const [fs, gs] = await Promise.all([fonds.list(), groupes.list()]);
    const data = {
      app: 'studio-slowik-choix', version: 2, date: new Date().toISOString(),
      fonds: await Promise.all(fs.map(async f => Object.assign({}, f, { blob: await toDataUrl(f.blob) }))),
      groupes: await Promise.all(gs.map(async g => Object.assign({}, g, { photo: g.photo ? await toDataUrl(g.photo) : null }))),
    };
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  async function restore(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error("Ce fichier n'est pas une sauvegarde valide."); }
    if (!data || data.app !== 'studio-slowik-choix') throw new Error("Ce fichier n'est pas une sauvegarde Studio SLOWIK.");
    for (const f of data.fonds || []) await touch('fonds', Object.assign({}, f, { blob: await fromDataUrl(f.blob), blobChanged: true, deleted: false }));
    for (const g of data.groupes || []) await touch('groupes', Object.assign({}, g, { photo: await fromDataUrl(g.photo), blobChanged: true, deleted: false }));
    return { fonds: (data.fonds || []).length, groupes: (data.groupes || []).length };
  }

  // Acces direct pour la synchronisation (ne marque rien a envoyer).
  const sync = {
    all, get, put, del,
    onChange: fn => listeners.push(fn),
  };

  return { fonds, groupes, csv, backup, restore, loadImg, sync };
})();
