// Assembler un PDF : les pages sont regroupees 2 par 2 l'une au-dessus de l'autre (1 sur 2, 3 sur 4...).
// Deux pages paysage deviennent une page portrait ; rien n'est coupe ni reimprime en image : chaque
// page est reprise telle quelle (texte et images nets). Nombre impair : la derniere page est seule en haut.
var SL = self.SL = self.SL || {};
SL.pdfAssembler = (function () {
  const A4 = { w: 595.28, h: 841.89 };   // points (1/72 de pouce)

  // Page telle qu'on la voit : zone visible (CropBox) et rotation de la page.
  function vue(page) {
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const tourne = rot === 90 || rot === 270;
    return { box, rot, w: tourne ? box.height : box.width, h: tourne ? box.width : box.height };
  }

  // Dessine la page integree (non tournee) pour qu'elle apparaisse comme dans le PDF d'origine,
  // dans le rectangle (x, y, largeur w*k, hauteur h*k) de la nouvelle page.
  function poser(PDFLib, page, emb, v, x, y, k) {
    const { degrees } = PDFLib;
    const bw = v.box.width * k, bh = v.box.height * k;
    const o = { xScale: k, yScale: k };
    // /Rotate tourne la page dans le sens des aiguilles d'une montre a l'affichage
    if (v.rot === 0) Object.assign(o, { x, y });
    if (v.rot === 90) Object.assign(o, { x, y: y + bw, rotate: degrees(-90) });
    if (v.rot === 180) Object.assign(o, { x: x + bw, y: y + bh, rotate: degrees(180) });
    if (v.rot === 270) Object.assign(o, { x: x + bh, y, rotate: degrees(90) });
    page.drawPage(emb, o);
  }

  // octets : le PDF d'origine. format : 'reel' (aucune reduction) ou 'a4' (feuille A4 portrait).
  // Retourne { octets, pages (avant), feuilles (apres), taille: { w, h } en points }.
  async function assembler(octets, { format = 'reel' } = {}) {
    const PDFLib = self.PDFLib || await SL.u.ensurePdfLib();
    const { PDFDocument } = PDFLib;
    let src;
    try {
      src = await PDFDocument.load(octets, { ignoreEncryption: true, updateMetadata: false });
    } catch (e) {
      throw new Error('Ce fichier n\'est pas un PDF lisible.');
    }
    const pages = src.getPages();
    if (!pages.length) throw new Error('Ce PDF ne contient aucune page.');
    const vues = pages.map(vue);
    const out = await PDFDocument.create();
    const integrees = await out.embedPages(pages, vues.map(v => ({
      left: v.box.x, bottom: v.box.y, right: v.box.x + v.box.width, top: v.box.y + v.box.height,
    })));
    // taille commune de toutes les feuilles : la plus grande paire (pages de tailles differentes centrees)
    let W = 0, H = 0;
    for (let i = 0; i < vues.length; i += 2) {
      const a = vues[i], b = vues[i + 1] || { w: a.w, h: a.h };
      W = Math.max(W, a.w, b.w);
      H = Math.max(H, a.h + b.h, 2 * a.h);
    }
    const reel = format !== 'a4';
    const fw = reel ? W : A4.w, fh = reel ? H : A4.h;
    for (let i = 0; i < vues.length; i += 2) {
      const feuille = out.addPage([fw, fh]);
      [i, i + 1].forEach((j, haut0) => {
        const v = vues[j];
        if (!v) return;
        const enHaut = haut0 === 0;
        // moitie haute ou basse de la feuille ; la page y est centree (et reduite en A4)
        const zh = fh / 2, zy = enHaut ? fh / 2 : 0;
        const k = reel ? Math.min(1, fw / v.w, zh / v.h) : Math.min(fw / v.w, zh / v.h);
        const x = (fw - v.w * k) / 2;
        const y = reel
          ? (enHaut ? fh - v.h * k : 0)            // taille reelle : les deux pages se touchent au milieu
          : zy + (zh - v.h * k) / 2;
        poser(PDFLib, feuille, integrees[j], v, x, y, k);
      });
    }
    out.setTitle(src.getTitle() || 'PDF assemblé');
    out.setProducer('Studio SLOWIK');
    const octetsSortie = await out.save();
    return { octets: octetsSortie, pages: pages.length, feuilles: out.getPageCount(), taille: { w: fw, h: fh } };
  }

  // Taille en cm pour l'affichage (« 29,7 × 42 cm »).
  const cm = pt => (Math.round(pt / 72 * 2.54 * 10) / 10).toLocaleString('fr-FR');

  return { assembler, cm, A4 };
})();
