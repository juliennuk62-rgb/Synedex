// Vignettes des photos d'une seance (TIFF lourds) : calculees hors de la page, une a la fois.
importScripts('../vendor/pako_inflate.min.js', '../vendor/UTIF.js', '../core/naming.js', '../core/images.js');

const COTE = 220;

self.onmessage = async e => {
  const { id, file } = e.data;
  try {
    const bmp = await SL.images.decode(file, COTE);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, erreur: err && err.message ? err.message : String(err) });
  }
};
