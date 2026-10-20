// Tests du module « Detourage fond vert » (detourage/index.html).
import { ok, eq, has, openPage, makeImages, waitText, writeOpfs, listOpfs, clearOpfs } from './helpers.mjs';

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
    name: 'detourage avance : pas de lueur rouge autour des cheveux (photo JPEG)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag(synthese(url));
        const r = await page.evaluate(() => {
          const W = 900, H = 675;
          const { rgba, truth } = synthFondVert(W, H);
          // Chrominance reduite de moitie (JPEG 4:2:0 des appareils photo) : la teinte des bords
          // fins est melangee avec le vert voisin. C'est ce qui creait des lueurs rouges.
          const jpeg = new Uint8ClampedArray(rgba);
          for (let y = 0; y < H - 1; y += 2) for (let x = 0; x < W - 1; x += 2) {
            const ps = [y * W + x, y * W + x + 1, (y + 1) * W + x, (y + 1) * W + x + 1];
            const Y = ps.map(p => 0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2]);
            let cb = 0, cr = 0;
            ps.forEach((p, i) => { cb += (rgba[p * 4 + 2] - Y[i]) * 0.564 / 4; cr += (rgba[p * 4] - Y[i]) * 0.713 / 4; });
            ps.forEach((p, i) => {
              const r = Y[i] + 1.403 * cr, b = Y[i] + 1.773 * cb;
              jpeg[p * 4] = r; jpeg[p * 4 + 1] = (Y[i] - 0.299 * r - 0.114 * b) / 0.587; jpeg[p * 4 + 2] = b;
            });
          }
          // fond estime un peu trop clair (cas reel : fond moins eclaire derriere la tete)
          const an = SL.dt.fond.analyser(jpeg, W, H);
          an.map = an.map.map(v => v * 1.06);
          // rougeur des bords au-dela de la teinte des cheveux (rouge - vert, rapporte a la luminosite)
          const lueur = over => {
            const img = new Uint8ClampedArray(jpeg);
            const res = SL.dt.detourer(img, W, H, Object.assign({}, SL.dt.DEFAUTS.portraits, over), an);
            let red = 0, n = 0;
            for (let p = 0; p < W * H; p++) {
              const t = truth[p];
              if (!(t > 0 && t < 1) || p / W > H * 0.4) continue;
              const a = res.alpha[p] / 255;
              if (!a) continue;
              const rg = (img[p * 4] - img[p * 4 + 1]) / (img[p * 4] + img[p * 4 + 1] + img[p * 4 + 2] + 1);
              red += a * Math.max(0, rg - 0.167) * 100; n++;
            }
            return red / n;
          };
          return { avec: lueur({}), sans: lueur({ bords: 0 }) };
        });
        console.log(`      lueur rouge : ${r.avec.toFixed(2)} (sans « couleur des bords » : ${r.sans.toFixed(2)})`);
        ok(r.avec < 1, `lueur rouge trop forte : ${r.avec.toFixed(2)}`);
        ok(r.avec < r.sans, 'la couleur des bords reduit la lueur');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : score de confiance (vetement vert, photo vide)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag(synthese(url));
        const r = await page.evaluate(() => {
          const W = 600, H = 450;
          const essai = corps => {
            const { rgba } = synthFondVert(W, H, 1, corps);
            const c = SL.dt.detourer(new Uint8ClampedArray(rgba), W, H, SL.dt.DEFAUTS.portraits, null, 'portraits').confiance;
            return { score: c.score, codes: c.motifs.map(m => m.code) };
          };
          const vide = new Uint8ClampedArray(W * H * 4);
          for (let i = 0; i < vide.length; i += 4) { vide[i] = 40; vide[i + 1] = 170; vide[i + 2] = 70; vide[i + 3] = 255; }
          const v = SL.dt.detourer(vide, W, H, SL.dt.DEFAUTS.portraits, null, 'portraits').confiance;
          return {
            propre: essai([40, 60, 150]), fonce: essai([35, 95, 45]), pale: essai([110, 170, 100]),
            vide: { score: v.score, codes: v.motifs.map(m => m.code) }, seuil: SL.dt.score.SEUIL,
          };
        });
        console.log('      scores :', JSON.stringify(r));
        ok(r.propre.score >= r.seuil, `photo propre au-dessus du seuil (${r.propre.score})`);
        for (const k of ['fonce', 'pale', 'vide']) ok(r[k].score < r.seuil, `${k} : sous le seuil, a verifier (${r[k].score})`);
        ok(r.fonce.codes.includes('buste'), 'pull vert fonce : buste retire signale');
        ok(r.pale.codes.includes('transparence'), 'pull vert pale : zones semi-transparentes signalees');
        ok(r.vide.codes.includes('sujet'), 'photo vide : sujet absent signale');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : IA, vetement vert protege sur une vraie photo',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        const photo = new URL('../tests/mocks/astronaute.jpg', pageDetourage(url)).href; // NASA, domaine public
        const r = await page.evaluate(async photo => {
          const appel = w => (type, args) => new Promise((res, rej) => {
            w.onmessage = e => (e.data.ok ? res(e.data.res) : rej(new Error(e.data.err)));
            w.postMessage({ id: 1, type, args });
          });
          const A = appel(new Worker('js/worker/detourage-worker.js'));
          const original = new File([await (await fetch(photo)).blob()], 'astronaute.jpg', { type: 'image/jpeg' });
          await A('charger', { file: original });
          const p = Object.assign({}, SL.dt.DEFAUTS.portraits);
          const d = await A('detourer', { params: p, renvoyer: true, type: 'portraits' });
          const m = d.ia;
          // Photo sur fond vert fabriquee a partir de la silhouette, combinaison orange -> VERT (couleur du fond).
          const bmp = await createImageBitmap(original);
          const W = bmp.width, H = bmp.height;
          const c = new OffscreenCanvas(W, H), cx = c.getContext('2d', { willReadFrequently: true });
          cx.drawImage(bmp, 0, 0);
          const img = cx.getImageData(0, 0, W, H), px = img.data;
          const zone = new Uint8Array(W * H); // 1 fond, 2 combinaison verte, 3 reste du sujet
          let s = 3;
          const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const q = y * W + x, i = q * 4;
            const v = m.m[Math.min(m.mh - 1, ((y / H) * m.mh) | 0) * m.mw + Math.min(m.mw - 1, ((x / W) * m.mw) | 0)];
            if (v < 0.5) { px[i] = 45 + rnd() * 6; px[i + 1] = 175 + rnd() * 6; px[i + 2] = 80 + rnd() * 6; zone[q] = 1; continue; }
            const r = px[i], g = px[i + 1];
            if (y > H * 0.55 && r > g + 40) { px[i] = r * 0.2; px[i + 1] = r * 0.72; px[i + 2] = r * 0.33; zone[q] = 2; } else zone[q] = 3;
          }
          cx.putImageData(img, 0, 0);
          const vert = new File([await c.convertToBlob({ type: 'image/png' })], 'vert.png', { type: 'image/png' });
          const mesure = async ia => {
            const B = appel(new Worker('js/worker/detourage-worker.js'));
            await B('charger', { file: vert });
            const res = await B('detourer', { params: Object.assign({}, p, { ia }), renvoyer: true, type: 'portraits' });
            const o = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
            let vertGarde = 0;
            for (let q = 0; q < W * H; q++) {
              o[zone[q]][0] += res.rgba[q * 4 + 3] / 255; o[zone[q]][1]++;
              if (zone[q] === 2) vertGarde += res.rgba[q * 4 + 1] - Math.max(res.rgba[q * 4], res.rgba[q * 4 + 2]);
            }
            return { fond: o[1][0] / o[1][1], combinaison: o[2][0] / o[2][1], sujet: o[3][0] / o[3][1], vert: vertGarde / o[2][1],
              score: res.confiance.score, motifs: res.confiance.motifs.map(x => x.code), n: o[2][1] };
          };
          return { iaMs: m.ms, fournisseur: m.fournisseur, sans: await mesure(0), avec: await mesure(100) };
        }, photo);
        console.log('      IA :', JSON.stringify(r));
        ok(r.sans.n > 5000, 'la photo de test contient une combinaison verte');
        ok(r.sans.combinaison < 0.3, `sans IA, la combinaison verte disparait (${r.sans.combinaison.toFixed(2)})`);
        // Cas extreme : combinaison exactement de la couleur du fond, sans texture. L'IA en garde la
        // majeure partie ; le reste se complete au pinceau « Garder » (la photo est marquee a verifier).
        ok(r.avec.combinaison > 0.5 && r.avec.combinaison > r.sans.combinaison + 0.45,
          `avec IA, la combinaison verte est en grande partie gardee (${r.avec.combinaison.toFixed(2)})`);
        ok(r.avec.score < 75 && r.avec.motifs.includes('ia'), 'photo protegee par l\'IA : marquee a verifier');
        ok(r.avec.fond < 0.02, `avec IA, le fond reste retire (${r.avec.fond.toFixed(3)})`);
        ok(r.avec.sujet > 0.95, `le reste du sujet est garde (${r.avec.sujet.toFixed(2)})`);
        ok(r.avec.vert > 30, `la combinaison reste verte (pas grisee par le reflet vert) : ${r.avec.vert.toFixed(0)}`);
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : retouches au pinceau (garder, retirer, affiner, portee, annuler)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag(synthese(url));
        // Calcul : un trait « retirer » sur le visage, un trait « garder » dans le fond.
        const calc = await page.evaluate(() => {
          const W = 600, H = 450;
          const { rgba } = synthFondVert(W, H);
          const retouches = [
            { mode: 'retirer', r: 20, durete: 1, pts: [[0.5, 0.4]] },
            { mode: 'garder', r: 20, durete: 1, pts: [[0.1, 0.15], [0.15, 0.15]] },
            { mode: 'bord', r: 15, durete: 0.5, pts: [[0.4, 0.2], [0.6, 0.2]] },
          ];
          const at = (a, u, v) => a[Math.round(v * H) * W + Math.round(u * W)];
          const sans = SL.dt.detourer(new Uint8ClampedArray(rgba), W, H, SL.dt.DEFAUTS.portraits).alpha;
          const avec = SL.dt.detourer(new Uint8ClampedArray(rgba), W, H, SL.dt.DEFAUTS.portraits, null, 'portraits', { retouches }).alpha;
          return { visage: [at(sans, 0.5, 0.4), at(avec, 0.5, 0.4)], fond: [at(sans, 0.12, 0.15), at(avec, 0.12, 0.15)], corps: at(avec, 0.5, 0.8) };
        });
        eq(calc.visage, [255, 0], 'retirer : le visage peint devient transparent');
        eq(calc.fond, [0, 255], 'garder : le fond peint devient opaque');
        eq(calc.corps, 255, 'le reste ne change pas');

        // Ecran : peindre a la souris, portee, annuler / retablir.
        const imgs = await makeImages(page, [
          { name: 'p1.jpg', kind: 'vert', w: 1200, h: 900 }, { name: 'p2.jpg', kind: 'vert', w: 1200, h: 900 }]);
        await page.setInputFiles('#pick-files', imgs);
        await waitText(page, '#full-status', /Pleine définition prête/, 60000);
        await page.click('#vue button[data-vue="masque"]');
        await page.click('#outil button[data-o="retirer"]');
        const box = await page.locator('#views canvas').boundingBox();
        const point = async (u, v) => {
          await page.mouse.move(box.x + box.width * u, box.y + box.height * v);
        };
        await point(0.2, 0.7);
        await page.mouse.down();
        await point(0.25, 0.72);
        await point(0.3, 0.74);
        await page.mouse.up();
        await waitText(page, '#full-status', /Pleine définition prête/, 60000);
        has(await page.textContent('#retouches-info'), '1 sur cette photo', 'trait enregistre pour la photo');
        const pixel = () => page.evaluate(() => {
          const c = SL.dt.ui.etat.apercu.masque;
          return c.getContext('2d').getImageData(Math.round(c.width * 0.25), Math.round(c.height * 0.72), 1, 1).data[0];
        });
        eq(await pixel(), 0, 'la zone peinte est retiree dans l\'apercu');
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(800);
        has(await page.textContent('#retouches-info'), '0 sur cette photo', 'Ctrl+Z annule le trait');
        ok(await pixel() > 200, 'apres annulation, le sujet revient');
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(500);
        has(await page.textContent('#retouches-info'), '1 sur cette photo', 'Ctrl+Y retablit le trait');
        // Portee « toute la classe » : visible sur l'autre photo.
        await page.selectOption('#portee', 'classe');
        await point(0.8, 0.1);
        await page.mouse.down();
        await page.mouse.up();
        await page.click('.dt-temoin[data-i="1"]');
        await waitText(page, '#full-status', /Pleine définition prête/, 60000);
        has(await page.textContent('#retouches-info'), '0 sur cette photo, 1 sur la classe', 'retouche de classe reprise sur la photo suivante');
        // Les retouches restent apres rechargement.
        await page.reload();
        await page.waitForTimeout(400);
        await page.setInputFiles('#pick-files', imgs);
        await waitText(page, '#full-status', /Pleine définition prête/, 60000);
        has(await page.textContent('#retouches-info'), '1 sur cette photo, 1 sur la classe', 'retouches gardees apres rechargement');
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
    name: 'detourage avance : traitement par lot, score, reprise, refaire, jamais d\'ecrasement',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await clearOpfs(page);
        const [a, b, c, vide] = await makeImages(page, [
          { name: 'a.jpg', kind: 'vert', w: 1200, h: 900 }, { name: 'b.jpg', kind: 'vert', w: 1200, h: 900, hair: '#3a2410' },
          { name: 'c.jpg', kind: 'vert', w: 900, h: 1200 }, { name: 'vide.jpg', kind: 'fond', color: 'rgb(40,170,70)' }]);
        await writeOpfs(page, [
          { path: 'src/CP A/a.jpg', buffer: a.buffer }, { path: 'src/CP A/b.jpg', buffer: b.buffer },
          { path: 'src/CE1/c.jpg', buffer: c.buffer }, { path: 'src/CE1/vide.jpg', buffer: vide.buffer },
          { path: 'src/CE1/casse.jpg', buffer: Buffer.from('pas une image') },
          // fichier deja present dans l'export : il ne doit jamais etre ecrase
          { path: 'out/Détourés/CE1/c.png', buffer: Buffer.from('ancien') },
        ]);
        // Erreur : lancer sans dossier d'export.
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          await SL.dt.ui.ouvrirDossier(await root.getDirectoryHandle('src'));
        });
        await page.click('#tab-reglage');
        await page.click('#type button[data-type="groupes"]');
        await page.click('#tab-lot');
        has(await page.textContent('#lot-photos'), '5 photos dans 2 classes', 'photos de la seance');
        has(await page.textContent('#lot-reglages'), 'Groupes', 'prereglage utilise');
        const dlg = [];
        page.on('console', m => { if (m.text().startsWith('DLG')) dlg.push(m.text()); });
        await page.click('#lot-start');
        await page.waitForTimeout(300);
        ok(dlg.some(d => d.includes('export')), 'sans dossier d\'export : message clair');
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          await SL.dt.lot.definirExport(await root.getDirectoryHandle('out'));
        });
        await page.click('#lot-start');
        await waitText(page, '#lot-progress-label', /Traitement terminé/, 90000);
        const fichiers = await listOpfs(page, 'out/Détourés');
        for (const f of ['CE1/c.png', 'CE1/c-2.png', 'CE1/vide.png', 'CP A/a.png', 'CP A/b.png', 'journal-detourage.csv', '.seance-detourage.json',
          '.vignettes/CP A/a.webp']) ok(fichiers.includes(f), `fichier attendu : ${f}\n      obtenu : ${fichiers.join(', ')}`);
        const ancien = await page.evaluate(async () => {
          const r = await navigator.storage.getDirectory();
          const d = await (await (await r.getDirectoryHandle('out')).getDirectoryHandle('Détourés')).getDirectoryHandle('CE1');
          return (await (await d.getFileHandle('c.png')).getFile()).text();
        });
        eq(ancien, 'ancien', 'le fichier deja present n\'est pas ecrase (nouveau fichier c-2.png)');
        const etat = await page.evaluate(() => {
          const e = SL.dt.lot.etat.etat.photos;
          return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, { statut: v.statut, score: v.score, motifs: v.motifs, erreur: v.erreur }]));
        });
        console.log('      etat :', JSON.stringify(etat));
        eq(etat['CE1/casse.jpg'].statut, 'erreur', 'photo illisible : erreur, le lot continue');
        has(etat['CE1/casse.jpg'].erreur, 'Photo illisible', 'erreur expliquee en francais');
        eq(etat['CE1/vide.jpg'].statut, 'verifier', 'photo sans sujet : a verifier');
        ok(['fait', 'verifier'].includes(etat['CP A/a.jpg'].statut) && etat['CP A/a.jpg'].score > etat['CE1/vide.jpg'].score, 'score plus haut pour une vraie photo');
        // Galerie : les plus douteuses d'abord (erreur, puis score croissant).
        const premiers = await page.$$eval('.dt-carte b', els => els.map(e => e.textContent));
        eq(premiers.slice(0, 2), ['casse.jpg', 'vide.jpg'], 'les plus douteuses en premier');
        // PNG transparent.
        const png = await page.evaluate(async () => {
          const r = await navigator.storage.getDirectory();
          const d = await (await (await r.getDirectoryHandle('out')).getDirectoryHandle('Détourés')).getDirectoryHandle('CP A');
          const bmp = await createImageBitmap(await (await d.getFileHandle('a.png')).getFile());
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          cv.getContext('2d').drawImage(bmp, 0, 0);
          const px = cv.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data;
          let t = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] === 0) t++;
          return { w: bmp.width, t: t / (px.length / 4) };
        });
        ok(png.w === 1200 && png.t > 0.3, `PNG en pleine definition avec fond transparent : ${JSON.stringify(png)}`);
        // Valider depuis le filtre « A verifier ».
        await page.click('#lot-filtre button[data-f="verifier"]');
        await page.click('.dt-carte button[data-a="valider"]');
        await page.click('#lot-filtre button[data-f="valide"]');
        ok((await page.locator('.dt-carte').count()) >= 1, 'photo validee');
        // Reprise : rien n'est refait, sauf l'erreur.
        await page.click('#lot-filtre button[data-f="toutes"]');
        const vider = () => page.evaluate(() => { document.getElementById('lot-progress-label').textContent = ''; });
        await vider();
        await page.click('#lot-start');
        await waitText(page, '#lot-progress-label', /Traitement terminé/, 60000);
        has(await page.textContent('#lot-progress-label'), '4 sautées', 'reprise : les photos deja faites sont sautees');
        // Refaire une photo : l'ancienne version est rangee, pas effacee.
        await vider();
        await page.click('.dt-carte:has(b:text-is("a.jpg")) button[data-a="refaire"]');
        await waitText(page, '#lot-progress-label', /Traitement terminé/, 60000);
        const apres = await listOpfs(page, 'out/Détourés');
        ok(apres.includes('_anciennes versions/CP A/a.png') && apres.includes('CP A/a.png'), `ancienne version rangee : ${apres.join(', ')}`);
        // Rechargement : la seance est relue depuis le dossier d'export.
        await page.reload();
        await page.waitForTimeout(400);
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          await SL.dt.ui.ouvrirDossier(await root.getDirectoryHandle('src'));
          await SL.dt.lot.definirExport(await root.getDirectoryHandle('out'));
        });
        await page.click('#tab-lot');
        eq(await page.locator('.dt-carte').count(), 5, 'galerie relue apres rechargement');
        ok(await page.locator('.dt-carte img').count() >= 4, 'vignettes relues');
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
