// Planche de demande PDF : fonds et classes numerotes + tableau croise a remplir (cases remplissables).
// Le PDF rempli par l'ecole peut etre reimporte pour remplir les choix automatiquement.
var SL = self.SL = self.SL || {};
SL.plancheDemande = (function () {
  const A4 = [595.28, 841.89];
  const A4L = [841.89, 595.28];
  const M = 36;                       // marge (points)
  const BLUE = [0.12, 0.42, 0.65];
  const FIELD = /^c(\d+)_f(\d+)$/;    // nom des cases : c{classe}_f{fond}

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

  // Image -> JPEG (octets), eventuellement posee sur un fond uni (PNG detoure).
  async function jpegBytes(blob, maxSize, bg) {
    const { img, url } = await SL.localChoix.loadImg(blob);
    const s = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * s));
    cv.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bg || '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
    return new Uint8Array(await out.arrayBuffer());
  }

  async function build(ecole) {
    const { PDFDocument, StandardFonts, rgb, TextAlignment } = await ensureLib();
    const [fonds, classes] = await Promise.all([SL.localChoix.fonds.list(), SL.localChoix.groupes.list()]);
    const fs = fonds.filter(f => f.actif);
    if (!fs.length) throw new Error('Ajoutez au moins un fond.');
    if (!classes.length) throw new Error('Ajoutez au moins une classe.');

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Choix des fonds${ecole ? ' - ' + ecole : ''}`);
    pdf.setAuthor('Studio SLOWIK');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const form = pdf.getForm();
    const color = c => rgb(c[0], c[1], c[2]);
    const grey = rgb(0.45, 0.45, 0.45);
    const line = rgb(0.6, 0.6, 0.6);

    // Texte sans caractere non imprimable par la police standard.
    const safe = (t, f) => {
      t = String(t ?? '');
      try { (f || font).widthOfTextAtSize(t, 10); return t; } catch (e) {
        return Array.from(t).map(ch => { try { (f || font).widthOfTextAtSize(ch, 10); return ch; } catch (e2) { return '?'; } }).join('');
      }
    };
    const fit = (t, f, size, maxW) => {
      t = safe(t, f);
      while (t.length > 1 && f.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…';
      return t;
    };
    const titre = `Choix des fonds - photos de groupe offertes`;
    const sousTitre = [ecole, new Date().toLocaleDateString('fr-FR')].filter(Boolean).join(' - ');

    // ---------- pages de presentation (portrait) ----------
    let page = pdf.addPage(A4);
    let y = A4[1] - M;
    const W = A4[0] - 2 * M;
    const header = (p, yy, landscape) => {
      p.drawText('Studio SLOWIK', { x: M, y: yy - 12, size: 10, font: bold, color: color(BLUE) });
      p.drawText(safe(titre, bold), { x: M, y: yy - 32, size: 17, font: bold });
      if (sousTitre) p.drawText(safe(sousTitre), { x: M, y: yy - 48, size: 11, font, color: grey });
      return yy - (sousTitre ? 62 : 46);
    };
    y = header(page, y);
    const consignes = [
      'Pour chaque classe, indiquez dans le tableau (dernière(s) page(s)) le nombre d\'exemplaires souhaités',
      'pour chaque fond. Le total d\'une ligne ne doit pas dépasser le nombre d\'exemplaires offerts.',
      'Vous pouvez remplir les cases directement sur ordinateur, ou imprimer et écrire à la main,',
      'puis renvoyer ce document à Studio SLOWIK.',
    ];
    consignes.forEach(t => { page.drawText(safe(t), { x: M, y, size: 10, font }); y -= 14; });
    y -= 10;

    const newPortrait = () => { page = pdf.addPage(A4); y = A4[1] - M; };
    const section = t => {
      if (y < M + 60) newPortrait();
      page.drawText(safe(t, bold), { x: M, y: y - 14, size: 13, font: bold });
      y -= 26;
    };
    const badge = (p, x, yTop, text, size) => {
      const w = bold.widthOfTextAtSize(text, size) + 10;
      p.drawRectangle({ x, y: yTop - size - 6, width: w, height: size + 6, color: color(BLUE) });
      p.drawText(text, { x: x + 5, y: yTop - size - 2, size, font: bold, color: rgb(1, 1, 1) });
    };

    // Grille d'images : cols colonnes, rapport hauteur/largeur ratio.
    async function grid(items, cols, ratio, draw) {
      const gap = 10;
      const cw = (W - gap * (cols - 1)) / cols;
      const ch = cw * ratio;
      for (let i = 0; i < items.length; i += cols) {
        if (y - ch - 18 < M) newPortrait();
        for (let k = 0; k < cols && i + k < items.length; k++) {
          await draw(items[i + k], M + k * (cw + gap), y, cw, ch);
        }
        y -= ch + 24;
      }
    }

    section('Les fonds');
    await grid(fs, 4, 0.75, async (f, x, top, w, h) => {
      const im = await pdf.embedJpg(await jpegBytes(f.blob, 500));
      const k = Math.min(w / im.width, h / im.height);
      page.drawRectangle({ x, y: top - h, width: w, height: h, color: rgb(0.93, 0.93, 0.93) });
      page.drawImage(im, { x: x + (w - im.width * k) / 2, y: top - h + (h - im.height * k) / 2, width: im.width * k, height: im.height * k });
      badge(page, x + 4, top - 4, `Fond ${f.numero}`, 11);
      page.drawText(fit(f.nom, font, 8, w), { x, y: top - h - 11, size: 8, font, color: grey });
    });

    section('Les classes');
    await grid(classes, 3, 2 / 3, async (g, x, top, w, h) => {
      page.drawRectangle({ x, y: top - h, width: w, height: h, color: rgb(0.91, 0.91, 0.91) });
      if (g.photo) {
        const im = await pdf.embedJpg(await jpegBytes(g.photo, 700, '#e8e8e8'));
        const k = Math.min(w / im.width, h / im.height);
        page.drawImage(im, { x: x + (w - im.width * k) / 2, y: top - h + (h - im.height * k) / 2, width: im.width * k, height: im.height * k });
      }
      badge(page, x + 4, top - 4, `Classe ${g.numero}`, 11);
      page.drawText(safe(`${g.nb} exemplaire(s) offert(s)`), { x, y: top - h - 11, size: 8, font, color: grey });
    });

    // ---------- tableau croise (paysage), cases remplissables ----------
    const LW = A4L[0] - 2 * M;
    const c1 = 70, c2 = 70;                  // Classe | Exemplaires offerts
    const minCol = 36, maxCol = 64;
    const perPage = Math.max(1, Math.floor((LW - c1 - c2) / minCol));
    const chunks = [];
    for (let i = 0; i < fs.length; i += perPage) chunks.push(fs.slice(i, i + perPage));
    const rowH = 22, headH = 44;
    const thumbs = {};
    for (const f of fs) thumbs[f.id] = await pdf.embedJpg(await jpegBytes(f.blob, 160));

    for (const [ci, cols] of chunks.entries()) {
      const colW = Math.min(maxCol, (LW - c1 - c2) / cols.length);
      let idx = 0;
      while (idx < classes.length) {
        const p = pdf.addPage(A4L);
        let yy = header(p, A4L[1] - M, true);
        const suite = chunks.length > 1 ? ` (fonds ${cols[0].numero} à ${cols[cols.length - 1].numero})` : '';
        p.drawText(safe(`Tableau à remplir${suite} : nombre d'exemplaires par fond`, bold), { x: M, y: yy - 4, size: 12, font: bold });
        yy -= 16;
        // en-tete
        const top = yy;
        const cell = (x, yTop, w, h) => p.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: line, borderWidth: 0.6 });
        cell(M, top, c1, headH); cell(M + c1, top, c2, headH);
        p.drawText('Classe', { x: M + 6, y: top - 26, size: 10, font: bold });
        p.drawText('Exemplaires', { x: M + c1 + 6, y: top - 20, size: 9, font: bold });
        p.drawText('offerts', { x: M + c1 + 6, y: top - 31, size: 9, font: bold });
        cols.forEach((f, k) => {
          const x = M + c1 + c2 + k * colW;
          p.drawRectangle({ x, y: top - headH, width: colW, height: headH, borderColor: line, borderWidth: 0.6, color: rgb(0.95, 0.97, 1) });
          const im = thumbs[f.id];
          const tw = colW - 8, th = 20;
          const kk = Math.min(tw / im.width, th / im.height);
          p.drawImage(im, { x: x + (colW - im.width * kk) / 2, y: top - 4 - im.height * kk, width: im.width * kk, height: im.height * kk });
          const label = `Fond ${f.numero}`;
          const size = Math.min(9, (colW - 4) / bold.widthOfTextAtSize(label, 1));
          p.drawText(label, { x: x + (colW - bold.widthOfTextAtSize(label, size)) / 2, y: top - headH + 6, size, font: bold, color: color(BLUE) });
        });
        // lignes
        let ry = top - headH;
        while (idx < classes.length && ry - rowH > M + 24) {
          const g = classes[idx];
          cell(M, ry, c1, rowH); cell(M + c1, ry, c2, rowH);
          p.drawText(`Classe ${g.numero}`, { x: M + 6, y: ry - 15, size: 10, font: bold });
          p.drawText(String(g.nb), { x: M + c1 + c2 / 2 - 3, y: ry - 15, size: 10, font });
          cols.forEach((f, k) => {
            const x = M + c1 + c2 + k * colW;
            const tf = form.createTextField(`c${g.numero}_f${f.numero}`);
            if (g.choix[f.id]) tf.setText(String(g.choix[f.id]));
            tf.setAlignment(TextAlignment.Center);
            tf.setMaxLength(2);
            tf.addToPage(p, { x: x + 1, y: ry - rowH + 1, width: colW - 2, height: rowH - 2, borderWidth: 0.6, borderColor: line, backgroundColor: rgb(1, 1, 1), font });
            tf.setFontSize(11);
          });
          ry -= rowH;
          idx++;
        }
        p.drawText(safe('Merci de renvoyer ce document rempli à Studio SLOWIK.'), { x: M, y: M - 6, size: 9, font, color: grey });
      }
    }
    form.updateFieldAppearances(font);

    // numeros de page
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      const t = `${i + 1} / ${pages.length}`;
      p.drawText(t, { x: p.getWidth() - M - font.widthOfTextAtSize(t, 9), y: M - 6, size: 9, font, color: grey });
    });
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  // Lit les cases du PDF renvoye et remplit les choix. Retourne un compte rendu.
  async function importFilled(file) {
    const { PDFDocument } = await ensureLib();
    let pdf;
    try { pdf = await PDFDocument.load(await file.arrayBuffer()); } catch (e) { throw new Error('PDF illisible.'); }
    const [fonds, classes] = await Promise.all([SL.localChoix.fonds.list(), SL.localChoix.groupes.list()]);
    const values = {};   // numero classe -> { fondId: qty }
    let cases = 0;
    const errors = [];
    for (const field of pdf.getForm().getFields()) {
      const m = FIELD.exec(field.getName());
      if (!m || !field.getText) continue;
      cases++;
      const txt = (field.getText() || '').trim();
      if (!txt) continue;
      const q = parseInt(txt, 10);
      const g = classes.find(c => c.numero === +m[1]);
      const f = fonds.find(x => x.numero === +m[2]);
      if (!g || !f) continue;
      if (!(q >= 0)) { errors.push(`Classe ${m[1]}, fond ${m[2]} : « ${txt} » n'est pas un nombre.`); continue; }
      (values[g.numero] = values[g.numero] || {})[f.id] = q;
    }
    if (!cases) throw new Error("Ce PDF ne contient pas le tableau à remplir (ou il a été imprimé puis scanné : saisissez les choix à la main).");
    let applied = 0;
    for (const g of classes) {
      const v = values[g.numero];
      if (!v) continue;
      const tot = Object.values(v).reduce((a, b) => a + b, 0);
      if (tot > g.nb) { errors.push(`Classe ${g.numero} : ${tot} exemplaires demandés pour ${g.nb} offert(s), non importée.`); continue; }
      await SL.localChoix.groupes.replaceChoix(g.id, v);
      applied++;
    }
    return { applied, errors };
  }

  return { build, importFilled };
})();
