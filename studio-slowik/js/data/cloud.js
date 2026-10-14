// Base en ligne (Supabase) : connexion, ecoles, acces.
var SL = self.SL = self.SL || {};
SL.cloud = (function () {
  const cfg = SL.config || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let sb = null;

  function client() {
    if (!configured) throw new Error('Base en ligne non configurée.');
    if (!sb) {
      const lib = window.__SB_MOCK__ || window.supabase;
      if (!lib) throw new Error('Connexion impossible : vérifiez votre accès à Internet puis rechargez la page.');
      sb = lib.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    }
    return sb;
  }

  function message(err) {
    const m = String((err && err.message) || err || '');
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
    if (/Email not confirmed/i.test(m)) return 'Adresse e-mail pas encore confirmée : cliquez sur le lien reçu par e-mail.';
    if (/Database error saving new user|pas autoris/i.test(m)) return "Cet e-mail n'a pas d'accès. Contactez Studio SLOWIK.";
    if (/already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Utilisez « Mot de passe oublié » si besoin.';
    if (/Password should be at least/i.test(m)) return 'Mot de passe trop court (6 caractères minimum).';
    if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Réessayez dans quelques minutes.';
    if (/duplicate key/i.test(m)) return 'Cet élément existe déjà.';
    if (/row-level security/i.test(m)) return "Action non autorisée pour ce compte.";
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion à Internet.';
    return m || 'Erreur inconnue.';
  }

  function check(res) {
    if (res.error) throw new Error(message(res.error));
    return res.data;
  }

  const siteUrl = () => location.origin + location.pathname;

  // --- connexion ---------------------------------------------------------
  const auth = {
    async session() { return check(await client().auth.getSession()).session; },
    onChange(cb) { client().auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) {
      return check(await client().auth.signInWithPassword({ email: email.trim(), password }));
    },
    async signUp(email, password) {
      return check(await client().auth.signUp({
        email: email.trim(), password, options: { emailRedirectTo: siteUrl() },
      }));
    },
    async resetPassword(email) {
      return check(await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: siteUrl() }));
    },
    async updatePassword(password) { return check(await client().auth.updateUser({ password })); },
    async signOut() { await client().auth.signOut(); },
  };

  async function profil(userId) {
    return check(await client().from('profils').select('*').eq('id', userId).maybeSingle());
  }

  // --- ecoles --------------------------------------------------------------
  const FIELDS = ['nom', 'type', 'adresse', 'code_postal', 'ville', 'contact_nom', 'contact_email',
    'telephone', 'taux_commission', 'notes', 'archivee'];

  const ecoles = {
    async list() { return check(await client().from('ecoles').select('*').order('nom')); },
    async get(id) { return check(await client().from('ecoles').select('*').eq('id', id).maybeSingle()); },
    async save(e) {
      const row = {};
      FIELDS.forEach(f => { if (e[f] !== undefined) row[f] = e[f]; });
      if (e.id) return check(await client().from('ecoles').update(row).eq('id', e.id).select().single());
      return check(await client().from('ecoles').insert(row).select().single());
    },
    async remove(id) { return check(await client().from('ecoles').delete().eq('id', id)); },
  };

  // --- acces des ecoles ------------------------------------------------------
  const acces = {
    async list(ecoleId) {
      return check(await client().from('acces_etat').select('*').eq('ecole_id', ecoleId).order('email'));
    },
    async add(email, ecoleId) {
      const clean = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Adresse e-mail invalide.');
      return check(await client().from('acces_autorises').insert({ email: clean, role: 'ecole', ecole_id: ecoleId }));
    },
    async remove(email) { return check(await client().from('acces_autorises').delete().eq('email', email)); },
  };

  return { configured, client, message, siteUrl, auth, profil, ecoles, acces };
})();
