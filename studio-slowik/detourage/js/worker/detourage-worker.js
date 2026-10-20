// Calculs du detourage hors de la page (l'ecran reste fluide).
// Deux exemplaires tournent : un pour l'apercu (image reduite), un pour la pleine definition.
importScripts('../../../js/vendor/pako_inflate.min.js', '../../../js/vendor/UTIF.js',
  '../../../js/core/naming.js', '../../../js/core/images.js', '../../../js/core/chroma.js', '../../../js/core/fsa.js',
  '../pipeline/outils.js', '../pipeline/fond.js', '../pipeline/gpu.js', '../pipeline/cle.js', '../pipeline/matting.js',
  '../pipeline/despill.js', '../pipeline/score.js', '../pipeline/ia.js', '../pipeline/groupe.js', '../pipeline/retouches.js',
  '../pipeline/meta.js', '../pipeline/detourage.js');

let src = null;      // { data, w, h } photo chargee
let res = null;      // dernier resultat : RGBA detoure
let fondImg = null;  // image de fond choisie (pour la loupe)
let iaPhoto = null;  // masque de l'IA de la photo chargee
const fondsAjustes = new Map(); // fonds deja ajustes a la taille des photos (2 au plus en memoire)

async function fondAjuste(f, w, h, mode) {
  const cle = `${f.cle}|${w}x${h}|${mode}`;
  if (fondsAjustes.has(cle)) return fondsAjustes.get(cle);
  const bmp = await SL.images.decode(f.file);
  const cv = SL.chroma.fit(bmp, w, h, mode);
  bmp.close();
  if (fondsAjustes.size >= 2) fondsAjustes.delete(fondsAjustes.keys().next().value);
  fondsAjustes.set(cle, cv);
  return cv;
}

// Masque de l'IA (petit cote envoye au modele : plus grand pour les groupes, aux visages petits).
// En cas d'echec (premier lancement hors ligne...), le detourage continue sans IA.
async function masqueIA(data, w, h, type) {
  try {
    return await SL.dt.ia.masque(data, w, h, type === 'groupes' ? 768 : 512);
  } catch (e) {
    return { erreur: e.message || String(e) };
  }
}

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
    iaPhoto = null;
    if (apercu) return { w: src.w, h: src.h, bitmap: bmp, transfer: [bmp] };
    bmp.close();
    return { w: src.w, h: src.h };
  },

  // Detoure la photo chargee. renvoyer = false : le resultat reste ici (loupe, export).
  // ia : masque deja calcule (par l'apercu) ; sinon calcule ici si la protection est active.
  // iaGroupe : silhouette de l'IA de groupe (detourage hors du fond vert), calculee par la page.
  async detourer({ params, analyse, renvoyer, type, ia, iaGroupe, retouches }) {
    if (!src) throw new Error('Aucune photo chargée.');
    const t0 = performance.now();
    if (ia) iaPhoto = ia;
    const groupe = iaGroupe && iaGroupe.m ? iaGroupe : null;
    let iaCalcul = null;
    if (params.ia > 0 && !iaPhoto && !groupe) iaPhoto = iaCalcul = await masqueIA(src.data, src.w, src.h, type);
    const rgba = new Uint8ClampedArray(src.data);
    const r = SL.dt.detourer(rgba, src.w, src.h, params, analyse, type,
      { ia: iaPhoto && !iaPhoto.erreur ? iaPhoto : null, iaGroupe: groupe, retouches });
    res = rgba;
    const out = {
      w: src.w, h: src.h, analyse: r.analyse, temps: r.temps, confiance: r.confiance, total: Math.round(performance.now() - t0),
      ia: iaCalcul, iaErreur: iaPhoto && iaPhoto.erreur, groupe: r.groupe,
    };
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

  // Traitement par lot : une photo complete, ecrite en PNG dans `dir` sous le nom `nom`
  // (nom deja choisi par la page : jamais d'ecrasement), plus une vignette pour la galerie.
  // Traitement par lot : une photo complete. Les noms et dossiers de sortie sont choisis par la
  // page (jamais d'ecrasement) : exports = {
  //   png: { dir, nom } | null, masque: { dir, nom } | null, vignette: { dir, nom },
  //   fonds: [{ file, cle, dir, nom }], format: { mime, quality }, mode }
  async traiter({ file, params, type, retouches, exports, iaGroupe }) {
    const t0 = performance.now();
    const meta = await SL.dt.meta.lire(file);
    const bmp = await SL.images.decode(file);
    const img = pixels(bmp);
    bmp.close();
    const { width: w, height: h } = img;
    const groupe = iaGroupe && iaGroupe.m ? iaGroupe : null;
    const ia = params.ia > 0 && !groupe ? await masqueIA(img.data, w, h, type) : null;
    const r = SL.dt.detourer(img.data, w, h, params, null, type, { ia: ia && !ia.erreur ? ia : null, iaGroupe: groupe, retouches });
    const motifs = r.confiance.motifs.map(m => m.texte);
    if (ia && ia.erreur) motifs.push(`IA indisponible (${ia.erreur}) : vêtements verts non protégés.`);
    // Le navigateur convertit JPEG et PNG en sRGB : leur profil d'origine ne s'applique plus.
    // TIFF : couleurs lues telles quelles, le profil d'origine est remis.
    const m = { dpi: meta.dpi, icc: meta.tiff ? meta.icc : null };
    const cv = new OffscreenCanvas(w, h);
    cv.getContext('2d').putImageData(img, 0, 0);
    let taille = 0;
    if (exports.png) {
      const png = await SL.dt.meta.ecrire(await cv.convertToBlob({ type: 'image/png' }), m);
      await SL.fsa.writeFile(exports.png.dir, exports.png.nom, png);
      taille = png.size;
    }
    if (exports.masque) {
      const mc = new OffscreenCanvas(w, h), md = new ImageData(w, h);
      for (let q = 0; q < w * h; q++) { const a = r.alpha[q]; md.data[q * 4] = md.data[q * 4 + 1] = md.data[q * 4 + 2] = a; md.data[q * 4 + 3] = 255; }
      mc.getContext('2d').putImageData(md, 0, 0);
      await SL.fsa.writeFile(exports.masque.dir, exports.masque.nom, await SL.dt.meta.ecrire(await mc.convertToBlob({ type: 'image/png' }), m));
    }
    for (const f of exports.fonds || []) {
      const out = SL.chroma.compose(cv, await fondAjuste(f, w, h, exports.mode), 'stretch');
      const blob = await out.convertToBlob(exports.format);
      await SL.fsa.writeFile(f.dir, f.nom, await SL.dt.meta.ecrire(blob, m));
    }
    const k = Math.min(1, 240 / Math.max(w, h));
    const tv = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    const tctx = tv.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(cv, 0, 0, tv.width, tv.height);
    const vignette = await tv.convertToBlob({ type: 'image/webp', quality: 0.8 });
    if (exports.vignette) await SL.fsa.writeFile(exports.vignette.dir, exports.vignette.nom, vignette);
    return {
      w, h, taille, vignette, duree: Math.round(performance.now() - t0),
      score: r.confiance.score, aVerifier: r.confiance.aVerifier, motifs,
      ia: groupe ? `groupe (${groupe.fournisseur})` : ia ? (ia.erreur ? 'indisponible' : ia.fournisseur) : '',
      dpi: meta.dpi, profil: meta.icc ? (meta.srgb ? 'sRGB' : (meta.tiff ? 'conservé' : 'converti en sRGB')) : '',
      gpu: SL.dt.gpu.utile(w, h),
    };
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
