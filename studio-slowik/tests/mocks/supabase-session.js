// Faux Supabase pour les tests : comptes, ecoles, acces, factures (donnees gardees dans sessionStorage).
window.SL = { config: { supabaseUrl: 'https://mock.supabase.co', supabaseAnonKey: 'anon' } };
(function () {
  const saved = JSON.parse(sessionStorage.getItem('mock') || 'null');
  const db = saved ? saved.db : {
    ecoles: [], acces_autorises: [{ email: 'admin@x.fr', role: 'admin', ecole_id: null }], profils: [],
    fonds_offerts: [], groupes: [], choix_fonds: [], files: {}, factures: [],
    parametres: [{ id: 1, nom: 'Julien SLOWIK', enseigne: 'Studio SLOWIK', adresse: '', code_postal: '', ville: '', siret: '842 857 757', telephone: '', email: '', iban: '', mention_tva: 'TVA non applicable, art. 293 B du CGI', conditions: 'Paiement à réception de facture. En cas de retard de paiement : pénalités au taux légal en vigueur et indemnité forfaitaire de 40 € pour frais de recouvrement.' }],
  };
  const users = saved ? saved.users : []; let session = saved ? saved.session : null; const listeners = [];
  setInterval(() => sessionStorage.setItem('mock', JSON.stringify({ db, users, session })), 50);
  const uuid = () => crypto.randomUUID();
  const me = () => session && db.profils.find(p => p.id === session.user.id);
  function visible(table) {
    const p = me(); if (!p) return [];
    if (table === 'acces_etat') return p.role === 'admin' ? db.acces_autorises.map(a => ({ ...a, compte_cree: db.profils.some(x => x.email === a.email) })) : [];
    if (table === 'choix_recap') return p.role === 'admin' ? db.choix_fonds.map(c => { const g = db.groupes.find(x => x.id === c.groupe_id); return { ...c, ecole: db.ecoles.find(e => e.id === g.ecole_id).nom, groupe: g.nom, saison: g.saison, verrouille: g.verrouille, fond: db.fonds_offerts.find(f => f.id === c.fond_id).nom }; }) : [];
    if (p.role === 'admin') return db[table];
    if (table === 'ecoles') return db.ecoles.filter(e => e.id === p.ecole_id);
    if (table === 'fonds_offerts') return db.fonds_offerts.filter(f => f.actif);
    if (table === 'parametres') return db.parametres;
    if (table === 'factures') return db.factures.filter(f => f.ecole_id === p.ecole_id && f.statut === 'emise');
    if (table === 'groupes') return db.groupes.filter(g => g.ecole_id === p.ecole_id);
    if (table === 'choix_fonds') return db.choix_fonds.filter(c => db.groupes.some(g => g.id === c.groupe_id && g.ecole_id === p.ecole_id));
    if (table === 'profils') return db.profils.filter(x => x.id === p.id);
    return [];
  }
  function builder(table) {
    let op = 'select', payload, filters = [], order, single = false, maybe = false;
    const b = {
      select() { return b; }, eq(c, v) { filters.push([c, v]); return b; }, order(c) { order = c; return b; },
      insert(o) { op = 'insert'; payload = o; return b; }, update(o) { op = 'update'; payload = o; return b; },
      delete() { op = 'delete'; return b; }, single() { single = true; return b; }, maybeSingle() { maybe = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      if (!navigator.onLine) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
      const p = me();
      const match = r => filters.every(([c, v]) => r[c] === v);
      if (op !== 'select' && (!p || p.role !== 'admin')) return { data: null, error: { message: 'new row violates row-level security policy' } };
      let rows;
      if (op === 'insert') {
        if (table === 'acces_autorises' && db.acces_autorises.some(a => a.email === payload.email)) return { error: { message: 'duplicate key value' } };
        const defaults = { ecoles: { archivee: false, taux_commission: 30, type: 'ecole' }, fonds_offerts: { actif: true, ordre: 0 }, groupes: { verrouille: false } };
        const row = { ...(defaults[table] ? { id: uuid(), ...defaults[table] } : {}), ...payload };
        db[table].push(row); rows = [row];
      } else if (op === 'update') { rows = db[table].filter(match); rows.forEach(r => Object.assign(r, payload)); }
      else if (op === 'delete') {
        rows = db[table].filter(match); db[table] = db[table].filter(r => !match(r));
        if (table === 'acces_autorises') rows.forEach(a => { db.profils = db.profils.filter(x => x.email !== a.email); });
      } else { rows = visible(table).filter(match); if (order) rows = rows.slice().sort((a, c) => String(a[order]).localeCompare(String(c[order]))); }
      if (single || maybe) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    return b;
  }
  const emit = (ev) => listeners.forEach(f => f(ev, session));
  window.__SB_MOCK__ = { createClient: () => ({
    from: builder,
    async rpc(name, args) {
      const p = me();
      if (name === 'creer_facture') {
        if (p.role !== 'admin') return { error: { message: 'Action non autorisee.' } };
        const e = db.ecoles.find(x => x.id === args.p_ecole);
        const ca = Math.round(args.p_lignes.reduce((a, l) => a + l.montant, 0) * 100) / 100;
        const com = Math.round(ca * args.p_taux) / 100;
        const base = args.p_date.replace(/-/g, '');
        const n = db.factures.filter(f => f.numero === base || f.numero.startsWith(base + '-')).length;
        const f = { id: uuid(), numero: n ? base + '-' + (n + 1) : base, date_facture: args.p_date, ecole_id: e.id,
          client: { nom: e.nom, adresse: e.adresse || '', code_postal: e.code_postal || '', ville: e.ville || '', contact_nom: e.contact_nom || '' },
          emetteur: { ...db.parametres[0] }, lignes: args.p_lignes, ca, taux: args.p_taux, commission: com, net: Math.round((ca - com) * 100) / 100,
          notes: args.p_notes, statut: 'emise', commission_versee: false };
        db.factures.push(f); return { data: f, error: null };
      } const g = db.groupes.find(x => x.id === args.p_groupe);
      if (!g || !(p.role === 'admin' || g.ecole_id === p.ecole_id)) return { error: { message: 'Groupe introuvable.' } };
      if (g.verrouille && p.role !== 'admin') return { error: { message: 'Les choix de ce groupe sont verrouilles par le photographe.' } };
      if (args.p_choix.length > g.nb_adultes) return { error: { message: 'Pas plus de ' + g.nb_adultes + ' fond(s) pour ce groupe.' } };
      db.choix_fonds = db.choix_fonds.filter(c => c.groupe_id !== g.id).concat(args.p_choix.map(c => ({ groupe_id: g.id, ...c })));
      return { data: null, error: null };
    },
    storage: { from: (bucket) => ({
      async upload(path, blob) { const r = new FileReader(); const url = await new Promise(res => { r.onload = () => res(r.result); r.readAsDataURL(blob); }); db.files[bucket + '/' + path] = url; return { data: { path }, error: null }; },
      async remove(paths) { paths.forEach(x => delete db.files[bucket + '/' + x]); return { data: [], error: null }; },
      async createSignedUrls(paths) { return { data: paths.map(x => ({ path: x, signedUrl: db.files[bucket + '/' + x] || null })), error: null }; },
    }) },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(f) { listeners.push(f); return { data: { subscription: {} } }; },
      async signInWithPassword({ email, password }) {
        const u = users.find(x => x.email === email.toLowerCase() && x.password === password);
        if (!u) return { data: null, error: { message: 'Invalid login credentials' } };
        session = { user: { id: u.id, email: u.email } }; setTimeout(() => emit('SIGNED_IN')); return { data: { session }, error: null };
      },
      async signUp({ email, password }) {
        email = email.toLowerCase(); const a = db.acces_autorises.find(x => x.email === email);
        if (!a) return { data: null, error: { message: 'Database error saving new user' } };
        const u = { id: uuid(), email, password }; users.push(u);
        db.profils.push({ id: u.id, email, role: a.role, ecole_id: a.ecole_id });
        return { data: { session: null, user: u }, error: null };
      },
      async signOut() { session = null; sessionStorage.setItem('mock', JSON.stringify({ db, users, session })); emit('SIGNED_OUT'); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser() { return { data: {}, error: null }; },
    },
  }) };
  window.__mockdb = db;
})();
