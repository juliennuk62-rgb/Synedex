// Onglet Ecoles : carnet d'adresses et acces en ligne des etablissements.
var SL = self.SL = self.SL || {};
SL.ecolesUI = (function () {
  const $ = id => document.getElementById(id);
  const TYPES = { ecole: 'École', club: 'Club', autre: 'Autre' };
  const euros = v => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  let list = [];
  let current = null; // ecole affichee (null = nouvelle)
  let ready = false;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function say(text, kind) {
    const el = $('ecole-message');
    el.textContent = text || '';
    el.className = 'form-message' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------- liste
  async function reload(selectId) {
    try {
      list = await SL.cloud.ecoles.list();
    } catch (e) {
      $('ecoles-list').innerHTML = `<div class="placeholder error-text">${esc(e.message)}</div>`;
      return;
    }
    renderList();
    if (selectId) open(list.find(e => e.id === selectId) || null);
  }

  function renderList() {
    const q = $('ecoles-search').value.trim().toLowerCase();
    const showArchived = $('ecoles-archived').checked;
    const rows = list.filter(e => (showArchived || !e.archivee)
      && (!q || `${e.nom} ${e.ville} ${e.contact_nom}`.toLowerCase().includes(q)));
    const box = $('ecoles-list');
    if (!rows.length) {
      box.innerHTML = `<div class="placeholder">${list.length ? 'Aucun résultat.' : 'Aucune école pour le moment.'}</div>`;
      return;
    }
    box.innerHTML = rows.map(e => `
      <button class="list-item${current && current.id === e.id ? ' active' : ''}${e.archivee ? ' archived' : ''}" data-id="${e.id}">
        <span class="li-title">${esc(e.nom)}</span>
        <span class="li-sub">${esc(TYPES[e.type] || '')}${e.ville ? ' · ' + esc(e.ville) : ''} · ${Number(e.taux_commission)} %${e.archivee ? ' · archivée' : ''}</span>
      </button>`).join('');
    box.querySelectorAll('.list-item').forEach(b => b.addEventListener('click', () => open(list.find(e => e.id === b.dataset.id))));
  }

  // ------------------------------------------------------------- fiche
  function open(ecole) {
    current = ecole;
    const f = $('ecole-form');
    const e = ecole || { type: 'ecole', taux_commission: 30 };
    ['nom', 'adresse', 'code_postal', 'ville', 'contact_nom', 'contact_email', 'telephone', 'notes']
      .forEach(k => { f.elements[k].value = e[k] || ''; });
    f.elements.type.value = e.type || 'ecole';
    f.elements.taux_commission.value = Number(e.taux_commission ?? 30);
    $('ecole-title').textContent = ecole ? ecole.nom : 'Nouvelle école';
    $('ecole-archive').classList.toggle('hidden', !ecole);
    $('ecole-delete').classList.toggle('hidden', !ecole);
    $('ecole-archive').textContent = ecole && ecole.archivee ? 'Désarchiver' : 'Archiver';
    $('acces-section').classList.toggle('hidden', !ecole);
    $('ecole-detail').classList.remove('hidden');
    $('ecole-empty').classList.add('hidden');
    updateExample();
    say('');
    renderList();
    if (ecole) loadAcces();
  }

  function updateExample() {
    const taux = Number($('ecole-form').elements.taux_commission.value);
    if (!(taux >= 0 && taux <= 100)) {
      $('taux-exemple').textContent = 'Le taux doit être compris entre 0 et 100 %.';
      return;
    }
    const ca = 1000;
    const com = Math.round(ca * taux) / 100;
    $('taux-exemple').textContent =
      `Part du CA reversée à l'établissement. Exemple : sur ${euros(ca)} de CA, ${euros(com)} reversés à l'établissement, ${euros(ca - com)} pour vous.`;
  }

  async function save(ev) {
    ev.preventDefault();
    const f = $('ecole-form');
    const data = {};
    ['nom', 'type', 'adresse', 'code_postal', 'ville', 'contact_nom', 'contact_email', 'telephone', 'notes']
      .forEach(k => { data[k] = f.elements[k].value.trim(); });
    data.taux_commission = Number(String(f.elements.taux_commission.value).replace(',', '.'));
    if (!data.nom) { say('Le nom est obligatoire.', 'error'); return; }
    if (!(data.taux_commission >= 0 && data.taux_commission <= 100)) { say('Taux de commission invalide.', 'error'); return; }
    if (current) data.id = current.id;
    $('ecole-save').disabled = true;
    try {
      const saved = await SL.cloud.ecoles.save(data);
      await reload(saved.id);
      say('Enregistré.', 'ok');
    } catch (e) {
      say(e.message, 'error');
    } finally {
      $('ecole-save').disabled = false;
    }
  }

  async function toggleArchive() {
    if (!current) return;
    try {
      const saved = await SL.cloud.ecoles.save({ id: current.id, archivee: !current.archivee });
      await reload(saved.id);
      say(saved.archivee ? 'École archivée (elle reste dans le carnet).' : 'École réactivée.', 'ok');
    } catch (e) { say(e.message, 'error'); }
  }

  async function remove() {
    if (!current) return;
    if (!confirm(`Supprimer définitivement « ${current.nom} » et ses accès en ligne ?\n\nPour la garder d'une année sur l'autre sans l'afficher, utilisez plutôt « Archiver ».`)) return;
    try {
      await SL.cloud.ecoles.remove(current.id);
      current = null;
      $('ecole-detail').classList.add('hidden');
      $('ecole-empty').classList.remove('hidden');
      await reload();
    } catch (e) { say(e.message, 'error'); }
  }

  // ------------------------------------------------------------- acces
  async function loadAcces() {
    const box = $('acces-list');
    const id = current && current.id;
    box.innerHTML = '<div class="muted">Chargement…</div>';
    try {
      const rows = await SL.cloud.acces.list(id);
      if (!current || current.id !== id) return;
      box.innerHTML = rows.length ? rows.map(r => `
        <div class="acces-row">
          <span class="acces-email">${esc(r.email)}</span>
          <span class="badge ${r.compte_cree ? 'ok' : 'wait'}">${r.compte_cree ? 'compte créé' : "en attente d'inscription"}</span>
          <button class="btn small secondary" data-email="${esc(r.email)}">Retirer</button>
        </div>`).join('') : '<div class="muted">Aucun accès pour cette école.</div>';
      box.querySelectorAll('button[data-email]').forEach(b => b.addEventListener('click', () => removeAcces(b.dataset.email)));
    } catch (e) {
      box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
    }
  }

  async function addAcces(ev) {
    ev.preventDefault();
    const input = $('acces-email');
    try {
      await SL.cloud.acces.add(input.value, current.id);
      input.value = '';
      await loadAcces();
    } catch (e) {
      alert(e.message);
    }
  }

  async function removeAcces(email) {
    if (!confirm(`Retirer l'accès de ${email} ? La personne ne pourra plus rien consulter.`)) return;
    try {
      await SL.cloud.acces.remove(email);
      await loadAcces();
    } catch (e) {
      alert(e.message);
    }
  }

  // ------------------------------------------------------------- demarrage
  function init() {
    if (!SL.cloud.configured) {
      $('ecoles-layout').classList.add('hidden');
      $('ecoles-unconfigured').classList.remove('hidden');
      return;
    }
    if (!ready) {
      ready = true;
      $('ecoles-search').addEventListener('input', renderList);
      $('ecoles-archived').addEventListener('change', renderList);
      $('ecole-new').addEventListener('click', () => open(null));
      $('ecole-form').addEventListener('submit', save);
      $('ecole-form').elements.taux_commission.addEventListener('input', updateExample);
      $('ecole-archive').addEventListener('click', toggleArchive);
      $('ecole-delete').addEventListener('click', remove);
      $('acces-form').addEventListener('submit', addAcces);
      $('site-url').textContent = SL.cloud.siteUrl();
    }
    reload();
  }

  return { init };
})();
