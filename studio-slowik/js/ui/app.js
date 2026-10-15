// Demarrage : connexion, puis onglets selon le role (admin ou ecole).
var SL = self.SL = self.SL || {};
SL.app = (function () {
  const $ = id => document.getElementById(id);
  let shownUser;            // id de l'utilisateur affiche
  let compositeurReady = false;

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
    if (admin) {
      showTab('compositeur');
      if (!compositeurReady) { compositeurReady = true; SL.compositeur.init(); }
    } else {
      showTab('espace');
      SL.espaceUI.init(profil);
    }
  }

  async function route(session) {
    if (!session) {
      shownUser = null;
      SL.authUI.show();
      return;
    }
    if (shownUser === session.user.id) return;
    try {
      const profil = await SL.cloud.profil(session.user.id);
      if (!profil) {
        await SL.cloud.auth.signOut();
        SL.authUI.show("Ce compte n'a plus d'accès. Contactez Studio SLOWIK.", 'error');
        return;
      }
      shownUser = session.user.id;
      showApp(profil);
    } catch (e) {
      SL.authUI.show(e.message, 'error');
    }
  }

  async function boot() {
    document.querySelectorAll('#tabs .tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab, true)));
    $('logout').addEventListener('click', async () => {
      if (SL.compositeur.state.running && !confirm('Un export est en cours. Se déconnecter quand même ?')) return;
      await SL.cloud.auth.signOut();
      location.reload();
    });
    SL.authUI.init();

    if (!SL.cloud.configured) {
      // Base en ligne pas encore installee : le compositeur reste utilisable.
      showApp({ role: 'admin', email: 'mode local (base en ligne non configurée)', local: true });
      return;
    }
    try {
      SL.cloud.auth.onChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') SL.authUI.showRecovery();
        else if (event === 'SIGNED_OUT') route(null);
        else if (event === 'SIGNED_IN') route(session);
      });
      if (/type=recovery/.test(location.hash)) return; // l'evenement PASSWORD_RECOVERY va suivre
      route(await SL.cloud.auth.session());
    } catch (e) {
      SL.authUI.show(e.message, 'error');
    }
  }

  boot();
  return { route };
})();
