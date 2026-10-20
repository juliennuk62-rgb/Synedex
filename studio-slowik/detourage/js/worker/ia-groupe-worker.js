// IA de groupe hors de la page (un seul exemplaire du modele en memoire, voir ui/ia-groupe.js).
importScripts('../../../js/vendor/pako_inflate.min.js', '../../../js/vendor/UTIF.js',
  '../../../js/core/naming.js', '../../../js/core/images.js',
  '../pipeline/outils.js', '../pipeline/fond.js', '../pipeline/ia.js', '../pipeline/ia-groupe.js');

// Fond vert sur au moins cette part du tour de l'image : fond complet, l'IA de groupe est inutile
// en mode « Auto » (portrait ou groupe devant un grand fond).
const BORD_COMPLET = 0.5;
const IMAGE_MAX = 2048; // la photo est lue a cette taille au plus (le modele travaille en 1024 x 1024)

function pixels(bmp) {
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

const actions = {
  diagnostic: ({ dossier }) => SL.dt.iaGroupe.diagnostic({ dossier }),

  async masque({ file, mode, dossier }) {
    const bmp = await SL.images.decode(file, IMAGE_MAX);
    try {
      if (mode === 'auto') {
        const petit = await createImageBitmap(bmp, { resizeWidth: Math.max(1, Math.round(bmp.width * Math.min(1, 512 / Math.max(bmp.width, bmp.height)))),
          resizeHeight: Math.max(1, Math.round(bmp.height * Math.min(1, 512 / Math.max(bmp.width, bmp.height)))), resizeQuality: 'high' });
        const img = pixels(petit);
        petit.close();
        const an = SL.dt.fond.analyser(img.data, img.width, img.height);
        if (an.bordVert >= BORD_COMPLET) return { inutile: true, bordVert: an.bordVert };
      }
      const r = await SL.dt.iaGroupe.masque(bmp, { dossier });
      return Object.assign(r, { transfer: [r.m.buffer] });
    } finally {
      bmp.close();
    }
  },
};

self.onmessage = async e => {
  const { id, type, args } = e.data;
  try {
    const r = await actions[type](args || {});
    const transfer = r.transfer || [];
    delete r.transfer;
    self.postMessage({ id, ok: true, res: r }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, err: err && err.message ? err.message : String(err) });
  }
};
