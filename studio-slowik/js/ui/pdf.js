// Onglet Assembler PDF : pages regroupees 2 par 2 l'une sous l'autre (aussi sur telephone).
var SL = self.SL = self.SL || {};
SL.pdfUI = (function () {
  const $ = id => document.getElementById(id);
  const { html } = SL.u;
  const FORMAT = 'slowik.pdf.format';
  let pret = false;

  const format = () => (document.querySelector('input[name=pdf-format]:checked') || {}).value || 'reel';

  async function traiter(fichiers) {
    fichiers = [...fichiers].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!fichiers.length) { SL.u.toast('Choisissez un fichier PDF.', 'error'); return; }
    for (const f of fichiers) {
      $('pdf-etat').textContent = `Assemblage de « ${f.name} »…`;
      try {
        const r = await SL.pdfAssembler.assembler(await f.arrayBuffer(), { format: format() });
        const nom = `${SL.naming.stem(f.name)} - 2 pages par feuille.pdf`;
        const blob = new Blob([r.octets], { type: 'application/pdf' });
        SL.u.download(blob, nom);
        const ligne = document.createElement('div');
        ligne.className = 'pdf-ligne';
        const taille = `${SL.pdfAssembler.cm(r.taille.w)} × ${SL.pdfAssembler.cm(r.taille.h)} cm`;
        ligne.innerHTML = html`<span><strong>${nom}</strong><br><span class="muted">${r.pages} page(s) → ${r.feuilles} page(s) de ${taille}</span></span>
          <a class="btn small secondary" download="${nom}">Télécharger à nouveau</a>`;
        ligne.querySelector('a').href = URL.createObjectURL(blob);
        $('pdf-resultats').prepend(ligne);
        $('pdf-etat').textContent = '';
      } catch (e) {
        $('pdf-etat').textContent = '';
        SL.u.alert(`« ${f.name} » : ${e.message}`, { title: 'Assemblage impossible' });
      }
    }
  }

  function init() {
    if (pret) return;
    pret = true;
    try {
      const f = localStorage.getItem(FORMAT);
      if (f) document.querySelector(`input[name=pdf-format][value="${f}"]`).checked = true;
    } catch (e) { /* stockage bloque */ }
    document.querySelectorAll('input[name=pdf-format]').forEach(r => r.addEventListener('change', () => {
      try { localStorage.setItem(FORMAT, format()); } catch (e) { /* stockage bloque */ }
    }));
    $('pdf-fichier').addEventListener('change', e => traiter(e.target.files).finally(() => { e.target.value = ''; }));
    const zone = $('pdf-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); traiter(e.dataTransfer.files); });
  }

  return { init, traiter };
})();
