// Detourage ouvert depuis une seance (V2) : les portraits de TIFF (groupes exclus, ils sont detoures a
// la main), les PNG ranges dans PNG/<classe>/ du dossier de l'ecole. Rien a choisir.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.depuisSeance = (function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;

  function bandeau(v, contenu) {
    let b = $('dt-seance');
    if (!b) {
      b = document.createElement('div');
      b.id = 'dt-seance';
      b.className = 'banner dt-seance';
      document.querySelector('main').prepend(b);
    }
    b.innerHTML = html`<span>Séance <strong>${v.ecole || ''}</strong> : ${contenu}</span>
      <a class="btn small secondary" href="../index.html#seance=${v.seance}">◀ Retour à la séance</a>`;
    return b;
  }

  async function demarrer(v) {
    const tiff = await v.dossier.getDirectoryHandle('TIFF');
    const items = v.photos.map(p => ({ name: p.name, classe: p.classe, getFile: async () => (await tiff.getFileHandle(p.name)).getFile() }));
    SL.dt.seance.dossierDetoures('PNG');
    await SL.dt.ui.definirPhotos(items, tiff);
    await SL.dt.lot.definirExport(v.dossier);
    // la seance ne veut que les PNG detoures (les fonds viennent ensuite, depuis la seance)
    for (const [id, oui] of [['exp-png', true], ['exp-masque', false], ['exp-fonds', false]]) {
      const c = $(id);
      if (c && c.checked !== oui) { c.checked = oui; c.dispatchEvent(new Event('change')); }
    }
    bandeau(v, html`${items.length} portrait(s) de TIFF dans ${new Set(items.map(i => i.classe)).size} classe(s), groupes exclus. Les PNG vont dans <strong>PNG/&lt;classe&gt;</strong>. Réglez sur les photos témoins, puis lancez le lot.`);
  }

  async function reprendre() {
    await SL.migrationV1;
    const v = await SL.envoi.reprendre('detourage-seance');
    if (!v || !v.dossier) return null;
    if (await SL.fsa.hasPermission(v.dossier, true).catch(() => false)) await demarrer(v);
    else {
      const b = bandeau(v, html`le navigateur demande l'accès au dossier « ${v.dossier.name} ». <button class="btn small" type="button" id="dt-seance-ok">Autoriser</button>`);
      b.querySelector('#dt-seance-ok').addEventListener('click', async () => {
        if (await SL.fsa.requestPermission(v.dossier, true).catch(() => false)) await demarrer(v);
      });
    }
    return v;
  }

  const pret = reprendre().catch(e => { SL.u.toast(`Séance : ${e.message}`, 'error'); return null; });
  return { pret };
})();
