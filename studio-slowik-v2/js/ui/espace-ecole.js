// Espace d'une ecole connectee : sa fiche.
var SL = self.SL = self.SL || {};
SL.espaceUI = (function () {
  const $ = id => document.getElementById(id);
  const { html, euros, dateFr } = SL.u;

  async function loadFiche(profil) {
    const box = $('espace-fiche');
    try {
      const e = await SL.cloud.ecoles.get(profil.ecole_id);
      if (!e) throw new Error('Fiche introuvable.');
      $('espace-nom').textContent = e.nom;
      const lignes = [
        e.adresse, [e.code_postal, e.ville].filter(Boolean).join(' '),
        e.contact_nom && `Contact : ${e.contact_nom}`,
        e.contact_email, e.telephone,
        `Commission reversée à l'établissement : ${Number(e.taux_commission)} % du chiffre d'affaires`,
      ].filter(Boolean);
      box.innerHTML = html`${lignes.map(t => html`<div>${t}</div>`)}`;
    } catch (err) {
      box.textContent = err.message;
    }
  }

  async function loadFactures() {
    const box = $('espace-factures');
    try {
      const list = await SL.cloud.factures.list();
      if (!list.length) { box.innerHTML = '<p class="muted">Aucune facture pour le moment.</p>'; return; }
      const eur = euros;
      box.innerHTML = html`${list.map(f => html`<div class="acces-row">
        <span class="acces-email"><strong>${f.numero}</strong> · ${dateFr(f.date_facture)}<br>
          <span class="muted small">Total ${eur(f.ca)} · commission qui vous est reversée : ${eur(f.commission)} (${Number(f.taux)} %)</span></span>
        <button class="btn small" data-id="${f.id}">Télécharger le PDF</button></div>`)}`;
      box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () =>
        SL.u.busy(b, () => SL.facturePdf.download(list.find(f => f.id === b.dataset.id)).catch(e => SL.u.alert(e.message)))));
    } catch (e) {
      box.innerHTML = html`<div class="error-text">${e.message}</div>`;
    }
  }

  async function init(profil) {
    await loadFiche(profil);
    await loadFactures();
  }

  return { init };
})();
