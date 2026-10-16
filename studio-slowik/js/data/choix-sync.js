// Synchronisation du choix des fonds avec votre base (connecte + Internet).
// Principe : on recupere les nouveautes du serveur, puis on envoie les modifications locales.
// En cas de conflit, la modification la plus recente gagne.
var SL = self.SL = self.SL || {};
SL.choixSync = (function () {
  const BUCKET = 'choix';
  const LAST = 'slowik.sync.last.';
  const PURGE_KEY = 'slowik.sync.purge';
  const QUOTA = 1024 * 1024 * 1024;   // offre gratuite Supabase : 1 Go de stockage
  const KEEP_DAYS = 30;               // traces de suppression gardees 30 jours
  let usage = null;                   // octets utilises (images en ligne)
  let usageAt = 0;
  let quotaWarned = false;
  const SPEC = {
    fonds: { table: 'choix_fonds_sync', blob: 'blob', fields: ['numero', 'nom', 'actif', 'created'] },
    groupes: { table: 'choix_classes_sync', blob: 'photo', fields: ['numero', 'fichier', 'nb', 'choix', 'created'] },
  };
  let enabled = false;
  let running = false;
  let again = false;
  let timer = null;
  let status = { state: 'off' };
  let listeners = [];

  const L = () => SL.localChoix.sync;
  const client = () => SL.cloud.client();
  const check = res => { if (res.error) throw new Error(SL.cloud.message(res.error)); return res.data; };

  function setStatus(s) {
    status = s;
    render();
  }

  function render() {
    const el = document.getElementById('choix-sync');
    if (!el) return;
    const h = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const txt = {
      off: SL.cloud.configured ? 'Enregistré sur cet appareil uniquement (connectez-vous pour retrouver vos classes sur tous vos appareils).'
        : 'Enregistré sur cet appareil.',
      running: 'Synchronisation…',
      ok: `Synchronisé avec vos autres appareils${status.at ? ' à ' + h(status.at) : ''}.`,
      offline: 'Hors ligne : vos modifications seront envoyées au retour d\'Internet.',
      error: `Synchronisation impossible : ${status.msg || ''}`,
    }[status.state] || '';
    el.querySelector('span').textContent = txt;
    const q = document.getElementById('choix-quota');
    if (q) {
      if (enabled && usage !== null) {
        const pct = Math.round(usage / QUOTA * 100);
        q.innerHTML = SL.u.html`<span>Espace en ligne utilisé : ${mo(usage)} sur 1 Go (${pct} %)</span>
          <span class="quota-bar"><span style="width:${Math.min(100, pct)}%"></span></span>`;
        q.className = 'quota' + (pct >= 80 ? ' warn' : '');
        q.classList.remove('hidden');
      } else q.classList.add('hidden');
    }
    el.className = 'sync-status ' + status.state;
    el.querySelector('button').classList.toggle('hidden', !enabled || status.state === 'running');
  }

  function schedule(ms) {
    if (!enabled) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }

  // --- recuperation des nouveautes du serveur ----------------------------------------
  async function pull(store) {
    const spec = SPEC[store];
    let last = '1970-01-01T00:00:00Z';
    try { last = localStorage.getItem(LAST + store) || last; } catch (e) { /* ignore */ }
    const since = new Date(new Date(last).getTime() - 5000).toISOString(); // petite marge
    const rows = check(await client().from(spec.table).select('*').gt('synced_at', since).order('synced_at'));
    let changed = false;
    let max = last;
    for (const row of rows) {
      if (row.synced_at > max) max = row.synced_at;
      const local = await L().get(store, row.id);
      const remoteUpdated = Number(row.updated);
      if (local && local.dirty !== false && (local.updated || 0) > remoteUpdated) continue;  // local plus recent
      if (local && local.dirty === false && local.updated === remoteUpdated && local.remotePath === row.chemin
        && !!local.deleted === row.deleted) continue;                                       // deja a jour
      const rec = Object.assign({}, local || {}, { id: row.id, updated: remoteUpdated, deleted: row.deleted });
      spec.fields.forEach(f => { rec[f] = row[f]; });
      rec.created = Number(row.created) || rec.created || remoteUpdated;
      if (row.deleted || !row.chemin) {
        rec[spec.blob] = row.deleted ? null : (local && local[spec.blob]) || null;
      } else if (!(local && local.remotePath === row.chemin && local[spec.blob])) {
        rec[spec.blob] = check(await client().storage.from(BUCKET).download(row.chemin));
      }
      rec.remotePath = row.chemin || null;
      rec.dirty = false;
      rec.blobChanged = false;
      await L().put(store, rec);
      changed = true;
    }
    try { localStorage.setItem(LAST + store, max); } catch (e) { /* ignore */ }
    return changed;
  }

  // --- envoi des modifications locales ------------------------------------------------
  async function push(store) {
    const spec = SPEC[store];
    const dirty = (await L().all(store)).filter(r => r.dirty !== false);
    for (const r of dirty) {
      const old = r.remotePath || null;
      let chemin = old;
      const blob = r[spec.blob];
      if (r.deleted) {
        chemin = null;
      } else if (blob && (r.blobChanged || !old)) {
        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
        chemin = `${store}/${r.id}-${r.updated}.${ext}`;
        check(await client().storage.from(BUCKET).upload(chemin, blob, { contentType: blob.type || 'image/jpeg', upsert: true }));
      }
      const row = { id: r.id, updated: r.updated || Date.now(), deleted: !!r.deleted, chemin };
      spec.fields.forEach(f => { row[f] = r[f] === undefined ? null : r[f]; });
      if (store === 'fonds') { row.nom = row.nom || ''; row.actif = row.actif !== false; }
      if (store === 'groupes') { row.fichier = row.fichier || ''; row.nb = row.nb || 1; row.choix = row.choix || {}; }
      row.numero = row.numero || 0;
      check(await client().from(spec.table).upsert(row, { onConflict: 'id' }));
      if (old && old !== chemin) await client().storage.from(BUCKET).remove([old]).catch(() => {});
      // Marque envoye, sauf si l'element a encore change pendant l'envoi.
      const cur = await L().get(store, r.id);
      if (cur) {
        cur.remotePath = chemin;
        if (cur.updated === r.updated) { cur.dirty = false; cur.blobChanged = false; }
        await L().put(store, cur);
      }
    }
  }

  const mo = n => `${(n / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: n < 100 * 1024 * 1024 ? 1 : 0 })} Mo`;

  // Taille totale des images en ligne (au plus toutes les 10 minutes).
  async function measure(force) {
    if (!force && Date.now() - usageAt < 10 * 60 * 1000) return;
    let total = 0;
    for (const folder of ['fonds', 'groupes']) {
      for (let offset = 0; ; offset += 1000) {
        const items = check(await client().storage.from(BUCKET).list(folder, { limit: 1000, offset }));
        (items || []).forEach(it => { total += (it.metadata && it.metadata.size) || 0; });
        if (!items || items.length < 1000) break;
      }
    }
    usage = total;
    usageAt = Date.now();
    if (total / QUOTA >= 0.8 && !quotaWarned) {
      quotaWarned = true;
      SL.u.toast(`Espace en ligne presque plein (${mo(total)} sur 1 Go) : utilisez « Tout effacer » pour les écoles terminées.`, 'error');
    }
  }

  // Menage : les traces de suppression de plus de 30 jours sont effacees (une fois par jour).
  async function purge() {
    let last = 0;
    try { last = Number(localStorage.getItem(PURGE_KEY)) || 0; } catch (e) { /* ignore */ }
    if (Date.now() - last < 24 * 3600 * 1000) return;
    const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
    for (const store of ['fonds', 'groupes']) {
      check(await client().from(SPEC[store].table).delete().eq('deleted', true).lt('updated', limit));
      for (const r of await L().all(store)) {
        if (r.deleted && r.dirty === false && (r.updated || 0) < limit) await L().del(store, r.id);
      }
    }
    try { localStorage.setItem(PURGE_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  async function syncNow() {
    if (!enabled) return;
    if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
    if (running) { again = true; return; }
    running = true;
    setStatus({ state: 'running' });
    try {
      let changed = await pull('fonds');
      changed = (await pull('groupes')) || changed;
      await push('fonds');
      await push('groupes');
      await purge().catch(() => {});
      await measure(changed).catch(() => {});
      setStatus({ state: 'ok', at: new Date() });
      if (changed) listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    } catch (e) {
      const msg = SL.cloud.message(e);
      setStatus(/Internet|fetch/i.test(msg) ? { state: 'offline' } : { state: 'error', msg });
    } finally {
      running = false;
      if (again) { again = false; schedule(500); }
    }
  }

  let started = false;
  function start() {
    enabled = true;
    if (!started) {
      started = true;
      SL.localChoix.sync.onChange(() => schedule(1500));
      window.addEventListener('online', () => schedule(500));
      window.addEventListener('offline', () => setStatus({ state: 'offline' }));
      setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
    }
    syncNow();
  }

  function stop() {
    enabled = false;
    clearTimeout(timer);
    setStatus({ state: 'off' });
  }

  return {
    start, stop, syncNow, render,
    onRemoteChange: fn => listeners.push(fn),
    get enabled() { return enabled; },
  };
})();
