// Faux Supabase dont les donnees vivent dans le test (partagees entre deux "appareils").
window.SL = { config: { supabaseUrl: 'https://mock.supabase.co', supabaseAnonKey: 'anon' } };
(function () {
  const session = { user: { id: 'admin-id', email: 'admin@x.fr' } };
  const srv = (op, args) => window.__srv(JSON.stringify({ op, args })).then(r => JSON.parse(r));
  function builder(table) {
    const q = { table, op: 'select', filters: [], order: null, payload: null, single: false };
    const b = {
      select() { return b; }, eq(c, v) { q.filters.push(['eq', c, v]); return b; }, gt(c, v) { q.filters.push(['gt', c, v]); return b; }, lt(c, v) { q.filters.push(['lt', c, v]); return b; },
      order(c) { q.order = c; return b; }, upsert(o) { q.op = 'upsert'; q.payload = o; return b; },
      update(o) { q.op = 'update'; q.payload = o; return b; }, insert(o) { q.op = 'insert'; q.payload = o; return b; },
      delete() { q.op = 'delete'; return b; }, single() { q.single = true; return b; }, maybeSingle() { q.single = true; return b; },
      then(res, rej) {
        if (!navigator.onLine) return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }).then(res, rej);
        if (table === 'profils') return Promise.resolve({ data: { id: 'admin-id', email: 'admin@x.fr', role: 'admin' }, error: null }).then(res, rej);
        return srv('query', q).then(r => { if (q.single && Array.isArray(r.data)) r.data = r.data[0] || null; return r; }).then(res, rej);
      },
    };
    return b;
  }
  const toDataUrl = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  window.__SB_MOCK__ = { createClient: () => ({
    from: builder,
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange() { return { data: { subscription: {} } }; },
      async signOut() { return { error: null }; },
    },
    storage: { from: (bucket) => ({
      async upload(path, blob) { await srv('put', { k: bucket + '/' + path, v: await toDataUrl(blob) }); return { data: { path }, error: null }; },
      async download(path) { const r = await srv('get', { k: bucket + '/' + path }); return r.v ? { data: await (await fetch(r.v)).blob(), error: null } : { data: null, error: { message: 'Object not found' } }; },
      async list(prefix) { const r = await srv('list', { k: bucket + '/' + prefix + '/' }); return { data: r.items, error: null }; },
      async remove(paths) { for (const p of paths) await srv('del', { k: bucket + '/' + p }); return { data: [], error: null }; },
    }) },
  }) };
})();
