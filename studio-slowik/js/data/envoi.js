// Passage de dossiers ou de fichiers d'un module a l'autre (detourage -> compositeur, choix des fonds).
// Les poignees de dossiers et les fichiers sont gardes dans le navigateur (IndexedDB), puis repris
// une seule fois par le module qui les recoit.
var SL = self.SL = self.SL || {};
SL.envoi = (function () {
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('slowik-envoi', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function deposer(cle, valeur) {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction('kv', 'readwrite');
      t.objectStore('kv').put(Object.assign({ date: Date.now() }, valeur), cle);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  }

  // Reprend (et efface) un envoi de moins d'une heure.
  async function reprendre(cle) {
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const t = d.transaction('kv', 'readwrite');
        const st = t.objectStore('kv');
        const r = st.get(cle);
        r.onsuccess = () => {
          const v = r.result;
          if (v) st.delete(cle);
          res(v && Date.now() - v.date < 3600e3 ? v : null);
        };
        r.onerror = () => rej(r.error);
      });
    } catch (e) { return null; }
  }

  return { deposer, reprendre };
})();
