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

  async function init(profil) {
    await loadFiche(profil);
  }

  return { init };
})();
