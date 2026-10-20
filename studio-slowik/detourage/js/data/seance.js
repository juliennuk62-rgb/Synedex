// Etat d'une seance de detourage par lot.
// Il est enregistre DANS le dossier d'export (Détourés/.seance-detourage.json) : la reprise fonctionne
// apres fermeture du navigateur, ou depuis un autre ordinateur qui ouvre le meme dossier.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.seance = (function () {
  const DOSSIER = 'Détourés';
  const FICHIER = '.seance-detourage.json';
  const VIGNETTES = '.vignettes';
  const ANCIENNES = '_anciennes versions';

  // Cle unique d'une photo : « classe/nom » ou « nom ».
  const cle = photo => (photo.classe ? `${photo.classe}/${photo.name}` : photo.name);

  async function ouvrir(exportDir) {
    const racine = await exportDir.getDirectoryHandle(DOSSIER, { create: true });
    let etat = { version: 1, photos: {} };
    try {
      const f = await (await racine.getFileHandle(FICHIER)).getFile();
      const lu = JSON.parse(await f.text());
      if (lu && lu.photos && typeof lu.photos === 'object') etat = lu;
    } catch (e) { /* premiere seance dans ce dossier */ }
    return { racine, etat };
  }

  async function enregistrer(racine, etat) {
    etat.maj = new Date().toISOString();
    await SL.fsa.writeFile(racine, FICHIER, new Blob([JSON.stringify(etat)], { type: 'application/json' }));
  }

  // Dossier de sortie d'une classe (cree si besoin).
  const dossierClasse = (racine, classe) => SL.fsa.subdir(racine, classe ? classe.split('/') : []);

  async function dossierVignettes(racine, classe) {
    return SL.fsa.subdir(await racine.getDirectoryHandle(VIGNETTES, { create: true }), classe ? classe.split('/') : []);
  }

  async function fichierExiste(racine, chemin) {
    try {
      const parts = chemin.split('/');
      let d = racine;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      await d.getFileHandle(parts[parts.length - 1]);
      return true;
    } catch (e) { return false; }
  }

  // Ancienne version d'un fichier deplacee (jamais effacee) avant de refaire une photo.
  async function archiver(racine, chemin) {
    const parts = chemin.split('/');
    const nom = parts.pop();
    let d = racine;
    for (const p of parts) d = await d.getDirectoryHandle(p);
    const fh = await d.getFileHandle(nom);
    const dest = await SL.fsa.subdir(await racine.getDirectoryHandle(ANCIENNES, { create: true }), parts);
    const final = await SL.fsa.uniqueName(dest, nom);
    await SL.fsa.writeFile(dest, final, await fh.getFile());
    await d.removeEntry(nom);
    return [ANCIENNES, ...parts, final].join('/');
  }

  async function lireVignette(racine, chemin) {
    try {
      const parts = chemin.split('/');
      let d = await racine.getDirectoryHandle(VIGNETTES);
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      return await (await d.getFileHandle(parts[parts.length - 1])).getFile();
    } catch (e) { return null; }
  }

  // Journal lisible dans Excel (separateur ; et accents conserves).
  function journal(etat, photos) {
    const champ = v => {
      const s = String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const STATUTS = { fait: 'Détourée', verifier: 'À vérifier', valide: 'Validée', erreur: 'Erreur' };
    const lignes = [['Classe', 'Photo', 'Fichier détouré', 'Statut', 'Score', 'Motifs', 'Durée (s)', 'Préréglage', 'Date'].join(';')];
    for (const p of photos) {
      const e = etat.photos[cle(p)];
      if (!e) continue;
      lignes.push([p.classe, p.name, e.sortie, STATUTS[e.statut] || e.statut, e.score ?? '', (e.motifs || []).join(' / '),
        e.duree ? (e.duree / 1000).toFixed(1).replace('.', ',') : '', e.prereglage || '', e.date ? e.date.slice(0, 16).replace('T', ' ') : '']
        .map(champ).join(';'));
    }
    return new Blob(['﻿' + lignes.join('\r\n') + '\r\n'], { type: 'text/csv' });
  }

  // Derniers dossiers utilises (poignees gardees dans le navigateur, pour « Reprendre »).
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('slowik-detourage', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function memoriser(valeur) {
    try {
      const d = await db();
      await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(valeur, 'derniere'); t.oncomplete = res; t.onerror = rej; });
    } catch (e) { /* navigation privee */ }
  }
  async function derniere() {
    try {
      const d = await db();
      return await new Promise((res, rej) => { const r = d.transaction('kv').objectStore('kv').get('derniere'); r.onsuccess = () => res(r.result || null); r.onerror = rej; });
    } catch (e) { return null; }
  }

  return { DOSSIER, cle, ouvrir, enregistrer, dossierClasse, dossierVignettes, fichierExiste, archiver, lireVignette, journal, memoriser, derniere };
})();
