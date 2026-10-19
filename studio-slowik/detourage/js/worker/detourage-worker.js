// Calculs du detourage hors de la page (l'ecran reste fluide).
// Deux exemplaires tournent : un pour l'apercu (image reduite), un pour la pleine definition.
importScripts('../../../js/vendor/pako_inflate.min.js', '../../../js/vendor/UTIF.js',
  '../../../js/core/naming.js', '../../../js/core/images.js', '../../../js/core/chroma.js',
  '../pipeline/outils.js', '../pipeline/fond.js', '../pipeline/cle.js', '../pipeline/matting.js',
  '../pipeline/despill.js', '../pipeline/detourage.js');

let src = null;      // { data, w, h } photo chargee
let res = null;      // dernier resultat : RGBA detoure
let fondImg = null;  // image de fond choisie (pour la loupe)

function pixels(bmp) {
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

const actions = {
  // Charge une photo (reduite a `max` pixels si demande).
  async charger({ file, max, apercu }) {
    const bmp = await SL.images.decode(file, max);
    const img = pixels(bmp);
    src = { data: img.data, w: img.width, h: img.height };
    res = null;
    if (apercu) return { w: src.w, h: src.h, bitmap: bmp, transfer: [bmp] };
    bmp.close();
    return { w: src.w, h: src.h };
  },

  // Detoure la photo chargee. renvoyer = false : le resultat reste ici (loupe, export).
  detourer({ params, analyse, renvoyer }) {
    if (!src) throw new Error('Aucune photo chargée.');
    const rgba = new Uint8ClampedArray(src.data);
    const t0 = performance.now();
    const r = SL.dt.detourer(rgba, src.w, src.h, params, analyse);
    res = rgba;
    const out = { w: src.w, h: src.h, analyse: r.analyse, temps: r.temps, total: Math.round(performance.now() - t0) };
    if (renvoyer) {
      const copie = new Uint8ClampedArray(rgba);
      out.rgba = copie;
      out.transfer = [copie.buffer];
    }
    return out;
  },

  fond({ bitmap }) {
    if (fondImg) fondImg.close();
    fondImg = bitmap || null;
    return {};
  },

  // Morceau de l'image en pleine definition pour la loupe.
  // vue : original, masque, damier, fond (couleur `couleur` ou image de fond).
  loupe({ u, v, taille, vue, couleur }) {
    if (!src) return { vide: true };
    const s = Math.max(8, Math.round(taille));
    const x0 = Math.round(u * src.w - s / 2), y0 = Math.round(v * src.h - s / 2);
    const out = new ImageData(s, s);
    const d = out.data;
    const base = vue === 'original' || !res ? src.data : res;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const sx = x0 + x, sy = y0 + y, o = (y * s + x) * 4;
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) { d[o + 3] = 0; continue; }
      const i = (sy * src.w + sx) * 4;
      if (vue === 'masque' && res) { d[o] = d[o + 1] = d[o + 2] = res[i + 3]; d[o + 3] = 255; continue; }
      d[o] = base[i]; d[o + 1] = base[i + 1]; d[o + 2] = base[i + 2]; d[o + 3] = vue === 'original' ? 255 : base[i + 3];
    }
    if (vue !== 'fond' || !res) return { s, data: d, pret: !!res, transfer: [d.buffer] };
    // Sur le fond : fond (couleur ou image en mode « remplir ») puis le sujet par-dessus.
    const cv = new OffscreenCanvas(s, s);
    const ctx = cv.getContext('2d');
    if (fondImg) {
      const k = Math.max(src.w / fondImg.width, src.h / fondImg.height);
      const ox = (src.w - fondImg.width * k) / 2, oy = (src.h - fondImg.height * k) / 2;
      ctx.drawImage(fondImg, ox - x0, oy - y0, fondImg.width * k, fondImg.height * k);
    } else {
      ctx.fillStyle = couleur || '#ffffff';
      ctx.fillRect(0, 0, s, s);
    }
    const sujet = new OffscreenCanvas(s, s);
    sujet.getContext('2d').putImageData(out, 0, 0);
    ctx.drawImage(sujet, 0, 0);
    const fin = ctx.getImageData(0, 0, s, s).data;
    return { s, data: fin, pret: true, transfer: [fin.buffer] };
  },

  // PNG transparent en pleine definition.
  async png() {
    if (!res) throw new Error('Le détourage en pleine définition n\'est pas encore prêt.');
    const cv = new OffscreenCanvas(src.w, src.h);
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res), src.w, src.h), 0, 0);
    return { blob: await cv.convertToBlob({ type: 'image/png' }) };
  },

  // Petites versions de quelques photos, pour choisir les photos temoins :
  // luminosite du sujet et part de bords fins (cheveux).
  async echantillon({ files }) {
    const out = [];
    for (const file of files) {
      try {
        const bmp = await SL.images.decode(file, 320);
        const img = pixels(bmp);
        const { data, width: w, height: h } = img;
        const an = SL.dt.fond.analyser(data, w, h);
        const alpha = SL.dt.cle.calculer(data, w, h, an, SL.dt.DEFAUTS.portraits);
        let lum = 0, plein = 0, bord = 0;
        for (let p = 0; p < w * h; p++) {
          const a = alpha[p];
          if (a > 230) { plein++; lum += 0.3 * data[p * 4] + 0.59 * data[p * 4 + 1] + 0.11 * data[p * 4 + 2]; } else if (a > 20) bord++;
        }
        out.push({ ok: true, lum: plein ? lum / plein : 0, detail: plein ? bord / plein : 0, thumb: bmp });
      } catch (e) {
        out.push({ ok: false, erreur: e.message });
      }
    }
    return { liste: out, transfer: out.filter(x => x.thumb).map(x => x.thumb) };
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
