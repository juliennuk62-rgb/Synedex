// PDF d'une facture (A4) : logo, coordonnees, client, lignes, total, repartition de la commission.
var SL = self.SL = self.SL || {};
SL.facturePdf = (function () {
  const M = 46;
  let logoBytes = null;

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

  // Montant en euros, sans espaces speciaux (non imprimables par la police standard).
  const euros = v => Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
    .replace(/[  ]/g, ' ');
  const dateFr = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR');
  const pct = v => `${Number(v).toLocaleString('fr-FR')} %`;

  async function build(f) {
    const { PDFDocument, StandardFonts, rgb, degrees } = await ensureLib();
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Facture ${f.numero}`);
    pdf.setAuthor(f.emetteur.enseigne || 'Studio SLOWIK');
    const page = pdf.addPage([595.28, 841.89]);
    const W = page.getWidth();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const dark = rgb(0.12, 0.16, 0.2);
    const grey = rgb(0.42, 0.42, 0.42);
    const light = rgb(0.94, 0.95, 0.96);
    const blue = rgb(0.12, 0.42, 0.65);

    const safe = (t, fnt) => {
      t = String(t ?? '').replace(/[  ]/g, ' ');
      return Array.from(t).map(ch => { try { (fnt || font).widthOfTextAtSize(ch, 10); return ch; } catch (e) { return '?'; } }).join('');
    };
    const text = (t, x, y, opt = {}) => page.drawText(safe(t, opt.font), Object.assign({ x, y, size: 10, font, color: dark }, opt));
    const right = (t, xr, y, opt = {}) => {
      const fnt = opt.font || font;
      const size = opt.size || 10;
      const s = safe(t, fnt);
      page.drawText(s, Object.assign({ x: xr - fnt.widthOfTextAtSize(s, size), y, size, font: fnt, color: dark }, opt));
    };
    // Texte sur plusieurs lignes dans une largeur donnee ; retourne le y suivant.
    const wrap = (t, x, y, maxW, opt = {}) => {
      const fnt = opt.font || font;
      const size = opt.size || 10;
      const lh = size * 1.35;
      safe(t, fnt).split('\n').forEach(par => {
        let line = '';
        par.split(' ').forEach(w => {
          const test = line ? line + ' ' + w : w;
          if (fnt.widthOfTextAtSize(test, size) > maxW && line) {
            page.drawText(line, { x, y, size, font: fnt, color: opt.color || dark });
            y -= lh;
            line = w;
          } else line = test;
        });
        if (line) { page.drawText(line, { x, y, size, font: fnt, color: opt.color || dark }); y -= lh; }
      });
      return y;
    };

    // --- en-tete : logo + emetteur | FACTURE ---
    const e = f.emetteur || {};
    let y = 841.89 - M;
    try {
      if (!logoBytes) logoBytes = new Uint8Array(await (await fetch('assets/logo.png')).arrayBuffer());
      const logo = await pdf.embedPng(logoBytes);
      const h = 54;
      const w = logo.width * h / logo.height;
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
      text(e.enseigne || 'Studio SLOWIK', M + w + 12, y - 22, { font: bold, size: 16 });
      text('Photographie scolaire', M + w + 12, y - 38, { size: 9, color: grey });
    } catch (err) {
      text(e.enseigne || 'Studio SLOWIK', M, y - 22, { font: bold, size: 16 });
    }
    right('FACTURE', W - M, y - 18, { font: bold, size: 20, color: blue });
    right(`N° ${f.numero}`, W - M, y - 36, { font: bold, size: 11 });
    right(`Date : ${dateFr(f.date_facture)}`, W - M, y - 51, { size: 10 });

    y -= 82;
    const emLines = [
      e.nom, e.adresse, [e.code_postal, e.ville].filter(Boolean).join(' '),
      e.siret && `SIRET : ${e.siret}`, e.telephone && `Tél. : ${e.telephone}`, e.email,
    ].filter(Boolean);
    let ye = y;
    emLines.forEach(l => { text(l, M, ye, { size: 9.5 }); ye -= 13; });

    // --- client ---
    const c = f.client || {};
    const bx = W / 2 + 10, bw = W - M - bx;
    const cl = [c.nom, c.contact_nom && `À l'attention de ${c.contact_nom}`, c.adresse,
      [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean);
    const bh = 22 + cl.length * 13;
    page.drawRectangle({ x: bx, y: y - bh + 12, width: bw, height: bh, color: light });
    text('Facturé à', bx + 10, y - 2, { size: 8.5, color: grey });
    let yc = y - 16;
    cl.forEach((l, i) => { text(l, bx + 10, yc, { size: 10, font: i === 0 ? bold : font }); yc -= 13; });

    y = Math.min(ye, y - bh) - 22;

    // --- lignes ---
    const xr = W - M;
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: dark });
    text('Désignation', M + 10, y + 1, { font: bold, color: rgb(1, 1, 1) });
    right('Montant', xr - 10, y + 1, { font: bold, color: rgb(1, 1, 1) });
    y -= 26;
    (f.lignes || []).forEach(l => {
      const yStart = y;
      y = wrap(l.designation, M + 10, y, W - 2 * M - 130);
      right(euros(l.montant), xr - 10, yStart);
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: xr, y: y + 4 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 10;
    });

    // --- total ---
    y -= 4;
    page.drawRectangle({ x: xr - 230, y: y - 8, width: 230, height: 26, color: light });
    text('Total à payer', xr - 220, y, { font: bold, size: 11 });
    right(euros(f.ca), xr - 10, y, { font: bold, size: 12 });
    y -= 22;
    text(e.mention_tva || 'TVA non applicable, art. 293 B du CGI', xr - 230, y, { size: 8.5, color: grey });

    // --- repartition de la commission ---
    y -= 34;
    page.drawRectangle({ x: M, y: y - 52, width: W - 2 * M, height: 68, borderColor: rgb(0.8, 0.85, 0.9), borderWidth: 1 });
    text('Détail de la répartition du chiffre d\'affaires', M + 12, y, { font: bold, size: 10.5 });
    text(`Chiffre d'affaires réalisé`, M + 12, y - 17);
    right(euros(f.ca), xr - 12, y - 17);
    text(`Commission reversée à l'établissement (${pct(f.taux)})`, M + 12, y - 31);
    right(euros(f.commission), xr - 12, y - 31);
    text(`Part ${e.enseigne || 'Studio SLOWIK'}`, M + 12, y - 45, { font: bold });
    right(euros(f.net), xr - 12, y - 45, { font: bold });
    y -= 76;

    // --- notes, paiement, conditions ---
    if (f.notes) { y = wrap(f.notes, M, y, W - 2 * M, { size: 9.5 }); y -= 8; }
    if (e.iban) { text(`Règlement par virement - IBAN : ${e.iban}`, M, y, { size: 9.5 }); y -= 16; }
    if (e.conditions) y = wrap(e.conditions, M, y, W - 2 * M, { size: 8.5, color: grey });
    if (f.statut === 'annulee') {
      page.drawText('ANNULÉE', { x: 150, y: 380, size: 90, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.25, rotate: degrees(30) });
    }

    // --- pied de page ---
    const foot = [e.enseigne || 'Studio SLOWIK', e.nom, e.siret && `SIRET ${e.siret}`, e.mention_tva].filter(Boolean).join(' - ');
    const fs = safe(foot);
    page.drawText(fs, { x: (W - font.widthOfTextAtSize(fs, 8)) / 2, y: 28, size: 8, font, color: grey });
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  async function download(f) {
    const blob = await build(f);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Facture-${f.numero}-${SL.naming.clean(f.client && f.client.nom || '')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  return { build, download, euros, dateFr };
})();
