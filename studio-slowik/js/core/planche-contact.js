// Planche contact PDF (A4) : grille de vignettes, nom du fichier sous chaque photo, en-tete ecole / classe.
var SL = self.SL = self.SL || {};
SL.plancheContact = (function () {
  const A4 = [595.28, 841.89];
  const M = 28;
  const GRILLES = { '3x4': [3, 4], '4x5': [4, 5], '5x6': [5, 6] };

  async function ensureLib() {
    if (self.PDFLib) return self.PDFLib;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/pdf-lib.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Module PDF introuvable (ouvrez le site une fois avec Internet).'));
      document.head.appendChild(s);
    });
    return self.PDFLib;
  }

  async function thumbJpeg(file, maxSize) {
    const bmp = await SL.images.decode(file, maxSize);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // photos : [{ name, file() }] ; opts : { ecole, classe, grille, onProgress(i, n) }
  async function build(photos, opts) {
    const { PDFDocument, StandardFonts, rgb } = await ensureLib();
    const [cols, rows] = GRILLES[opts.grille] || GRILLES['4x5'];
    const perPage = cols * rows;
    const pdf = await PDFDocument.create();
    const titre = [opts.ecole, opts.classe].filter(Boolean).join(' - ') || 'Planche contact';
    pdf.setTitle(`Planche contact - ${titre}`);
    pdf.setAuthor('Studio SLOWIK');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const grey = rgb(0.4, 0.4, 0.4);
    const safe = (t, f) => Array.from(String(t ?? '').replace(/[  ]/g, ' '))
      .map(ch => { try { (f || font).widthOfTextAtSize(ch, 9); return ch; } catch (e) { return '?'; } }).join('');
    const fit = (t, f, size, maxW) => {
      t = safe(t, f);
      if (f.widthOfTextAtSize(t, size) <= maxW) return t;
      while (t.length > 3 && f.widthOfTextAtSize('…' + t, size) > maxW) t = t.slice(1);
      return '…' + t; // garde la fin du nom (souvent le numero)
    };

    const pages = Math.max(1, Math.ceil(photos.length / perPage));
    const headH = 46;
    const gap = 8;
    const labelH = 20;
    const cw = (A4[0] - 2 * M - gap * (cols - 1)) / cols;
    const ch = (A4[1] - 2 * M - headH - 14 - gap * (rows - 1)) / rows;
    const imgH = ch - labelH;
    const thumbPx = Math.round(Math.max(cw, imgH) * 2.2); // ~160 dpi

    for (let p = 0; p < pages; p++) {
      const page = pdf.addPage(A4);
      const top = A4[1] - M;
      page.drawText('Studio SLOWIK', { x: M, y: top - 10, size: 9, font: bold, color: rgb(0.12, 0.42, 0.65) });
      page.drawText(fit(titre, bold, 16, A4[0] - 2 * M - 120), { x: M, y: top - 30, size: 16, font: bold });
      const info = safe(`${photos.length} photo(s) - page ${p + 1} / ${pages}`);
      page.drawText(info, { x: A4[0] - M - font.widthOfTextAtSize(info, 9), y: top - 28, size: 9, font, color: grey });
      page.drawLine({ start: { x: M, y: top - headH + 6 }, end: { x: A4[0] - M, y: top - headH + 6 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) });

      for (let k = 0; k < perPage; k++) {
        const i = p * perPage + k;
        if (i >= photos.length) break;
        if (opts.onProgress) opts.onProgress(i + 1, photos.length);
        const ph = photos[i];
        const x = M + (k % cols) * (cw + gap);
        const yTop = top - headH - 4 - Math.floor(k / cols) * (ch + gap);
        try {
          const im = await pdf.embedJpg(await thumbJpeg(await ph.file(), thumbPx));
          const s = Math.min(cw / im.width, imgH / im.height);
          const w = im.width * s, h = im.height * s;
          page.drawImage(im, { x: x + (cw - w) / 2, y: yTop - imgH + (imgH - h) / 2, width: w, height: h });
        } catch (e) {
          page.drawRectangle({ x, y: yTop - imgH, width: cw, height: imgH, color: rgb(0.93, 0.93, 0.93) });
          page.drawText('illisible', { x: x + 6, y: yTop - imgH / 2, size: 8, font, color: grey });
        }
        // Nom sur 1 ou 2 lignes ; si trop long, la fin est raccourcie.
        const full = safe(ph.name);
        let l1 = full;
        let l2 = '';
        if (font.widthOfTextAtSize(full, 7) > cw) {
          let cut = full.length;
          while (cut > 1 && font.widthOfTextAtSize(full.slice(0, cut), 7) > cw) cut--;
          l1 = full.slice(0, cut);
          l2 = fit(full.slice(cut), font, 7, cw);
        }
        [l1, l2].forEach((t, j) => {
          if (t) page.drawText(t, { x: x + (cw - font.widthOfTextAtSize(t, 7)) / 2, y: yTop - imgH - 8 - j * 8.5, size: 7, font });
        });
      }
    }
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  return { build, GRILLES };
})();
