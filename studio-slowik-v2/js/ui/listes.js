// Onglet Listes : photo de la liste de classe → noms et prenoms lus, verifies, enregistres.
// Fonctionne sur telephone : la liste enregistree se retrouve sur l'ordinateur (onglet Renommer).
var SL = self.SL = self.SL || {};
SL.listesUI = (function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;
  const S = {
    revue: null,   // { id?, nom, eleves: [{ nom, prenom, verifier, raison, extrait }] } en cours de verification
    ready: false,
  };

  function progression(part, texte) {
    $('ls-progress').textContent = part >= 1 ? '' : `${texte}… ${Math.round(part * 100)} %`;
  }

  // Extrait de la feuille (la ligne lue), affiche a cote du nom pour comparer.
  function extrait(image, z, hauteur) {
    if (!image || !z) return null;
    const m = (hauteur || 20) * 0.35;
    const x0 = Math.max(0, z.x0 - m * 2), y0 = Math.max(0, z.y0 - m);
    const w = Math.min(image.width, z.x1 + m * 2) - x0, h = Math.min(image.height, z.y1 + m) - y0;
    if (w <= 0 || h <= 0) return null;
    const k = Math.min(1, 56 / h);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    cv.getContext('2d').drawImage(image, x0, y0, w, h, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.8);
  }

  // Photos lues l'une apres l'autre (pages d'une meme liste, dans l'ordre).
  async function lirePhotos(fichiers, ajouter) {
    fichiers = [...fichiers].filter(f => f.type.startsWith('image/') || SL.images.isImage(f.name));
    if (!fichiers.length) return;
    const lus = [];
    let classe = '';
    try {
      for (const [k, f] of fichiers.entries()) {
        const page = fichiers.length > 1 ? ` (photo ${k + 1}/${fichiers.length})` : '';
        const r = await SL.listeOcr.lire(f, (p, t) => progression(p, t + page));
        classe = classe || r.classe;
        r.eleves.forEach(e => lus.push({ nom: e.nom, prenom: e.prenom, verifier: e.verifier, raison: e.raison,
          extrait: extrait(r.image, e.zone, r.hauteur) }));
      }
    } catch (e) {
      progression(1);
      SL.u.alert(`La photo n'a pas pu être lue : ${e.message}`, { title: 'Lecture de la liste' });
      return;
    }
    progression(1);
    if (!lus.length) {
      SL.u.alert('Aucun nom d\'élève trouvé sur cette photo. Reprenez la photo : feuille à plat, bien éclairée, '
        + 'entière et nette (approchez-vous si l\'écriture est petite).', { title: 'Lecture de la liste' });
      return;
    }
    if (ajouter && S.revue) S.revue.eleves.push(...lus);
    else S.revue = { nom: classe || `Liste du ${new Date().toLocaleDateString('fr-FR')}`, eleves: lus };
    afficherRevue();
  }

  function afficherRevue() {
    const R = S.revue;
    $('ls-revue').classList.toggle('hidden', !R);
    $('ls-lire').classList.toggle('hidden', !!R);
    if (!R) return;
    $('ls-nom').value = R.nom;
    const n = R.eleves.length, av = R.eleves.filter(e => e.verifier).length;
    $('ls-resume').textContent = `${n} élève(s)` + (av ? ` — ${av} à vérifier (en orange) : comparez avec l'extrait de la feuille, corrigez si besoin puis cliquez ✓.`
      : ' — tout a été lu avec assurance. Un coup d\'œil reste conseillé.');
    $('ls-resume').className = av ? 'hint warn-text' : 'hint';
    $('ls-table').innerHTML = html`<table class="fac-table ls-table"><thead><tr><th>N°</th><th>Sur la feuille</th><th>Nom</th><th>Prénom</th><th></th></tr></thead><tbody>
      ${R.eleves.map((e, i) => html`<tr class="${e.verifier ? 'ls-verifier' : ''}" data-i="${i}">
        <td data-label="N°">${i + 1}</td>
        <td data-label="Sur la feuille">${e.extrait ? html`<img class="ls-extrait" src="${e.extrait}" alt="">` : ''}</td>
        <td data-label="Nom"><input type="text" data-champ="nom" value="${e.nom}" aria-label="Nom de l'élève ${i + 1}">
          ${e.verifier && e.raison ? html`<span class="ls-raison">${e.raison}</span>` : ''}</td>
        <td data-label="Prénom"><input type="text" data-champ="prenom" value="${e.prenom}" aria-label="Prénom de l'élève ${i + 1}"></td>
        <td class="ls-actions">
          ${e.verifier ? html`<button class="btn small secondary" data-act="ok" title="Vérifié">✓</button>` : ''}
          <button class="btn small secondary" data-act="inserer" title="Insérer un élève au-dessus">+</button>
          <button class="btn small secondary" data-act="suppr" title="Supprimer cette ligne">✕</button></td>
      </tr>`)}</tbody></table>`;
  }

  async function enregistrerRevue() {
    const R = S.revue;
    R.nom = $('ls-nom').value.trim();
    const vides = R.eleves.map((e, i) => (!e.nom.trim() && !e.prenom.trim() ? i + 1 : 0)).filter(Boolean);
    if (vides.length) {
      SL.u.alert(`Ligne(s) ${vides.join(', ')} sans nom : complétez-les ou supprimez-les (✕).`, { title: 'Liste incomplète' });
      return;
    }
    if (!R.eleves.length) return;
    const av = R.eleves.filter(e => e.verifier).length;
    if (av && !(await SL.u.confirm(`${av} élève(s) encore à vérifier (en orange). Enregistrer quand même ?`,
      { title: 'Vérification', ok: 'Enregistrer' }))) return;
    await SL.listes.enregistrer({ id: R.id, nom: R.nom, eleves: R.eleves });
    SL.u.toast(`Liste « ${R.nom || 'sans nom'} » enregistrée (${R.eleves.length} élèves).`, 'ok');
    S.revue = null;
    afficherRevue();
  }

  async function afficherListes() {
    const box = $('ls-liste');
    if (!box) return;
    $('ls-sync').textContent = SL.listes.message();
    const listes = await SL.listes.toutes();
    const renommer = !document.querySelector('#tabs .tab[data-tab=renommer]').classList.contains('hidden');
    box.innerHTML = listes.length ? html`${listes.map(l => html`<div class="ls-carte" data-id="${l.id}">
        <div class="ls-titre"><strong>${l.nom}</strong><span class="muted">${l.eleves.length} élève(s) · ${new Date(l.updated).toLocaleDateString('fr-FR')}</span></div>
        <div class="ls-boutons">
          ${renommer ? html`<button class="btn small primary" data-act="renommer">Renommer les photos</button>` : ''}
          <button class="btn small secondary" data-act="modifier">Voir / modifier</button>
          <button class="btn small secondary" data-act="copier">Copier</button>
          <button class="btn small secondary" data-act="supprimer">Supprimer</button>
        </div></div>`)}`
      : html`<p class="hint">Aucune liste pour l'instant.</p>`;
  }

  async function actionListe(act, id) {
    const l = await SL.listes.get(id);
    if (!l) return;
    if (act === 'modifier') {
      S.revue = { id: l.id, nom: l.nom, eleves: l.eleves.map(e => ({ nom: e.nom, prenom: e.prenom })) };
      afficherRevue();
      $('ls-revue').scrollIntoView({ behavior: 'smooth' });
    } else if (act === 'copier') {
      try {
        await navigator.clipboard.writeText(SL.listes.texte(l, 'np'));
        SL.u.toast('Liste copiée : collez-la où vous voulez.', 'ok');
      } catch (e) { SL.u.toast('Copie impossible sur cet appareil.', 'error'); }
    } else if (act === 'supprimer') {
      if (await SL.u.confirm(`Supprimer la liste « ${l.nom} » (${l.eleves.length} élèves) sur tous vos appareils ?`,
        { title: 'Supprimer la liste', ok: 'Supprimer', danger: true })) await SL.listes.supprimer(id);
    } else if (act === 'renommer') {
      document.querySelector('#tabs .tab[data-tab=renommer]').click();
      SL.renommageUI.utiliserListe(id);
    }
  }

  function init() {
    SL.listes.synchroniser();
    afficherListes();
    if (S.ready) return;
    S.ready = true;
    const lire = ajouter => e => { const f = e.target.files; lirePhotos(f, ajouter).finally(() => { e.target.value = ''; }); };
    $('ls-photo').addEventListener('change', lire(false));
    $('ls-fichiers').addEventListener('change', lire(false));
    $('ls-page').addEventListener('change', lire(true));
    const zone = $('page-listes');
    zone.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    zone.addEventListener('drop', e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      lirePhotos(e.dataTransfer.files, !!S.revue);
    });
    $('ls-table').addEventListener('input', e => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr || !e.target.dataset.champ) return;
      S.revue.eleves[+tr.dataset.i][e.target.dataset.champ] = e.target.value;
    });
    $('ls-table').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const i = +b.closest('tr').dataset.i, E = S.revue.eleves;
      if (b.dataset.act === 'ok') E[i].verifier = false;
      if (b.dataset.act === 'suppr') E.splice(i, 1);
      if (b.dataset.act === 'inserer') E.splice(i, 0, { nom: '', prenom: '', verifier: true, raison: 'ajouté à la main' });
      afficherRevue();
    });
    $('ls-ajouter').addEventListener('click', () => {
      S.revue.eleves.push({ nom: '', prenom: '', verifier: true, raison: 'ajouté à la main' });
      afficherRevue();
      const ins = $('ls-table').querySelectorAll('input[data-champ=nom]');
      ins[ins.length - 1].focus();
    });
    $('ls-nom').addEventListener('input', e => { S.revue.nom = e.target.value; });
    $('ls-enregistrer').addEventListener('click', () => SL.u.busy($('ls-enregistrer'), enregistrerRevue));
    $('ls-abandonner').addEventListener('click', async () => {
      if (await SL.u.confirm('Abandonner cette liste ? Les corrections seront perdues.', { title: 'Annuler', ok: 'Abandonner', danger: true })) {
        S.revue = null;
        afficherRevue();
      }
    });
    $('ls-liste').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (b) actionListe(b.dataset.act, b.closest('[data-id]').dataset.id);
    });
    SL.listes.onChange(afficherListes);
  }

  return { init, lirePhotos, etat: S };
})();
