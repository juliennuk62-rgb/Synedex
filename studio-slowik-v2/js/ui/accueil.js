// Accueil (V2) : les etapes d'une ecole dans l'ordre du travail, ce que l'on peut reprendre, les ecoles.
var SL = self.SL = self.SL || {};
SL.accueilUI = (function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;

  // Les etapes d'une ecole, dans l'ordre (onglet de cette page ou page Detourage).
  const ETAPES = [
    { tab: 'listes', titre: "Listes d'élèves", texte: 'Photographier la liste de la classe : noms et prénoms lus automatiquement.' },
    { tab: 'detourage', titre: 'Détourage', texte: 'Fond vert retiré sur toute la séance, photos à revoir signalées.' },
    { tab: 'compositeur', titre: 'Individuels sur fonds', texte: 'Chaque portrait sur chaque fond, numérotés.' },
    { tab: 'classe', titre: 'Photo de classe', texte: 'Groupes sur les fonds de classe, 24 × 18 cm, école et année.' },
    { tab: 'planche', titre: 'Planche contact', texte: 'Un PDF de vignettes par classe.' },
    { tab: 'choix', titre: 'Choix des fonds', texte: "Les familles ou l'école choisissent les fonds des photos de classe." },
    { tab: 'facturation', titre: 'Facture', texte: "La facture de l'école et sa commission." },
  ];

  const onglet = t => document.querySelector(`#tabs .tab[data-tab=${t}]`);
  const visible = t => { const o = onglet(t); return !!o && !o.classList.contains('hidden'); };
  const aller = t => { const o = onglet(t); if (o) o.click(); };

  function saison() {
    const d = new Date(), y = d.getFullYear(), debut = d.getMonth() >= 8 ? y : y - 1;
    return { libelle: `${debut}-${debut + 1}`, depuis: `${debut}-09-01` };
  }

  function entete() {
    const h = new Date().getHours();
    $('ac-titre').textContent = h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour';
    $('ac-saison').textContent = `Saison ${saison().libelle} · ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  }

  function etapes() {
    const liste = ETAPES.filter(e => visible(e.tab));
    $('ac-etapes').innerHTML = html`${liste.map((e, i) => html`
      <li><button type="button" class="ac-etape" data-aller="${e.tab}">
        <span class="ac-num">${i + 1}</span>
        <span class="ac-txt"><strong>${e.titre}</strong><span class="hint">${e.texte}</span></span>
      </button></li>`)}`;
  }

  async function reprendre() {
    const blocs = [];
    // seances (une ecole, une annee) : en premier
    if (visible('seances')) {
      (await SL.seances.toutes()).slice(0, 3).forEach(s => blocs.push(html`<button type="button" class="ac-carte" data-seance="${s.id}">
        <span class="ac-type">Séance ${s.annee}</span><strong>${s.ecole.nom || 'École sans nom'}</strong>
        <span class="hint">${s.resume || ''}</span></button>`));
    }
    // projets recents des individuels sur fonds (dossiers deja choisis)
    if (visible('compositeur')) {
      const projets = (await SL.store.loadProjects()).slice(0, 3);
      projets.forEach((p, i) => blocs.push(html`<button type="button" class="ac-carte" data-projet="${i}">
        <span class="ac-type">Individuels sur fonds</span><strong>${p.name || (p.sources && p.sources.name) || 'Projet sans nom'}</strong>
        <span class="hint">${p.date || ''}</span></button>`));
    }
    const listes = (await SL.listes.toutes()).slice(0, 3);
    listes.forEach(l => blocs.push(html`<button type="button" class="ac-carte" data-aller="listes">
      <span class="ac-type">Liste d'élèves</span><strong>${l.nom}</strong>
      <span class="hint">${l.eleves.length} élève(s) · ${new Date(l.updated).toLocaleDateString('fr-FR')}</span></button>`));
    $('ac-reprendre').innerHTML = blocs.length ? html`${blocs}` : html`<p class="hint">Rien à reprendre pour l'instant : tes derniers projets et listes apparaîtront ici.</p>`;
  }

  // Ecoles actives, avec leurs factures de la saison (compte connecte).
  async function ecoles() {
    const box = $('ac-ecoles');
    if (!visible('ecoles')) {
      box.innerHTML = html`<p class="hint">${SL.cloud.configured ? 'Connecte-toi pour voir tes écoles ici.' : 'Base en ligne non configurée.'}</p>`;
      return;
    }
    box.innerHTML = html`<p class="hint">Chargement…</p>`;
    try {
      const [liste, factures] = await Promise.all([SL.cloud.ecoles.list(), SL.cloud.factures.list().catch(() => [])]);
      const { depuis, libelle } = saison();
      const actives = liste.filter(e => !e.archivee);
      if (!actives.length) { box.innerHTML = html`<p class="hint">Aucune école pour l'instant.</p>`; return; }
      const parEcole = new Map();
      factures.filter(f => f.statut === 'emise' && String(f.date_facture) >= depuis)
        .forEach(f => parEcole.set(f.ecole_id, (parEcole.get(f.ecole_id) || []).concat(f)));
      const seances = visible('seances') ? (await SL.seances.toutes()).filter(s => s.annee === libelle) : [];
      box.innerHTML = html`<table class="fac-table ac-ecoles"><thead><tr><th>École</th><th>Ville</th><th>Factures ${libelle}</th><th>Séance ${libelle}</th><th></th></tr></thead><tbody>
        ${actives.map(e => {
          const fs = parEcole.get(e.id) || [];
          const total = fs.reduce((s, f) => s + Number(f.ca || 0), 0);
          return html`<tr><td data-label="École"><strong>${e.nom}</strong></td><td data-label="Ville">${e.ville || ''}</td>
            <td data-label="Factures">${fs.length ? `${fs.length} · ${SL.u.euros(total)}` : html`<span class="muted">aucune</span>`}</td>
            <td data-label="Séance">${visible('seances') ? suiviCellule(seances.find(s => s.ecole.id === e.id), e.id) : ''}</td>
            <td><button type="button" class="btn small secondary" data-ecole="${e.id}">Fiche</button></td></tr>`;
        })}</tbody></table>`;
    } catch (e) {
      box.innerHTML = html`<p class="hint">Écoles indisponibles : ${e.message}</p>`;
    }
  }

  // Ou en est la seance de l'ecole : triee, detouree, choix des fonds, preparee.
  function suiviCellule(s, ecoleId) {
    if (!s) return html`<button type="button" class="btn small secondary" data-seance-ecole="${ecoleId}">Créer</button>`;
    const v = s.suivi || {};
    const puce = (ok, texte) => html`<span class="ac-puce ${ok ? 'ok' : ''}">${texte}</span>`;
    return html`<div class="ac-suivi">
      ${v.classes ? html`${puce(v.triees === v.classes, `Tri ${v.triees}/${v.classes}`)}${puce(v.portraits && v.faits === v.portraits, `Détourage ${v.faits}/${v.portraits}`)}${v.choixEnvoyes ? puce(v.choixFaits === v.choixEnvoyes, `Choix ${v.choixFaits}/${v.choixEnvoyes}`) : ''}${v.preparee ? puce(true, 'Préparée') : ''}`
        : puce(false, 'À trier')}
      <button type="button" class="btn small primary" data-seance-ecole="${ecoleId}">Ouvrir</button></div>`;
  }

  // Ouvre la fiche d'une ecole dans l'onglet Ecoles (une fois sa liste affichee).
  async function ficheEcole(id) {
    aller('ecoles');
    for (let k = 0; k < 40; k++) {
      const b = document.querySelector(`#ecoles-list .list-item[data-id="${id}"]`);
      if (b) { b.click(); return; }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  let pret = false;
  function init() {
    entete();
    etapes();
    reprendre().catch(() => {});
    ecoles();
    if (pret) return;
    pret = true;
    $('page-accueil').addEventListener('click', e => {
      const b = e.target.closest('[data-aller], [data-projet], [data-ecole], [data-seance], [data-seance-ecole]');
      if (!b) return;
      if (b.tagName === 'A') e.preventDefault();
      if (b.dataset.seance) { aller('seances'); SL.seancesUI.ouvrir(b.dataset.seance); }
      else if (b.dataset.seanceEcole) { aller('seances'); SL.seancesUI.pourEcole(b.dataset.seanceEcole); }
      else if (b.dataset.aller) aller(b.dataset.aller);
      else if (b.dataset.ecole) ficheEcole(b.dataset.ecole);
      else if (b.dataset.projet !== undefined) {
        // projet recent : rouvert dans les individuels sur fonds (meme chemin que « Projets recents »)
        aller('compositeur');
        const sel = $('history');
        sel.value = b.dataset.projet;
        sel.dispatchEvent(new Event('change'));
      }
    });
  }

  return { init };
})();
