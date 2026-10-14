// Espace d'une ecole connectee.
var SL = self.SL = self.SL || {};
SL.espaceUI = (function () {
  const $ = id => document.getElementById(id);

  async function init(profil) {
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
      box.innerHTML = '';
      lignes.forEach(t => {
        const div = document.createElement('div');
        div.textContent = t;
        box.appendChild(div);
      });
    } catch (err) {
      box.textContent = err.message;
    }
  }

  return { init };
})();
