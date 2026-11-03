// Noms des fichiers exportes.
var SL = self.SL = self.SL || {};
SL.naming = (function () {
  const FORMATS = {
    JPEG: { ext: '.jpg', mime: 'image/jpeg' },
    PNG: { ext: '.png', mime: 'image/png' },
    WebP: { ext: '.webp', mime: 'image/webp' },
  };
  const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g;

  function clean(text) {
    return String(text || '').replace(FORBIDDEN, '_').trim().replace(/\.+$/, '');
  }

  function stem(name) {
    const i = name.lastIndexOf('.');
    return i <= 0 ? name : name.slice(0, i);
  }

  function extension(name) {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i).toLowerCase();
  }

  // Numero devant : {n}_{Projet}_{Fond}.ext ou, sans projet, {n}_{Source}_{Fond}.ext
  function build(project, n, sourceName, bgName, ext) {
    const p = clean(project);
    const bg = clean(stem(bgName));
    return `${n}_${p || clean(stem(sourceName))}_${bg}${ext}`;
  }

  // Seance (V2) : {numero sur 3 chiffres}_{NOM Prenom}_{Fond}.ext (sans nom connu : le nom de la photo).
  function buildEleve(n, chiffres, eleve, sourceName, bgName, ext) {
    return `${String(n).padStart(chiffres || 3, '0')}_${clean(eleve) || clean(stem(sourceName))}_${clean(stem(bgName))}${ext}`;
  }

  return { FORMATS, clean, stem, extension, build, buildEleve };
})();
