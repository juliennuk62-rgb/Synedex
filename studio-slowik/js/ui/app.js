// Demarrage : connexion, puis onglets selon le role (admin ou ecole). Fonctionne aussi hors ligne.
var SL = self.SL = self.SL || {};
SL.app = (function () {
  const $ = id => document.getElementById(id);
  const PROFIL_KEY = 'slowik.profil';
  let shownUser;            // id de l'utilisateur affiche
  let compositeurReady = false;
  let offlineMode = false;  // ouvert sans pouvoir joindre la base en ligne

  const refresh = { ecoles: () => SL.ecolesUI.init(), groupes: () => SL.groupesUI.init() };

  function showTab(name, fromClick) {
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    if (fromClick && refresh[name]) refresh[name]();
  }

  function showApp(profil) {
    const admin = profil.role === 'admin';
    document.querySelectorAll('#tabs .tab').forEach(t => {
      const forSchool = t.dataset.role === 'ecole';
      t.classList.toggle('hidden', admin ? forSchool : !forSchool);
    });
    $('user-email').textContent = profil.email || '';
    $('logout').classList.toggle('hidden', !!profil.local);
    $('auth-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    updateBanner();
    if (admin) {
      showTab('compositeur');
      if (!compositeurReady) { compositeurReady = true; SL.compositeur.init(); }
    } else {
      showTab('espace');
      SL.espaceUI.init(profil);
    }
  }

  // --- hors ligne --------------------------------------------------------------
  function isNetworkError(err) {
    return !navigator.onLine || /Internet|Failed to fetch|NetworkError|Load failed|network/i.test(String(err && err.message || err));
  }

  function cachedProfil(userId) {
    try {
      const p = JSON.parse(localStorage.getItem(PROFIL_KEY) || 'null');
      return p && (!userId || p.id === userId) ? p : null;
    } catch (e) { return null; }
  }

  function rememberProfil(p) {
    try { localStorage.setItem(PROFIL_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  function updateBanner() {
    const banner = $('offline-banner');
    if (!navigator.onLine) {
      banner.textContent = 'Hors ligne : le compositeur fonctionne. Écoles, photos de groupe et connexion reviendront avec Internet.';
      banner.classList.remove('hidden');
    } else if (offlineMode && SL.cloud.configured) {
      banner.innerHTML = 'Connexion Internet revenue. <a href="./">Recharger la page</a> pour retrouver toutes les fonctions.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
    $('auth-offline').classList.toggle('hidden', navigator.onLine);
  }

  function openOffline() {
    offlineMode = true;
    const p = cachedProfil();
    // L'ecole n'a rien a faire hors ligne ; vous retrouvez le compositeur.
    showApp(p && p.role === 'admin' ? Object.assign({}, p, { local: true }) :
      { role: 'admin', email: 'hors ligne', local: true });
  }

  // --- connexion ---------------------------------------------------------------
  async function route(session) {
    if (!session) {
      shownUser = null;
      SL.authUI.show();
      updateBanner();
      return;
    }
    if (shownUser === session.user.id) return;
    try {
      const profil = await SL.cloud.profil(session.user.id);
      if (!profil) {
        localStorage.removeItem(PROFIL_KEY);
        await SL.cloud.auth.signOut();
        SL.authUI.show("Ce compte n'a plus d'accès. Contactez Studio SLOWIK.", 'error');
        return;
      }
      rememberProfil(profil);
      shownUser = session.user.id;
      showApp(profil);
    } catch (e) {
      const cached = cachedProfil(session.user.id);
      if (isNetworkError(e) && cached) {
        offlineMode = true;
        shownUser = session.user.id;
        showApp(cached);
      } else {
        SL.authUI.show(e.message, 'error');
        updateBanner();
      }
    }
  }

  function setupInstall() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* pas de hors ligne (ex : navigation privee) */ });
    }
    let deferred = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferred = e;
      $('install').classList.remove('hidden');
    });
    $('install').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      $('install').classList.add('hidden');
    });
    window.addEventListener('appinstalled', () => $('install').classList.add('hidden'));
    window.addEventListener('online', updateBanner);
    window.addEventListener('offline', updateBanner);
  }

  async function boot() {
    setupInstall();
    document.querySelectorAll('#tabs .tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab, true)));
    $('logout').addEventListener('click', async () => {
      if (SL.compositeur.state.running && !confirm('Un export est en cours. Se déconnecter quand même ?')) return;
      localStorage.removeItem(PROFIL_KEY);
      try { await SL.cloud.auth.signOut(); } catch (e) { /* hors ligne */ }
      location.reload();
    });
    $('auth-offline').addEventListener('click', openOffline);
    SL.authUI.init();
    updateBanner();

    if (!SL.cloud.configured) {
      // Base en ligne pas encore installee : le compositeur reste utilisable.
      showApp({ role: 'admin', email: 'mode local (base en ligne non configurée)', local: true });
      return;
    }
    try {
      SL.cloud.auth.onChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') SL.authUI.showRecovery();
        else if (event === 'SIGNED_OUT') { if (!offlineMode) route(null); }
        else if (event === 'SIGNED_IN') route(session);
      });
      if (/type=recovery/.test(location.hash)) return; // l'evenement PASSWORD_RECOVERY va suivre
      let session = null;
      try {
        session = await SL.cloud.auth.session();
      } catch (e) {
        if (!isNetworkError(e)) throw e;
      }
      route(session);
    } catch (e) {
      SL.authUI.show(e.message, 'error');
      updateBanner();
    }
  }

  boot();
  return { route };
})();
