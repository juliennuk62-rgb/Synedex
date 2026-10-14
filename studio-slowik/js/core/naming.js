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

  // {Projet}{n}_{Fond}.ext ou, sans projet, {Source}_{n}_{Fond}.ext
  function build(project, n, sourceName, bgName, ext) {
    const p = clean(project);
    const bg = clean(stem(bgName));
    if (p) return `${p}${n}_${bg}${ext}`;
    return `${clean(stem(sourceName))}_${n}_${bg}${ext}`;
  }

  return { FORMATS, clean, stem, extension, build };
})();
