// Tests : accepte automatiquement les fenetres SL.u (et note leur texte dans la console).
new MutationObserver(() => {
  const d = document.querySelector('.dlg');
  if (d && !d.dataset.seen) {
    d.dataset.seen = '1';
    console.log('DLG ' + d.innerText.replace(/\s+/g, ' ').slice(0, 120));
    setTimeout(() => d.querySelector('button[data-v="1"]').click(), 30);
  }
}).observe(document, { childList: true, subtree: true });
