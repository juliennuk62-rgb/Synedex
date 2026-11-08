// Dessine les fonds de photo de classe (24 x 18 cm, 300 dpi) dans Chromium, selon CONSIGNES.md.
// Usage, depuis studio-slowik/ : node fonds-classe/generer.mjs
// Produit fonds-classe/saisons/{printemps,ete,automne,hiver}.jpg et fonds-classe/apercu-saisons.jpg
// (les 4 fonds avec un groupe temoin et le texte, pour verifier la mise en page).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
// Playwright du projet (npm install) ou celui deja installe sur la machine.
const { chromium } = createRequire(import.meta.url)('playwright');

// --- code execute dans la page ---------------------------------------------------------------
function dessiner({ saison, temoin }) {
  const W = 2835, H = 2126, CM = W / 24;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  let c = cv.getContext('2d');
  // Dessin flou : fait sur un calque a part, puis flouté en une seule fois (bien plus rapide).
  function flou(px, dessin) {
    // calque plus grand que la feuille : le flou ne s'estompe pas sur les bords
    const M = Math.ceil(px * 3), principal = c, calque = document.createElement('canvas');
    calque.width = W + 2 * M; calque.height = H + 2 * M;
    c = calque.getContext('2d'); c.translate(M, M); dessin(); c = principal;
    c.save(); c.filter = `blur(${px}px)`; c.drawImage(calque, -M, -M); c.restore();
  }
  const X = v => v * CM;

  // Hasard reproductible : l'arbre est le meme pour toutes les saisons.
  const hasard = graine => () => {
    graine |= 0; graine = graine + 0x6D2B79F5 | 0;
    let t = Math.imul(graine ^ graine >>> 15, 1 | graine);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rA = hasard(7);                         // arbre
  const rS = hasard({ printemps: 11, ete: 12, automne: 13, hiver: 14 }[saison]);
  const entre = (r, a, b) => a + r() * (b - a);
  const choix = (r, l) => l[Math.floor(r() * l.length)];

  const PAL = {
    printemps: {
      ciel: ['#86b2dc', '#a9c9e6', '#e9dcdc', '#f4e3d6'], nuages: 'rgba(255,255,255,0.55)',
      collines: ['#b9c8d6', '#a8bcb4', '#97b38f'], sol: ['#b4cc86', '#97b860', '#7ea24a', '#6b8f3e'],
      herbe: ['#8db556', '#a3c46a', '#79a044'], tronc: ['#5b4436', '#6e5444', '#4a372c'],
      feuilles: ['#e08aa6', '#ec9db6', '#f2b3c6', '#f6c9d6', '#f9d8e2', '#fce8ee', '#ffffff'], pousses: '#b9d77a',
      bosquets: ['#8aa58a', '#9bb39a'],
      lumiere: 'rgba(255,240,230,0.35)',
    },
    ete: {
      ciel: ['#3c7fc3', '#64a0d6', '#bcd7e8', '#efe6c8'], nuages: 'rgba(255,255,255,0.7)',
      collines: ['#a9bfcf', '#93ad9a', '#d7c27a'], sol: ['#cdbb6c', '#9fae55', '#7c9a43', '#5f7f35'],
      herbe: ['#6f9a3c', '#86ad49', '#5d8833'], tronc: ['#4f3a2d', '#634a3a', '#3f2e24'],
      feuilles: ['#285524', '#2f6429', '#3a6f2f', '#447f37', '#4f8f3c', '#64a347', '#7cb658'],
      bosquets: ['#6c8c6c', '#7a9878'],
      lumiere: 'rgba(255,236,190,0.35)',
    },
    automne: {
      ciel: ['#7f9db9', '#a5b8c6', '#ead1b0', '#f2c693'], nuages: 'rgba(255,246,235,0.55)',
      collines: ['#b7b6bd', '#b59e86', '#b88a55'], sol: ['#c9a466', '#ad8546', '#946c37', '#7a5830'],
      herbe: ['#9c7a3c', '#b08b48', '#866631'], tronc: ['#4a3529', '#5d4434', '#3b2a21'],
      feuilles: ['#8e3a22', '#b3362a', '#c7472a', '#d9662b', '#e88a2e', '#e9a03f', '#f0b13a'],
      bosquets: ['#a58b66', '#b2865a', '#9c8d74'],
      lumiere: 'rgba(255,214,160,0.35)',
    },
    hiver: {
      ciel: ['#7d97b4', '#9fb2c7', '#c3cfdc', '#d9e1ea'], nuages: 'rgba(245,248,252,0.45)',
      collines: ['#b9c4d2', '#a9b6c6', '#e3e9f0'], sol: ['#eef2f6', '#e2e8ef', '#d2dbe5', '#bac6d4'],
      herbe: ['#8c7a63', '#9e8b70', '#7a6a56'], tronc: ['#463a35', '#5e5047', '#2f2622'],
      feuilles: [], bosquets: ['#8796a8', '#7d8da0'], lumiere: 'rgba(240,246,255,0.3)',
    },
  }[saison];

  const HORIZON = X(9.6);

  // --- ciel ---
  let g = c.createLinearGradient(0, 0, 0, HORIZON);
  PAL.ciel.forEach((col, i) => g.addColorStop(i / (PAL.ciel.length - 1), col));
  c.fillStyle = g; c.fillRect(0, 0, W, HORIZON + X(1));
  // halo de lumiere douce, haut droite (pas de soleil rasant)
  g = c.createRadialGradient(X(19), X(1.5), 0, X(19), X(1.5), X(11));
  g.addColorStop(0, PAL.lumiere); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, HORIZON);
  // nuages flous
  flou(X(0.35), () => { c.fillStyle = PAL.nuages;
  for (let i = 0; i < 9; i++) {
    const cx = X(entre(rS, 6, 23.5)), cy = X(entre(rS, 0.8, 6.5)), l = X(entre(rS, 1.5, 3.5));
    for (let k = 0; k < 7; k++) {
      c.beginPath();
      c.ellipse(cx + entre(rS, -l, l), cy + entre(rS, -l * 0.12, l * 0.12), l * entre(rS, 0.25, 0.5), l * entre(rS, 0.1, 0.2), 0, 0, 7);
      c.fill();
    }
  }
  });

  // --- collines (de la plus lointaine a la plus proche), floues ---
  const crete = (base, amp, freq, phase) => x => base + amp * (Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.3 + phase * 1.7) * 0.3 + Math.sin(x * freq * 5.1 + phase * 0.3) * 0.1);
  const cretes = [crete(X(8.6), X(0.6), 0.0011, 1), crete(X(9.1), X(0.45), 0.0017, 4), crete(X(9.6), X(0.3), 0.0023, 2)];
  flou(X(0.06), () => {
  cretes.forEach((f, i) => {
    c.beginPath(); c.moveTo(-X(1), H);
    for (let x = -X(1); x <= W + X(1); x += 8) c.lineTo(x, f(x));
    c.lineTo(W + X(1), H); c.closePath();
    c.fillStyle = PAL.collines[i]; c.fill();
    if (i === 1) {
      // lisiere de bosquets lointains (des sapins en hiver)
      for (let x = -X(0.3); x < W + X(0.3); x += X(entre(rS, 0.12, 0.45))) {
        if (rS() < 0.35) continue;
        const y = f(x) + X(0.12);
        c.fillStyle = choix(rS, PAL.bosquets);
        if (saison === 'hiver') {
          const h = X(entre(rS, 0.25, 0.6));
          c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + h * 0.28, y); c.lineTo(x - h * 0.28, y); c.closePath(); c.fill();
        } else {
          for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(x + X(entre(rS, -0.12, 0.12)), y - X(entre(rS, 0.05, 0.3)), X(entre(rS, 0.12, 0.3)), 0, 7); c.fill(); }
        }
      }
    }
  });
  });

  // --- sol : clair au loin, plus soutenu devant, un peu plus fonce dans la bande du texte ---
  const solHaut = x => cretes[2](x) + X(0.25);
  c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) c.lineTo(x, solHaut(x));
  c.lineTo(W, H); c.closePath();
  g = c.createLinearGradient(0, X(9.4), 0, H);
  g.addColorStop(0, PAL.sol[0]); g.addColorStop(0.3, PAL.sol[1]); g.addColorStop(0.62, PAL.sol[2]); g.addColorStop(1, PAL.sol[3]);
  c.fillStyle = g; c.fill();
  // brume a l'horizon (perspective atmospherique)
  g = c.createLinearGradient(0, X(7.8), 0, X(11));
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, X(7.8), W, X(3.2));

  // brins d'herbe ou bosses de neige : peu contrastes, plus denses sur les cotes, rares au centre
  const auCentre = x => x > X(3.4) && x < X(20.6);
  c.lineCap = 'round';
  for (let i = 0; i < (saison === 'hiver' ? 500 : 9000); i++) {
    const y = entre(rS, X(10.2), H);
    const x = rS() * W;
    if (auCentre(x) && rS() < 0.75) continue;
    const prof = (y - X(10)) / (H - X(10));   // 0 au loin, 1 devant
    const h = X(0.05 + prof * 0.35) * entre(rS, 0.6, 1.3);
    c.strokeStyle = choix(rS, PAL.herbe); c.globalAlpha = 0.25 + 0.3 * prof;
    c.lineWidth = Math.max(1, X(0.012 + prof * 0.025));
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + entre(rS, -h, h) * 0.3, y - h * 0.6, x + entre(rS, -h, h) * 0.5, y - h); c.stroke();
  }
  c.globalAlpha = 1;
  if (saison === 'hiver') {
    // ondulations de neige douces
    flou(X(0.25), () => {
    for (let i = 0; i < 40; i++) {
      const x = rS() * W, y = entre(rS, X(10.5), H);
      c.fillStyle = rS() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(150,168,190,0.12)';
      c.beginPath(); c.ellipse(x, y, X(entre(rS, 1, 3)), X(entre(rS, 0.15, 0.4)), 0, 0, 7); c.fill();
    }
    });
  }

  // --- l'arbre : tronc a gauche, branches en voute le long du haut (hors de la zone du groupe) ---
  // Le feuillage peut deborder un peu de la feuille, pas les bouts de branches (sinon il serait perdu).
  const permis = (x, y) => (y < X(3.0) && y > X(0.15) && x < X(23.5)) || (x < X(3.3) && x > X(0.2) && y > X(0.15));
  const segments = [], grappes = [];
  function branche(x, y, a, l, e, n, pref) {
    let x2, y2, ok = false;
    for (const d of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
      x2 = x + Math.cos(a + d) * l; y2 = y + Math.sin(a + d) * l;
      if (permis(x2, y2) && permis((x + x2) / 2, (y + y2) / 2)) { a += d; ok = true; break; }
    }
    if (!ok) { grappes.push([x, y]); return; }
    const courbe = entre(rA, -0.2, 0.2) * l;
    const fin = e * 0.72;
    segments.push([x, y, (x + x2) / 2 - Math.sin(a) * courbe, (y + y2) / 2 + Math.cos(a) * courbe, x2, y2, e, fin]);
    if (n <= 4) grappes.push([x2, y2]);
    if (n === 0 || fin < X(0.03)) return;
    const nb = rA() < 0.35 ? 3 : 2;
    for (let k = 0; k < nb; k++) {
      let na = a + (k - (nb - 1) / 2) * entre(rA, 0.45, 0.75) + entre(rA, -0.2, 0.2);
      na += (pref - na) * 0.18;                 // chaque grosse branche garde sa direction
      branche(x2, y2, na, l * entre(rA, 0.7, 0.84), fin * entre(rA, 0.8, 0.95), n - 1, pref);
    }
  }
  // tronc (centre et epaisseur), legerement penche vers la droite
  const tronc = [[X(1.45), H + X(0.5), X(1.25)], [X(1.55), X(13), X(1.05)], [X(1.9), X(9.5), X(0.9)], [X(2.15), X(6.5), X(0.78)], [X(2.6), X(4.0), X(0.62)]];
  for (let i = 0; i < tronc.length - 1; i++) {
    const [x1, y1, e1] = tronc[i], [x2, y2, e2] = tronc[i + 1];
    segments.push([x1, y1, (x1 + x2) / 2 + X(0.12), (y1 + y2) / 2, x2, y2, e1, e2]);
  }
  const rad = d => d * Math.PI / 180;
  branche(X(2.6), X(4.0), rad(-22), X(3.6), X(0.5), 7, rad(-4));     // grande branche en voute vers la droite
  branche(X(2.7), X(3.4), rad(-48), X(2.4), X(0.4), 6, rad(-14));    // seconde voute
  branche(X(2.5), X(4.3), rad(-95), X(2.0), X(0.36), 5, rad(-110));  // vers le haut et la gauche
  branche(X(2.2), X(6.4), rad(-145), X(1.6), X(0.3), 5, rad(-120));  // vers la gauche
  branche(X(1.95), X(9.0), rad(-130), X(1.3), X(0.22), 4, rad(-105)); // petite branche basse

  // branche effilee : petits traits ronds de largeur decroissante
  function tracer(seg, dx, dy, k) {
    const [x1, y1, cx, cy, x2, y2, e1, e2] = seg, N = 8;
    let px = x1, py = y1;
    for (let i = 1; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const qx = u * u * x1 + 2 * u * t * cx + t * t * x2, qy = u * u * y1 + 2 * u * t * cy + t * t * y2;
      c.lineWidth = Math.max(1.2, (e1 + (e2 - e1) * t) * k);
      c.beginPath(); c.moveTo(px + dx, py + dy); c.lineTo(qx + dx, qy + dy); c.stroke();
      px = qx; py = qy;
    }
  }
  c.lineCap = 'round';
  c.strokeStyle = PAL.tronc[0]; segments.forEach(s => tracer(s, 0, 0, 1));
  c.globalAlpha = 0.45;   // modele doux : un peu plus clair a gauche, plus sombre a droite (lumiere de face)
  c.strokeStyle = PAL.tronc[1]; segments.forEach(s => tracer(s, -s[6] * 0.18, 0, 0.45));
  c.strokeStyle = PAL.tronc[2]; segments.forEach(s => tracer(s, s[6] * 0.22, 0, 0.35));
  c.globalAlpha = 1;
  // ecorce : quelques fines stries sur le tronc
  c.strokeStyle = 'rgba(30,20,15,0.25)'; c.lineWidth = X(0.025);
  for (let i = 0; i < 40; i++) {
    const t = rA(), y = X(4.5) + t * (H - X(4.5)), xc = X(1.45 + (1 - t) * 1.0), dx = X(entre(rA, -0.35, 0.35));
    c.beginPath(); c.moveTo(xc + dx, y); c.lineTo(xc + dx * 1.05, y + X(entre(rA, 0.3, 0.9))); c.stroke();
  }
  if (saison === 'hiver') {
    // neige posee sur le dessus des branches
    c.strokeStyle = 'rgba(250,252,255,0.95)';
    for (const s of segments) {
      const [x1, y1, cx, cy, x2, y2, e1, e2] = s;
      if (Math.abs(y2 - y1) > Math.abs(x2 - x1) * 1.4) continue;   // pas sur les parties verticales
      tracer([x1, y1 - e1 * 0.38, cx, cy - (e1 + e2) * 0.19, x2, y2 - e2 * 0.38, e1 * 0.35, e2 * 0.3], 0, 0, 1);
    }
  }

  // feuillage / fleurs : petites taches, plus claires en haut de chaque touffe, plus sombres en bas
  if (PAL.feuilles.length) {
    const densite = { printemps: 30, ete: 42, automne: 34 }[saison];
    const taille = { printemps: [0.07, 0.15], ete: [0.1, 0.24], automne: [0.09, 0.2] }[saison];
    const rF = hasard(99);   // memes positions de feuillage d'une saison a l'autre
    const taches = [];
    for (const [gx, gy] of grappes) {
      const rayon = X(entre(rF, 0.45, 0.85));
      for (let k = 0; k < densite; k++) {
        const ang = rF() * 7, d = Math.sqrt(rF()) * rayon;
        const x = gx + Math.cos(ang) * d, y = gy + Math.sin(ang) * d * 0.75;
        const haut = 1 - (Math.sin(ang) * d / rayon + 1) / 2;   // 1 en haut de la touffe, 0 en bas
        if (x > X(3.9) && x < X(20.2) && y > X(3.7)) continue;      // le centre reste degage (au-dessus des tetes)
        taches.push([x, y, X(entre(rF, taille[0], taille[1])), haut, rF(), rF()]);
      }
    }
    const n = PAL.feuilles.length;
    flou(X(0.015), () => {
      for (const [x, y, r] of taches) { c.fillStyle = 'rgba(25,30,20,0.16)'; c.beginPath(); c.arc(x + r * 0.2, y + r * 0.4, r * 1.05, 0, 7); c.fill(); }
      for (const [x, y, r, haut, u, v] of taches) {
        const i = Math.max(0, Math.min(n - 1, Math.round(haut * (n - 1) + (u - 0.5) * 3)));
        c.fillStyle = PAL.pousses && v < 0.1 ? PAL.pousses : PAL.feuilles[i];
        c.beginPath(); c.ellipse(x, y, r, r * 0.8, v * 6, 0, 7); c.fill();
      }
    });
  }

  // --- details de saison au sol et dans l'air (sur les cotes, discrets au centre) ---
  function semer(n, zone, dessin) {
    for (let i = 0; i < n; i++) {
      const x = rS() * W, y = entre(rS, zone[0], zone[1]);
      if (auCentre(x) && y > X(3.2) && y < X(13.8) && rS() < 0.92) continue;
      dessin(x, y, (y - X(10)) / (H - X(10)));
    }
  }
  if (saison === 'printemps') {
    semer(260, [X(0.5), X(12)], (x, y) => {   // petales qui volent
      c.fillStyle = choix(rS, ['#f7c6d4', '#fbdfe7', '#f2aec3']); c.globalAlpha = 0.85;
      c.beginPath(); c.ellipse(x, y, X(0.06), X(0.035), rS() * 3, 0, 7); c.fill();
    });
    semer(900, [X(10.5), H], (x, y, p) => {   // paquerettes et petales au sol
      c.globalAlpha = 0.5 + 0.4 * p; const r = X(0.03 + 0.06 * p);
      c.fillStyle = choix(rS, ['#ffffff', '#fbe3ea', '#f7c6d4', '#fff4b8']);
      c.beginPath(); c.ellipse(x, y, r, r * 0.6, 0, 0, 7); c.fill();
    });
  } else if (saison === 'ete') {
    semer(700, [X(10.5), H], (x, y, p) => {   // fleurs des champs
      c.globalAlpha = 0.55 + 0.4 * p; const r = X(0.03 + 0.07 * p);
      c.fillStyle = choix(rS, ['#d8432f', '#e8573a', '#ffffff', '#f2d14a', '#8a7bd1']);
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    });
  } else if (saison === 'automne') {
    semer(180, [X(0.5), X(12)], (x, y) => {   // feuilles qui tombent
      c.fillStyle = choix(rS, PAL.feuilles); c.globalAlpha = 0.9;
      c.beginPath(); c.ellipse(x, y, X(0.1), X(0.05), rS() * 3, 0, 7); c.fill();
    });
    semer(2200, [X(10.5), H], (x, y, p) => {  // tapis de feuilles
      c.globalAlpha = 0.45 + 0.45 * p; const r = X(0.04 + 0.1 * p);
      c.fillStyle = choix(rS, PAL.feuilles);
      c.beginPath(); c.ellipse(x, y, r, r * 0.5, rS() * 3, 0, 7); c.fill();
    });
  } else {
    flou(X(0.012), () => {
    semer(1400, [0, H], (x, y) => {            // flocons
      c.fillStyle = '#ffffff'; c.globalAlpha = entre(rS, 0.5, 0.95);
      c.beginPath(); c.arc(x, y, X(entre(rS, 0.015, 0.05)), 0, 7); c.fill();
    });
    });
  }
  c.globalAlpha = 1;

  // bande du texte : leger assombrissement regulier, pour la lisibilite
  g = c.createLinearGradient(0, X(13.6), 0, H);
  g.addColorStop(0, 'rgba(20,25,30,0)'); g.addColorStop(0.5, `rgba(20,25,30,${saison === 'hiver' ? 0.06 : 0.12})`); g.addColorStop(1, `rgba(20,25,30,${saison === 'hiver' ? 0.1 : 0.2})`);
  c.fillStyle = g; c.fillRect(0, X(13.6), W, H);

  // grain fin (evite les bandes dans les degrades a l'impression)
  const img = c.getImageData(0, 0, W, H), d = img.data, rG = hasard(5);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rG() - 0.5) * 7;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);

  // couleur automatique du texte, meme regle que l'outil (photo-classe.js, couleurTexte) :
  // luminance moyenne de la bande du texte, avant la pose du groupe
  const bande = c.getImageData(0, Math.round(H - X(3) - X(0.4)), W, Math.round(X(0.8))).data;
  let somme = 0, nb = 0;
  for (let i = 0; i < bande.length; i += 16) { somme += 0.299 * bande[i] + 0.587 * bande[i + 1] + 0.114 * bande[i + 2]; nb++; }
  const luminance = Math.round(somme / nb), texteBlanc = luminance < 140;

  if (temoin) {
    // groupe temoin (3 rangs, gris) a la place qu'il aura, et le texte : pour l'apercu seulement
    const x0 = X(3), x1 = X(21), y0 = X(3.75), y1 = X(12.75);
    const rangs = [[11, 0.62], [12, 0.8], [13, 1.0]];
    rangs.forEach(([nb, f], ir) => {
      const yPied = y0 + (y1 - y0) * f, pas = (x1 - x0) / nb, r = pas * 0.24;
      for (let k = 0; k < nb; k++) {
        const cx = x0 + pas * (k + 0.5), yTete = yPied - X(ir === 2 ? 3.2 : 3.4);
        c.fillStyle = ['#6b7480', '#7b8490', '#5d6672'][ir];
        c.beginPath(); c.arc(cx, yTete, r, 0, 7); c.fill();
        c.beginPath(); c.roundRect(cx - pas * 0.42, yTete + r * 0.9, pas * 0.84, yPied - yTete - r * 0.9, r * 0.6); c.fill();
      }
    });
    c.font = `${X(0.7)}px Georgia, serif`; c.textBaseline = 'middle';
    c.fillStyle = texteBlanc ? '#ffffff' : '#1b1b1b'; c.shadowColor = texteBlanc ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'; c.shadowBlur = X(0.08); c.shadowOffsetY = X(0.03);
    c.textAlign = 'left'; c.fillText('École des Tilleuls', X(3), X(15));
    c.textAlign = 'right'; c.fillText('2026-2027', X(21), X(15));
  }
  return { url: cv.toDataURL('image/jpeg', 0.93), luminance, texte: texteBlanc ? 'blanc' : 'noir' };
}

