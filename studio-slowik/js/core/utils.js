// Outils communs : texte protege, gabarits HTML surs, telechargement, PDF, montants, dialogues, toasts.
var SL = self.SL = self.SL || {};
SL.u = (function () {
  // --- texte et gabarits HTML ---------------------------------------------------------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

  // Morceau de HTML deja sur (ne sera pas protege une seconde fois).
  class Safe {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  const raw = s => new Safe(String(s ?? ''));

  function part(v) {
    if (v === null || v === undefined || v === false) return '';
    if (v instanceof Safe) return v.s;
    if (Array.isArray(v)) return v.map(part).join('');
    return esc(v);
  }

  // html`<b>${nom}</b>` : toute valeur inseree est protegee automatiquement.
  // Les tableaux de html`` s'inserent tels quels (inutile de faire .join('')).
  function html(strings, ...values) {
    let out = '';
    strings.forEach((s, i) => { out += s + (i < values.length ? part(values[i]) : ''); });
    return new Safe(out);
  }

  // --- fichiers et PDF ------------------------------------------------------------------
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  let pdfLib = null;
  function ensurePdfLib() {
    if (self.PDFLib) return Promise.resolve(self.PDFLib);
    if (!pdfLib) {
      pdfLib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/pdf-lib.min.js';
        s.onload = () => resolve(self.PDFLib);
        s.onerror = () => { pdfLib = null; reject(new Error('Module PDF introuvable (ouvrez le site une fois avec Internet).')); };
        document.head.appendChild(s);
      });
    }
    return pdfLib;
  }

  // --- formats français ----------------------------------------------------------------
  // Espaces normales (les espaces fines ne s'impriment pas dans les PDF).
  const euros = v => Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
    .replace(/[  ]/g, ' ');
  const dateFr = d => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR');

  // --- dialogues (remplacent alert / confirm du navigateur) ------------------------------
  // Typographie francaise : espace insecable avant ? ! : ; » et apres «.
  const fr = t => String(t ?? '').replace(/ ([?!:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');

  function dialog({ title, message, ok = 'OK', cancel = null, danger = false }) {
    title = title && fr(title);
    message = fr(message);
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      const back = document.createElement('div');
      back.className = 'dlg-back';
      back.innerHTML = html`
        <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          ${title ? html`<h2 id="dlg-title">${title}</h2>` : html`<h2 id="dlg-title" class="sr-only">Message</h2>`}
          <div class="dlg-msg">${String(message ?? '').split('\n').map(l => (l ? html`<p>${l}</p>` : ''))}</div>
          <div class="dlg-actions">
            ${cancel ? html`<button type="button" class="btn secondary" data-v="0">${cancel}</button>` : ''}
            <button type="button" class="btn ${danger ? 'danger' : 'primary-solid'}" data-v="1">${ok}</button>
          </div>
        </div>`;
      const close = v => {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(v);
      };
      const buttons = () => [...back.querySelectorAll('button')];
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if (e.key === 'Tab') { // garde le focus dans la fenetre
          const b = buttons();
          const i = b.indexOf(document.activeElement);
          e.preventDefault();
          b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
        }
      };
      back.addEventListener('click', e => {
        const v = e.target.closest('button[data-v]');
        if (v) close(v.dataset.v === '1');
        else if (e.target === back && cancel) close(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      // Action destructive : « Annuler » preselectionne (Entree ne supprime jamais par megarde).
      (back.querySelector(danger && cancel ? 'button[data-v="0"]' : 'button[data-v="1"]')).focus();
    });
  }

  const confirm = (message, opts = {}) => dialog(Object.assign({ message, ok: 'Confirmer', cancel: 'Annuler' }, opts));
  const alert = (message, opts = {}) => dialog(Object.assign({ message, ok: 'Compris' }, opts));

  // --- toasts (messages courts, non bloquants) --------------------------------------------
  function toast(message, kind = 'ok', ms = 4000) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? Math.max(ms, 8000) : ms);
  }

  return { esc, raw, html, download, ensurePdfLib, euros, dateFr, dialog, confirm, alert, toast };
})();
