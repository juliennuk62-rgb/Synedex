// Onglet Choix des fonds : classes (PNG) numerotees, fonds numerotes, quantite par fond. Sans Internet.
var SL = self.SL = self.SL || {};
SL.choixUI = (function () {
  const $ = id => document.getElementById(id);
  const L = () => SL.localChoix;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ready = false;
  let fondsImg = new Map();   // id du fond -> Image (gardees pour les apercus)
  let currentId = null;       // classe affichee
  let previewFond = null;     // fond de l'apercu de la classe affichee

  // ------------------------------------------------------------------ images
  async function fondImage(f) {
    if (!fondsImg.has(f.id)) fondsImg.set(f.id, L().loadImg(f.blob).then(r => r.img));
    return fondsImg.get(f.id);
  }

  // Classe posee sur le fond (fond en mode "remplir"), dans un canvas.
  async function drawComposite(canvas, g, fond, maxSize, groupImg) {
    let img = groupImg;
    let url = null;
    if (!img && g.photo) {
      const r = await L().loadImg(g.photo);
      img = r.img;
      url = r.url;
    }
    const w0 = img ? img.naturalWidth : 1200;
    const h0 = img ? img.naturalHeight : 800;
    const s = Math.min(1, maxSize / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s));
    const h = Math.max(1, Math.round(h0 * s));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (fond) {
      const fi = await fondImage(fond);
      const k = Math.max(w / fi.naturalWidth, h / fi.naturalHeight);
      const sw = w / k, sh = h / k;
      ctx.drawImage(fi, (fi.naturalWidth - sw) / 2, (fi.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#4a4f57';
      ctx.fillRect(0, 0, w, h);
    }
    if (img) ctx.drawImage(img, 0, 0, w, h);
    if (url) URL.revokeObjectURL(url);
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

  function say(id, text, kind) {
    const el = $(id);
    el.textContent = text || '';
    el.className = 'form-message' + (kind ? ' ' + kind : '');
  }

  const resume = (g, fs) => fs.filter(f => g.choix[f.id]).map(f => `Fond ${f.numero} ×${g.choix[f.id]}`).join(' · ');

  function stepper(label, value, onChange) {
    const el = document.createElement('div');
    el.className = 'stepper';
    el.innerHTML = `<span>${label}</span><button type="button" aria-label="moins">−</button><b>${value}</b><button type="button" aria-label="plus">+</button>`;
    const [minus, plus] = el.querySelectorAll('button');
    minus.addEventListener('click', e => { e.stopPropagation(); onChange(-1); });
    plus.addEventListener('click', e => { e.stopPropagation(); onChange(1); });
    return el;
  }

  // ------------------------------------------------------------------ liste des classes
  async function showListe() {
    view('liste');
    currentId = null;
    const [gs, fs] = await Promise.all([L().groupes.list(), L().fonds.list()]);
    $('choix-nb-fonds').textContent = fs.length;
    const box = $('choix-groupes');
    box.innerHTML = '';
    if (!fs.length || !gs.length) {
      box.innerHTML = `<div class="guide">
        <h3>Comment faire</h3>
        <div class="guide-step${fs.length ? ' done' : ''}"><span class="guide-num">1</span>
          <div><strong>Ajoutez vos fonds</strong> : ils sont numérotés automatiquement (Fond 1, Fond 2…).
          ${fs.length ? `<br><span class="muted">${fs.length} fond(s) déjà ajouté(s).</span>` : ''}
          <br><button class="btn" data-guide="fonds">${fs.length ? 'Voir les fonds' : 'Ajouter mes fonds'}</button></div></div>
        <div class="guide-step${gs.length ? ' done' : ''}"><span class="guide-num">2</span>
          <div><strong>Ajoutez vos photos de groupe (PNG)</strong> : chaque fichier devient Classe 1, Classe 2…
          <br><label class="btn">Ajouter mes classes<input type="file" accept="image/png,image/*" multiple hidden></label></div></div>
        <div class="guide-step"><span class="guide-num">3</span>
          <div><strong>Notez les choix</strong> : pour chaque classe, le nombre d'exemplaires et le fond de chacun.</div></div>
      </div>`;
      box.querySelector('[data-guide=fonds]').addEventListener('click', showFonds);
      box.querySelector('input[type=file]').addEventListener('change', e => { addClasses(e.target.files); e.target.value = ''; });
    }
    for (const g of gs) {
      const card = document.createElement('div');
      card.className = 'choix-card';
      const t = L().groupes.total(g);
      card.innerHTML = `<button class="choix-card-img" type="button"><canvas></canvas><span class="num-badge">Classe ${g.numero}</span></button>
        <div class="choix-card-txt">
          <div class="choix-summary">${esc(resume(g, fs)) || '<span class="muted">Aucun fond choisi</span>'}</div>
          <span class="badge ${t >= g.nb ? 'ok' : 'wait'}">${t}/${g.nb} exemplaire(s)</span>
        </div>`;
      card.querySelector('.choix-card-txt').appendChild(stepper('Exemplaires', g.nb, async d => {
        await L().groupes.setNb(g.id, g.nb + d);
        showListe();
      }));
      card.querySelector('.choix-card-img').addEventListener('click', () => showGroupe(g.id));
      box.appendChild(card);
      const firstFond = fs.find(f => g.choix[f.id]);
      drawComposite(card.querySelector('canvas'), g, firstFond, 420).catch(() => {});
    }
    renderRecap(gs, fs);
  }

  function renderRecap(gs, fs) {
    const box = $('choix-recap');
    if (!gs.length) { box.innerHTML = ''; return; }
    const totals = {};
    gs.forEach(g => fs.forEach(f => { if (g.choix[f.id]) totals[f.id] = (totals[f.id] || 0) + g.choix[f.id]; }));
    box.innerHTML = `<h3>Récapitulatif</h3>
      <ul>${gs.map(g => `<li><strong>Classe ${g.numero}</strong> : ${esc(resume(g, fs)) || '<span class="muted">pas encore choisi</span>'}
        <span class="muted">(${L().groupes.total(g)}/${g.nb})</span></li>`).join('')}</ul>
      <p class="muted small">Total par fond : ${fs.filter(f => totals[f.id]).map(f => `Fond ${f.numero} : ${totals[f.id]}`).join(' · ') || '—'}</p>`;
  }

  async function addClasses(files) {
    if (!files || !files.length) return;
    try {
      const n = await L().groupes.addMany(files, (i, t) => say('choix-progress', `Import ${i}/${t}…`));
      say('choix-progress', `${n} classe(s) ajoutée(s).`, 'ok');
    } catch (e) {
      say('choix-progress', e.message, 'error');
    }
    showListe();
  }

  // ------------------------------------------------------------------ fonds
  async function showFonds() {
    view('fonds');
    const fs = await L().fonds.list();
    const box = $('choix-fonds-grid');
    box.innerHTML = '';
    if (!fs.length) {
      box.innerHTML = `<div class="guide"><p>Aucun fond pour le moment.</p>
        <label class="btn primary">Choisir mes images de fond<input type="file" accept="image/*" multiple hidden></label>
        <p class="muted small">Vous pouvez en sélectionner plusieurs d'un coup. Ils seront numérotés dans l'ordre des noms de fichiers.</p></div>`;
      box.querySelector('input').addEventListener('change', e => { addFonds(e.target.files); e.target.value = ''; });
      return;
    }
    fs.forEach(f => {
      const card = document.createElement('div');
      card.className = 'fond-card' + (f.actif ? '' : ' off');
      card.innerHTML = `<div class="fond-img"><img alt=""><span class="num-badge big">${f.numero}</span></div>
        <input type="text" class="fond-nom">
        <div class="fond-actions"><label class="check small"><input type="checkbox"> Proposé</label>
        <button class="btn small secondary" title="Supprimer">✕</button></div>`;
      fondImage(f).then(img => { card.querySelector('img').src = img.src; });
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
        if (!confirm(`Supprimer le fond n° ${f.numero} (« ${f.nom} ») ?`)) return;
        try { await L().fonds.remove(f.id); fondsImg.delete(f.id); showFonds(); } catch (e) { alert(e.message); }
      });
      box.appendChild(card);
    });
  }

  async function addFonds(files) {
    if (!files || !files.length) return;
    try {
      const n = await L().fonds.addMany(files, (i, t) => say('choix-fonds-message', `Ajout ${i}/${t}…`));
      say('choix-fonds-message', `${n} fond(s) ajouté(s).`, 'ok');
    } catch (e) {
      say('choix-fonds-message', e.message, 'error');
    }
    showFonds();
  }

  // ------------------------------------------------------------------ une classe
  async function showGroupe(id) {
    view('groupe');
    const [g, allFonds, gs] = await Promise.all([L().groupes.get(id), L().fonds.list(), L().groupes.list()]);
    if (!g) { showListe(); return; }
    if (currentId !== id) previewFond = null;
    currentId = id;
    const fonds = allFonds.filter(f => f.actif || g.choix[f.id]);
    const idx = gs.findIndex(x => x.id === id);
    const prev = gs[idx - 1];
    const next = gs[idx + 1];
    const t = L().groupes.total(g);

    const body = $('choix-groupe-body');
    body.innerHTML = `
      <div class="choix-head">
        <div><h2>Classe ${g.numero}</h2><div class="muted small">${esc(g.fichier || '')}</div></div>
        <div class="nav">
          ${prev ? `<button class="btn small secondary" data-nav="prev">◀ Classe ${prev.numero}</button>` : ''}
          ${next ? `<button class="btn small secondary" data-nav="next">Classe ${next.numero} ▶</button>` : ''}
        </div>
      </div>
      <div class="choix-nb"></div>
      <canvas class="choix-preview"></canvas>
      <div class="choix-etat"><span class="badge ${t >= g.nb ? 'ok' : 'wait'}">${t}/${g.nb} exemplaire(s) choisi(s)</span>
        <span class="muted small">Touchez une image pour l'aperçu, + / − pour le nombre d'exemplaires.</span></div>
      <div class="fonds-pick"></div>
      <div class="form-actions choix-tools">
        <label class="btn small secondary">Remplacer la photo<input type="file" accept="image/png,image/*" hidden></label>
        <button class="btn small danger" data-del>Supprimer la classe</button>
      </div>`;
    if (prev) body.querySelector('[data-nav=prev]').addEventListener('click', () => showGroupe(prev.id));
    if (next) body.querySelector('[data-nav=next]').addEventListener('click', () => showGroupe(next.id));
    body.querySelector('.choix-nb').appendChild(stepper('Exemplaires offerts', g.nb, async d => {
      await L().groupes.setNb(g.id, g.nb + d);
      showGroupe(g.id);
    }));
    body.querySelector('input[type=file]').addEventListener('change', async e => {
      if (!e.target.files[0]) return;
      await L().groupes.setPhoto(g.id, e.target.files[0]);
      showGroupe(g.id);
    });
    body.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`Supprimer la Classe ${g.numero} et ses choix ?`)) return;
      await L().groupes.remove(g.id);
      showListe();
    });

    // Apercu : la classe sur le fond choisi (ou le premier fond).
    let groupImg = null;
    if (g.photo) groupImg = (await L().loadImg(g.photo)).img;
    const canvas = body.querySelector('.choix-preview');
    const fondPreview = fonds.find(f => f.id === previewFond) || fonds.find(f => g.choix[f.id]) || fonds[0];
    previewFond = fondPreview ? fondPreview.id : null;
    const redraw = () => drawComposite(canvas, g, fonds.find(f => f.id === previewFond), 1400, groupImg);
    redraw();

    const pick = body.querySelector('.fonds-pick');
    if (!fonds.length) {
      pick.innerHTML = '<div class="guide"><p>Aucun fond.</p><button class="btn" type="button">Ajouter mes fonds</button></div>';
      pick.querySelector('button').addEventListener('click', showFonds);
      return;
    }
    fonds.forEach(f => {
      const q = g.choix[f.id] || 0;
      const card = document.createElement('div');
      card.className = 'pick-card' + (q ? ' chosen' : '') + (f.id === previewFond ? ' previewed' : '');
      card.innerHTML = `<button class="fond-img" type="button"><img alt=""><span class="num-badge big">${f.numero}</span></button>
        <div class="pick-name">${esc(f.nom)}</div>`;
      fondImage(f).then(img => { card.querySelector('img').src = img.src; });
      card.querySelector('.fond-img').addEventListener('click', () => {
        previewFond = f.id;
        pick.querySelectorAll('.pick-card').forEach(c => c.classList.remove('previewed'));
        card.classList.add('previewed');
        redraw();
      });
      card.appendChild(stepper('', q, async d => {
        try {
          await L().groupes.setQty(g.id, f.id, q + d);
          previewFond = f.id;
          showGroupe(g.id);
        } catch (e) { alert(e.message); }
      }));
      pick.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ demarrage
  // Nouveautes recues d'un autre appareil : on rafraichit l'ecran affiche.
  function refreshFromSync() {
    if (!$('page-choix').classList.contains('active')) return;
    fondsImg = new Map();
    if (!$('choix-liste').classList.contains('hidden')) showListe();
    else if (!$('choix-groupe').classList.contains('hidden') && currentId) showGroupe(currentId);
  }

  function init() {
    SL.choixSync.render();
    if (ready) { showListe(); return; }
    ready = true;
    SL.choixSync.onRemoteChange(refreshFromSync);
    $('choix-sync').querySelector('button').addEventListener('click', () => SL.choixSync.syncNow());
    $('choix-to-fonds').addEventListener('click', showFonds);
    document.querySelectorAll('[data-choix-back]').forEach(b => b.addEventListener('click', showListe));
    $('choix-add-classes').addEventListener('change', e => { addClasses(e.target.files); e.target.value = ''; });
    $('choix-fonds-file').addEventListener('change', e => { addFonds(e.target.files); e.target.value = ''; });
    $('choix-csv').addEventListener('click', async () => {
      download(await L().csv(), `choix-fonds-${new Date().toISOString().slice(0, 10)}.csv`);
    });
    $('choix-backup').addEventListener('click', async () => {
      say('choix-message', 'Préparation de la sauvegarde…');
      try {
        download(await L().backup(), `sauvegarde-choix-fonds-${new Date().toISOString().slice(0, 10)}.json`);
        say('choix-message', 'Sauvegarde téléchargée. Gardez ce fichier en lieu sûr.', 'ok');
      } catch (e) { say('choix-message', e.message, 'error'); }
    });
    $('choix-restore').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const r = await L().restore(file);
        fondsImg = new Map();
        say('choix-message', `Restauré : ${r.fonds} fond(s), ${r.groupes} classe(s).`, 'ok');
        showListe();
      } catch (err) { say('choix-message', err.message, 'error'); }
    });
    const ecoleKey = 'slowik.choix.ecole';
    try { $('choix-ecole').value = localStorage.getItem(ecoleKey) || ''; } catch (e) { /* ignore */ }
    $('choix-ecole').addEventListener('change', () => {
      try { localStorage.setItem(ecoleKey, $('choix-ecole').value.trim()); } catch (e) { /* ignore */ }
    });
    $('choix-pdf').addEventListener('click', async () => {
      const btn = $('choix-pdf');
      btn.disabled = true;
      say('choix-pdf-message', 'Création du PDF…');
      try {
        const ecole = $('choix-ecole').value.trim();
        const blob = await SL.plancheDemande.build(ecole);
        const nom = SL.naming.clean(ecole) || 'ecole';
        download(blob, `choix-fonds-${nom}.pdf`);
        say('choix-pdf-message', 'PDF créé : envoyez-le à l\'école.', 'ok');
      } catch (e) {
        say('choix-pdf-message', e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    $('choix-pdf-import').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      say('choix-pdf-message', 'Lecture du PDF…');
      try {
        const r = await SL.plancheDemande.importFilled(file);
        const msg = `${r.applied} classe(s) remplie(s) depuis le PDF.` + (r.errors.length ? ' ' + r.errors.join(' ') : '');
        say('choix-pdf-message', msg, r.errors.length ? 'error' : 'ok');
        showListe();
      } catch (err) {
        say('choix-pdf-message', err.message, 'error');
      }
    });
    $('choix-clear').addEventListener('click', async () => {
      if (!confirm('Effacer toutes les classes et leurs choix ? Les fonds sont conservés.\n\nPensez à « Sauvegarder » ou au « Récapitulatif » avant.')) return;
      await L().groupes.clearAll();
      say('choix-message', 'Classes effacées.', 'ok');
      showListe();
    });
    showListe().catch(e => { $('choix-groupes').innerHTML = `<div class="error-text">${esc(e.message)}</div>`; });
  }

  return { init };
})();
