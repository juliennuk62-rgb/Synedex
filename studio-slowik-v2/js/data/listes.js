// Listes d'eleves enregistrees (lues sur une photo ou collees) : gardees sur l'appareil et, une fois
// connecte, dans votre base en ligne (la liste photographiee avec le telephone se retrouve sur
// l'ordinateur). En cas de modification sur deux appareils, la plus recente gagne.
var SL = self.SL = self.SL || {};
SL.listes = (function () {
  const CLE = 'listes';
  const TABLE = 'listes_eleves';
  let enLigne = false;
  let enCours = false;
  let encore = false;
  let etat = { state: 'off' };
  const ecouteurs = [];

  const avertir = () => ecouteurs.forEach(f => { try { f(); } catch (e) { /* ecran ferme */ } });
  const changerEtat = e => { etat = e; avertir(); };

  async function lireTout() {
    try { return (await SL.store.idbGet(CLE)) || []; } catch (e) { return []; }
  }

  // Listes visibles, la plus recente en tete.
  async function toutes() {
    return (await lireTout()).filter(x => !x.deleted).sort((a, b) => b.updated - a.updated);
  }

  async function get(id) {
    return (await lireTout()).find(x => x.id === id && !x.deleted) || null;
  }

  // Ecrit en gardant, pour chaque liste, la version la plus recente (un enregistrement peut arriver
  // pendant une synchronisation).
  async function fusionner(nouvelles) {
    const parId = new Map((await lireTout()).map(x => [x.id, x]));
    for (const n of nouvelles) {
      const a = parId.get(n.id);
      if (!a || n.updated > a.updated || (n.updated === a.updated && a.dirty && !n.dirty)) parId.set(n.id, n);
    }
    await SL.store.idbSet(CLE, [...parId.values()]);
  }

  const nouvelId = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // liste : { id?, nom, eleves: [{ nom, prenom }] }
  async function enregistrer(liste) {
    const ancienne = liste.id ? (await lireTout()).find(x => x.id === liste.id) : null;
    const maintenant = Date.now();
    const rec = {
      id: liste.id || nouvelId(), nom: String(liste.nom || '').trim() || 'Liste sans nom',
      eleves: liste.eleves.map(e => ({ nom: String(e.nom || '').trim(), prenom: String(e.prenom || '').trim() })),
      created: ancienne ? ancienne.created : maintenant,
      updated: Math.max(maintenant, ancienne ? ancienne.updated + 1 : 0), deleted: false, dirty: true,
    };
    await fusionner([rec]);
    avertir();
    synchroniser();
    return rec;
  }

  async function supprimer(id) {
    const a = (await lireTout()).find(x => x.id === id);
    if (!a) return;
    await fusionner([Object.assign({}, a, { deleted: true, updated: Math.max(Date.now(), a.updated + 1), dirty: true })]);
    avertir();
    synchroniser();
  }

  // Noms prets pour un nom de fichier : « NOM Prénom » (ordre 'np') ou « Prénom NOM » ('pn').
  const texte = (liste, ordre) => liste.eleves
    .map(e => (ordre === 'pn' ? [e.prenom, e.nom] : [e.nom, e.prenom]).filter(Boolean).join(' ')).join('\n');

  async function synchroniser() {
    if (!enLigne) return;
    if (enCours) { encore = true; return; }
    enCours = true;
    changerEtat({ state: 'running' });
    try {
      const client = SL.cloud.client();
      const res = await client.from(TABLE).select('*');
      if (res.error) throw res.error;
      const distant = new Map(res.data.map(r => [r.id, r]));
      const recues = [];
      for (const r of res.data) {
        recues.push({ id: r.id, nom: r.nom, eleves: r.eleves || [], created: r.created, updated: Number(r.updated), deleted: !!r.deleted, dirty: false });
      }
      await fusionner(recues);
      for (const x of await lireTout()) {
        const r = distant.get(x.id);
        if (!x.dirty && r && Number(r.updated) >= x.updated) continue;
        const env = await client.from(TABLE).upsert({ id: x.id, nom: x.nom, eleves: x.eleves, created: x.created || null,
          updated: x.updated, deleted: !!x.deleted }, { onConflict: 'id' });
        if (env.error) throw env.error;
        await fusionner([Object.assign({}, x, { dirty: false })]);
      }
      changerEtat({ state: 'ok', at: new Date() });
    } catch (e) {
      const m = String((e && e.message) || e);
      if (/listes_eleves|does not exist|Could not find the table/i.test(m)) changerEtat({ state: 'absent' });
      else if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(m)) changerEtat({ state: 'offline' });
      else changerEtat({ state: 'error', msg: SL.cloud.message(e) });
    } finally {
      enCours = false;
      if (encore) { encore = false; synchroniser(); }
    }
  }

  let ecoute = false;
  function connecter(oui) {
    enLigne = !!oui;
    if (!enLigne) { changerEtat({ state: 'off' }); return; }
    if (!ecoute) {
      ecoute = true;
      window.addEventListener('online', () => synchroniser());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchroniser(); });
    }
    synchroniser();
  }

  // Phrase d'etat pour l'ecran.
  function message() {
    const h = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return {
      off: SL.cloud.configured ? 'Enregistrées sur cet appareil (connectez-vous pour les retrouver sur l\'ordinateur et le téléphone).'
        : 'Enregistrées sur cet appareil.',
      running: 'Synchronisation…',
      ok: `Synchronisées avec vos autres appareils${etat.at ? ' à ' + h(etat.at) : ''}.`,
      offline: 'Hors ligne : les listes seront envoyées au retour d\'Internet.',
      absent: 'Enregistrées sur cet appareil : pour les retrouver sur vos autres appareils, exécutez le fichier 04_listes_eleves.sql dans Supabase.',
      error: `Synchronisation impossible : ${etat.msg || ''}`,
    }[etat.state] || '';
  }

  return {
    toutes, get, enregistrer, supprimer, texte, synchroniser, connecter, message,
    onChange: f => ecouteurs.push(f),
    get etat() { return etat; },
  };
})();
