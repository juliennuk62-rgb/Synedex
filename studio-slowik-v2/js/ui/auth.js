// Ecran de connexion.
var SL = self.SL = self.SL || {};
SL.authUI = (function () {
  const $ = id => document.getElementById(id);
  let mode = 'login';

  const TITLES = {
    login: 'Connexion',
    signup: 'Créer mon accès',
    forgot: 'Mot de passe oublié',
    recovery: 'Nouveau mot de passe',
  };

  function setMode(m) {
    mode = m;
    $('auth-title').textContent = TITLES[m];
    $('auth-email-row').classList.toggle('hidden', m === 'recovery');
    $('auth-password-row').classList.toggle('hidden', m === 'forgot');
    $('auth-confirm-row').classList.toggle('hidden', !(m === 'signup' || m === 'recovery'));
    $('auth-submit').textContent = { login: 'Se connecter', signup: 'Créer mon accès', forgot: 'Recevoir le lien', recovery: 'Enregistrer' }[m];
    $('auth-links').classList.toggle('hidden', m === 'recovery');
    $('auth-to-login').classList.toggle('hidden', m === 'login');
    $('auth-to-signup').classList.toggle('hidden', m !== 'login');
    $('auth-to-forgot').classList.toggle('hidden', m !== 'login');
    $('auth-help').textContent = m === 'signup'
      ? "Utilisez l'adresse e-mail que Studio SLOWIK a enregistrée pour votre établissement."
      : '';
    say('');
  }

  function say(text, kind) {
    const el = $('auth-message');
    el.textContent = text;
    el.className = 'auth-message' + (kind ? ' ' + kind : '');
  }

  function show(message, kind) {
    $('app').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
    if (mode === 'recovery') setMode('login');
    if (message) say(message, kind);
  }

  function showRecovery() {
    $('app').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
    setMode('recovery');
  }

  async function submit(e) {
    e.preventDefault();
    const email = $('auth-email').value;
    const pw = $('auth-password').value;
    const pw2 = $('auth-confirm').value;
    const btn = $('auth-submit');
    if ((mode === 'signup' || mode === 'recovery') && pw !== pw2) {
      say('Les deux mots de passe sont différents.', 'error');
      return;
    }
    btn.disabled = true;
    say('Patientez…');
    try {
      if (mode === 'login') {
        await SL.cloud.auth.signIn(email, pw);
        say('');
      } else if (mode === 'signup') {
        const data = await SL.cloud.auth.signUp(email, pw);
        if (!data.session) {
          setMode('login');
          say('Compte créé. Ouvrez l\'e-mail de confirmation reçu, cliquez sur le lien, puis connectez-vous.', 'ok');
        }
      } else if (mode === 'forgot') {
        await SL.cloud.auth.resetPassword(email);
        setMode('login');
        say('Si cette adresse a un accès, un e-mail avec un lien vient de vous être envoyé.', 'ok');
      } else if (mode === 'recovery') {
        await SL.cloud.auth.updatePassword(pw);
        setMode('login');
        say('Mot de passe modifié.', 'ok');
        SL.app.route(await SL.cloud.auth.session());
      }
    } catch (err) {
      say(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    $('auth-form').addEventListener('submit', submit);
    $('auth-to-login').addEventListener('click', e => { e.preventDefault(); setMode('login'); });
    $('auth-to-signup').addEventListener('click', e => { e.preventDefault(); setMode('signup'); });
    $('auth-to-forgot').addEventListener('click', e => { e.preventDefault(); setMode('forgot'); });
    setMode('login');
  }

  return { init, show, showRecovery, say };
})();