// 300 dpi dans l'en-tete JFIF
function dpi300(buf) {
  if (buf[2] === 0xff && buf[3] === 0xe0 && buf.toString('ascii', 6, 10) === 'JFIF') {
    buf[13] = 1; buf.writeUInt16BE(300, 14); buf.writeUInt16BE(300, 16);
  }
  return buf;
}
const enJpeg = url => dpi300(Buffer.from(url.split(',')[1], 'base64'));

const SAISONS = ['printemps', 'ete', 'automne', 'hiver'];
const nav = await chromium.launch();
const page = await nav.newPage();
await page.setContent('<!doctype html><body></body>');
mkdirSync(join(ICI, 'saisons'), { recursive: true });
const apercus = [];
for (const s of SAISONS) {
  const f = await page.evaluate(dessiner, { saison: s, temoin: false });
  writeFileSync(join(ICI, 'saisons', `${s}.jpg`), enJpeg(f.url));
  apercus.push((await page.evaluate(dessiner, { saison: s, temoin: true })).url);
  console.log(`saisons/${s}.jpg : bande du texte ${f.luminance}/255, texte automatique ${f.texte}`);
}
// planche d'apercu 2 x 2
const planche = await page.evaluate(urls => new Promise(ok => {
  const w = 1400, h = Math.round(w * 2126 / 2835), m = 24;
  const cv = document.createElement('canvas'); cv.width = w * 2 + m * 3; cv.height = h * 2 + m * 3;
  const c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
  let n = 0;
  urls.forEach((u, i) => {
    const im = new Image();
    im.onload = () => { c.drawImage(im, m + (i % 2) * (w + m), m + Math.floor(i / 2) * (h + m), w, h); if (++n === urls.length) ok(cv.toDataURL('image/jpeg', 0.88)); };
    im.src = u;
  });
}), apercus);
writeFileSync(join(ICI, 'apercu-saisons.jpg'), enJpeg(planche));
console.log('apercu-saisons.jpg');
await nav.close();
