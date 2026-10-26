// Onglet Renommer : chaque photo prend le nom de la liste, dans l'ordre (photo 1 = 1er nom...).
// Les fichiers sont renommes sur place (Chrome / Edge). Jamais d'ecrasement d'un autre fichier
// (move() ecrase sans prevenir : le dossier est toujours verifie avant), et le dernier renommage
// peut etre annule.
var SL = self.SL = self.SL || {};
SL.renommageUI = (function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;
  const ordre = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  const S = {
    dir: null,          // dossier choisi (renommage dans ce dossier)
    photos: [],         // [{ name, handle, dir }] triees par nom (dir inconnu pour des photos deposees)
    annuler: null,      // [{ p, de, vers }] du dernier renommage
    urls: [],
    ready: false,
  };

  // Liste collee : une ligne par eleve ; colonnes d'un tableur (tabulations) reunies par un espace.
  function noms() {
    return $('rn-liste').value.split(/\r?\n/)
      .map(l => l.split('\t').map(c => c.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' '))
      .filter(Boolean);
  }

  // Nouveaux noms : nom nettoye (caracteres interdits par Windows), extension d'origine, numero
  // devant si demande, (2), (3)... pour deux eleves du meme nom.
  function cibles() {
    const liste = noms(), vus = new Map(), num = $('rn-numero').checked;
    const n = Math.min(liste.length, S.photos.length), w = String(n).length < 2 ? 2 : String(n).length;
    const out = [];
    for (let i = 0; i < n; i++) {
      let base = SL.naming.clean(liste[i]) || `Photo ${i + 1}`;
      if (num) base = `${String(i + 1).padStart(w, '0')} ${base}`;
      const ext = SL.naming.extension(S.photos[i].name);
      const cle = (base + ext).toLowerCase();
      const k = (vus.get(cle) || 0) + 1;
      vus.set(cle, k);
      out.push(k > 1 ? `${base} (${k})${ext}` : base + ext);
    }
    return out;
  }

  async function definirPhotos(liste, dir) {
    S.urls.forEach(u => URL.revokeObjectURL(u));
    S.urls = [];
    S.dir = dir || null;
    S.photos = liste.filter(p => SL.images.isImage(p.name)).sort((a, b) => ordre.compare(a.name, b.name));
    S.annuler = null;
    $('rn-dossier').textContent = dir ? dir.name : `${S.photos.length} photo(s) déposée(s)`;
    $('rn-dossier').classList.toggle('set', S.photos.length > 0);
    afficher();
  }

  async function setFolder(dir) {
    const liste = [];
    for await (const [name, h] of dir.entries()) if (h.kind === 'file') liste.push({ name, handle: h, dir });
    await definirPhotos(liste, dir);
  }

  async function choisirDossier() {
    try {
      await setFolder(await SL.fsa.pick('slowik-renommage', true));
    } catch (e) {
      if (e.name !== 'AbortError') SL.u.toast(`Dossier illisible : ${e.message}`, 'error');
    }
  }

  // Photos glissees depuis l'Explorateur : on garde leur acces sur le disque pour les renommer.
  async function deposer(e) {
    e.preventDefault();
    $('rn-zone').classList.remove('over');
    const items = [...e.dataTransfer.items].filter(i => i.kind === 'file');
    if (!items.length || !items[0].getAsFileSystemHandle) {
      SL.u.toast('Glisser-déposer : utilisez Chrome ou Edge, ou le bouton « Choisir le dossier ».', 'error');
      return;
    }
    const handles = await Promise.all(items.map(i => i.getAsFileSystemHandle()));
    const dossier = handles.find(h => h && h.kind === 'directory');
    if (dossier) { await setFolder(dossier); return; }
    await definirPhotos(handles.filter(h => h && h.kind === 'file').map(h => ({ name: h.name, handle: h, dir: null })), null);
  }

  function afficher() {
    const liste = noms(), c = cibles();
    const np = S.photos.length, nl = liste.length;
    const etat = $('rn-etat');
    etat.className = 'hint';
    if (!np && !nl) etat.textContent = 'Choisissez les photos et collez la liste des élèves.';
    else if (!np) etat.textContent = `${nl} nom(s) dans la liste : choisissez les photos.`;
    else if (!nl) etat.textContent = `${np} photo(s) : collez la liste des élèves (un nom par ligne).`;
    else if (np === nl) { etat.textContent = `${np} photos, ${nl} noms : tout correspond.`; etat.className = 'hint ok-text'; }
    else { etat.textContent = `Attention : ${np} photo(s) mais ${nl} nom(s). Seules les ${Math.min(np, nl)} premières seront renommées.`; etat.className = 'hint error-text'; }
    $('rn-go').disabled = !np || !nl;
    $('rn-annuler').classList.toggle('hidden', !S.annuler);
    const lignes = Math.max(np, nl);
    $('rn-apercu').innerHTML = lignes ? html`
      <table class="fac-table rn-table"><thead><tr><th>N°</th><th>Photo</th><th>Nom actuel</th><th>Nouveau nom</th></tr></thead><tbody>
      ${Array.from({ length: lignes }, (_, i) => {
        const p = S.photos[i];
        return html`<tr class="${!p || !c[i] ? 'rn-manque' : ''}"><td data-label="N°">${i + 1}</td>
          <td data-label="Photo">${p ? html`<img class="rn-vignette" data-i="${i}" alt="">` : ''}</td>
          <td data-label="Nom actuel">${p ? p.name : '— (pas de photo)'}</td>
          <td data-label="Nouveau nom">${c[i] || (p ? '— (pas de nom)' : liste[i])}</td></tr>`;
      })}</tbody></table>` : '';
    vignettes();
  }

  // Vignettes : pour verifier d'un coup d'oeil que l'eleve correspond au nom.
  async function vignette(p) {
    const bmp = await SL.images.decode(await p.handle.getFile(), 160);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const url = URL.createObjectURL(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8)));
    S.urls.push(url);
    return url;
  }

  async function vignettes() {
    for (const img of $('rn-apercu').querySelectorAll('.rn-vignette')) {
      const p = S.photos[+img.dataset.i];
      if (!p) continue;
      p.vignette = p.vignette || vignette(p);  // une seule lecture, meme si le tableau est redessine
      try {
        const url = await p.vignette;
        if (img.isConnected) img.src = url;
      } catch (e) { /* photo illisible : pas de vignette */ }
    }
  }

  // Noms deja presents dans les dossiers (Windows ne distingue pas majuscules et minuscules).
  const cle = nom => nom.normalize('NFC').toLowerCase();
  async function nomsPris(dirs) {
    const pris = new Map();
    for (const dir of new Set(dirs)) {
      const set = new Set();
      for await (const nom of dir.keys()) set.add(cle(nom));
      pris.set(dir, set);
    }
    return pris;
  }

  // Photos deposees une par une : on ne connait pas leur dossier. Il est demande pour verifier
  // qu'aucun autre fichier ne porte deja un nouveau nom.
  async function dossierDesPhotos(lot) {
    const sans = lot.filter(p => !p.dir);
    if (!sans.length) return true;
    if (!(await SL.u.confirm('Pour être sûr de n\'écraser aucune autre photo, indiquez le dossier qui contient ces photos.',
      { title: 'Dossier des photos', ok: 'Choisir le dossier' }))) return false;
    let dir;
    try {
      dir = await self.showDirectoryPicker({ id: 'slowik-renommage', mode: 'readwrite', startIn: sans[0].handle });
    } catch (e) {
      if (e.name !== 'AbortError') SL.u.toast(`Dossier illisible : ${e.message}`, 'error');
      return false;
    }
    for (const p of sans) {
      const chemin = await dir.resolve(p.handle);
      if (!chemin || chemin.length !== 1) {
        SL.u.alert(`La photo « ${p.name} » n'est pas dans le dossier « ${dir.name} ». Choisissez le dossier qui contient les photos.`, { title: 'Dossier des photos' });
        return false;
      }
    }
    sans.forEach(p => { p.dir = dir; });
    return true;
  }

  // Renommage en deux temps (noms provisoires puis definitifs) : deux photos peuvent echanger
  // leurs noms sans s'ecraser. Un autre fichier du dossier portant deja un nouveau nom n'est jamais
  // ecrase : la photo prend « nom (2) ».
  async function renommer() {
    const c = cibles(), n = c.length;
    const liste = noms();
    if (S.photos.length !== liste.length && !(await SL.u.confirm(
      `${S.photos.length} photo(s) et ${liste.length} nom(s) : seules les ${n} premières photos seront renommées. Continuer ?`,
      { title: 'Nombres différents', ok: 'Renommer' }))) return;
    if (typeof S.photos[0].handle.move !== 'function') {
      SL.u.alert('Le renommage des fichiers demande Google Chrome ou Microsoft Edge à jour.', { title: 'Navigateur' });
      return;
    }
    const lot = S.photos.slice(0, n);
    if (!(await dossierDesPhotos(lot))) return;
    // une seule demande d'acces par dossier (et non une par photo)
    for (const dir of new Set(lot.map(p => p.dir))) {
      if (!(await SL.fsa.requestPermission(dir, true).catch(() => false))) {
        SL.u.toast('Accès en écriture refusé : les photos ne peuvent pas être renommées.', 'error');
        return;
      }
    }
    const fait = [];
    const etape = Date.now().toString(36);
    try {
      for (let i = 0; i < n; i++) {
        const p = lot[i], tmp = `~slowik-${etape}-${i}${SL.naming.extension(p.name)}`;
        await p.handle.move(tmp);
        fait.push({ p, de: p.name, tmp });
      }
      // les photos portent leur nom provisoire : seuls les autres fichiers occupent encore un nom
      const pris = await nomsPris(lot.map(p => p.dir));
      for (let i = 0; i < n; i++) {
        const f = fait[i], occupes = pris.get(f.p.dir);
        let nom = c[i];
        for (let k = 2; occupes.has(cle(nom)); k++) nom = `${SL.naming.stem(c[i])} (${k})${SL.naming.extension(c[i])}`;
        occupes.add(cle(nom));
        await f.p.handle.move(nom);
        f.vers = nom;
        f.p.name = nom;
      }
    } catch (e) {
      // retour en arriere : chaque photo deja touchee reprend son nom d'origine
      for (const f of fait.reverse()) { try { await f.p.handle.move(f.de); f.p.name = f.de; } catch (e2) { /* laisse le nom provisoire */ } }
      SL.u.toast(`Renommage interrompu, noms d'origine remis : ${e.message}`, 'error');
      afficher();
      return;
    }
    S.annuler = fait.map(f => ({ p: f.p, de: f.de, vers: f.vers }));
    SL.u.toast(`${n} photo(s) renommée(s).`, 'ok');
    // l'ordre affiche reste celui du renommage (meme si les nouveaux noms ne sont pas alphabetiques)
    S.photos = [...lot, ...S.photos.slice(n)];
    afficher();
  }

  async function annuler() {
    if (!S.annuler) return;
    const etape = Date.now().toString(36);
    const actuels = new Set(S.annuler.map(a => cle(a.vers)));
    const pris = await nomsPris(S.annuler.map(a => a.p.dir));
    for (const a of S.annuler) {
      if (!actuels.has(cle(a.de)) && pris.get(a.p.dir).has(cle(a.de))) {
        SL.u.alert(`Un autre fichier s'appelle maintenant « ${a.de} » : annulation impossible sans l'écraser.`, { title: 'Annulation' });
        return;
      }
    }
    try {
      for (const [i, a] of S.annuler.entries()) await a.p.handle.move(`~slowik-${etape}-${i}${SL.naming.extension(a.de)}`);
      for (const a of S.annuler) { await a.p.handle.move(a.de); a.p.name = a.de; }
      SL.u.toast('Renommage annulé : les photos ont repris leur nom d\'origine.', 'ok');
    } catch (e) {
      SL.u.toast(`Annulation impossible : ${e.message}`, 'error');
    }
    S.annuler = null;
    S.photos.sort((a, b) => ordre.compare(a.name, b.name));
    afficher();
  }

  // Listes enregistrees (onglet Listes d'eleves, aussi lues sur le telephone) : menu au-dessus de la liste.
  const ORDRE = 'slowik.renommage.ordre';
  async function menuListes() {
    const sel = $('rn-listes'), choisie = sel.value;
    const listes = await SL.listes.toutes();
    sel.innerHTML = html`<option value="">${listes.length ? '— choisir (ou coller ci-dessous) —' : '— aucune liste enregistrée —'}</option>
      ${listes.map(l => html`<option value="${l.id}">${l.nom} (${l.eleves.length})</option>`)}`;
    if (listes.some(l => l.id === choisie)) sel.value = choisie;
  }

  async function utiliserListe(id) {
    const l = await SL.listes.get(id);
    if (!l) return;
    await menuListes();
    $('rn-listes').value = id;
    $('rn-liste').value = SL.listes.texte(l, $('rn-ordre').value);
    afficher();
  }

  function init() {
    SL.listes.synchroniser();
    menuListes();
    if (S.ready) return;
    S.ready = true;
    try { $('rn-ordre').value = localStorage.getItem(ORDRE) || 'np'; } catch (e) { /* stockage bloque */ }
    $('rn-listes').addEventListener('change', e => { if (e.target.value) utiliserListe(e.target.value); });
    $('rn-ordre').addEventListener('change', e => {
      try { localStorage.setItem(ORDRE, e.target.value); } catch (err) { /* stockage bloque */ }
      if ($('rn-listes').value) utiliserListe($('rn-listes').value);
    });
    $('rn-vers-listes').addEventListener('click', e => { e.preventDefault(); document.querySelector('#tabs .tab[data-tab=listes]').click(); });
    SL.listes.onChange(menuListes);
    $('rn-pick').addEventListener('click', choisirDossier);
    $('rn-pick').disabled = !SL.fsa.supported;
    const zone = $('rn-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => deposer(e).catch(err => SL.u.toast(err.message, 'error')));
    $('rn-liste').addEventListener('input', afficher);
    $('rn-numero').addEventListener('change', afficher);
    $('rn-go').addEventListener('click', () => SL.u.busy($('rn-go'), renommer));
    $('rn-annuler').addEventListener('click', () => SL.u.busy($('rn-annuler'), annuler));
    afficher();
  }

  return { init, setFolder, utiliserListe, etat: S };
})();
