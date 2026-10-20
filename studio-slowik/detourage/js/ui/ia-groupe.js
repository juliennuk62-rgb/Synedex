// IA de groupe (page) : installation du modele (un seul telechargement, verifie, garde hors
// ligne) et calcul des silhouettes dans un calcul en arriere-plan dedie : un seul exemplaire du
// modele en memoire, partage par l'ecran Reglage et le traitement par lot.
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

  // Modele complet dans le cache hors ligne ?
  async function verifier() {
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
    enCours = (async () => {
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
  async function masque(file, mode) {
    if (!mode || mode === 'non') return null;
    if (installe === null) await verifier();
    if (!installe) return null;
    try {
      const r = await call('masque', { file, mode, dossier });
      if (r.fournisseur) fournisseur = r.fournisseur;
      return r;
    } catch (e) {
      return { erreur: e.message || String(e) };
    }
  }

  // ---------------------------------------------------------------------------------
  // Panneau de l'ecran Reglage
  // ---------------------------------------------------------------------------------
  const mo = o => `${Math.round(o / 1e6).toLocaleString('fr-FR')} Mo`;
  function afficher(etat) {
    const el = $('iag-etat');
    if (!el) return;
    const taille = man ? mo(man.taille) : '500 Mo';
    el.textContent = etat || (enCours ? 'Installation de l\'IA de groupe…'
      : installe ? `IA de groupe installée${fournisseur ? ` (calcul : ${fournisseur})` : ''}. Elle détoure les personnes là où le fond vert ne couvre pas le cadre.`
        : installe === false ? `IA de groupe non installée (${taille} à télécharger une seule fois). Sans elle, seul le fond vert est retiré.`
          : 'IA de groupe : vérification…');
    $('iag-installer').classList.toggle('hidden', !!installe || !!enCours);
    $('iag-installer').textContent = `Installer l'IA de groupe (${taille})`;
    $('iag-retirer').classList.toggle('hidden', !installe || !!enCours);
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

  return { masque, installer, desinstaller, verifier, configurer, abonner: f => auditeurs.add(f), estInstalle: () => installe };
})();
