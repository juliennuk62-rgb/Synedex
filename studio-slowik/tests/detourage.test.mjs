// Tests du module « Detourage fond vert » (detourage/index.html).
import { ok, eq, has, openPage, makeImages, waitText, writeOpfs, listOpfs, clearOpfs, withoutAccount } from './helpers.mjs';

const close = async (...ctxs) => { for (const c of ctxs) if (c) await c.close(); };

// Stockage du navigateur de test (OPFS en memoire) : un dossier au nom accentue (« Détourés ») y
// est confondu avec son dossier parent. Defaut de cet environnement seulement (un vrai disque
// garde bien le dossier) : les chemins attendus sont adaptes.
async function fusionAccents(page) {
  return page.evaluate(async () => {
    const r = await navigator.storage.getDirectory();
    const t = await r.getDirectoryHandle('test-accent', { create: true });
    const same = await (await t.getDirectoryHandle('é', { create: true })).isSameEntry(t);
    await r.removeEntry('test-accent', { recursive: true });
    return same;
  });
}
const chemin = (fusion, p) => (fusion ? p.replace(/Détourés\//g, '') : p);
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
    name: 'detourage avance : pas de lueur rouge ni de teinte olive autour des cheveux (photo JPEG)',
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
            let red = 0, olive = 0, n = 0;
            for (let p = 0; p < W * H; p++) {
              const t = truth[p];
              if (!(t > 0 && t < 1) || p / W > H * 0.4) continue;
              const a = res.alpha[p] / 255;
              if (!a) continue;
              const R = img[p * 4], G = img[p * 4 + 1], B = img[p * 4 + 2];
              const rg = (R - G) / (R + G + B + 1);
              red += a * Math.max(0, rg - 0.167) * 100; n++;
              // teinte olive / verte (vert au niveau du rouge) : reste du fond dans la meche
              if (G >= 0.93 * Math.max(R, B) && G - Math.min(R, B) > 20) olive += a;
            }
            return { rouge: red / n, olive: (olive / n) * 100 };
          };
          const avec = lueur({}), sans = lueur({ bords: 0 });
          // cheveux blonds : le vert du fond y laisse une teinte olive si le reflet est mal retire
          const blond = synthFondVert(W, H, 1, [40, 60, 150], [215, 180, 120], [225, 190, 130]);
          jpeg.set(blond.rgba);
          truth.set(blond.truth);
          const blondAvec = lueur({}), standard = lueur({ methode: 'limite', bords: 0 });
          return { avec: avec.rouge, sans: sans.rouge, olive: blondAvec.olive, oliveStandard: standard.olive };
        });
        console.log(`      lueur rouge : ${r.avec.toFixed(2)} (sans « couleur des bords » : ${r.sans.toFixed(2)}) ; teinte olive : ${r.olive.toFixed(2)} % (methode standard : ${r.oliveStandard.toFixed(2)} %)`);
        ok(r.olive < 0.5 && r.olive < r.oliveStandard, `pas de teinte olive dans les meches (${r.olive.toFixed(2)} %)`);
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
    name: 'detourage avance : IA, petits trous entre les meches jamais proteges, grand vetement protege',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        const r = await page.evaluate(() => {
          const W = 400, H = 400, alpha = new Uint8Array(W * H);
          // sujet trouve par la cle : un disque (tete) ; trous de fond : 3 petits carres dans la
          // chevelure ; grand vetement vert retire par la cle : le bas de l'image
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const q = y * W + x;
            if ((x - 200) ** 2 + (y - 130) ** 2 < 100 ** 2) alpha[q] = 255;
            for (const [cx, cy] of [[150, 90], [230, 80], [200, 170]]) if (Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6) alpha[q] = 0;
          }
          // masque de l'IA : toute la personne (tete pleine, trous compris, et le buste)
          const mw = 100, mh = 100, m = new Float32Array(mw * mh);
          for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
            const X = x * 4 + 2, Y = y * 4 + 2;
            m[y * mw + x] = ((X - 200) ** 2 + (Y - 130) ** 2 < 104 ** 2) || (Y > 210 && Math.abs(X - 200) < 150) ? 1 : 0;
          }
          const a = new Uint8Array(alpha);
          const { prot } = SL.dt.ia.proteger(a, W, H, { m, mw, mh }, 1);
          return { trou: a[90 * W + 150], trouProt: prot[90 * W + 150], buste: a[320 * W + 200], busteProt: prot[320 * W + 200], tete: prot[130 * W + 200] };
        });
        eq(r.trou, 0, 'petit trou de fond dans la chevelure : reste du fond');
        eq(r.trouProt, 0, 'petit trou : reflet vert retire normalement');
        eq(r.buste, 255, 'grand vetement vert retire par la cle : garde par l\'IA');
        ok(r.busteProt > 200, 'grand vetement : sa couleur verte est gardee');
        eq(r.tete, 0, 'sujet deja trouve par la cle (cheveux, peau) : reflet vert retire normalement');
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
        // Reglages enregistres par une version precedente : anciennes valeurs par defaut mises a jour.
        await page.evaluate(() => localStorage.setItem('slowik-detourage', JSON.stringify({
          preset: 'Portraits (par défaut)', params: { methode: 'limite', trous: 20, tolerance: 41 },
          presets: { Ancien: { type: 'portraits', params: Object.assign({}, SL.dt.DEFAUTS.portraits, { methode: 'limite', trous: 20 }) } },
        })));
        await page.reload();
        await page.waitForTimeout(300);
        const migre = await page.evaluate(() => {
          const S = SL.dt.ui.etat;
          return [S.params.methode, S.params.trous, S.params.tolerance, S.presets.Ancien.params.methode, S.presets.Ancien.params.trous];
        });
        eq(migre, ['moyenne', 0, 41, 'moyenne', 0], 'anciens reglages par defaut mis a jour, reglage choisi a la main garde');
        await page.evaluate(() => localStorage.removeItem('slowik-detourage'));
        await page.reload();
        await page.waitForTimeout(300);
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
        const apres = await listOpfs(page, 'out');
        const fu = await fusionAccents(page);
        ok(apres.includes(chemin(fu, '_anciennes versions/Détourés/CP A/a.png')) && apres.includes(chemin(fu, 'Détourés/CP A/a.png')),
          `ancienne version rangee : ${apres.join(', ')}`);
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
    name: 'detourage avance : exports sur fonds, masques, dpi, reprise, envoi au compositeur et au choix des fonds',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await clearOpfs(page);
        const [a, b, bleu, rouge] = await makeImages(page, [
          { name: 'a.jpg', kind: 'vert', w: 1200, h: 900 }, { name: 'b.jpg', kind: 'vert', w: 1200, h: 900 },
          { name: 'Bleu.jpg', kind: 'fond', color: '#1430a0' }, { name: 'Rouge.jpg', kind: 'fond', color: '#c81414' }]);
        await writeOpfs(page, [
          { path: 'src/CP A/a.jpg', buffer: a.buffer }, { path: 'src/CP A/b.jpg', buffer: b.buffer },
          { path: 'fonds/Bleu.jpg', buffer: bleu.buffer }, { path: 'fonds/Rouge.jpg', buffer: rouge.buffer }]);
        // Photos a 300 dpi (comme un appareil photo).
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          const d = await (await root.getDirectoryHandle('src')).getDirectoryHandle('CP A');
          for (const n of ['a.jpg', 'b.jpg']) {
            const fh = await d.getFileHandle(n);
            const blob = await SL.dt.meta.ecrire(await fh.getFile(), { dpi: 300 });
            const w = await fh.createWritable(); await w.write(blob); await w.close();
          }
          await SL.dt.ui.ouvrirDossier(await root.getDirectoryHandle('src'));
          await SL.dt.lot.definirExport(await root.getDirectoryHandle('out', { create: true }));
        });
        await page.click('#tab-lot');
        await page.check('#exp-masque');
        await page.check('#exp-fonds');
        await page.evaluate(async () => SL.dt.lot.definirFonds(await (await navigator.storage.getDirectory()).getDirectoryHandle('fonds')));
        await page.uncheck('#exp-fonds-liste input[data-fond="1"]'); // Rouge
        await page.fill('#exp-projet', 'Ecole');
        has(await page.textContent('#exp-exemple'), 'Ecole1_Bleu.jpg', 'exemple de nom');
        const vider = () => page.evaluate(() => { document.getElementById('lot-progress-label').textContent = ''; });
        await page.click('#lot-start');
        await waitText(page, '#lot-progress-label', /Traitement terminé/, 90000);
        const fu = await fusionAccents(page);
        let f = await listOpfs(page, 'out');
        for (const x of [chemin(fu, 'Détourés/CP A/a.png'), 'Masques/CP A/a_masque.png', 'Masques/CP A/b_masque.png', 'Sur fonds/CP A/Ecole1_Bleu.jpg', 'Sur fonds/CP A/Ecole2_Bleu.jpg'])
          ok(f.includes(x), `fichier attendu : ${x}\n      obtenu : ${f.join(', ')}`);
        ok(!f.some(x => x.includes('Rouge')), 'fond decoche : pas exporte');
        const lu = await page.evaluate(async fu => {
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('out');
          const get = async chemin => { const p = chemin.split('/'); let d = root; for (const x of p.slice(0, -1)) d = await d.getDirectoryHandle(x); return (await d.getFileHandle(p.at(-1))).getFile(); };
          const jpg = await get('Sur fonds/CP A/Ecole1_Bleu.jpg');
          const bmp = await createImageBitmap(jpg);
          const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
          const coin = [...c.getContext('2d').getImageData(5, 5, 1, 1).data];
          const msk = await createImageBitmap(await get('Masques/CP A/a_masque.png'));
          return {
            dpiPng: (await SL.dt.meta.lire(await get(fu ? 'CP A/a.png' : 'Détourés/CP A/a.png'))).dpi, dpiJpg: (await SL.dt.meta.lire(jpg)).dpi,
            dpiMasque: (await SL.dt.meta.lire(await get('Masques/CP A/a_masque.png'))).dpi, coin, taille: [bmp.width, bmp.height, msk.width],
          };
        }, fu);
        eq([lu.dpiPng, lu.dpiJpg, lu.dpiMasque], [300, 300, 300], 'resolution 300 dpi conservee dans tous les fichiers');
        ok(lu.coin[2] > 120 && lu.coin[0] < 60, `photo sur le fond bleu : ${lu.coin}`);
        eq(lu.taille, [1200, 900, 1200], 'pleine definition');
        // Reprise avec les memes exports : rien n'est refait.
        await vider();
        await page.click('#lot-start');
        await waitText(page, '#lot-progress-label', /Traitement terminé/, 60000);
        has(await page.textContent('#lot-progress-label'), '2 sautées', 'reprise : rien a refaire');
        // Un fond de plus : les photos sont refaites, les anciens fichiers ranges (jamais effaces).
        await page.check('#exp-fonds-liste input[data-fond="1"]');
        await vider();
        await page.click('#lot-start');
        await waitText(page, '#lot-progress-label', /Traitement terminé/, 90000);
        f = await listOpfs(page, 'out');
        ok(f.includes('Sur fonds/CP A/Ecole1_Rouge.jpg') && f.includes('_anciennes versions/Sur fonds/CP A/Ecole1_Bleu.jpg'),
          `nouveau fond exporte, anciens fichiers ranges : ${f.join(', ')}`);
        // Envoi au compositeur.
        await page.click('#lot-vers-compositeur');
        await page.waitForURL(/index\.html#compositeur/);
        await page.waitForTimeout(400);
        await withoutAccount(page);
        await page.waitForTimeout(800);
        eq(await page.textContent('#name-sources'), 'Détourés', 'le compositeur recoit le dossier « Détourés »');
        ok(!(await page.isChecked('#chromaOn')) && await page.isChecked('#recursive'), 'photos deja detourees, une classe par sous-dossier');
        // Envoi au choix des fonds (photos de groupe).
        await page.goto(pageDetourage(url));
        await page.waitForTimeout(400);
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          await SL.dt.ui.ouvrirDossier(await root.getDirectoryHandle('src'));
          await SL.dt.lot.definirExport(await root.getDirectoryHandle('out'));
        });
        await page.click('#type button[data-type="groupes"]');
        await page.click('#tab-lot');
        await page.click('#lot-vers-choix');
        await page.waitForURL(/index\.html#choix/, { timeout: 10000 });
        await page.waitForTimeout(400);
        await withoutAccount(page);
        await page.waitForFunction(async () => (await SL.localChoix.groupes.list()).length === 2, null, { timeout: 20000 });
        has(await page.textContent('.toasts'), '2 classe(s) ajoutée(s)', 'les 2 photos de groupe deviennent 2 classes');
        ok(await page.isVisible('#page-choix'), 'arrivee directe sur le choix des fonds');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage avance : carte graphique (memes resultats que le processeur), dpi et profil couleur',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag(synthese(url));
        const r = await page.evaluate(async () => {
          const W = 900, H = 675;
          const { rgba } = synthFondVert(W, H);
          const run = gpu => {
            SL.dt.gpu.etat.forcer = gpu; SL.dt.gpu.etat.desactiver = !gpu;
            const img = new Uint8ClampedArray(rgba);
            const res = SL.dt.detourer(img, W, H, Object.assign({}, SL.dt.DEFAUTS.portraits, { ia: 0 }));
            return { img, alpha: res.alpha };
          };
          const cpu = run(false), gpu = run(true);
          SL.dt.gpu.etat.forcer = false; SL.dt.gpu.etat.desactiver = false;
          let da = 0, dc = 0, loin = 0;
          for (let i = 0; i < W * H; i++) {
            da = Math.max(da, Math.abs(cpu.alpha[i] - gpu.alpha[i]));
            for (let k = 0; k < 4; k++) {
              const e = Math.abs(cpu.img[i * 4 + k] - gpu.img[i * 4 + k]);
              dc = Math.max(dc, e);
              if (e > 2) loin++;
            }
          }
          loin /= W * H * 4;
          // dpi et profil : ecriture puis relecture (PNG et JPEG)
          const icc = new Uint8Array(70000).map((_, i) => (i * 7) % 251); // profil fictif sur 2 blocs JPEG
          const c = new OffscreenCanvas(40, 30); c.getContext('2d').fillRect(0, 0, 10, 10);
          const meta = {};
          for (const type of ['image/png', 'image/jpeg']) {
            const b = await SL.dt.meta.ecrire(await c.convertToBlob({ type }), { dpi: 254, icc });
            const lu = await SL.dt.meta.lire(new File([b], 'x'));
            const bmp = await createImageBitmap(b);
            meta[type] = { dpi: lu.dpi, icc: !!lu.icc && lu.icc.length === icc.length && lu.icc.every((v, i) => v === icc[i]), lisible: bmp.width === 40 };
          }
          return { da, dc, loin, gpuDisponible: SL.dt.gpu.carte() !== '', meta, crc: SL.dt.meta.crc32(new TextEncoder().encode('IEND')).toString(16) };
        });
        ok(r.gpuDisponible, 'WebGL2 disponible pour le test');
        // arrondis de calcul flottant : 3 niveaux sur 255 au plus, presque toujours 2 ou moins
        ok(r.da <= 2 && r.dc <= 3 && r.loin < 1e-4, `carte graphique = processeur (alpha ${r.da}, couleurs ${r.dc}, ecarts > 2 : ${(r.loin * 100).toFixed(4)} %)`);
        eq(r.crc, 'ae426082', 'CRC des blocs PNG');
        eq(r.meta['image/png'], { dpi: 254, icc: true, lisible: true }, 'PNG : dpi et profil relus, image lisible');
        eq(r.meta['image/jpeg'], { dpi: 254, icc: true, lisible: true }, 'JPEG : dpi et profil (2 blocs) relus, image lisible');
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
  {
    name: 'detourage avance : IA de groupe, installation verifiee, salle retiree hors du fond vert',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, pageDetourage(url));
      try {
        await page.addScriptTag({ url: new URL('../tests/mocks/synthese-groupe.js', pageDetourage(url)).href });
        // Petit modele de test (meme entree et sortie que le vrai), en 2 morceaux.
        await page.evaluate(() => SL.dt.iaGroupeClient.configurer({ dossier: '../tests/mocks/ia-groupe/' }));
        eq(await page.evaluate(() => SL.dt.iaGroupeClient.verifier()), false, 'IA de groupe pas encore installee');
        has(await page.textContent('#iag-etat'), 'non installée', 'ecran : IA non installee, taille annoncee');
        // Morceau abime pendant le telechargement (empreinte differente) : refuse, pas installee.
        const abime = await page.evaluate(async () => {
          SL.dt.iaGroupeClient.configurer({ dossier: '../tests/mocks/ia-groupe-abime/' });
          const m = await SL.dt.iaGroupeClient.installer().then(() => 'ok', e => e.message);
          return { m, installee: await SL.dt.iaGroupeClient.verifier() };
        });
        has(abime.m, 'abîmé', 'morceau abime refuse');
        eq(abime.installee, false, 'installation abimee : pas installee');
        await page.evaluate(() => SL.dt.iaGroupeClient.configurer({ dossier: '../tests/mocks/ia-groupe/' }));
        await page.click('#iag-installer');
        await waitText(page, '#iag-etat', /IA de groupe installée/, 10000);
        ok(await page.isHidden('#iag-installer') && await page.isVisible('#iag-retirer'), 'ecran : installee, bouton desinstaller');
        // Bouton « Tester » : rapport a copier (navigateur, carte, modele, une passe chronometree).
        await page.click('#iag-tester');
        await waitText(page, '#iag-rapport', /Résultat/, 20000);
        const rapport = await page.textContent('#iag-rapport');
        console.log('      rapport :', rapport.replace(/\n/g, ' | '));
        ok(/Installée sur cet ordinateur : oui/.test(rapport) && /Une passe \(image de test\) : \d+ ms/.test(rapport) && /fonctionne\./.test(rapport), 'rapport de test complet');
        ok(await page.isVisible('#iag-copier'), 'bouton copier le rapport');

        const r = await page.evaluate(async () => {
          const W = 1600, H = 1066;
          const fichier = async complet => {
            const { rgba, zone } = synthGroupe(W, H, complet);
            const c = new OffscreenCanvas(W, H);
            c.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0);
            return { file: new File([await c.convertToBlob({ type: 'image/png' })], 'groupe.png', { type: 'image/png' }), zone, rgba };
          };
          const g = await fichier(false);
          const iaComplet = await SL.dt.iaGroupeClient.masque((await fichier(true)).file, 'auto');
          const iaNon = await SL.dt.iaGroupeClient.masque(g.file, 'non');
          // Trois demandes en meme temps (photo affichee, traitement par lot, test) : chacune son tour.
          const [ia, ia2, diag] = await Promise.all([SL.dt.iaGroupeClient.masque(g.file, 'auto'),
            SL.dt.iaGroupeClient.masque(g.file, 'oui'), SL.dt.iaGroupeClient.diagnostic()]);
          const simultanes = { ok: !!(ia.m && ia2.m) && /fonctionne\./.test(diag), erreur: ia.erreur || ia2.erreur };
          const appel = w => (type, args) => new Promise((res, rej) => {
            w.onmessage = e => (e.data.ok ? res(e.data.res) : rej(new Error(e.data.err)));
            w.postMessage({ id: 1, type, args });
          });
          const A = appel(new Worker('js/worker/detourage-worker.js'));
          await A('charger', { file: g.file });
          const p = Object.assign({}, SL.dt.DEFAUTS.groupes);
          const mesure = async iaGroupe => {
            const d = await A('detourer', { params: p, renvoyer: true, type: 'groupes', iaGroupe });
            const z = g.zone, o = d.rgba;
            // pixels a plus de 6 px d'une autre zone (le contour est mesure a part)
            const loin = q => { const x = q % W, y = (q / W) | 0; for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4], [4, -4], [-4, 4]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || z[yy * W + xx] !== z[q]) return false; } return true; };
            const m = [[0, 0], [0, 0], [0, 0]];
            let vertBord = 0, nVert = 0, rougeAvant = 0, rougeApres = 0, nRouge = 0;
            for (let q = 0; q < W * H; q++) {
              const a = o[q * 4 + 3];
              if (loin(q)) { m[z[q]][0] += a / 255; m[z[q]][1]++; continue; }
              if (z[q] !== 2 || a < 128) continue;
              const x = q % W, y = (q / W) | 0;
              // personne au bord du fond vert : pas de reflet vert
              if (z[q - 3] === 1 || z[q + 3] === 1 || z[q - 3 * W] === 1) { vertBord += o[q * 4 + 1] - Math.max(o[q * 4], o[q * 4 + 2]); nVert++; }
              // personne en rouge (devant la salle, a gauche) : bord sans gris de la salle
              if (x > W * 0.06 && x < W * 0.22 && y > H * 0.5 && a < 250) { rougeAvant += g.rgba[q * 4 + 2] - g.rgba[q * 4]; rougeApres += o[q * 4 + 2] - o[q * 4]; nRouge++; }
            }
            return { salle: m[0][0] / m[0][1], vert: m[1][0] / m[1][1], personnes: m[2][0] / m[2][1], vertBord: nVert ? vertBord / nVert : 0,
              bleuAvant: nRouge ? rougeAvant / nRouge : 0, bleuApres: nRouge ? rougeApres / nRouge : 0, nBord: nRouge,
              score: d.confiance.score, motifs: d.confiance.motifs.map(x => x.code), groupe: d.groupe };
          };
          // masque de l'IA (meme taille que la photo ici) face aux vraies personnes
          // (loin des contours : une passe en miroir mal remise a l'endroit y laisse un fantome)
          let faux = 0;
          const z = g.zone;
          for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) {
            const q = y * W + x;
            if (z[q - 6] !== z[q] || z[q + 6] !== z[q] || z[q - 6 * W] !== z[q] || z[q + 6 * W] !== z[q]) continue;
            if (Math.abs(ia.m[q] - (z[q] === 2 ? 1 : 0)) > 0.25) faux++;
          }
          return { simultanes, complet: iaComplet, non: iaNon, ia: { passes: ia.passes, mw: ia.mw, mh: ia.mh, fournisseur: ia.fournisseur, erreur: ia.erreur, faux: faux / (W * H) },
            sans: await mesure(null), avec: await mesure(ia) };
        });
        console.log('      IA de groupe :', JSON.stringify(r));
        ok(r.complet && r.complet.inutile, 'fond vert sur tout le cadre : IA de groupe inutile en mode Auto');
        eq(r.non, null, 'mode Non : pas de calcul');
        eq(r.ia.erreur, undefined, 'IA de groupe calculee');
        ok(r.simultanes.ok, `demandes simultanees traitees l'une apres l'autre (${r.simultanes.erreur || 'ok'})`);
        eq(r.ia.passes, 2, 'photo entiere et son miroir');
        ok(r.ia.mw === 1600 && r.ia.faux < 0.0005, `masque de l'IA a la place des personnes, passe en miroir remise a l'endroit (${(r.ia.faux * 100).toFixed(2)} % faux)`);
        ok(r.sans.salle > 0.9, `sans IA de groupe, la salle reste (${r.sans.salle.toFixed(2)})`);
        ok(r.avec.salle < 0.02, `avec IA de groupe, la salle est retiree (${r.avec.salle.toFixed(3)})`);
        ok(r.avec.vert < 0.02, `le fond vert reste retire (${r.avec.vert.toFixed(3)})`);
        ok(r.avec.personnes > 0.98, `les personnes sont gardees (${r.avec.personnes.toFixed(3)})`);
        ok(r.avec.vertBord < 6, `pas de reflet vert au bord des personnes devant le fond vert (${r.avec.vertBord.toFixed(1)})`);
        ok(r.avec.groupe && r.avec.motifs.includes('groupe') && !r.avec.motifs.includes('fond'), `score : detourage par l'IA signale, fond partiel prevu (${r.avec.motifs})`);
        ok(r.avec.score >= 75, `photo pas marquee a verifier pour le fond partiel (${r.avec.score})`);
        ok(r.avec.nBord > 100 && r.avec.bleuApres >= r.avec.bleuAvant - 2, 'bord devant la salle : couleur du vetement, sans gris de la salle');

        // Ecran Reglage : photo de groupe ouverte, mode Groupes (« Auto ») : la salle disparait.
        const png = await page.evaluate(async () => {
          const W = 1600, H = 1066, { rgba } = synthGroupe(W, H, false);
          const c = new OffscreenCanvas(W, H);
          c.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0);
          const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
          let t = ''; for (let i = 0; i < b.length; i += 32768) t += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
          return btoa(t);
        });
        await page.click('#type button[data-type="groupes"]');
        has(await page.textContent('#params-groupe'), 'Détourer aussi hors du fond vert', 'reglage visible');
        await page.setInputFiles('#pick-files', [{ name: 'groupe.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
        await waitText(page, '#iag-photo', /2 passes/, 30000);
        await waitText(page, '#full-status', /Pleine définition prête/, 30000);
        const coin = await page.evaluate(() => {
          const c = document.querySelector('canvas[data-vue="masque"]');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let salle = 0, n = 0;
          for (let y = 0; y < c.height; y += 4) for (let x = Math.ceil(c.width * 0.96); x < c.width; x += 4) { salle += d[(y * c.width + x) * 4]; n++; }
          return salle / n;
        });
        ok(coin < 5, `ecran : la salle (bord droit) est retiree du masque (${coin.toFixed(1)})`);
        ok(!(await page.textContent('#analyse')).includes('Peu de fond vert'), 'pas d\'alerte « peu de fond vert » quand l\'IA de groupe detoure');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },
];
