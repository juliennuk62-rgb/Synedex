// V2 : a la premiere ouverture, les reglages et les donnees de la V1 (meme navigateur) sont COPIES
// dans les noms de la V2 (slowik2...). La V1 n'est jamais modifiee : les deux versions vivent cote
// a cote, chacune avec sa memoire. Les autres scripts attendent SL.migrationV1 avant de lire la leur.
var SL = self.SL = self.SL || {};
SL.migrationV1 = (function () {
  const FAIT = 'slowik2.migration-v1';
  // bases IndexedDB : projets, listes, dossiers (slowik) ; choix des fonds ; seances de detourage
  const BASES = [['slowik', 'slowik2'], ['slowik-choix', 'slowik2-choix'], ['slowik-detourage', 'slowik2-detourage']];

  function dejaFaite() {
    try { return !!localStorage.getItem(FAIT); } catch (e) { return true; }   // stockage bloque : rien a copier
  }

  // reglages (localStorage) : copie immediate, avant que les autres scripts les lisent
  function copierReglages() {
    const cles = [];
    for (let i = 0; i < localStorage.length; i++) cles.push(localStorage.key(i));
    for (const k of cles) {
      const m = /^slowik([.-])(.*)$/.exec(k);
      if (!m) continue;
      const k2 = `slowik2${m[1]}${m[2]}`;
      if (localStorage.getItem(k2) === null) localStorage.setItem(k2, localStorage.getItem(k));
    }
  }

  const demande = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  // Copie d'une base entiere (memes magasins, cles et index) si l'ancienne existe et pas la nouvelle.
  async function copierBase(ancien, nouveau) {
    if (indexedDB.databases) {
      const liste = await indexedDB.databases();
      if (!liste.some(d => d.name === ancien) || liste.some(d => d.name === nouveau)) return;
    }
    const src = await new Promise(resolve => {
      const r = indexedDB.open(ancien);
      r.onupgradeneeded = () => r.transaction.abort();   // n'existait pas : ne pas la creer
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
    if (!src) return;
    const magasins = [...src.objectStoreNames];
    if (!magasins.length) { src.close(); return; }
    const tx = src.transaction(magasins, 'readonly');
    const schema = magasins.map(n => {
      const s = tx.objectStore(n);
      return {
        n, keyPath: s.keyPath, auto: s.autoIncrement,
        index: [...s.indexNames].map(i => { const x = s.index(i); return { i, keyPath: x.keyPath, unique: x.unique, multiEntry: x.multiEntry }; }),
        valeurs: demande(s.getAll()), cles: demande(s.getAllKeys()),
      };
    });
    for (const sc of schema) { sc.valeurs = await sc.valeurs; sc.cles = await sc.cles; }
    const version = src.version;
    src.close();
    const dst = await new Promise((resolve, reject) => {
      const r = indexedDB.open(nouveau, version);
      r.onupgradeneeded = () => schema.forEach(sc => {
        const s = r.result.createObjectStore(sc.n, sc.keyPath === null ? { autoIncrement: sc.auto } : { keyPath: sc.keyPath, autoIncrement: sc.auto });
        sc.index.forEach(x => s.createIndex(x.i, x.keyPath, { unique: x.unique, multiEntry: x.multiEntry }));
      });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const t = dst.transaction(magasins, 'readwrite');
      schema.forEach(sc => {
        const s = t.objectStore(sc.n);
        sc.valeurs.forEach((v, i) => (sc.keyPath === null ? s.put(v, sc.cles[i]) : s.put(v)));
      });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    dst.close();
  }

  if (dejaFaite()) return Promise.resolve(false);
  try { copierReglages(); } catch (e) { /* stockage plein ou bloque */ }
  return (async () => {
    if (self.indexedDB) {
      for (const [a, b] of BASES) {
        try { await copierBase(a, b); } catch (e) { /* base illisible : la V2 repart de zero pour celle-ci */ }
      }
    }
    try { localStorage.setItem(FAIT, new Date().toISOString()); } catch (e) { /* ignore */ }
    return true;
  })();
})();
