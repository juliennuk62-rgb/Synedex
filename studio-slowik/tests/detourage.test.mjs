// Tests du module « Detourage fond vert » (detourage/index.html).
import { ok, eq, has, openPage, makeImages, waitText } from './helpers.mjs';

const close = async (...ctxs) => { for (const c of ctxs) if (c) await c.close(); };
const pageDetourage = url => url.replace(/index\.html$/, 'detourage/index.html');
// Charge par adresse (la page interdit les scripts en ligne).
const synthese = url => ({ url: new URL('../tests/mocks/synthese-fond-vert.js', pageDetourage(url)).href });

export const tests = [
  {
    name: 'detourage avance : precision (cheveux, ombre au sol, fond inegal) meilleure que le compositeur',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag(synthese(url));
        const r = await page.evaluate(() => {
          const W = 900, H = 675;
          const { rgba, truth, shadowBox } = synthFondVert(W, H);
          const img = new Uint8ClampedArray(rgba);
          const res = SL.dt.detourer(img, W, H, SL.dt.DEFAUTS.portraits);
          const old = SL.chroma.keyPixels(new Uint8ClampedArray(rgba), 50, 30, 60);
          let vert = 0, n = 0;
          for (let p = 0; p < W * H; p++) {
            const a = res.alpha[p];
            if (a > 25 && a < 230) { vert += Math.max(0, img[p * 4 + 1] - Math.max(img[p * 4], img[p * 4 + 2])); n++; }
          }
          return {
            nouveau: mesuresDetourage(res.alpha, truth, W, H, shadowBox),
            ancien: mesuresDetourage(old, truth, W, H, shadowBox),
            vertBords: vert / n, alertes: res.analyse.alertes.length,
          };
        });
        console.log('      mesures :', JSON.stringify(r));
        ok(r.nouveau.sad < 1, `erreur moyenne trop forte : ${r.nouveau.sad} ‰`);
        ok(r.nouveau.sad < r.ancien.sad / 2, `au moins 2 fois plus precis que le compositeur (${r.nouveau.sad} contre ${r.ancien.sad})`);
        ok(r.nouveau.edgeMSE < r.ancien.edgeMSE / 5, `bords au moins 5 fois plus justes (${r.nouveau.edgeMSE} contre ${r.ancien.edgeMSE})`);
        ok(r.nouveau.ombre < 0.01, `ombre au sol supprimee (alpha moyen ${r.nouveau.ombre})`);
        ok(r.nouveau.interieur > 0.995, `sujet plein a l'interieur (${r.nouveau.interieur})`);
        ok(r.nouveau.meches > 0.15, `meches fines conservees en transparence (${r.nouveau.meches})`);
        ok(r.vertBords < 2, `reflet vert retire des bords (${r.vertBords.toFixed(2)})`);
        eq(r.alertes, 0, 'fond correct : aucune alerte');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : filtres exacts (erosion, zones, filtre guide par carreaux)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        const r = await page.evaluate(() => {
          const { minMax, zones } = SL.dt.outils;
          let s = 7;
          const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
          const W = 173, H = 121;
          const a = new Uint8Array(W * H).map(() => (rnd() * 256) | 0);
          // mini / maxi : comparaison avec le calcul direct
          let diffs = 0;
          for (const r of [1, 2, 5, 9]) for (const isMax of [false, true]) {
            const out = minMax(a, W, H, r, isMax);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
              let v = isMax ? 0 : 255;
              for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
                v = isMax ? Math.max(v, a[yy * W + xx]) : Math.min(v, a[yy * W + xx]);
              }
              if (v !== out[y * W + x]) diffs++;
            }
          }
          // zones : surfaces comparees a un remplissage direct (8 voisins)
          const m = new Uint8Array(W * H).map(() => (rnd() < 0.45 ? 255 : 0));
          const z = zones(m, W, H, 128, 255);
          const ref = new Int32Array(W * H).fill(-1);
          const areas = [];
          for (let p = 0; p < W * H; p++) {
            if (m[p] < 128 || ref[p] >= 0) continue;
            const id = areas.length; let n = 0; const pile = [p]; ref[p] = id;
            while (pile.length) {
              const q = pile.pop(); n++;
              const qx = q % W, qy = (q / W) | 0;
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = qx + dx, yy = qy + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const t = yy * W + xx;
                if (m[t] >= 128 && ref[t] < 0) { ref[t] = id; pile.push(t); }
              }
            }
            areas.push(n);
          }
          let zoneDiffs = 0;
          for (let i = 0; i < z.n; i++) {
            const p = z.Y[i] * W + z.X0[i];
            if (z.area[z.root[i]] !== areas[ref[p]]) zoneDiffs++;
          }
          // filtre guide par carreaux = filtre guide sur l'image entiere
          const GW = 300, GH = 260, rgba = new Uint8ClampedArray(GW * GH * 4), al = new Uint8Array(GW * GH);
          for (let p = 0; p < GW * GH; p++) {
            const x = p % GW, y = (p / GW) | 0;
            const inside = (x - 150) ** 2 + (y - 130) ** 2 < 90 ** 2;
            rgba[p * 4] = inside ? 200 : 40 + rnd() * 20; rgba[p * 4 + 1] = inside ? 150 : 170 + rnd() * 20; rgba[p * 4 + 2] = inside ? 120 : 70;
            al[p] = inside ? 255 : 0;
          }
          const tuiles = new Uint8Array(al);
          SL.dt.matting.affiner(rgba, tuiles, GW, GH, { R: 4, r: 3, eps: 1e-3, mix: 1, zone: new Uint8Array(GW * GH).fill(1) });
          const n = GW * GH, buf = SL.dt.matting.buffers(n);
          const Ir = new Float32Array(n), Ig = new Float32Array(n), Ib = new Float32Array(n), P = new Float32Array(n);
          for (let p = 0; p < n; p++) { Ir[p] = rgba[p * 4] / 255; Ig[p] = rgba[p * 4 + 1] / 255; Ib[p] = rgba[p * 4 + 2] / 255; P[p] = al[p] / 255; }
          const q = SL.dt.matting.guide(Ir, Ig, Ib, P, GW, GH, 3, 1e-3, buf);
          let gMax = 0;
          for (let p = 0; p < n; p++) gMax = Math.max(gMax, Math.abs(tuiles[p] - Math.round(Math.min(1, Math.max(0, q[p])) * 255)));
          return { diffs, zones: z.n, zoneDiffs, gMax };
        });
        eq(r.diffs, 0, 'erosion / dilatation identiques au calcul direct');
        ok(r.zones > 0, 'des zones sont trouvees');
        eq(r.zoneDiffs, 0, 'surfaces des zones identiques au remplissage direct');
        ok(r.gMax <= 1, `filtre guide par carreaux identique a l'image entiere (ecart ${r.gMax})`);
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : ecran reglage, prereglages, loupe, export PNG',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        // Sans photo : message d'accueil, pas d'erreur.
        ok(await page.isVisible('#views-empty'), 'message d\'accueil sans photo');
        const imgs = await makeImages(page, [
          { name: 'eleve-1.jpg', kind: 'vert', w: 1600, h: 1200 },
          { name: 'eleve-2.jpg', kind: 'vert', w: 1600, h: 1200, hair: '#3a2410' },
          { name: 'notes.txt', kind: 'fond', color: '#fff' },
        ]);
        await page.setInputFiles('#pick-files', imgs);
        await page.waitForSelector('.dt-temoin', { timeout: 20000 });
        eq(await page.locator('.dt-temoin').count(), 2, 'les 2 images deviennent les photos temoins (le reste est ignore)');
        has(await page.textContent('#photos-info'), '2 photos', 'nombre de photos affiche');
        await waitText(page, '#full-status', /Pleine définition prête/, 30000);
        eq(await page.locator('#views canvas').count(), 4, 'vue cote a cote : 4 images');
        has(await page.textContent('#analyse'), 'Fond', 'analyse du fond affichee');
        // Le masque montre un sujet (blanc) et un fond (noir).
        const masque = await page.evaluate(() => {
          const c = document.querySelector('canvas[data-vue="masque"]');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let blanc = 0, noir = 0;
          for (let i = 0; i < d.length; i += 4) { if (d[i] > 240) blanc++; else if (d[i] < 15) noir++; }
          return { blanc: blanc / (d.length / 4), noir: noir / (d.length / 4) };
        });
        ok(masque.blanc > 0.1 && masque.noir > 0.3, `masque coherent : ${JSON.stringify(masque)}`);

        // Un reglage relance l'apercu puis la pleine definition.
        await page.locator('.range[data-k="tolerance"] input').fill('70');
        has(await page.textContent('.range[data-k="tolerance"] output'), '70', 'valeur affichee');
        ok(await page.isVisible('#preset-modified'), 'reglages signales comme modifies');
        await waitText(page, '#full-status', /Pleine définition prête/, 30000);

        // Enregistrer un prereglage, il reste apres rechargement.
        await page.click('#preset-form button[type=submit]');
        await page.waitForTimeout(100);
        has(await page.textContent('.toasts'), 'Donnez un nom', 'nom obligatoire');
        await page.fill('#preset-name', 'Gymnase Arras');
        await page.click('#preset-form button[type=submit]');
        await page.waitForTimeout(400);
        eq(await page.inputValue('#preset'), 'Gymnase Arras', 'prereglage selectionne');
        ok(await page.isHidden('#preset-modified'), 'plus de modification en attente');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#preset-export')]);
        eq(dl.suggestedFilename(), 'prereglages-detourage.json', 'export des prereglages');

        // Vues et loupe.
        await page.click('#vue button[data-vue="avantapres"]');
        ok(await page.isVisible('#split'), 'curseur avant / apres');
        await page.click('#vue button[data-vue="masque"]');
        eq(await page.locator('#views canvas').count(), 1, 'une seule vue');
        await page.check('#loupe');
        const box = await page.locator('#views canvas').boundingBox();
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
        await page.waitForFunction(() => document.getElementById('loupe-box').dataset.source === 'pleine', null, { timeout: 10000 });
        ok(await page.isVisible('#loupe-box'), 'loupe affichee en pleine definition');

        // Export PNG transparent en pleine definition.
        const [png] = await Promise.all([page.waitForEvent('download'), page.click('#export-png')]);
        eq(png.suggestedFilename(), 'eleve-1_detoure.png', 'nom du PNG');
        const buf = await (await import('node:fs/promises')).readFile(await png.path());
        const info = await page.evaluate(async b64 => {
          const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' }));
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          c.getContext('2d').drawImage(bmp, 0, 0);
          const d = c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data;
          let transparent = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] === 0) transparent++;
          return { w: bmp.width, h: bmp.height, transparent: transparent / (d.length / 4) };
        }, buf.toString('base64'));
        eq([info.w, info.h], [1600, 1200], 'PNG en pleine definition');
        ok(info.transparent > 0.3, `fond transparent dans le PNG (${info.transparent.toFixed(2)})`);

        // Changement de photo temoin.
        await page.click('.dt-temoin[data-i="1"]');
        await waitText(page, '#full-status', /Pleine définition prête/, 30000);
        eq(await page.getAttribute('.dt-temoin[data-i="1"]', 'aria-pressed'), 'true', 'temoin selectionne');

        // Rechargement : prereglage et reglages conserves.
        await page.reload();
        await page.waitForTimeout(400);
        eq(await page.inputValue('#preset'), 'Gymnase Arras', 'prereglage garde apres rechargement');
        eq(await page.inputValue('.range[data-k="tolerance"] input'), '70', 'reglage garde apres rechargement');
        // Import d'un fichier invalide : message clair.
        await page.setInputFiles('#preset-import', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
        await page.waitForTimeout(200);
        eq(await page.locator('#preset option').count(), 3, 'fichier invalide : rien n\'est importe');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : temps de calcul sur une photo de 24 Mpx',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag(synthese(url));
        const r = await page.evaluate(() => {
          const sw = 1500, sh = 1000;
          const { rgba } = synthFondVert(sw, sh);
          const small = new OffscreenCanvas(sw, sh);
          small.getContext('2d').putImageData(new ImageData(rgba, sw, sh), 0, 0);
          const W = 6000, H = 4000, big = new OffscreenCanvas(W, H), bctx = big.getContext('2d', { willReadFrequently: true });
          bctx.imageSmoothingQuality = 'high';
          bctx.drawImage(small, 0, 0, W, H);
          const data = bctx.getImageData(0, 0, W, H).data;
          const t0 = performance.now();
          const res = SL.dt.detourer(data, W, H, SL.dt.DEFAUTS.portraits);
          const total = performance.now() - t0;
          // apercu (1280 px)
          const pw = 1280, ph = 853, pv = new OffscreenCanvas(pw, ph), pctx = pv.getContext('2d', { willReadFrequently: true });
          pctx.drawImage(small, 0, 0, pw, ph);
          const pd = pctx.getImageData(0, 0, pw, ph).data;
          const t1 = performance.now();
          SL.dt.detourer(pd, pw, ph, SL.dt.DEFAUTS.portraits, res.analyse);
          return { total: Math.round(total), temps: res.temps, apercu: Math.round(performance.now() - t1) };
        });
        console.log(`      24 Mpx : ${r.total} ms ${JSON.stringify(r.temps)} ; apercu 1280 px : ${r.apercu} ms`);
        ok(r.total < 20000, `24 Mpx en moins de 20 s dans l'environnement de test (${r.total} ms)`);
        ok(r.apercu < 1000, `apercu en moins d'une seconde (${r.apercu} ms)`);
      } finally { await close(ctx); }
    },
  },
];
