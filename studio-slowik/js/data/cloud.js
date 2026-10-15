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
    if (/Bucket not found/i.test(m)) return "Stockage des images non installé : exécutez le script 02 dans Supabase.";
    if (/relation .* does not exist|Could not find the table/i.test(m)) return "Base incomplète : exécutez le script 02 dans Supabase.";
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

  // --- images en ligne (stockage prive, liens temporaires) ------------------
  const urlCache = new Map();
  const storage = {
    async upload(bucket, path, blob) {
      return check(await client().storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    },
    async remove(bucket, paths) {
      const list = paths.filter(Boolean);
      if (list.length) check(await client().storage.from(bucket).remove(list));
    },
    // Retourne { chemin: url } (liens valables 1 h, gardes 50 min).
    async urls(bucket, paths) {
      const now = Date.now();
      const out = {};
      const missing = [];
      for (const p of paths.filter(Boolean)) {
        const c = urlCache.get(bucket + '/' + p);
        if (c && c.expires > now) out[p] = c.url; else missing.push(p);
      }
      if (missing.length) {
        const rows = check(await client().storage.from(bucket).createSignedUrls(missing, 3600));
        for (const r of rows || []) {
          if (r.signedUrl) {
            out[r.path] = r.signedUrl;
            urlCache.set(bucket + '/' + r.path, { url: r.signedUrl, expires: now + 50 * 60 * 1000 });
          }
        }
      }
      return out;
    },
  };

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  // --- fonds proposes ----------------------------------------------------------
  const fonds = {
    async list() {
      return check(await client().from('fonds_offerts').select('*').order('ordre').order('nom'));
    },
    async add(file) {
      const blob = await SL.images.toJpeg(file, 1600, 0.85);
      const chemin = `${newId()}.jpg`;
      await storage.upload('fonds', chemin, blob);
      try {
        return check(await client().from('fonds_offerts')
          .insert({ nom: SL.naming.stem(file.name), chemin }).select().single());
      } catch (e) {
        await storage.remove('fonds', [chemin]);
        throw e;
      }
    },
    async update(id, values) {
      return check(await client().from('fonds_offerts').update(values).eq('id', id).select().single());
    },
    async remove(f) {
      const res = await client().from('fonds_offerts').delete().eq('id', f.id);
      if (res.error && /foreign key|violates/i.test(res.error.message)) {
        throw new Error('Ce fond a déjà été choisi par une école : désactivez-le plutôt que de le supprimer.');
      }
      check(res);
      await storage.remove('fonds', [f.chemin]);
    },
  };

  // --- groupes et choix --------------------------------------------------------
  const groupes = {
    async list(ecoleId) {
      let q = client().from('groupes').select('*');
      if (ecoleId) q = q.eq('ecole_id', ecoleId);
      return check(await q.order('saison', { ascending: false }).order('nom'));
    },
    async save(g, photoFile) {
      const row = { nom: g.nom, nb_adultes: g.nb_adultes, saison: g.saison, verrouille: !!g.verrouille };
      let oldPhoto = null;
      if (photoFile) {
        const blob = await SL.images.toJpeg(photoFile, 2000, 0.85);
        const chemin = `${g.ecole_id}/${newId()}.jpg`;
        await storage.upload('photos-groupes', chemin, blob);
        oldPhoto = g.photo_chemin;
        row.photo_chemin = chemin;
      }
      let saved;
      if (g.id) {
        saved = check(await client().from('groupes').update(row).eq('id', g.id).select().single());
      } else {
        row.ecole_id = g.ecole_id;
        saved = check(await client().from('groupes').insert(row).select().single());
      }
      if (oldPhoto) await storage.remove('photos-groupes', [oldPhoto]).catch(() => {});
      return saved;
    },
    async setLocked(id, locked) {
      return check(await client().from('groupes').update({ verrouille: locked }).eq('id', id).select().single());
    },
    async remove(g) {
      check(await client().from('groupes').delete().eq('id', g.id));
      await storage.remove('photos-groupes', [g.photo_chemin]).catch(() => {});
    },
  };

  const choix = {
    // Tous les choix visibles, regroupes par groupe : { groupe_id: [ {rang, fond_id, nom_adulte} ] }
    async byGroupe() {
      const rows = check(await client().from('choix_fonds').select('*').order('rang'));
      const out = {};
      for (const r of rows) (out[r.groupe_id] = out[r.groupe_id] || []).push(r);
      return out;
    },
    async save(groupeId, list) {
      return check(await client().rpc('enregistrer_choix', { p_groupe: groupeId, p_choix: list }));
    },
    async recap() {
      return check(await client().from('choix_recap').select('*')
        .order('ecole').order('saison').order('groupe').order('rang'));
    },
  };

  function saisonCourante(d) {
    d = d || new Date();
    const y = d.getFullYear();
    return d.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  }

  return { configured, client, message, siteUrl, auth, profil, ecoles, acces, storage, fonds, groupes, choix, saisonCourante };
})();
