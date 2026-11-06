// PDF d'une facture (A4) : en-tete, emetteur et client, lignes (quantite x prix unitaire), total,
// detail de la commission (seulement si elle n'est pas a 0 %), puis reglement et conditions en bas
// de page : la feuille reste equilibree meme avec une seule ligne. Plusieurs pages si besoin.
var SL = self.SL = self.SL || {};
SL.facturePdf = (function () {
  const A4 = [595.28, 841.89];
  const M = 50;            // marges laterales
  const BAS = 58;          // au-dessus du pied de page
  let logoBytes = null;

  const ensureLib = () => SL.u.ensurePdfLib();

  const { euros, dateFr } = SL.u;
  const pct = v => `${Number(v).toLocaleString('fr-FR')} %`;
  const nombre = v => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

  // Lignes d'une facture, y compris les anciennes (montant seul : 1 x montant).
  function lignesDe(f) {
    return (f.lignes || []).map(l => {
      const q = Number(l.quantite);
      const quantite = Number.isFinite(q) && q > 0 ? q : 1;
      const pu = Number(l.prix_unitaire);
      return { designation: l.designation, quantite, prix_unitaire: Number.isFinite(pu) ? pu : Number(l.montant) / quantite, montant: Number(l.montant) };
    });
  }

  // La commission (ligne et detail) n'apparait que si elle existe.
  const avecCommission = f => Number(f.taux) > 0;

  async function build(f) {
    const { PDFDocument, StandardFonts, rgb, degrees } = await ensureLib();
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Facture ${f.numero}`);
    pdf.setAuthor((f.emetteur && f.emetteur.enseigne) || 'Studio SLOWIK');
    const [W, H] = A4;
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const dark = rgb(0.12, 0.16, 0.2);
    const grey = rgb(0.45, 0.47, 0.5);
    const light = rgb(0.95, 0.96, 0.97);
    const rule = rgb(0.85, 0.87, 0.9);
    const blue = rgb(0.12, 0.42, 0.65);
    const white = rgb(1, 1, 1);
    let page = pdf.addPage(A4);

    const safe = (t, fnt) => {
      t = String(t ?? '').replace(/[  ]/g, ' ');
      return Array.from(t).map(ch => { try { (fnt || font).widthOfTextAtSize(ch, 10); return ch; } catch (e) { return '?'; } }).join('');
    };
    const text = (t, x, y, opt = {}) => page.drawText(safe(t, opt.font), Object.assign({ x, y, size: 10, font, color: dark }, opt));
    const right = (t, xr, y, opt = {}) => {
      const fnt = opt.font || font, size = opt.size || 10, s = safe(t, fnt);
      page.drawText(s, Object.assign({ x: xr - fnt.widthOfTextAtSize(s, size), y, size, font: fnt, color: dark }, opt));
    };
    // Decoupe un texte en lignes tenant dans une largeur.
    const couper = (t, maxW, fnt = font, size = 10) => {
      const out = [];
      safe(t, fnt).split('\n').forEach(par => {
        let line = '';
        par.split(' ').forEach(w => {
          const test = line ? line + ' ' + w : w;
          if (fnt.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = w; } else line = test;
        });
        out.push(line);
      });
      return out;
    };
    const ecrire = (lignes, x, y, opt = {}) => {
      const size = opt.size || 10, lh = size * 1.4;
      lignes.forEach(l => { if (l) page.drawText(l, { x, y, size, font: opt.font || font, color: opt.color || dark }); y -= lh; });
      return y;
    };
    const etiquette = (t, x, y) => text(t.toUpperCase(), x, y, { size: 7.5, font: bold, color: grey });

    // --- en-tete : logo + enseigne | FACTURE, numero, date ---
    const e = f.emetteur || {};
    const enseigne = e.enseigne || 'Studio SLOWIK';
    let y = H - 48;
    try {
      if (!logoBytes) logoBytes = new Uint8Array(await (await fetch('assets/logo.png')).arrayBuffer());
      const logo = await pdf.embedPng(logoBytes);
      const h = 58, w = logo.width * h / logo.height;
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
      text(enseigne, M + w + 14, y - 24, { font: bold, size: 17 });
      text('Photographie scolaire', M + w + 14, y - 40, { size: 9.5, color: grey });
    } catch (err) {
      text(enseigne, M, y - 24, { font: bold, size: 17 });
      text('Photographie scolaire', M, y - 40, { size: 9.5, color: grey });
    }
    right('FACTURE', W - M, y - 20, { font: bold, size: 24, color: blue });
    right(`N° ${f.numero}`, W - M, y - 40, { font: bold, size: 11 });
    right(`Date : ${dateFr(f.date_facture)}`, W - M, y - 55, { size: 10, color: grey });
    y -= 82;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: blue });

    // --- emetteur | client ---
    y -= 30;
    const em = [e.nom, e.adresse, [e.code_postal, e.ville].filter(Boolean).join(' '),
      e.siret && `SIRET : ${e.siret}`, e.telephone && `Tél. : ${e.telephone}`, e.email].filter(Boolean);
    etiquette('Émetteur', M, y);
    let ye = y - 17;
    em.forEach(l => { text(l, M, ye, { size: 9.5 }); ye -= 13.5; });

    const c = f.client || {};
    const bx = W / 2 + 20, bw = W - M - bx;
    const cl = [c.nom, c.contact_nom && `À l'attention de ${c.contact_nom}`, c.adresse,
      [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean);
    const bh = 34 + cl.length * 14;
    page.drawRectangle({ x: bx, y: y - bh + 14, width: bw, height: bh, color: light });
    page.drawRectangle({ x: bx, y: y - bh + 14, width: 3, height: bh, color: blue });
    etiquette('Facturé à', bx + 14, y);
    let yc = y - 18;
    cl.forEach((l, i) => { text(l, bx + 14, yc, { size: i === 0 ? 11 : 10, font: i === 0 ? bold : font }); yc -= 14; });
    y = Math.min(ye, y - bh + 14) - 40;

    // --- tableau des lignes ---
    const xr = W - M;
    const col = { qte: xr - 205, pu: xr - 95, mt: xr - 12 };   // bords droits des colonnes chiffrees
    const desW = col.qte - 60 - (M + 12);
    const enteteTableau = () => {
      page.drawRectangle({ x: M, y: y - 9, width: W - 2 * M, height: 26, color: dark });
      text('Désignation', M + 12, y, { font: bold, size: 9.5, color: white });
      right('Qté', col.qte, y, { font: bold, size: 9.5, color: white });
      right('Prix unitaire', col.pu, y, { font: bold, size: 9.5, color: white });
      right('Montant', col.mt, y, { font: bold, size: 9.5, color: white });
      y -= 32;
    };
    // nouvelle page quand la place manque (le tableau reprend avec son en-tete)
    const place = (h, tableau) => {
      if (y - h >= BAS + 20) return;
      page = pdf.addPage(A4);
      y = H - 60;
      right(`Facture ${f.numero} (suite)`, W - M, y + 12, { size: 9, color: grey });
      y -= 20;
      if (tableau) enteteTableau();
    };
    enteteTableau();
    lignesDe(f).forEach((l, i) => {
      const ls = couper(l.designation, desW);
      const h = Math.max(1, ls.length) * 14 + 14;
      place(h, true);
      if (i % 2) page.drawRectangle({ x: M, y: y - h + 17, width: W - 2 * M, height: h, color: light });
      ecrire(ls, M + 12, y);
      right(nombre(l.quantite), col.qte, y);
      right(euros(l.prix_unitaire), col.pu, y);
      right(euros(l.montant), col.mt, y, { font: bold });
      y -= h;
    });
    page.drawLine({ start: { x: M, y: y + 17 }, end: { x: xr, y: y + 17 }, thickness: 0.8, color: rule });

    // --- total ---
    place(70, false);
    y -= 14;
    page.drawRectangle({ x: xr - 240, y: y - 11, width: 240, height: 32, color: blue });
    text('Total à payer', xr - 228, y, { font: bold, size: 11.5, color: white });
    right(euros(f.ca), xr - 12, y, { font: bold, size: 13, color: white });
    y -= 30;
    right(e.mention_tva || 'TVA non applicable, art. 293 B du CGI', xr, y, { size: 8.5, color: grey });
    y -= 40;

    // --- repartition de la commission (absente a 0 %) ---
    if (avecCommission(f)) {
      place(90, false);
      page.drawRectangle({ x: M, y: y - 58, width: W - 2 * M, height: 76, borderColor: rule, borderWidth: 1 });
      text('Détail de la répartition du chiffre d\'affaires', M + 14, y, { font: bold, size: 10.5 });
      text('Chiffre d\'affaires réalisé', M + 14, y - 19);
      right(euros(f.ca), xr - 14, y - 19);
      text(`Commission reversée à l'établissement (${pct(f.taux)})`, M + 14, y - 34);
      right(euros(f.commission), xr - 14, y - 34);
      text(`Part ${enseigne}`, M + 14, y - 50, { font: bold });
      right(euros(f.net), xr - 14, y - 50, { font: bold });
      y -= 100;
    }

    // --- note ---
    if (f.notes) {
      const ln = couper(f.notes, W - 2 * M, font, 9.5);
      place(ln.length * 13.3 + 30, false);
      etiquette('Note', M, y);
      y = ecrire(ln, M, y - 16, { size: 9.5 }) - 20;
    }

    // --- reglement et conditions : en bas de la derniere page ---
    const cond = e.conditions ? couper(e.conditions, W - 2 * M, font, 8.5) : [];
    const hBas = 28 + (e.iban ? 18 : 0) + cond.length * 11.9 + 26;
    if (y - hBas < BAS) { page = pdf.addPage(A4); y = H - 60; }
    let yb = BAS + hBas;
    page.drawLine({ start: { x: M, y: yb }, end: { x: xr, y: yb }, thickness: 0.8, color: rule });
    yb -= 20;
    etiquette('Règlement', M, yb);
    yb -= 17;
    if (e.iban) { text(`Par virement - IBAN : ${e.iban}`, M, yb, { size: 9.5 }); yb -= 18; }
    if (cond.length) yb = ecrire(cond, M, yb, { size: 8.5, color: grey });
    text('Merci de votre confiance.', M, yb - 8, { size: 9.5, font: bold, color: blue });

    // --- annulee, pied de page sur chaque page ---
    const foot = safe([enseigne, e.nom, e.siret && `SIRET ${e.siret}`, e.mention_tva].filter(Boolean).join(' - '));
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      if (f.statut === 'annulee') {
        p.drawText('ANNULÉE', { x: 150, y: 380, size: 90, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.25, rotate: degrees(30) });
      }
      p.drawText(foot, { x: (W - font.widthOfTextAtSize(foot, 8)) / 2, y: 30, size: 8, font, color: grey });
      if (pages.length > 1) {
        const n = `${i + 1} / ${pages.length}`;
        p.drawText(n, { x: W - M - font.widthOfTextAtSize(n, 8), y: 30, size: 8, font, color: grey });
      }
    });
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  async function download(f) {
    SL.u.download(await build(f), `Facture-${f.numero}-${SL.naming.clean(f.client && f.client.nom || '')}.pdf`);
  }

  return { build, download, euros, dateFr, lignesDe, avecCommission };
})();
