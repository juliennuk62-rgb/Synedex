// Espace d'une ecole connectee : sa fiche.
var SL = self.SL = self.SL || {};
SL.espaceUI = (function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
      box.innerHTML = lignes.map(t => `<div>${esc(t)}</div>`).join('');
    } catch (err) {
      box.textContent = err.message;
    }
  }

  async function loadFactures() {
    const box = $('espace-factures');
    try {
      const list = await SL.cloud.factures.list();
      if (!list.length) { box.innerHTML = '<p class="muted">Aucune facture pour le moment.</p>'; return; }
      const eur = SL.facturePdf.euros;
      box.innerHTML = list.map(f => `<div class="acces-row">
        <span class="acces-email"><strong>${esc(f.numero)}</strong> · ${SL.facturePdf.dateFr(f.date_facture)}<br>
          <span class="muted small">Total ${eur(f.ca)} · commission qui vous est reversée : ${eur(f.commission)} (${Number(f.taux)} %)</span></span>
        <button class="btn small" data-id="${f.id}">PDF</button></div>`).join('');
      box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () =>
        SL.facturePdf.download(list.find(f => f.id === b.dataset.id)).catch(e => alert(e.message))));
    } catch (e) {
      box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
    }
  }

  async function init(profil) {
    await loadFiche(profil);
    await loadFactures();
  }

  return { init };
})();
