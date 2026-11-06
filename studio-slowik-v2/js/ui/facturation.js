// Onglet Facturation (admin) : factures, commission reversee a l'etablissement, coordonnees.
var SL = self.SL = self.SL || {};
SL.facturationUI = (function () {
  const $ = id => document.getElementById(id);
  const { html, raw, dateFr } = SL.u;
  const eur = SL.u.euros;
  const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  let factures = [];
  let ecoles = [];
  let ready = false;

  function say(id, text, kind) {
    // Regle commune : les succes en toast, les erreurs sous le formulaire.
    if (kind === 'ok') { SL.u.toast(text); text = ''; kind = ''; }
    const el = $(id);
    el.textContent = text || '';
    el.className = 'form-message' + (kind ? ' ' + kind : '');
  }

  function view(name) {
    ['liste', 'nouvelle', 'detail', 'coordonnees'].forEach(v => $(`fac-${v}`).classList.toggle('hidden', v !== name));
    $('page-facturation').scrollTop = 0;
  }

  // ------------------------------------------------------------- liste
  async function showListe() {
    view('liste');
    try {
      [factures, ecoles] = await Promise.all([SL.cloud.factures.list(), SL.cloud.ecoles.list()]);
    } catch (e) {
      $('fac-table').innerHTML = html`<div class="error-text">${e.message}</div>`;
      return;
    }
    checkCoordonnees();
    const years = [...new Set(factures.map(f => f.date_facture.slice(0, 4)))].sort().reverse();
    const cur = String(new Date().getFullYear());
    if (!years.includes(cur)) years.unshift(cur);
    const ySel = $('fac-annee');
    const keepY = ySel.value || cur;
    ySel.innerHTML = html`${years.map(y => html`<option>${y}</option>`)}<option value="">Toutes</option>`;
    ySel.value = years.includes(keepY) || keepY === '' ? keepY : cur;
    const eSel = $('fac-ecole');
    const keepE = eSel.value;
    eSel.innerHTML = html`<option value="">Toutes les écoles</option>${ecoles.map(e => html`<option value="${e.id}">${e.nom}</option>`)}`;
    eSel.value = ecoles.some(e => e.id === keepE) ? keepE : '';
    renderListe();
  }

  function renderListe() {
    const y = $('fac-annee').value;
    const ecole = $('fac-ecole').value;
    const rows = factures.filter(f => (!y || f.date_facture.startsWith(y)) && (!ecole || f.ecole_id === ecole));
    const actives = rows.filter(f => f.statut === 'emise');
    const sum = k => actives.reduce((a, f) => a + Number(f[k]), 0);
    const aVerser = actives.filter(f => !f.commission_versee).reduce((a, f) => a + Number(f.commission), 0);
    $('fac-stats').innerHTML = html`
      <div class="stat"><span>Chiffre d'affaires</span><b>${eur(sum('ca'))}</b></div>
      <div class="stat"><span>Commissions reversées aux établissements</span><b>${eur(sum('commission'))}</b></div>
      <div class="stat"><span>Part Studio SLOWIK</span><b>${eur(sum('net'))}</b></div>
      <div class="stat${aVerser ? ' warn' : ''}"><span>Commissions encore à verser</span><b>${eur(aVerser)}</b></div>`;
    const box = $('fac-table');
    if (!rows.length) {
      box.innerHTML = '<div class="placeholder">Aucune facture pour cette sélection.<br><button class="btn small" type="button">Créer une facture</button></div>';
      box.querySelector('button').addEventListener('click', showNouvelle);
      return;
    }
    box.innerHTML = html`<table class="fac-table"><thead><tr>
        <th>N°</th><th>Date</th><th>École</th><th class="num">CA</th><th class="num">Commission</th><th class="num">Votre part</th><th>Suivi</th>
      </tr></thead><tbody>${rows.map(f => html`
        <tr data-id="${f.id}" class="${f.statut === 'annulee' ? 'annulee' : ''}">
          <td data-label="N°"><strong>${f.numero}</strong></td>
          <td data-label="Date">${dateFr(f.date_facture)}</td>
          <td data-label="École">${f.client.nom}</td>
          <td class="num" data-label="CA">${eur(f.ca)}</td>
          <td class="num" data-label="Commission">${eur(f.commission)} <span class="muted small">(${Number(f.taux)} %)</span></td>
          <td class="num" data-label="Votre part">${eur(f.net)}</td>
          <td data-label="Suivi">${raw(f.statut === 'annulee' ? '<span class="badge lock">annulée</span>'
            : !(Number(f.taux) > 0) ? '<span class="badge">sans commission</span>'
            : f.commission_versee ? '<span class="badge ok">commission versée</span>' : '<span class="badge wait">commission à verser</span>')}</td>
        </tr>`)}</tbody></table>`;
    box.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => showDetail(tr.dataset.id)));
  }

  async function checkCoordonnees() {
    try {
      const p = await SL.cloud.parametres.get();
      const missing = !p || !p.adresse || !p.ville || p.siret.replace(/\D/g, '').length < 14;
      $('fac-coord-warn').classList.toggle('hidden', !missing);
    } catch (e) { /* affiche dans la liste */ }
  }

  // ------------------------------------------------------------- nouvelle facture
  // Une ligne : designation, quantite, prix unitaire ; le montant (quantite x prix) est calcule.
  function ligneRow(l) {
    const row = document.createElement('div');
    row.className = 'fac-ligne';
    row.innerHTML = `<input type="text" class="fl-des" placeholder="Désignation (ex : Photographies scolaires 2026-2027)" aria-label="Désignation">
      <input type="text" class="fl-qte" inputmode="decimal" placeholder="Qté" aria-label="Quantité" title="Nombre d'unités">
      <input type="text" class="fl-pu" inputmode="decimal" placeholder="Prix unitaire €" aria-label="Prix unitaire">
      <span class="fl-mt" title="Montant de la ligne"></span>
      <button type="button" class="btn small secondary" title="Retirer la ligne">✕</button>`;
    const virgule = v => String(v).replace('.', ',');
    row.querySelector('.fl-des').value = l.designation || '';
    row.querySelector('.fl-qte').value = virgule(l.quantite || 1);
    const pu = l.prix_unitaire ?? l.montant;
    row.querySelector('.fl-pu').value = pu ? virgule(pu) : '';
    row.querySelector('button').addEventListener('click', () => { row.remove(); recalc(); });
    row.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc));
    return row;
  }

  const parseMontant = v => {
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };

  function readLignes() {
    return [...document.querySelectorAll('#fac-lignes .fac-ligne')].map(r => {
      const designation = r.querySelector('.fl-des').value.trim();
      const pu = r.querySelector('.fl-pu').value.trim();
      const quantite = parseMontant(r.querySelector('.fl-qte').value.trim() || '1');
      const prix_unitaire = parseMontant(pu || '0');
      const montant = round2(quantite * prix_unitaire);
      return { designation, quantite, prix_unitaire, montant, vide: !designation && !pu };
    }).filter(l => !l.vide);
  }

  function recalc() {
    document.querySelectorAll('#fac-lignes .fac-ligne').forEach(r => {
      const q = parseMontant(r.querySelector('.fl-qte').value.trim() || '1');
      const pu = parseMontant(r.querySelector('.fl-pu').value.trim() || '0');
      r.querySelector('.fl-mt').textContent = Number.isFinite(q * pu) ? eur(round2(q * pu)) : '?';
    });
    const lignes = readLignes();
    const ca = round2(lignes.reduce((a, l) => a + (Number.isFinite(l.montant) ? l.montant : 0), 0));
    const taux = parseMontant($('fac-taux').value);
    const com = round2(ca * (Number.isFinite(taux) ? taux : 0) / 100);
    $('fac-calc').innerHTML = taux === 0
      ? html`
      <div class="total"><span>Chiffre d'affaires (total facturé)</span><b>${eur(ca)}</b></div>
      <p class="hint">Commission à 0 % : ni la ligne commission ni le détail de la répartition n'apparaîtront sur la facture.</p>`
      : html`
      <div><span>Chiffre d'affaires (total facturé)</span><b>${eur(ca)}</b></div>
      <div><span>Commission <strong>versée</strong> à l'établissement (${Number.isFinite(taux) ? taux : '?'} %)</span><b>${eur(com)}</b></div>
      <div class="total"><span>Votre part</span><b>${eur(ca - com)}</b></div>
      <p class="hint">Pour ne pas faire apparaître la commission sur la facture, mettez le taux à 0.</p>`;
  }

  async function showNouvelle() {
    view('nouvelle');
    if (!ecoles.length) ecoles = await SL.cloud.ecoles.list();
    const actives = ecoles.filter(e => !e.archivee);
    $('fac-n-ecole').innerHTML = actives.length
      ? html`<option value="">Choisir…</option>${actives.map(e => html`<option value="${e.id}">${e.nom}</option>`)}`
      : '<option value="">Aucune école : créez-la dans l\'onglet Écoles</option>';
    const today = new Date();
    $('fac-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    $('fac-taux').value = '30';
    $('fac-notes').value = '';
    const y = today.getFullYear();
    const saison = today.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
    $('fac-lignes').innerHTML = '';
    $('fac-lignes').appendChild(ligneRow({ designation: `Photographies scolaires ${saison}` }));
    say('fac-n-message', '');
    recalc();
  }

  async function createFacture(ev) {
    ev.preventDefault();
    const ecoleId = $('fac-n-ecole').value;
    const lignes = readLignes();
    const taux = parseMontant($('fac-taux').value);
    if (!ecoleId) { say('fac-n-message', "Choisissez l'école.", 'error'); return; }
    if (!lignes.length) { say('fac-n-message', 'Ajoutez au moins une ligne.', 'error'); return; }
    if (lignes.some(l => !l.designation)) { say('fac-n-message', 'Chaque ligne doit avoir une désignation.', 'error'); return; }
    if (lignes.some(l => !(l.quantite > 0))) { say('fac-n-message', 'Quantité invalide (ex : 1, 25).', 'error'); return; }
    if (lignes.some(l => !(l.prix_unitaire >= 0))) { say('fac-n-message', 'Prix unitaire invalide (ex : 1234,50).', 'error'); return; }
    if (!(taux >= 0 && taux <= 100)) { say('fac-n-message', 'Taux de commission invalide.', 'error'); return; }
    const ecole = ecoles.find(e => e.id === ecoleId);
    const ca = round2(lignes.reduce((a, l) => a + l.montant, 0));
    const detail = taux > 0 ? `Commission versée à l'établissement : ${eur(round2(ca * taux / 100))}` : 'Sans commission (rien sur la facture)';
    if (!(await SL.u.confirm(`Total : ${eur(ca)}\n${detail}\nUne facture émise ne peut plus être modifiée, seulement annulée.`,
      { title: `Créer la facture pour ${ecole.nom} ?`, ok: 'Créer la facture' }))) return;
    $('fac-create').disabled = true;
    say('fac-n-message', 'Création…');
    try {
      const f = await SL.cloud.factures.create({
        ecoleId, date: $('fac-date').value, taux, notes: $('fac-notes').value.trim(),
        lignes: lignes.map(l => ({ designation: l.designation, quantite: l.quantite, prix_unitaire: round2(l.prix_unitaire), montant: l.montant })),
      });
      factures = await SL.cloud.factures.list();
      showDetail(f.id, true);
    } catch (e) {
      say('fac-n-message', e.message, 'error');
    } finally {
      $('fac-create').disabled = false;
    }
  }

  // ------------------------------------------------------------- detail
  function showDetail(id, justCreated) {
    const f = factures.find(x => x.id === id);
    if (!f) { showListe(); return; }
    view('detail');
    const box = $('fac-detail-body');
    box.innerHTML = html`
      ${justCreated ? raw('<div class="banner ok-banner">Facture créée.</div>') : ''}
      <div class="choix-head"><div><h2>Facture ${f.numero}</h2>
        <div class="muted">${dateFr(f.date_facture)} · ${f.client.nom}</div></div>
        <div class="nav"><button class="btn" data-pdf>Télécharger le PDF</button></div></div>
      ${f.statut === 'annulee' ? raw('<div class="banner error">Facture annulée.</div>') : ''}
      <table class="fac-table small-table"><tbody>
        ${SL.facturePdf.lignesDe(f).map(l => html`<tr><td>${l.designation}</td>
          <td class="num muted">${l.quantite === 1 ? '' : `${String(l.quantite).replace('.', ',')} × ${eur(l.prix_unitaire)}`}</td><td class="num">${eur(l.montant)}</td></tr>`)}
        <tr class="tot"><td colspan="2">Chiffre d'affaires (total facturé)</td><td class="num">${eur(f.ca)}</td></tr>
        ${Number(f.taux) > 0 ? html`
        <tr><td colspan="2">Commission versée à l'établissement (${Number(f.taux)} %)</td><td class="num">${eur(f.commission)}</td></tr>
        <tr class="tot"><td colspan="2">Votre part</td><td class="num">${eur(f.net)}</td></tr>` : html`
        <tr><td colspan="2" class="muted">Sans commission : rien n'apparaît à ce sujet sur la facture</td><td></td></tr>`}
      </tbody></table>
      ${f.notes ? html`<p class="muted">${f.notes}</p>` : ''}
      ${f.statut === 'emise' ? html`
        ${Number(f.taux) > 0 ? html`<label class="check"><input type="checkbox" data-versee${f.commission_versee ? ' checked' : ''}>
          Commission de ${eur(f.commission)} versée à l'établissement</label>` : ''}
        <div class="form-actions"><button class="btn small danger" data-annuler>Annuler cette facture</button></div>` : ''}
      <div class="form-message" data-msg></div>`;
    const msg = box.querySelector('[data-msg]');
    const pdfBtn = box.querySelector('[data-pdf]');
    pdfBtn.addEventListener('click', () => SL.u.busy(pdfBtn, async () => {
      try { await SL.facturePdf.download(f); } catch (e) { msg.textContent = e.message; msg.className = 'form-message error'; }
    }));
    const cb = box.querySelector('[data-versee]');
    if (cb) cb.addEventListener('change', async () => {
      try {
        Object.assign(f, await SL.cloud.factures.update(f.id, { commission_versee: cb.checked }));
        msg.textContent = ''; msg.className = 'form-message';
        SL.u.toast(cb.checked ? 'Commission marquée comme versée.' : 'Commission marquée comme à verser.');
      } catch (e) { cb.checked = !cb.checked; msg.textContent = e.message; msg.className = 'form-message error'; }
    });
    const an = box.querySelector('[data-annuler]');
    if (an) an.addEventListener('click', async () => {
      if (!(await SL.u.confirm("Elle restera dans l'historique, marquée « annulée », et ne sera plus visible par l'école.",
        { title: `Annuler la facture ${f.numero} ?`, ok: 'Annuler la facture', cancel: 'Garder la facture', danger: true }))) return;
      try {
        Object.assign(f, await SL.cloud.factures.update(f.id, { statut: 'annulee' }));
        showDetail(f.id);
      } catch (e) { msg.textContent = e.message; msg.className = 'form-message error'; }
    });
  }

  // ------------------------------------------------------------- coordonnees
  const COORD = ['enseigne', 'nom', 'adresse', 'code_postal', 'ville', 'siret', 'telephone', 'email', 'iban', 'mention_tva', 'conditions'];

  async function showCoordonnees() {
    view('coordonnees');
    const form = $('fac-coord-form');
    try {
      const p = await SL.cloud.parametres.get();
      COORD.forEach(k => { form.elements[k].value = (p && p[k]) || ''; });
      say('fac-c-message', '');
    } catch (e) { say('fac-c-message', e.message, 'error'); }
  }

  async function saveCoordonnees(ev) {
    ev.preventDefault();
    const form = $('fac-coord-form');
    const data = {};
    COORD.forEach(k => { data[k] = form.elements[k].value.trim(); });
    if (data.siret.replace(/\D/g, '').length !== 14) {
      if (!(await SL.u.confirm('Le SIRET doit faire 14 chiffres : le SIREN 842 857 757 suivi de 5 chiffres.',
        { title: 'SIRET incomplet', ok: 'Enregistrer quand même', cancel: 'Corriger' }))) return;
    }
    try {
      await SL.cloud.parametres.save(data);
      say('fac-c-message', 'Coordonnées enregistrées. Elles seront utilisées pour les prochaines factures.', 'ok');
    } catch (e) { say('fac-c-message', e.message, 'error'); }
  }

  // ------------------------------------------------------------- demarrage
  function init() {
    if (!SL.cloud.configured) return;
    if (!ready) {
      ready = true;
      $('fac-new').addEventListener('click', showNouvelle);
      $('fac-to-coord').addEventListener('click', showCoordonnees);
      $('fac-coord-warn-btn').addEventListener('click', showCoordonnees);
      document.querySelectorAll('[data-fac-back]').forEach(b => b.addEventListener('click', showListe));
      $('fac-annee').addEventListener('change', renderListe);
      $('fac-ecole').addEventListener('change', renderListe);
      $('fac-add-ligne').addEventListener('click', () => { $('fac-lignes').appendChild(ligneRow({})); recalc(); });
      $('fac-taux').addEventListener('input', recalc);
      $('fac-n-ecole').addEventListener('change', () => {
        const e = ecoles.find(x => x.id === $('fac-n-ecole').value);
        if (e) $('fac-taux').value = String(Number(e.taux_commission)).replace('.', ',');
        recalc();
      });
      $('fac-form').addEventListener('submit', createFacture);
      $('fac-coord-form').addEventListener('submit', saveCoordonnees);
    }
    showListe();
  }

  // Depuis une seance (V2) : nouvelle facture deja reglee sur l'ecole.
  async function nouvellePour(ecoleId, designation) {
    init();
    await showNouvelle();
    if (ecoleId && [...$('fac-n-ecole').options].some(o => o.value === ecoleId)) {
      $('fac-n-ecole').value = ecoleId;
      $('fac-n-ecole').dispatchEvent(new Event('change'));
    }
    const des = $('fac-lignes').querySelector('.fl-des');
    if (des && designation) des.value = designation;
  }

  return { init, nouvellePour };
})();
