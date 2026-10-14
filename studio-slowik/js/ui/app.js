// Navigation entre les onglets.
(function () {
  document.querySelectorAll('#tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${tab.dataset.tab}`));
    });
  });
  SL.compositeur.init();
})();
