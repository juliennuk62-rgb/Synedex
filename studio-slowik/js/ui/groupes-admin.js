// Onglet Photos de groupe (admin) : fonds proposes, groupes, choix des ecoles.
var SL = self.SL = self.SL || {};
SL.groupesUI = (function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let fonds = [];
  let ecoles = [];
  let ready = false;

  function say(id, text, kind) {
    const el = $(id);
    el.textContent = text || '';
    el.className = 'form-message' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------- fonds
  async function loadFonds() {
    const box = $('fonds-grid');
    try {
      fonds = await SL.cloud.fonds.list();
      const urls = await SL.cloud.storage.urls('fonds', fonds.map(f => f.chemin));
      if (!fonds.length) {
        box.innerHTML = '<div class="placeholder">Aucun fond. Ajoutez les fonds que les écoles pourront choisir.</div>';
        return;
      }
      box.innerHTML = '';
      fonds.forEach(f => {
        const card = document.createElement('div');
        card.className = 'fond-card' + (f.actif ? '' : ' off');
        card.innerHTML = `<img alt="" loading="lazy">
          <input type="text" class="fond-nom">
          <div class="fond-actions">
            <label class="check small"><input type="checkbox"> Proposé</label>
            <button class="btn small secondary" title="Supprimer">✕</button>
          </div>`;
        card.querySelector('img').src = urls[f.chemin] || '';
        const nom = card.querySelector('.fond-nom');
        nom.value = f.nom;
        nom.addEventListener('change', async () => {
          try { await SL.cloud.fonds.update(f.id, { nom: nom.value.trim() || f.nom }); f.nom = nom.value.trim() || f.nom; } catch (e) { alert(e.message); }
        });
        const cb = card.querySelector('input[type=checkbox]');
        cb.checked = f.actif;
        cb.addEventListener('change', async () => {
          try {
            await SL.cloud.fonds.update(f.id, { actif: cb.checked });
            f.actif = cb.checked;
            card.classList.toggle('off', !f.actif);
          } catch (e) { cb.checked = f.actif; alert(e.message); }
        });
        card.querySelector('button').addEventListener('click', async () => {
          if (!confirm(`Supprimer le fond « ${f.nom} » ?`)) return;
          try { await SL.cloud.fonds.remove(f); await loadFonds(); } catch (e) { alert(e.message); }
        });
        box.appendChild(card);
      });
    } catch (e) {
      box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
    }
  }

  async function addFonds(files) {
    const list = Array.from(files || []);
    for (let i = 0; i < list.length; i++) {
      say('fonds-message', `Envoi ${i + 1}/${list.length} : ${list[i].name}…`);
      try { await SL.cloud.fonds.add(list[i]); } catch (e) { say('fonds-message', `${list[i].name} : ${e.message}`, 'error'); return; }
    }
    say('fonds-message', list.length ? `${list.length} fond(s) ajouté(s).` : '', 'ok');
    await loadFonds();
    await loadGroupes();
  }

  // ------------------------------------------------------------- groupes
  async function loadEcoles() {
    const sel = $('groupes-ecole');
    const keep = sel.value;
    ecoles = (await SL.cloud.ecoles.list()).filter(e => !e.archivee);
    sel.innerHTML = '<option value="">Choisir une école…</option>' +
      ecoles.map(e => `<option value="${e.id}">${esc(e.nom)}</option>`).join('');
    if (ecoles.some(e => e.id === keep)) sel.value = keep;
    else if (ecoles.length === 1) sel.value = ecoles[0].id;
  }

  async function loadGroupes() {
    const ecoleId = $('groupes-ecole').value;
    $('groupe-new').classList.toggle('hidden', !ecoleId);
    const box = $('groupes-list');
    if (!ecoleId) { box.innerHTML = '<div class="placeholder">Choisissez une école.</div>'; return; }
    try {
      const [list, choixMap] = await Promise.all([SL.cloud.groupes.list(ecoleId), SL.cloud.choix.byGroupe()]);
      if (ecoleId !== $('groupes-ecole').value) return;
      const urls = await SL.cloud.storage.urls('photos-groupes', list.map(g => g.photo_chemin));
      const fondNom = id => (fonds.find(f => f.id === id) || {}).nom || '?';
      if (!list.length) { box.innerHTML = '<div class="placeholder">Aucun groupe pour cette école.</div>'; return; }
      box.innerHTML = '';
      list.forEach(g => {
        const ch = choixMap[g.id] || [];
        const card = document.createElement('div');
        card.className = 'groupe-card';
        card.innerHTML = `
          <a class="groupe-photo" target="_blank" rel="noopener">${g.photo_chemin ? '<img alt="">' : '<span class="muted">pas de photo</span>'}</a>
          <div class="groupe-info">
            <div class="li-title">${esc(g.nom)} <span class="muted">${esc(g.saison)}</span></div>
            <div class="groupe-status">
              <span class="badge ${ch.length >= g.nb_adultes ? 'ok' : 'wait'}">${ch.length}/${g.nb_adultes} fond(s) choisi(s)</span>
              ${g.verrouille ? '<span class="badge lock">verrouillé</span>' : ''}
            </div>
            <ul class="choix-list">${ch.map(c => `<li>Adulte ${c.rang}${c.nom_adulte ? ' (' + esc(c.nom_adulte) + ')' : ''} : <strong>${esc(fondNom(c.fond_id))}</strong></li>`).join('')}</ul>
            <div class="form-actions">
              <button class="btn small secondary" data-act="edit">Modifier</button>
              <button class="btn small secondary" data-act="lock">${g.verrouille ? 'Déverrouiller' : 'Verrouiller'}</button>
              <button class="btn small danger" data-act="del">Supprimer</button>
            </div>
            <form class="groupe-edit hidden"></form>
          </div>`;
        if (g.photo_chemin && urls[g.photo_chemin]) {
          card.querySelector('.groupe-photo').href = urls[g.photo_chemin];
          card.querySelector('img').src = urls[g.photo_chemin];
        }
        card.querySelector('[data-act=edit]').addEventListener('click', () => toggleEdit(card, g));
        card.querySelector('[data-act=lock]').addEventListener('click', async () => {
          try { await SL.cloud.groupes.setLocked(g.id, !g.verrouille); await loadGroupes(); } catch (e) { alert(e.message); }
        });
        card.querySelector('[data-act=del]').addEventListener('click', async () => {
          if (!confirm(`Supprimer le groupe « ${g.nom} », sa photo et les choix de l'école ?`)) return;
          try { await SL.cloud.groupes.remove(g); await loadGroupes(); } catch (e) { alert(e.message); }
        });
        box.appendChild(card);
      });
    } catch (e) {
      box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
    }
  }

  function groupeFields(g) {
    return `
      <label class="field">Nom du groupe<input name="nom" type="text" required value="${esc(g.nom || '')}" placeholder="ex : CM2 Mme Durand, U11…"></label>
      <label class="field">Nombre d'adultes<input name="nb_adultes" type="number" min="1" max="30" required value="${g.nb_adultes || 1}"></label>
      <label class="field">Saison<input name="saison" type="text" value="${esc(g.saison || SL.cloud.saisonCourante())}"></label>
      <label class="field">Photo du groupe${g.id ? ' (laisser vide pour garder la photo actuelle)' : ''}<input name="photo" type="file" accept="image/*"${g.id ? '' : ' required'}></label>`;
  }

  function readForm(form, base) {
    return Object.assign({}, base, {
      nom: form.elements.nom.value.trim(),
      nb_adultes: Math.max(1, Math.min(30, parseInt(form.elements.nb_adultes.value, 10) || 1)),
      saison: form.elements.saison.value.trim(),
    });
  }

  function toggleEdit(card, g) {
    const form = card.querySelector('.groupe-edit');
    if (!form.classList.contains('hidden')) { form.classList.add('hidden'); return; }
    form.innerHTML = groupeFields(g) + `<div class="form-actions">
      <button class="btn small" type="submit">Enregistrer</button><span class="form-message"></span></div>`;
    form.classList.remove('hidden');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const data = readForm(form, g);
      if (data.nb_adultes < g.nb_adultes && !confirm(`Passer à ${data.nb_adultes} adulte(s) retire les choix en trop. Continuer ?`)) return;
      const msg = form.querySelector('.form-message');
      msg.textContent = 'Enregistrement…';
      try {
        await SL.cloud.groupes.save(data, form.elements.photo.files[0]);
        await loadGroupes();
      } catch (e) { msg.textContent = e.message; msg.className = 'form-message error'; }
    };
  }

  async function addGroupe(ev) {
    ev.preventDefault();
    const form = $('groupe-new');
    const data = readForm(form, { ecole_id: $('groupes-ecole').value });
    const file = form.elements.photo.files[0];
    if (!file) { say('groupe-message', 'Choisissez la photo du groupe.', 'error'); return; }
    form.querySelector('button[type=submit]').disabled = true;
    say('groupe-message', 'Envoi de la photo…');
    try {
      await SL.cloud.groupes.save(data, file);
      form.reset();
      form.elements.saison.value = SL.cloud.saisonCourante();
      say('groupe-message', 'Groupe ajouté.', 'ok');
      await loadGroupes();
    } catch (e) {
      say('groupe-message', e.message, 'error');
    } finally {
      form.querySelector('button[type=submit]').disabled = false;
    }
  }

  // ------------------------------------------------------------- recapitulatif
  async function exportCsv() {
    try {
      const rows = await SL.cloud.choix.recap();
      if (!rows.length) { alert('Aucun choix enregistré pour le moment.'); return; }
      const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['École', 'Saison', 'Groupe', 'Adulte n°', 'Nom de l\'adulte', 'Fond', 'Verrouillé']]
        .concat(rows.map(r => [r.ecole, r.saison, r.groupe, r.rang, r.nom_adulte, r.fond, r.verrouille ? 'oui' : 'non']))
        .map(l => l.map(cell).join(';'));
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `choix-fonds-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { alert(e.message); }
  }

  // ------------------------------------------------------------- demarrage
  async function init() {
    if (!SL.cloud.configured) {
      $('groupes-layout').classList.add('hidden');
      $('groupes-unconfigured').classList.remove('hidden');
      return;
    }
    if (!ready) {
      ready = true;
      $('groupe-new').innerHTML = groupeFields({}) +
        '<div class="form-actions"><button class="btn" type="submit">Ajouter le groupe</button><span id="groupe-message" class="form-message"></span></div>';
      $('fonds-file').addEventListener('change', e => { addFonds(e.target.files); e.target.value = ''; });
      $('groupes-ecole').addEventListener('change', loadGroupes);
      $('groupe-new').addEventListener('submit', addGroupe);
      $('groupes-csv').addEventListener('click', exportCsv);
    }
    try { await loadEcoles(); } catch (e) { $('groupes-list').innerHTML = `<div class="error-text">${esc(e.message)}</div>`; }
    await loadFonds();
    await loadGroupes();
  }

  return { init };
})();
