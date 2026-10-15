// Espace d'une ecole connectee : sa fiche et le choix des fonds des photos de groupe.
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

  async function loadGroupes() {
    const box = $('espace-groupes');
    box.innerHTML = '<div class="muted">Chargement…</div>';
    try {
      const [groupes, fonds, choixMap] = await Promise.all([
        SL.cloud.groupes.list(), SL.cloud.fonds.list(), SL.cloud.choix.byGroupe(),
      ]);
      if (!groupes.length) { box.innerHTML = '<p class="muted">Aucune photo de groupe pour le moment.</p>'; return; }
      const [photoUrls, fondUrls] = await Promise.all([
        SL.cloud.storage.urls('photos-groupes', groupes.map(g => g.photo_chemin)),
        SL.cloud.storage.urls('fonds', fonds.map(f => f.chemin)),
      ]);
      box.innerHTML = '';
      groupes.forEach(g => box.appendChild(groupeCard(g, fonds, choixMap[g.id] || [], photoUrls, fondUrls)));
    } catch (e) {
      box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
    }
  }

  function groupeCard(g, fonds, existants, photoUrls, fondUrls) {
    // selection[rang] = { fond_id, nom_adulte }
    const selection = {};
    existants.forEach(c => { selection[c.rang] = { fond_id: c.fond_id, nom_adulte: c.nom_adulte }; });
    const locked = g.verrouille;
    const card = document.createElement('div');
    card.className = 'espace-groupe';
    const photo = photoUrls[g.photo_chemin];
    card.innerHTML = `
      <h3>${esc(g.nom)} <span class="muted">${esc(g.saison)}</span></h3>
      ${photo ? `<a href="${photo}" target="_blank" rel="noopener" class="espace-photo"><img src="${photo}" alt="Photo du groupe ${esc(g.nom)}"></a>` : ''}
      <p class="hint">${g.nb_adultes} adulte(s) : choisissez un fond pour chacun.
        Le même fond peut être choisi plusieurs fois.</p>
      ${locked ? '<div class="banner warn">Choix verrouillés par Studio SLOWIK. Contactez-nous pour une modification.</div>' : ''}
      <div class="slots"></div>
      <div class="form-actions">
        ${locked ? '' : '<button class="btn primary">Enregistrer mes choix</button>'}
        <span class="form-message"></span>
      </div>`;
    const slots = card.querySelector('.slots');
    const msg = card.querySelector('.form-message');
    const setMsg = (t, k) => { msg.textContent = t; msg.className = 'form-message' + (k ? ' ' + k : ''); };
    const count = () => Object.values(selection).filter(s => s && s.fond_id).length;
    const status = () => setMsg(`${count()}/${g.nb_adultes} fond(s) choisi(s)`);

    for (let rang = 1; rang <= g.nb_adultes; rang++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<div class="slot-head"><strong>Adulte ${rang}</strong>
        <input type="text" maxlength="60" placeholder="Nom (facultatif)"${locked ? ' disabled' : ''}></div>
        <div class="fond-strip"></div>`;
      const nom = slot.querySelector('input');
      nom.value = (selection[rang] && selection[rang].nom_adulte) || '';
      nom.addEventListener('input', () => {
        selection[rang] = Object.assign({ fond_id: null }, selection[rang], { nom_adulte: nom.value });
        setMsg('Modifications non enregistrées.');
      });
      const strip = slot.querySelector('.fond-strip');
      fonds.forEach(f => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fond-choice';
        b.disabled = locked;
        b.innerHTML = `<img alt="" loading="lazy"><span>${esc(f.nom)}</span>`;
        b.querySelector('img').src = fondUrls[f.chemin] || '';
        b.classList.toggle('selected', !!selection[rang] && selection[rang].fond_id === f.id);
        b.addEventListener('click', () => {
          const cur = selection[rang] || { nom_adulte: nom.value };
          cur.fond_id = cur.fond_id === f.id ? null : f.id;
          selection[rang] = cur;
          strip.querySelectorAll('.fond-choice').forEach(x => x.classList.remove('selected'));
          if (cur.fond_id) b.classList.add('selected');
          setMsg(`${count()}/${g.nb_adultes} choisi(s). Modifications non enregistrées.`);
        });
        strip.appendChild(b);
      });
      // fond choisi puis retire du catalogue : on le signale
      if (selection[rang] && selection[rang].fond_id && !fonds.some(f => f.id === selection[rang].fond_id)) {
        strip.insertAdjacentHTML('afterbegin', '<span class="muted">Fond choisi indisponible</span>');
      }
      slots.appendChild(slot);
    }
    status();

    const save = card.querySelector('.btn.primary');
    if (save) {
      save.addEventListener('click', async () => {
        const list = [];
        for (let rang = 1; rang <= g.nb_adultes; rang++) {
          const s = selection[rang];
          if (s && s.fond_id) list.push({ rang, fond_id: s.fond_id, nom_adulte: (s.nom_adulte || '').trim() });
        }
        save.disabled = true;
        setMsg('Enregistrement…');
        try {
          await SL.cloud.choix.save(g.id, list);
          setMsg(`Enregistré : ${list.length}/${g.nb_adultes} fond(s) choisi(s).`, 'ok');
        } catch (e) {
          setMsg(e.message, 'error');
        } finally {
          save.disabled = false;
        }
      });
    }
    return card;
  }

  async function init(profil) {
    await loadFiche(profil);
    await loadGroupes();
  }

  return { init };
})();
