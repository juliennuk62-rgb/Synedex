// Recherche et lecture des images (y compris TIFF).
var SL = self.SL = self.SL || {};
SL.images = (function () {
  const EXTS = ['.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.tif', '.tiff', '.bmp', '.webp', '.gif'];
  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  const compare = (a, b) => collator.compare(a.name, b.name);

  function isImage(name) {
    return EXTS.includes(SL.naming.extension(name)) && !name.startsWith('.') && !name.startsWith('~');
  }

  async function listImages(dir) {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && isImage(name)) out.push({ name, handle });
    }
    return out.sort(compare);
  }

  async function isExcluded(handle, exclude) {
    for (const e of exclude) {
      if (e && e.kind === 'directory' && await handle.isSameEntry(e)) return true;
    }
    return false;
  }

  // Photos sources. En mode recursif, chaque sous-dossier = une classe.
  async function scanSources(dir, recursive, exclude) {
    const items = [];
    async function walk(d, path) {
      const files = [];
      const dirs = [];
      for await (const [name, handle] of d.entries()) {
        if (handle.kind === 'file') {
          if (isImage(name)) files.push({ name, handle });
        } else if (recursive && !name.startsWith('.') && !(await isExcluded(handle, exclude || []))) {
          dirs.push({ name, handle });
        }
      }
      files.sort(compare).forEach(f => items.push({
        name: f.name, handle: f.handle, classPath: path, classe: path.join('/'),
      }));
      for (const sub of dirs.sort(compare)) await walk(sub.handle, path.concat(sub.name));
    }
    await walk(dir, []);
    return items;
  }

  function isTiff(name) {
    const e = SL.naming.extension(name);
    return e === '.tif' || e === '.tiff';
  }

  async function decodeTiff(file) {
    if (!self.UTIF) throw new Error('lecteur TIFF non chargé');
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    let best = null;
    let bestArea = 0;
    for (const ifd of ifds) {
      const w = ifd.t256 ? ifd.t256[0] : 0;
      const h = ifd.t257 ? ifd.t257[0] : 0;
      if (w * h > bestArea) { best = ifd; bestArea = w * h; }
    }
    if (!best) throw new Error('TIFF illisible');
    UTIF.decodeImage(buf, best, ifds);
    const rgba = UTIF.toRGBA8(best);
    const data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, best.width * best.height * 4),
      best.width, best.height);
    return createImageBitmap(data);
  }

  // Retourne un ImageBitmap, reduit a maxSize (cote le plus long) si demande.
  async function decode(file, maxSize) {
    let bmp = isTiff(file.name)
      ? await decodeTiff(file)
      : await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (maxSize && Math.max(bmp.width, bmp.height) > maxSize) {
      const scale = maxSize / Math.max(bmp.width, bmp.height);
      const small = await createImageBitmap(bmp, {
        resizeWidth: Math.max(1, Math.round(bmp.width * scale)),
        resizeHeight: Math.max(1, Math.round(bmp.height * scale)),
        resizeQuality: 'high',
      });
      bmp.close();
      bmp = small;
    }
    return bmp;
  }

  // Version allegee en JPEG (pour l'envoi en ligne). Fonctionne aussi sur telephone.
  async function toJpeg(file, maxSize, quality) {
    const bmp = await decode(file);
    const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return cv.convertToBlob({ type: 'image/jpeg', quality: quality || 0.85 });
  }

  return { isImage, listImages, scanSources, decode, toJpeg };
})();
