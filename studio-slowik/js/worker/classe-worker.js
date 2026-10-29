// Photos de classe par lot : chaque groupe detoure x chaque fond → JPEG 24 x 18 cm, 300 dpi.
importScripts('../vendor/pako_inflate.min.js', '../vendor/UTIF.js', '../core/naming.js', '../core/images.js',
  '../core/fsa.js', '../core/photo-classe.js', '../../detourage/js/pipeline/meta.js');

const P = SL.photoClasse;
let annule = false;
const fonds = new Map();   // fonds decodes (gardes pour toutes les classes)

async function fond(f) {
  if (!fonds.has(f.nom)) fonds.set(f.nom, await SL.images.decode(await f.handle.getFile()));
  return fonds.get(f.nom);
}

async function traiter(t) {
  const etiquette = t.classe ? `${t.classe}/${t.nom}` : t.nom;
  let dossier, groupe, cadre;
  try {
    dossier = await SL.fsa.subdir(t.export, t.classPath || []);
    groupe = await SL.images.decode(await t.handle.getFile());
    cadre = await P.cadreDuGroupe(groupe);
    if (!cadre) throw new Error('image entièrement transparente');
    if (!cadre.transparent) postMessage({ type: 'log', text: `Attention : ${etiquette} n'a pas de fond transparent, le fond de classe ne sera pas visible.` });
  } catch (e) {
    postMessage({ type: 'log', text: `ERREUR lecture ${etiquette} : ${e.message || e}` });
    t.fonds.forEach(() => postMessage({ type: 'etape', ok: false }));
    return;
  }
  const { w: W, h: H } = P.TAILLE_EXPORT;
  for (const f of t.fonds) {
    if (annule) { postMessage({ type: 'etape', ok: false, saute: true }); continue; }
    const nom = P.nomFichier(t.nom, f.nom);
    try {
      if (t.reprendre && await SL.fsa.exists(dossier, nom)) {
        postMessage({ type: 'log', text: `Déjà présent, ignoré : ${nom}` });
        postMessage({ type: 'etape', ok: true, existait: true });
        continue;
      }
      const cv = new OffscreenCanvas(W, H);
      P.dessiner(cv.getContext('2d'), W, H, { groupe, cadre, fond: await fond(f), ecole: t.ecole, annee: t.annee, reglages: t.reglages });
      const blob = await SL.dt.meta.ecrire(await cv.convertToBlob({ type: 'image/jpeg', quality: 0.95 }), { dpi: P.DPI });
      const final = await SL.fsa.uniqueName(dossier, nom);
      await SL.fsa.writeFile(dossier, final, blob);
      postMessage({ type: 'log', text: `OK  ${etiquette}  →  ${final}` });
      postMessage({ type: 'etape', ok: true });
    } catch (e) {
      postMessage({ type: 'log', text: `ERREUR ${etiquette} + ${f.nom} : ${e.message || e}` });
      postMessage({ type: 'etape', ok: false });
    }
  }
  groupe.close();
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'annuler') annule = true;
  else if (m.type === 'taches') {
    for (const t of m.taches) await traiter(t);
    postMessage({ type: 'fini' });
  }
};
