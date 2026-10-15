// Onglet Choix des fonds : photos de groupe offertes, choix fait sur place, sans Internet.
var SL = self.SL = self.SL || {};
SL.choixUI = (function () {
  const $ = id => document.getElementById(id);
  const L = () => SL.localChoix;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let urls = [];
  let ready = false;
  let filtre = '';

  function url(blob) {
    if (!blob) return '';
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  }

  function freeUrls() {
    urls.forEach(u => URL.revokeObjectURL(u));
    urls = [];
  }

  function view(name) {
    ['liste', 'fonds', 'groupe'].forEach(v => $(`choix-${v}`).classList.toggle('hidden', v !== name));
    $('page-choix').scrollTop = 0;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function say(text, kind) {
    const el = $('choix-message');
    el.textContent = text || '';
    el.className = 'form-message' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------------ liste
  async function showListe() {
    freeUrls();
    view('liste');
    const [gs, fs] = await Promise.all([L().groupes.list(), L().fonds.list()]);
    $('choix-nb-fonds').textContent = fs.length;
    const ecoles = [...new Set(gs.map(g => g.ecole).filter(Boolean))];
    const sel = $('choix-filtre');
    sel.innerHTML = '<option value="">Toutes les écoles</option>' + ecoles.map(e => `<option>${esc(e)}</option>`).join('');
    if (!ecoles.includes(filtre)) filtre = '';
    sel.value = filtre;
    $('choix-ecoles-list').innerHTML = ecoles.map(e => `<option value="${esc(e)}">`).join('');
    const box = $('choix-groupes');
    const list = gs.filter(g => !filtre || g.ecole === filtre);
    if (!fs.length || !gs.length) {
      box.innerHTML = `<div class="guide">
        <h3>Comment faire</h3>
        <div class="guide-step${fs.length ? ' done' : ''}"><span class="guide-num">1</span>
          <div><strong>Ajoutez vos fonds</strong> (une seule fois, ils servent pour toutes les écoles).
          ${fs.length ? `<br><span class="muted">${fs.length} fond(s) déjà ajouté(s).</span>` : ''}
          <br><button class="btn" data-guide="fonds">${fs.length ? 'Voir les fonds' : 'Ajouter mes fonds'}</button></div></div>
        <div class="guide-step"><span class="guide-num">2</span>
          <div><strong>Créez un groupe</strong> : école, nom du groupe, nombre d'adultes, photo.
          <br><button class="btn" data-guide="groupe">Créer un groupe</button></div></div>
        <div class="guide-step"><span class="guide-num">3</span>
          <div><strong>Faites choisir</strong> : ouvrez le groupe et touchez un fond pour chaque adulte.</div></div>
      </div>`;
      box.querySelector('[data-guide=fonds]').addEventListener('click', showFonds);
      box.querySelector('[data-guide=groupe]').addEventListener('click', newGroupe);
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="placeholder">Aucun groupe pour cette école. Touchez « + Groupe ».</div>';
      return;
    }
    box.innerHTML = '';
    list.forEach(g => {
      const n = (g.choix || []).filter(c => c.fondId).length;
      const card = document.createElement('button');
      card.className = 'choix-card';
      card.innerHTML = `<div class="choix-card-img">${g.photo ? `<img src="${url(g.photo)}" alt="">` : ''}</div>
        <div class="choix-card-txt"><span class="li-sub">${esc(g.ecole)}</span><span class="li-title">${esc(g.nom)}</span>
        <span class="badge ${n >= g.nbAdultes ? 'ok' : 'wait'}">${n}/${g.nbAdultes} fond(s) choisi(s)</span></div>`;
      card.addEventListener('click', () => showGroupe(g.id));
      box.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ fonds
  async function showFonds() {
    freeUrls();
    view('fonds');
    const fs = await L().fonds.list();
    const box = $('choix-fonds-grid');
    if (!fs.length) {
      box.innerHTML = `<div class="guide"><p>Aucun fond pour le moment.</p>
        <label class="btn primary">Choisir mes images de fond<input type="file" accept="image/*" multiple hidden></label>
        <p class="muted small">Vous pouvez en sélectionner plusieurs d'un coup.</p></div>`;
      box.querySelector('input').addEventListener('change', e => { addFonds(e.target.files); e.target.value = ''; });
      return;
    }
    box.innerHTML = '';
    fs.forEach(f => {
      const card = document.createElement('div');
      card.className = 'fond-card' + (f.actif ? '' : ' off');
      card.innerHTML = `<img alt="" src="${url(f.blob)}"><input type="text" class="fond-nom">
        <div class="fond-actions"><label class="check small"><input type="checkbox"> Proposé</label>
        <button class="btn small secondary" title="Supprimer">✕</button></div>`;
      const nom = card.querySelector('.fond-nom');
      nom.value = f.nom;
      nom.addEventListener('change', () => L().fonds.update(f.id, { nom: nom.value.trim() || f.nom }));
      const cb = card.querySelector('input[type=checkbox]');
      cb.checked = f.actif;
      cb.addEventListener('change', async () => {
        await L().fonds.update(f.id, { actif: cb.checked });
        card.classList.toggle('off', !cb.checked);
      });
      card.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Supprimer le fond « ${f.nom} » ?`)) return;
        try { await L().fonds.remove(f.id); showFonds(); } catch (e) { alert(e.message); }
      });
      box.appendChild(card);
    });
  }

  async function addFonds(files) {
    const list = Array.from(files || []);
    const msg = $('choix-fonds-message');
    for (let i = 0; i < list.length; i++) {
      msg.textContent = `Ajout ${i + 1}/${list.length}…`;
      try { await L().fonds.add(list[i]); } catch (e) { msg.textContent = `${list[i].name} : ${e.message}`; return; }
    }
    msg.textContent = list.length ? `${list.length} fond(s) ajouté(s).` : '';
    showFonds();
  }

  // ------------------------------------------------------------------ groupe
  function formHtml(g) {
    return `
      <label class="field">École / club<input name="ecole" type="text" list="choix-ecoles-list" value="${esc(g.ecole || filtre || '')}"></label>
      <label class="field">Groupe<input name="nom" type="text" placeholder="ex : CM2 Mme Durand, U11…" value="${esc(g.nom || '')}"></label>
      <label class="field">Nombre d'adultes<input name="nbAdultes" type="number" min="1" max="30" inputmode="numeric" value="${g.nbAdultes || 1}"></label>
      <label class="field">Photo du groupe${g.id ? ' (vide = garder l\'actuelle)' : ' (vous pourrez l\'ajouter plus tard)'}<input name="photo" type="file" accept="image/*"></label>
      <div class="form-actions"><button class="btn primary" type="submit">${g.id ? 'Enregistrer' : 'Créer le groupe'}</button>
        <button class="btn secondary" type="button" data-cancel>Annuler</button><span class="form-message"></span></div>`;
  }

  function bindForm(form, g, onDone) {
    form.noValidate = true;
    form.innerHTML = formHtml(g);
    form.querySelector('[data-cancel]').addEventListener('click', () => onDone(null));
    form.onsubmit = async ev => {
      ev.preventDefault();
      const msg = form.querySelector('.form-message');
      const err = t => { msg.textContent = t; msg.className = 'form-message error'; };
      if (!form.elements.ecole.value.trim()) { err("Indiquez le nom de l'école ou du club."); form.elements.ecole.focus(); return; }
      if (!form.elements.nom.value.trim()) { err('Indiquez le nom du groupe (ex : CM2 Mme Durand).'); form.elements.nom.focus(); return; }
      const nb = parseInt(form.elements.nbAdultes.value, 10);
      if (!(nb >= 1 && nb <= 30)) { err("Nombre d'adultes : entre 1 et 30."); form.elements.nbAdultes.focus(); return; }
      const used = (g.choix || []).filter(c => c.rang > nb).length;
      if (used && !confirm(`Passer à ${nb} adulte(s) retire ${used} choix déjà faits. Continuer ?`)) return;
      msg.className = 'form-message';
      msg.textContent = 'Enregistrement…';
      try {
        const saved = await L().groupes.save({
          id: g.id, ecole: form.elements.ecole.value, nom: form.elements.nom.value, nbAdultes: nb,
        }, form.elements.photo.files[0]);
        filtre = saved.ecole;
        onDone(saved);
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'form-message error';
      }
    };
  }

  function newGroupe() {
    freeUrls();
    view('groupe');
    $('choix-groupe-body').innerHTML = '<h2>Nouveau groupe</h2><form class="choix-form"></form>';
    bindForm($('choix-groupe-body').querySelector('form'), {}, saved => (saved ? showGroupe(saved.id) : showListe()));
  }

  async function showGroupe(id) {
    freeUrls();
    view('groupe');
    const [g, allFonds] = await Promise.all([L().groupes.get(id), L().fonds.list()]);
    if (!g) { showListe(); return; }
    const fonds = allFonds.filter(f => f.actif || (g.choix || []).some(c => c.fondId === f.id));
    const fondUrls = {};
    fonds.forEach(f => { fondUrls[f.id] = url(f.blob); });
    const body = $('choix-groupe-body');
    body.innerHTML = `
      <div class="choix-head">
        <div><div class="li-sub">${esc(g.ecole)}</div><h2>${esc(g.nom)}</h2></div>
        <div class="nav"><button class="btn small secondary" data-edit>Modifier</button>
        <button class="btn small danger" data-del>Supprimer</button></div>
      </div>
      <form class="choix-form hidden"></form>
      ${g.photo ? `<img class="choix-photo" src="${url(g.photo)}" alt="Photo du groupe">` : '<div class="placeholder">Pas encore de photo : touchez « Modifier » pour l\'ajouter.</div>'}
      <p class="choix-consigne">${g.nbAdultes} adulte(s) : choisissez un fond pour chacun.
        Le même fond peut être choisi plusieurs fois.</p>
      <div class="choix-etat"></div>
      <div class="slots"></div>`;
    body.querySelector('[data-edit]').addEventListener('click', () => {
      const form = body.querySelector('.choix-form');
      if (!form.classList.contains('hidden')) { form.classList.add('hidden'); return; }
      form.classList.remove('hidden');
      bindForm(form, g, saved => (saved ? showGroupe(saved.id) : form.classList.add('hidden')));
    });
    body.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`Supprimer le groupe « ${g.nom} » et ses choix ?`)) return;
      await L().groupes.remove(g.id);
      showListe();
    });

    const etat = body.querySelector('.choix-etat');
    const choix = {};
    (g.choix || []).forEach(c => { choix[c.rang] = c; });
    const refreshEtat = (saved) => {
      const n = Object.values(choix).filter(c => c.fondId).length;
      etat.innerHTML = `<span class="badge ${n >= g.nbAdultes ? 'ok' : 'wait'}">${n}/${g.nbAdultes} fond(s) choisi(s)</span>` +
        (saved ? ' <span class="muted small">enregistré sur cet appareil</span>' : '');
    };
    refreshEtat(false);

    const slots = body.querySelector('.slots');
    for (let rang = 1; rang <= g.nbAdultes; rang++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<div class="slot-head"><strong>Adulte ${rang}</strong>
        <input type="text" maxlength="60" placeholder="Nom (facultatif)"></div><div class="fond-strip"></div>`;
      const nom = slot.querySelector('input');
      nom.value = (choix[rang] && choix[rang].nomAdulte) || '';
      let t = null;
      nom.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          await L().groupes.setChoix(g.id, rang, { nomAdulte: nom.value.trim() });
          choix[rang] = Object.assign({ rang, fondId: null }, choix[rang], { nomAdulte: nom.value.trim() });
          refreshEtat(true);
        }, 400);
      });
      const strip = slot.querySelector('.fond-strip');
      fonds.forEach(f => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fond-choice';
        b.innerHTML = `<img alt="" src="${fondUrls[f.id]}"><span>${esc(f.nom)}</span>`;
        b.classList.toggle('selected', !!choix[rang] && choix[rang].fondId === f.id);
        b.addEventListener('click', async () => {
          const next = choix[rang] && choix[rang].fondId === f.id ? null : f.id;
          await L().groupes.setChoix(g.id, rang, { fondId: next });
          choix[rang] = Object.assign({ rang, nomAdulte: nom.value.trim() }, choix[rang], { fondId: next });
          strip.querySelectorAll('.fond-choice').forEach(x => x.classList.remove('selected'));
          if (next) b.classList.add('selected');
          refreshEtat(true);
        });
        strip.appendChild(b);
      });
      if (!fonds.length) {
        strip.innerHTML = '<span class="muted">Aucun fond. </span><button class="btn small" type="button">Ajouter mes fonds</button>';
        strip.querySelector('button').addEventListener('click', showFonds);
      }
      slots.appendChild(slot);
    }
  }

  // ------------------------------------------------------------------ demarrage
  function init() {
    if (ready) { showListe(); return; }
    ready = true;
    $('choix-filtre').addEventListener('change', e => { filtre = e.target.value; showListe(); });
    $('choix-new').addEventListener('click', newGroupe);
    $('choix-to-fonds').addEventListener('click', showFonds);
    document.querySelectorAll('[data-choix-back]').forEach(b => b.addEventListener('click', showListe));
    $('choix-fonds-file').addEventListener('change', e => { addFonds(e.target.files); e.target.value = ''; });
    $('choix-csv').addEventListener('click', async () => {
      download(await L().csv(), `choix-fonds-${new Date().toISOString().slice(0, 10)}.csv`);
    });
    $('choix-backup').addEventListener('click', async () => {
      say('Préparation de la sauvegarde…');
      try {
        download(await L().backup(), `sauvegarde-choix-fonds-${new Date().toISOString().slice(0, 10)}.json`);
        say('Sauvegarde téléchargée. Gardez ce fichier en lieu sûr.', 'ok');
      } catch (e) { say(e.message, 'error'); }
    });
    $('choix-restore').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const r = await L().restore(file);
        say(`Restauré : ${r.fonds} fond(s), ${r.groupes} groupe(s).`, 'ok');
        showListe();
      } catch (err) { say(err.message, 'error'); }
    });
    showListe().catch(e => { $('choix-groupes').innerHTML = `<div class="error-text">${esc(e.message)}</div>`; });
  }

  return { init };
})();
