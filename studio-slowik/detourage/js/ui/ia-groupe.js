// IA de groupe (page) : installation du modele (un seul telechargement, verifie, garde hors
// ligne) et calcul des silhouettes dans un calcul en arriere-plan dedie : un seul exemplaire du
// modele en memoire, partage par l'ecran Reglage et le traitement par lot.
// Logiciel installe (page servie par le moteur local, voir moteur/) : l'IA est calculee par le
// moteur (PyTorch, carte NVIDIA, 2048 px) au lieu du navigateur.
SL.dt = SL.dt || {};
SL.dt.iaGroupeClient = (function () {
  const $ = id => document.getElementById(id);
  const CACHE = 'ia-slowik-1';
  let dossier = new URL('ia/birefnet-1/', location.href).href;
  let man = null;          // manifeste du modele
  let installe = null;     // true / false une fois verifie
  let enCours = null;      // installation en cours (Promise)
  let worker = null, n = 0, fournisseur = '';
  const attente = new Map();
  const auditeurs = new Set();
  let moteur = null;       // etat du moteur local (logiciel installe), null sur le site internet
  const BORD_COMPLET = 0.5; // comme ia-groupe-worker.js : fond vert sur au moins la moitie du tour
  // Chaises gardees : HR-matting ; retirees : dynamic (il ne les compte pas comme des personnes).
  const modeleMoteur = chaises => (chaises === 'retirer' ? 'dynamic' : 'hr-matting');

  async function etatMoteur() {
    if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return null;
    try {
      const r = await fetch('/api/etat', { cache: 'no-store' });
      if (!r.ok) return null;
      const e = await r.json();
      return e && e.version ? e : null;
    } catch (e) { return null; }
  }
  const octetsMoteur = () => (moteur ? moteur.modeles.reduce((t, x) => t + x.octets, 0) : 0);

  function signaler() { auditeurs.forEach(f => { try { f(); } catch (e) { /* ecran ferme */ } }); }

  function call(type, args) {
    if (!worker) {
      worker = new Worker('js/worker/ia-groupe-worker.js');
      worker.onmessage = e => {
        const p = attente.get(e.data.id);
        attente.delete(e.data.id);
        if (p) e.data.ok ? p.resolve(e.data.res) : p.reject(new Error(e.data.err));
      };
      worker.onerror = e => {
        e.preventDefault();
        for (const p of attente.values()) p.reject(new Error(e.message || 'IA de groupe : mémoire insuffisante ?'));
        attente.clear();
        worker.terminate();
        worker = null;
      };
    }
    const id = ++n;
    return new Promise((resolve, reject) => { attente.set(id, { resolve, reject }); worker.postMessage({ id, type, args }); });
  }

  async function manifeste() {
    if (!man) {
      const r = await fetch(dossier + 'manifeste.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`modèle introuvable sur le site (${r.status})`);
      man = await r.json();
    }
    return man;
  }

  // Modele complet dans le cache hors ligne (ou modeles du moteur local installes) ?
  async function verifier() {
    moteur = await etatMoteur();
    if (moteur) {
      installe = moteur.modeles.length > 0 && moteur.modeles.every(x => x.installe);
      signaler();
      return installe;
    }
    try {
      const m = await manifeste();
      const cache = await caches.open(CACHE);
      for (const x of m.morceaux) {
        const r = await cache.match(dossier + x.nom, { ignoreSearch: true });
        if (!r || Number(r.headers.get('content-length') || x.taille) !== x.taille) { installe = false; signaler(); return false; }
      }
      installe = true;
    } catch (e) {
      installe = false;
    }
    signaler();
    return installe;
  }

  async function hex(buf) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), b => b.toString(16).padStart(2, '0')).join('');
  }

  // Telechargement morceau par morceau (reprise possible : les morceaux deja verifies restent).
  // progression(fait, total) en octets.
  function installer(progression) {
    if (enCours) return enCours;
    enCours = moteur ? installerMoteur(progression) : (async () => {
      const m = await manifeste();
      const cache = await caches.open(CACHE);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      let fait = 0;
      for (const x of m.morceaux) {
        const url = dossier + x.nom;
        const deja = await cache.match(url, { ignoreSearch: true });
        if (deja && Number(deja.headers.get('content-length')) === x.taille) { fait += x.taille; progression && progression(fait, m.taille); continue; }
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`téléchargement impossible (${r.status})`);
        const parts = [];
        const lecteur = r.body.getReader();
        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          parts.push(value);
          fait += value.length;
          progression && progression(fait, m.taille);
        }
        const blob = new Blob(parts);
        if (blob.size !== x.taille || await hex(await blob.arrayBuffer()) !== x.sha256) {
          await cache.delete(url, { ignoreSearch: true });
          throw new Error('fichier abîmé pendant le téléchargement, relancez l\'installation');
        }
        await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(x.taille) } }));
      }
      const mr = await fetch(dossier + 'manifeste.json', { cache: 'no-cache' });
      if (mr.ok) await cache.put(dossier + 'manifeste.json', mr);
      installe = true;
      signaler();
      return true;
    })();
    enCours.finally(() => { enCours = null; signaler(); }).catch(() => {});
    return enCours;
  }

  // Moteur local : il telecharge et verifie lui-meme les modeles ; la page suit la progression.
  async function installerMoteur(progression) {
    const total = octetsMoteur();
    for (const x of moteur.modeles) {
      if (x.installe) continue;
      await fetch(`/api/installer?modele=${x.id}`, { method: 'POST' });
      for (;;) {
        await new Promise(r => setTimeout(r, 500));
        const e = await etatMoteur();
        if (!e) throw new Error('moteur local arrêté');
        moteur = e;
        const fini = e.modeles.filter(y => y.installe).reduce((t, y) => t + y.octets, 0);
        progression && progression(fini + (e.telechargement ? e.telechargement.fait : 0), total);
        if (!e.telechargement) {
          if (e.modeles.find(y => y.id === x.id).installe) break;
          throw new Error(e.erreur || 'téléchargement interrompu');
        }
      }
    }
    installe = true;
    signaler();
    return true;
  }

  async function masqueMoteur(file, mode, chaises) {
    if (mode === 'auto') {
      const b = await call('bordVert', { file });
      if (b.bordVert >= BORD_COMPLET) return { inutile: true, bordVert: b.bordVert };
    }
    const r = await fetch(`/api/masque?modele=${modeleMoteur(chaises)}&cote=2048`, { method: 'POST', body: file });
    if (!r.ok) {
      let msg = `erreur ${r.status}`;
      try { msg = (await r.json()).erreur || msg; } catch (e) { /* pas de detail */ }
      throw new Error(msg);
    }
    const mw = Number(r.headers.get('X-Largeur')), mh = Number(r.headers.get('X-Hauteur'));
    const u = new Uint16Array(await r.arrayBuffer());
    const m = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) m[i] = u[i] / 65535;
    return { m, mw, mh, ms: Number(r.headers.get('X-Duree-Ms')), passes: 2,
      fournisseur: `${decodeURIComponent(r.headers.get('X-Carte') || '')}, moteur local` };
  }

  async function desinstaller() {
    const m = await manifeste();
    const cache = await caches.open(CACHE);
    for (const x of m.morceaux) await cache.delete(dossier + x.nom, { ignoreSearch: true });
    await cache.delete(dossier + 'manifeste.json', { ignoreSearch: true });
    if (worker) { worker.terminate(); worker = null; }
    installe = false;
    signaler();
  }

  // Silhouette des personnes d'une photo. mode : 'auto' (seulement si le fond vert ne couvre pas
  // tout le cadre) ou 'oui'. Retourne { m, mw, mh, ms, passes, fournisseur }, { inutile: true }
  // (fond vert complet) ou { erreur } ; null si l'IA n'est pas installee ou pas demandee.
  async function masque(file, mode, opts) {
    if (!mode || mode === 'non') return null;
    if (installe === null) await verifier();
    if (!installe) return null;
    try {
      const r = moteur ? await masqueMoteur(file, mode, (opts || {}).chaises) : await call('masque', { file, mode, dossier });
      if (r.fournisseur) fournisseur = r.fournisseur;
      return r;
    } catch (e) {
      return { erreur: e.message || String(e) };
    }
  }

  // Rapport de diagnostic (texte a copier et a envoyer).
  async function diagnostic() {
    const l = [`Studio SLOWIK, détourage — ${new Date().toLocaleString('fr-FR')}`];
    await verifier();
    if (moteur) return diagnosticMoteur(l);
    try { const m = await manifeste(); l.push(`Modèle sur le site : ${mo(m.taille)}, ${m.morceaux.length} morceaux`); } catch (e) { l.push(`Modèle sur le site : ${e.message}`); }
    await verifier();
    l.push(`Installée sur cet ordinateur : ${installe ? 'oui' : 'non'}`);
    try {
      const e = await navigator.storage.estimate();
      l.push(`Stockage du navigateur : ${mo(e.usage || 0)} utilisés sur ${mo(e.quota || 0)}${navigator.storage.persisted ? (await navigator.storage.persisted() ? ', persistant' : ', non persistant') : ''}`);
    } catch (e) { /* inconnu */ }
    if (!installe) return l.join('\n');
    let r;
    try { r = await call('diagnostic', { dossier }); } catch (e) { r = { erreur: e.message, ok: false }; }
    l.push(`Navigateur : ${r.navigateur || '?'}`);
    l.push(`WebGPU : ${r.webgpu ? 'présent' : 'absent'}`);
    if (r.carte) l.push(`Carte graphique : ${r.carte}`);
    if (r.limites) l.push(`Limites : tampon ${mo(r.limites.tampon)}, liaison ${mo(r.limites.liaison)}, ${r.limites.tableaux} tableaux`);
    if (r.modele) l.push(`Modèle : ${r.modele}`);
    if (r.passe) l.push(`Une passe (image de test) : ${r.passe}, sortie ${r.sortie}`);
    if (r.erreur) l.push(`ERREUR : ${r.erreur}`);
    l.push(r.ok ? 'Résultat : l\'IA de groupe fonctionne.' : 'Résultat : l\'IA de groupe ne fonctionne pas.');
    return l.join('\n');
  }

  async function diagnosticMoteur(l) {
    l.push(`Logiciel installé, moteur local version ${moteur.version}`);
    l.push(`Calcul : ${moteur.carte}${moteur.memoire ? ` (${(moteur.memoire / 1073741824).toFixed(1)} Go)` : ''}, ${moteur.appareil}${moteur.test ? ', modèle de test' : ''}`);
    for (const x of moteur.modeles) l.push(`Modèle ${x.nom} : ${x.installe ? 'installé' : 'non installé'}`);
    if (moteur.erreur) l.push(`ERREUR : ${moteur.erreur}`);
    let ok = installe && !moteur.erreur;
    if (installe) {
      const cv = new OffscreenCanvas(640, 427), ctx = cv.getContext('2d');
      ctx.fillStyle = '#9a968f'; ctx.fillRect(0, 0, 640, 427);
      ctx.fillStyle = '#c03040'; ctx.fillRect(260, 160, 120, 230);
      ctx.fillStyle = '#e1af91'; ctx.beginPath(); ctx.arc(320, 120, 45, 0, 7); ctx.fill();
      const file = new File([await cv.convertToBlob({ type: 'image/png' })], 'test.png', { type: 'image/png' });
      for (const ch of ['garder', 'retirer']) {
        try {
          const r = await masqueMoteur(file, 'oui', ch);
          l.push(`Test ${modeleMoteur(ch)} (2 passes, 2048 px) : ${r.ms} ms`);
        } catch (e) { l.push(`ERREUR ${modeleMoteur(ch)} : ${e.message}`); ok = false; }
      }
    }
    l.push(ok ? 'Résultat : l\'IA de groupe fonctionne.' : 'Résultat : l\'IA de groupe ne fonctionne pas.');
    return l.join('\n');
  }

  // ---------------------------------------------------------------------------------
  // Panneau de l'ecran Reglage
  // ---------------------------------------------------------------------------------
  const mo = o => `${Math.round(o / 1e6).toLocaleString('fr-FR')} Mo`;
  function afficher(etat) {
    const el = $('iag-etat');
    if (!el) return;
    const taille = moteur ? mo(octetsMoteur()) : man ? mo(man.taille) : '500 Mo';
    const carte = moteur ? `${moteur.carte}${moteur.memoire ? ` (${Math.round(moteur.memoire / 1073741824)} Go)` : ''}` : '';
    el.textContent = etat || (enCours ? 'Installation de l\'IA de groupe…'
      : moteur && moteur.erreur && !installe ? `Moteur local : ${moteur.erreur}`
        : installe && moteur ? `Logiciel : IA de groupe en 2048 px sur ${carte}. Elle détoure les personnes là où le fond vert ne couvre pas le cadre.`
          : installe ? `IA de groupe installée${fournisseur ? ` (calcul : ${fournisseur})` : ''}. Elle détoure les personnes là où le fond vert ne couvre pas le cadre.`
            : installe === false ? `IA de groupe non installée (${taille} à télécharger une seule fois)${moteur ? `, calcul sur ${carte}` : ''}. Sans elle, seul le fond vert est retiré.`
              : 'IA de groupe : vérification…');
    $('iag-installer').classList.toggle('hidden', !!installe || !!enCours);
    $('iag-installer').textContent = `Installer l'IA de groupe (${taille})`;
    $('iag-retirer').classList.toggle('hidden', !installe || !!enCours || !!moteur);
    $('iag-tester').classList.toggle('hidden', !installe || !!enCours);
    $('iag-progress').classList.toggle('hidden', !enCours);
  }

  function brancher() {
    if (!$('iag-etat')) return;
    auditeurs.add(() => afficher());
    $('iag-installer').addEventListener('click', async () => {
      const bar = $('iag-progress');
      try {
        await installer((fait, total) => { bar.value = fait / total; afficher(`Téléchargement de l'IA de groupe : ${mo(fait)} sur ${mo(total)}…`); });
        SL.u.toast('IA de groupe installée : elle reste sur cet ordinateur, même hors ligne.', 'ok');
      } catch (e) {
        SL.u.toast(`Installation de l'IA de groupe impossible : ${e.message}`, 'error');
      }
    });
    $('iag-tester').addEventListener('click', async () => {
      const out = $('iag-rapport');
      out.classList.remove('hidden');
      out.textContent = 'Test en cours (chargement du modèle puis un calcul)…';
      await SL.u.busy($('iag-tester'), async () => { out.textContent = await diagnostic(); });
      $('iag-copier').classList.remove('hidden');
    });
    $('iag-copier').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('iag-rapport').textContent); SL.u.toast('Rapport copié : collez-le dans votre message.', 'ok'); }
      catch (e) { SL.u.toast('Copie impossible : sélectionnez le texte du rapport et copiez-le.', 'error'); }
    });
    $('iag-retirer').addEventListener('click', async () => {
      if (!(await SL.u.confirm('Désinstaller l\'IA de groupe ? Il faudra la télécharger de nouveau pour détourer hors du fond vert.', { title: 'IA de groupe', ok: 'Désinstaller' }))) return;
      await desinstaller().catch(e => SL.u.toast(e.message, 'error'));
    });
    afficher();
    verifier();
  }

  // Tests : autre dossier du modele.
  function configurer(o) {
    if (o.dossier) { dossier = new URL(o.dossier, location.href).href; man = null; installe = null; }
    if (worker) { worker.terminate(); worker = null; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', brancher);
  else brancher();

  return { masque, installer, desinstaller, verifier, diagnostic, configurer, abonner: f => auditeurs.add(f), estInstalle: () => installe };
})();
