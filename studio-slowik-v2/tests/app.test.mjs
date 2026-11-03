// Tests de bout en bout de Studio SLOWIK (Chromium, base en ligne simulee).
// Chaque test : le parcours principal + au moins un cas d'erreur.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, ok, eq, has, openPage, withoutAccount, signupLogin, waitText, makeImages, writeOpfs, listOpfs, clearOpfs, mock,
} from './helpers.mjs';

const sessionMock = { path: mock('supabase-session.js') };
const close = async (...ctxs) => { for (const c of ctxs) if (c) await c.close(); };
const dialogsOf = page => {
  const list = [];
  page.on('console', m => { if (m.text().startsWith('DLG')) list.push(m.text().slice(4)); });
  return list;
};

export const tests = [
  {
    name: 'service worker : liste des fichiers et version a jour',
    async run() {
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-sw.mjs'), '--check'], { encoding: 'utf8' });
      ok(r.status === 0, `sw.js n'est pas a jour : lancez « node scripts/build-sw.mjs ».\n${r.stderr}`);
    },
  },

  {
    name: 'V2 : memoire separee de la V1, reglages et donnees de la V1 copies a la premiere ouverture',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        // etat d'un navigateur qui a servi a la V1 : un reglage, une liste d'eleves ; V2 jamais ouverte
        await page.evaluate(async () => {
          localStorage.clear();
          for (const n of ['slowik', 'slowik2']) await new Promise(r => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = r; });
          localStorage.setItem('slowik.pdf.format', 'a4');
          const db = await new Promise(r => { const q = indexedDB.open('slowik', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => r(q.result); });
          await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put([{ id: 'l1', nom: 'CP A (V1)', eleves: [{ nom: 'DUPONT', prenom: 'Léa' }], created: 1, updated: 1, deleted: false }], 'listes'); t.oncomplete = r; });
          db.close();
        });
        await page.reload(); await page.waitForTimeout(600);
        await withoutAccount(page);
        ok(await page.isVisible('#v2-bandeau'), 'bandeau V2 avec lien vers la V1');
        eq(await page.getAttribute('#v2-bandeau a', 'href'), '../studio-slowik/', 'lien vers la V1');
        await page.click('[data-tab=pdf]');
        ok(await page.isChecked('input[name=pdf-format][value=a4]'), 'reglage de la V1 repris');
        await page.click('[data-tab=listes]');
        await waitText(page, '#ls-liste', /CP A \(V1\)/);
        // la V2 ecrit dans sa memoire, la V1 garde la sienne intacte
        await page.click('[data-tab=pdf]');
        await page.check('input[name=pdf-format][value=reel]');
        const etat = await page.evaluate(async () => {
          const lire = (n, k) => new Promise(r => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result; const g = d.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => { r(g.result); d.close(); }; }; });
          return { v1: localStorage.getItem('slowik.pdf.format'), v2: localStorage.getItem('slowik2.pdf.format'),
            listesV2: (await lire('slowik2', 'listes') || []).length, fait: !!localStorage.getItem('slowik2.migration-v1'),
            caches: (await caches.keys()).filter(k => k.startsWith('slowik-')).length };
        });
        eq([etat.v1, etat.v2], ['a4', 'reel'], 'reglage V1 intact, reglage V2 a part');
        eq(etat.listesV2, 1, 'liste copiee dans la memoire de la V2');
        ok(etat.fait, 'copie faite une seule fois');
        eq(etat.caches, 0, 'aucune memoire hors ligne au nom de la V1 (slowik-) : la V1 ne peut pas effacer celle de la V2');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'V2 : accueil et menu en colonne (etapes dans l\'ordre, reprendre, ecoles de la saison)',
    async run({ browser, url }) {
      const tables = { ecoles: [{ id: 'e1', nom: 'École Jean Jaurès', ville: 'Lens', archivee: false, type: 'ecole', taux_commission: 30 },
        { id: 'e2', nom: 'Les Tilleuls', ville: 'Arras', archivee: false, type: 'ecole', taux_commission: 30 },
        { id: 'e3', nom: 'Ancienne école', ville: '', archivee: true, type: 'ecole', taux_commission: 30 }],
        factures: [{ id: 'f1', ecole_id: 'e1', statut: 'emise', date_facture: '2099-10-10', ca: 1250 }, { id: 'f2', ecole_id: 'e1', statut: 'annulee', date_facture: '2099-10-11', ca: 99 }] };
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
      await ctx.exposeFunction('__srv', m => { const { args } = JSON.parse(m); return JSON.stringify({ data: tables[args.table] || [], error: null }); });
      await ctx.addInitScript({ path: mock('supabase-shared.js') });
      await ctx.addInitScript({ path: mock('auto-dialog.js') });
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', e => page.errors.push(e.message));
      try {
        await page.goto(url); await page.waitForTimeout(800);
        eq(await page.$eval('#tabs .tab.active', t => t.dataset.tab), 'accueil', 'arrivee sur l\'Accueil');
        eq(await page.$$eval('#tabs .tab:not(.hidden)', ts => ts.map(t => t.dataset.tab)),
          ['accueil', 'seances', 'listes', 'detourage', 'compositeur', 'classe', 'planche', 'choix', 'ecoles', 'facturation', 'renommer', 'pdf'], 'menu dans l\'ordre du travail');
        const box = await page.locator('#tabs').boundingBox();
        ok(box.width < 260 && box.height > 500, 'menu en colonne a gauche');
        eq(await page.$$eval('#ac-etapes .ac-etape strong', s => s.map(x => x.textContent)),
          ["Listes d'élèves", 'Détourage', 'Individuels sur fonds', 'Photo de classe', 'Planche contact', 'Choix des fonds', 'Facture'], 'etapes d\'une ecole dans l\'ordre');
        await waitText(page, '#ac-ecoles', /Jean Jaurès/);
        const ecoles = await page.textContent('#ac-ecoles');
        has(ecoles, '1 · 1 250,00 €', 'factures de la saison (annulee exclue)');
        ok(!ecoles.includes('Ancienne école'), 'ecoles archivees masquees');
        eq(await page.getAttribute('#tabs .tab[data-tab=detourage]', 'data-lien'), 'detourage/index.html', 'Detourage : lien vers sa page');
        // une etape ouvre son outil
        await page.click('#ac-etapes [data-aller=compositeur]');
        eq(await page.$eval('#tabs .tab.active', t => t.dataset.tab), 'compositeur', 'etape -> outil');
        // la fiche d'une ecole s'ouvre depuis l'accueil
        await page.click('#tabs .tab[data-tab=accueil]');
        await waitText(page, '#ac-ecoles', /Jean Jaurès/);
        await page.click('#ac-ecoles [data-ecole=e1]');
        await waitText(page, '#ecole-title', /Jean Jaurès/);
        // clavier : fleche bas dans le menu
        await page.focus('#tabs .tab[data-tab=ecoles]');
        await page.keyboard.press('ArrowDown');
        eq(await page.$eval('#tabs .tab.active', t => t.dataset.tab), 'facturation', 'fleche bas : entree suivante');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'V2 : seance d\'une ecole (dossier choisi une fois, tri des classes dans TIFF, groupes, noms, slowik-seance.json)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await withoutAccount(page);
        await clearOpfs(page);
        // deux listes d'eleves deja lues ; le dossier de l'ecole tel que Julien le range
        await page.evaluate(async () => {
          await SL.listes.enregistrer({ nom: 'CP A', eleves: [{ nom: 'DUPONT', prenom: 'Léa' }, { nom: 'MARTIN', prenom: 'Hugo' }, { nom: 'PETIT', prenom: 'Zoé' }] });
          await SL.listes.enregistrer({ nom: 'CE1', eleves: [{ nom: 'BERNARD', prenom: 'Noé' }, { nom: 'ROBIN', prenom: 'Sacha' }] });
          const r = await navigator.storage.getDirectory();
          const ecole = await r.getDirectoryHandle('Jean Jaures', { create: true });
          await (await ecole.getDirectoryHandle('SOURCE', { create: true })).getFileHandle('IMG_0001.CR3', { create: true });
          const tiff = await ecole.getDirectoryHandle('TIFF', { create: true });
          // G1 = groupe du CP A (en premier), 3 portraits, 2 portraits du CE1, G2 = son groupe (en dernier), X = ratee
          const photos = [['IMG_0001.tif', 300, 200, [200, 40, 40]], ['IMG_0002.tif', 160, 200, [40, 160, 60]], ['IMG_0003.tif', 160, 200, [40, 60, 160]],
            ['IMG_0004.tif', 160, 200, [160, 160, 40]], ['IMG_0005.tif', 160, 200, [40, 160, 160]], ['IMG_0006.tif', 160, 200, [160, 40, 160]],
            ['IMG_0007.tif', 300, 200, [90, 90, 90]], ['IMG_0008.tif', 160, 200, [10, 10, 10]]];
          for (const [nom, w, h, c] of photos) {
            const px = new Uint8Array(w * h * 4);
            for (let i = 0; i < w * h; i++) { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
            await SL.fsa.writeFile(tiff, nom, new Blob([UTIF.encodeImage(px, w, h)], { type: 'image/tiff' }));
          }
        });
        await page.click('[data-tab=seances]');
        await page.click('#se-nouvelle-btn');
        await page.selectOption('#se-ecole', '');
        await page.fill('#se-ecole-libre', 'École Jean Jaurès');
        await page.evaluate(async () => SL.seancesUI.definirNouveauDossier(await (await navigator.storage.getDirectory()).getDirectoryHandle('Jean Jaures')));
        const examen = await page.textContent('#se-examen');
        has(examen, '8 photo(s) dans TIFF', 'photos de depart trouvees dans TIFF');
        has(examen, 'Seront créés : PNG, JPEGS DEF, EXTRA', 'dossiers de sortie annonces');
        await page.click('#se-creer');
        await page.waitForSelector('#se-vue:not(.hidden)');
        has(await page.textContent('#se-titre'), 'École Jean Jaurès', 'seance ouverte');
        const dossiers = await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Jean Jaures'); const o = []; for await (const [n, h] of d.entries()) o.push(n + (h.kind === 'directory' ? '/' : '')); return o.sort(); });
        eq(dossiers, ['EXTRA/', 'JPEGS DEF/', 'PNG/', 'SOURCE/', 'TIFF/', 'slowik-seance.json'], 'dossiers crees, SOURCE et TIFF intacts, memoire de la seance dans le dossier');
        has(await page.textContent('#se-resume'), '1 classe(s)', 'une classe au depart');
        const classe = n => `#se-tri .se-classe >> nth=${n}`;
        const photo = (n, act) => page.click(`#se-tri figure[data-photo="${n}"] button[data-act=${act}]`);
        await page.selectOption(`${classe(0)} >> .se-liste`, { label: 'CP A (3)' });
        await photo('IMG_0001.tif', 'groupe');
        await page.click(`${classe(0)} >> button[data-act=couper-liste]`);
        await page.selectOption(`${classe(1)} >> .se-liste`, { label: 'CE1 (2)' });
        await photo('IMG_0007.tif', 'groupe');
        await photo('IMG_0008.tif', 'ecarter');
        await waitText(page, '#se-tri figure[data-photo="IMG_0008.tif"] .se-eleve', /Écartée/, 10000);
        const etiquette = n => page.textContent(`#se-tri figure[data-photo="${n}"] .se-eleve`);
        eq(await Promise.all(['IMG_0001.tif', 'IMG_0002.tif', 'IMG_0003.tif', 'IMG_0004.tif', 'IMG_0005.tif', 'IMG_0006.tif', 'IMG_0007.tif', 'IMG_0008.tif'].map(etiquette)),
          ['Photo de groupe', 'DUPONT Léa', 'MARTIN Hugo', 'PETIT Zoé', 'BERNARD Noé', 'ROBIN Sacha', 'Photo de groupe', 'Écartée'], 'chaque vignette porte le nom de son eleve');
        eq(await page.$$eval('#se-tri .se-classe .se-nom', i => i.map(x => x.value)), ['CP A', 'CE1'], 'classes nommees d\'apres leur liste');
        eq(await page.$$eval('#se-tri .se-etat .ok-text', s => s.length), 2, 'photos et noms correspondent dans les deux classes');
        await page.waitForFunction(() => [...document.querySelectorAll('#se-tri img')].every(i => i.naturalWidth > 0), null, { timeout: 30000 });
        await waitText(page, '#se-enregistre', /slowik-seance\.json/);
        await page.waitForTimeout(500);
        const json = await page.evaluate(async () => JSON.parse(await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Jean Jaures')).getFileHandle('slowik-seance.json')).getFile()).text()));
        eq(json.classes.map(c => [c.nom, c.debut, c.groupe, c.eleves.length]), [['CP A', 'IMG_0001.tif', 'IMG_0001.tif', 3], ['CE1', 'IMG_0005.tif', 'IMG_0007.tif', 2]], 'classes, groupes et noms enregistres dans le dossier');
        eq(json.ecartees, ['IMG_0008.tif'], 'photo ecartee enregistree');
        // une photo ecartee de trop : decalage signale
        await photo('IMG_0003.tif', 'ecarter');
        await waitText(page, '#se-tri .se-classe .se-etat', /il manque 1 photo/, 10000);
        eq(await etiquette('IMG_0004.tif'), 'MARTIN Hugo', 'les noms suivent l\'ordre des portraits');
        await photo('IMG_0003.tif', 'ecarter');
        await waitText(page, '#se-tri .se-classe .se-etat', /3 élèves ✓/, 10000);
        // reprise apres rechargement : depuis l'accueil
        await page.waitForTimeout(600);
        await page.reload(); await page.waitForTimeout(600); await withoutAccount(page);
        await page.click('[data-tab=accueil]');
        await waitText(page, '#ac-reprendre', /École Jean Jaurès/);
        await page.click('#ac-reprendre [data-seance]');
        await page.waitForSelector('#se-vue:not(.hidden)');
        await waitText(page, '#se-tri', /ROBIN Sacha/);
        eq(await etiquette('IMG_0003.tif'), 'MARTIN Hugo', 'seance reprise telle quelle');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'V2 : production depuis la seance (detourage, individuels, photos de classe, planches) sans rechoisir les dossiers',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await withoutAccount(page);
        await clearOpfs(page);
        const annee = await page.evaluate(() => SL.seances.anneeScolaire());
        // seance deja triee : CP A (groupe IMG_0001, 3 portraits), CE1 (2 portraits, groupe IMG_0007) ;
        // portraits deja detoures dans PNG, PNG du groupe du CP A depose (celui du CE1 manque) ; fonds de la saison
        const id = await page.evaluate(async annee => {
          const r = await navigator.storage.getDirectory();
          const tiffImg = async (dir, nom, w, h, c) => { const px = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { px.set(c, i * 4); px[i * 4 + 3] = 255; } await SL.fsa.writeFile(dir, nom, new Blob([UTIF.encodeImage(px, w, h)])); };
          const pngImg = async (dir, nom, w, h, c) => { const cv = new OffscreenCanvas(w, h), x = cv.getContext('2d'); x.fillStyle = `rgb(${c})`; x.fillRect(w * 0.2, h * 0.1, w * 0.6, h * 0.9); await SL.fsa.writeFile(dir, nom, await cv.convertToBlob({ type: 'image/png' })); };
          const jpg = async (dir, nom, c) => { const cv = new OffscreenCanvas(400, 300), x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 400, 300); await SL.fsa.writeFile(dir, nom, await cv.convertToBlob({ type: 'image/jpeg' })); };
          const ecole = await r.getDirectoryHandle('Jean Jaures', { create: true });
          const tiff = await ecole.getDirectoryHandle('TIFF', { create: true });
          const noms = ['IMG_0001.tif', 'IMG_0002.tif', 'IMG_0003.tif', 'IMG_0004.tif', 'IMG_0005.tif', 'IMG_0006.tif', 'IMG_0007.tif'];
          for (const [i, n] of noms.entries()) await tiffImg(tiff, n, i === 0 || i === 6 ? 300 : 160, 200, [40, 170, 70]);
          const png = await ecole.getDirectoryHandle('PNG', { create: true });
          const cpa = await png.getDirectoryHandle('CP A', { create: true }), ce1 = await png.getDirectoryHandle('CE1', { create: true });
          for (const n of ['IMG_0002', 'IMG_0003', 'IMG_0004']) await pngImg(cpa, `${n}.png`, 160, 200, [200, 40, 40]);
          await pngImg(cpa, 'IMG_0001.png', 300, 200, [40, 40, 200]);   // groupe detoure a la main
          for (const n of ['IMG_0005', 'IMG_0006']) await pngImg(ce1, `${n}.png`, 160, 200, [200, 40, 40]);
          await png.getDirectoryHandle('_anciennes versions', { create: true });
          for (const d of ['JPEGS DEF', 'EXTRA', 'SOURCE']) await ecole.getDirectoryHandle(d, { create: true });
          const fonds = await r.getDirectoryHandle('FONDS', { create: true });
          const ind = await fonds.getDirectoryHandle('INDIVIDUELS', { create: true }), cl = await fonds.getDirectoryHandle('CLASSE', { create: true });
          await jpg(ind, '1 Bleu.jpg', '#1430a0'); await jpg(ind, '2 Rouge.jpg', '#c81414'); await jpg(cl, 'Bleu nuit.jpg', '#102040');
          const data = SL.seances.nouvelleSeance({ ecole: { nom: 'École Jean Jaurès' }, annee });
          data.classes = [{ debut: 'IMG_0001.tif', nom: 'CP A', groupe: 'IMG_0001.tif', liste: null, eleves: [{ nom: 'DUPONT', prenom: 'Léa' }, { nom: 'MARTIN', prenom: 'Hugo' }, { nom: 'PETIT', prenom: 'Zoé' }] },
            { debut: 'IMG_0005.tif', nom: 'CE1', groupe: 'IMG_0007.tif', liste: null, eleves: [{ nom: 'BERNARD', prenom: 'Noé' }, { nom: 'ROBIN', prenom: 'Sacha' }] }];
          await SL.seances.ecrireJson(ecole, data);
          await SL.seances.memoriser({ id: data.id, ecole: data.ecole, annee, dossier: ecole, maj: Date.now() });
          await SL.store.idbSet(`fonds-saison:${annee}`, fonds);
          return data.id;
        }, annee);
        await page.click('[data-tab=seances]');
        await page.evaluate(id => SL.seancesUI.ouvrir(id), id);
        await waitText(page, '#se-production', /Fonds de la saison/);
        const prod = await page.textContent('#se-production');
        has(prod, 'INDIVIDUELS : 2 · CLASSE : 1', 'fonds de la saison retrouves');
        has(prod, '5 / 5 portrait(s) détouré(s) dans PNG', 'portraits deja detoures comptes');
        has(prod, '1 / 2 PNG de groupe', 'groupes detoures a la main comptes');
        has(prod, 'À déposer : PNG/CE1/IMG_0007.png', 'groupe manquant indique');

        // individuels sur fonds : dossiers et portraits deja la, groupe et anciennes versions laisses de cote
        await page.click('#se-production [data-prod=individuels]');
        await page.waitForFunction(() => document.querySelector('#page-compositeur.active') && SL.compositeur.state.sources.length > 0, null, { timeout: 10000 });
        eq(await page.evaluate(() => SL.compositeur.state.sources.map(s => `${s.classe}/${s.name}`).sort()),
          ['CE1/IMG_0005.png', 'CE1/IMG_0006.png', 'CP A/IMG_0002.png', 'CP A/IMG_0003.png', 'CP A/IMG_0004.png'], 'seulement les portraits des classes');
        eq([await page.textContent('#name-sources'), await page.textContent('#name-fonds'), await page.textContent('#name-export')], ['PNG', 'INDIVIDUELS', 'JPEGS DEF'], 'dossiers de la seance');
        await page.click('#start');
        await waitText(page, '#progress-label', /fichier/, 60000);
        const jpegs = await listOpfs(page, 'Jean Jaures/JPEGS DEF');
        eq(jpegs.length, 10, '5 portraits x 2 fonds');
        ok(jpegs.includes('CP A/001_DUPONT Léa_1 Bleu.jpg') && jpegs.includes('CE1/005_ROBIN Sacha_2 Rouge.jpg'), `ranges par classe, nommes par eleve (${jpegs.slice(0, 3)})`);

        // photos de classe : le groupe du CP A seulement, ecole et annee de la seance
        await page.click('[data-tab=seances]');
        await page.evaluate(id => SL.seancesUI.ouvrir(id), id);
        await waitText(page, '#se-production', /Fonds de la saison/);
        await page.click('#se-production [data-prod=classe]');
        await page.waitForFunction(() => document.querySelector('#page-classe.active') && /1 photo\(s\) de groupe/.test(document.querySelector('#cl-compte').textContent), null, { timeout: 10000 });
        eq(await page.inputValue('#cl-ecole'), 'École Jean Jaurès', 'ecole de la seance');
        eq(await page.inputValue('#cl-annee'), annee, 'annee de la seance');
        await page.click('#cl-go');
        await waitText(page, '#cl-etat', /créée/, 60000);
        ok((await listOpfs(page, 'Jean Jaures/JPEGS DEF')).includes('CP A/CP A - Bleu nuit.jpg'), 'photo de classe rangee avec sa classe');

        // planches contact avec les noms
        await page.click('[data-tab=seances]');
        await page.evaluate(id => SL.seancesUI.ouvrir(id), id);
        await waitText(page, '#se-production', /Fonds de la saison/);
        await page.click('#se-production [data-prod=planches]');
        await waitText(page, '#se-prod-etat', /2 planche\(s\)/, 60000);
        eq(await listOpfs(page, 'Jean Jaures/EXTRA'), ['Planches contact/Planche contact - CE1.pdf', 'Planches contact/Planche contact - CP A.pdf'], 'planches dans EXTRA');

        // detourage : les portraits de TIFF (groupes exclus), PNG ranges dans PNG/<classe>
        await page.click('#se-production [data-prod=detourage]');
        await page.waitForURL(/detourage\/index\.html/);
        await waitText(page, '#dt-seance', /5 portrait\(s\) de TIFF dans 2 classe\(s\)/, 20000);
        eq(await page.evaluate(() => [SL.dt.seance.DOSSIER, SL.dt.lot.etat.exportDir.name, SL.dt.ui.etat.photos.map(p => `${p.classe}/${p.name}`).join(',')]),
          ['PNG', 'Jean Jaures', 'CP A/IMG_0002.tif,CP A/IMG_0003.tif,CP A/IMG_0004.tif,CE1/IMG_0005.tif,CE1/IMG_0006.tif'], 'detourage pret : portraits, export dans PNG');
        ok(!(await page.isChecked('#exp-masque')) && !(await page.isChecked('#exp-fonds')) && await page.isChecked('#exp-png'), 'seulement les PNG detoures');
        await page.click('#dt-seance a');
        await page.waitForURL(/index\.html#seance=/);
        await page.waitForTimeout(600);
        await withoutAccount(page);   // ici sans compte ; connecte, la seance s'ouvre directement
        await page.waitForSelector('#se-vue:not(.hidden)');
        has(await page.textContent('#se-titre'), 'École Jean Jaurès', 'retour a la seance');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'V2 : « Tout preparer » (detourage automatique, puis individuels nommes par eleve, photos de classe, planches, bilan)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await withoutAccount(page);
        await clearOpfs(page);
        const annee = await page.evaluate(() => SL.seances.anneeScolaire());
        // seance deja triee : CP A (groupe IMG_0001, 3 portraits), CE1 (2 portraits, groupe IMG_0007) ;
        // portraits deja detoures dans PNG, PNG du groupe du CP A depose (celui du CE1 manque) ; fonds de la saison
        const id = await page.evaluate(async annee => {
          const r = await navigator.storage.getDirectory();
          const tiffImg = async (dir, nom, w, h) => { const cv = new OffscreenCanvas(w, h), x = cv.getContext('2d'); x.fillStyle = 'rgb(40,170,70)'; x.fillRect(0, 0, w, h); x.fillStyle = '#e0b090'; x.beginPath(); x.ellipse(w / 2, h * 0.35, w * 0.16, h * 0.14, 0, 0, 7); x.fill(); x.fillStyle = '#304080'; x.beginPath(); x.ellipse(w / 2, h * 0.85, w * 0.3, h * 0.35, 0, 0, 7); x.fill(); await SL.fsa.writeFile(dir, nom, new Blob([UTIF.encodeImage(new Uint8Array(x.getImageData(0, 0, w, h).data.buffer), w, h)])); };
          const pngImg = async (dir, nom, w, h, c) => { const cv = new OffscreenCanvas(w, h), x = cv.getContext('2d'); x.fillStyle = `rgb(${c})`; x.fillRect(w * 0.2, h * 0.1, w * 0.6, h * 0.9); await SL.fsa.writeFile(dir, nom, await cv.convertToBlob({ type: 'image/png' })); };
          const jpg = async (dir, nom, c) => { const cv = new OffscreenCanvas(400, 300), x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 400, 300); await SL.fsa.writeFile(dir, nom, await cv.convertToBlob({ type: 'image/jpeg' })); };
          const ecole = await r.getDirectoryHandle('Jean Jaures', { create: true });
          const tiff = await ecole.getDirectoryHandle('TIFF', { create: true });
          const noms = ['IMG_0001.tif', 'IMG_0002.tif', 'IMG_0003.tif', 'IMG_0004.tif', 'IMG_0005.tif', 'IMG_0006.tif', 'IMG_0007.tif'];
          for (const [i, n] of noms.entries()) await tiffImg(tiff, n, i === 0 || i === 6 ? 300 : 160, 200, [40, 170, 70]);
          const png = await ecole.getDirectoryHandle('PNG', { create: true });
          const cpa = await png.getDirectoryHandle('CP A', { create: true }), ce1 = await png.getDirectoryHandle('CE1', { create: true });
          await pngImg(cpa, 'IMG_0001.png', 300, 200, [40, 40, 200]);   // groupe detoure a la main
          await png.getDirectoryHandle('_anciennes versions', { create: true });
          for (const d of ['JPEGS DEF', 'EXTRA', 'SOURCE']) await ecole.getDirectoryHandle(d, { create: true });
          const fonds = await r.getDirectoryHandle('FONDS', { create: true });
          const ind = await fonds.getDirectoryHandle('INDIVIDUELS', { create: true }), cl = await fonds.getDirectoryHandle('CLASSE', { create: true });
          await jpg(ind, '1 Bleu.jpg', '#1430a0'); await jpg(ind, '2 Rouge.jpg', '#c81414'); await jpg(cl, 'Bleu nuit.jpg', '#102040');
          const data = SL.seances.nouvelleSeance({ ecole: { nom: 'École Jean Jaurès' }, annee });
          data.classes = [{ debut: 'IMG_0001.tif', nom: 'CP A', groupe: 'IMG_0001.tif', liste: null, eleves: [{ nom: 'DUPONT', prenom: 'Léa' }, { nom: 'MARTIN', prenom: 'Hugo' }, { nom: 'PETIT', prenom: 'Zoé' }] },
            { debut: 'IMG_0005.tif', nom: 'CE1', groupe: 'IMG_0007.tif', liste: null, eleves: [{ nom: 'BERNARD', prenom: 'Noé' }, { nom: 'ROBIN', prenom: 'Sacha' }] }];
          await SL.seances.ecrireJson(ecole, data);
          await SL.seances.memoriser({ id: data.id, ecole: data.ecole, annee, dossier: ecole, maj: Date.now() });
          await SL.store.idbSet(`fonds-saison:${annee}`, fonds);
          return data.id;
        }, annee);
        await page.click('[data-tab=seances]');
        await page.evaluate(id => SL.seancesUI.ouvrir(id), id);
        await waitText(page, '#se-production', /0 \/ 5 portrait/);
        await page.click('#se-production [data-prod=tout]');
        // le detourage tourne sur sa page, puis revient tout seul a la seance
        await page.waitForURL(/detourage\/index\.html/);
        await waitText(page, '#dt-seance', /Tout préparer/, 20000);
        await page.waitForURL(/index\.html#seance=.*&suite=1/, { timeout: 180000 });
        await page.waitForTimeout(600);
        await withoutAccount(page);   // ici sans compte ; connecte, la suite part directement
        await waitText(page, '#se-production', /Séance préparée/, 180000);
        const png = await listOpfs(page, 'Jean Jaures/PNG');
        eq(['CE1/IMG_0005.png', 'CE1/IMG_0006.png', 'CP A/IMG_0002.png', 'CP A/IMG_0003.png', 'CP A/IMG_0004.png'].filter(f => png.includes(f)).length, 5, 'portraits detoures dans PNG/<classe>');
        const jpegs = await listOpfs(page, 'Jean Jaures/JPEGS DEF');
        ok(['CP A/001_DUPONT Léa_1 Bleu.jpg', 'CP A/003_PETIT Zoé_2 Rouge.jpg', 'CE1/004_BERNARD Noé_1 Bleu.jpg', 'CE1/005_ROBIN Sacha_2 Rouge.jpg', 'CP A/CP A - Bleu nuit.jpg'].every(f => jpegs.includes(f)),
          `individuels nommes par eleve et photo de classe (${jpegs.join(', ')})`);
        eq(jpegs.length, 11, '5 portraits x 2 fonds + 1 photo de classe');
        eq((await listOpfs(page, 'Jean Jaures/EXTRA')).length, 2, 'planches contact');
        has(await page.textContent('#se-production'), 'groupe(s) à détourer à la main : CE1', 'bilan : groupe manquant');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'outils : texte protege, dialogues, messages',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        const h = await page.evaluate(() => String(SL.u.html`<b>${'<img src=x onerror=alert(1)>'}</b>${[SL.u.html`<i>${'a&b'}</i>`]}`));
        eq(h, '<b>&lt;img src=x onerror=alert(1)&gt;</b><i>a&amp;b</i>', 'html`` doit proteger les valeurs inserees');
        // dialogue : Echap = non ; action destructive = « Annuler » preselectionne
        await page.evaluate(() => { document.querySelectorAll('.dlg').forEach(d => d.remove()); });
        const r = await page.evaluate(async () => {
          // desactive l'acceptation automatique pour ce test
          const p = SL.u.confirm('Message', { title: 'Supprimer ?', ok: 'Supprimer', danger: true });
          const dlg = document.querySelector('.dlg');
          dlg.dataset.seen = '1';
          const focus = document.activeElement.textContent;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return { focus, res: await p };
        });
        eq(r, { focus: 'Annuler', res: false }, 'Echap annule, Annuler est preselectionne');
        const toasts = await page.evaluate(() => { SL.u.toast('A'); SL.u.toast('A'); SL.u.toast('B'); return [...document.querySelectorAll('.toast')].map(t => t.textContent); });
        eq(toasts, ['A', 'B'], 'les messages identiques ne doivent pas s\'empiler');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'detourage : flou limite aux bords identique au flou complet',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        const r = await page.evaluate(() => {
          const W = 700, H = 500, al = new Uint8Array(W * H);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let v = (x - 350) ** 2 / 150 ** 2 + (y - 280) ** 2 / 180 ** 2 < 1 ? 255 : 0;
            if (x >= 128 && x < 256) v = 255;                    // frontiere sur un bord de carreau
            if (x > 600 && y > 420) v = (x * 7 + y) % 256;       // zone bruitee
            al[y * W + x] = v;
          }
          let max = 0;
          for (const s of [0.6, 1.2, 4, 9]) {
            const a = SL.chroma.blur(al, W, H, s), b = SL.chroma.blurEdges(al, W, H, s);
            for (let i = 0; i < al.length; i++) max = Math.max(max, Math.abs(((a[i] + 0.5) | 0) - b[i]));
          }
          // detourage : le vert devient transparent, la peau reste opaque
          const d = new Uint8ClampedArray([40, 170, 70, 255, 224, 176, 144, 255]);
          const alpha = SL.chroma.keyPixels(d, 50, 30, 50);
          return { max, vert: alpha[0], peau: alpha[1] };
        });
        eq(r, { max: 0, vert: 0, peau: 255 }, 'flou identique, vert retire, peau gardee');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'compositeur : export par classe, noms, reprise',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      const dialogs = dialogsOf(page);
      try {
        await withoutAccount(page);
        await page.click('[data-tab=compositeur]');
        // erreur : lancer sans dossiers
        await page.click('#start');
        await page.waitForTimeout(300);
        ok(dialogs.some(d => d.includes('Export impossible')), 'un message doit expliquer pourquoi l\'export est impossible');
        await clearOpfs(page);
        const [v1, v2, v3, bleu, rouge] = await makeImages(page, [
          { kind: 'vert', name: 'a.jpg' }, { kind: 'vert', name: 'b.jpg' }, { kind: 'vert', name: 'c.jpg' },
          { kind: 'fond', name: 'Bleu.jpg', color: '#1430a0' }, { kind: 'fond', name: 'Rouge.jpg', color: '#c81414' }]);
        await writeOpfs(page, [
          { path: 'src/CP A/336A7934-Modifier.jpg', buffer: v1.buffer }, { path: 'src/CP A/IMG_2.jpg', buffer: v2.buffer },
          { path: 'src/CE1/a.jpg', buffer: v3.buffer }, { path: 'fonds/Bleu.jpg', buffer: bleu.buffer }, { path: 'fonds/Rouge.jpg', buffer: rouge.buffer }]);
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          const src = await root.getDirectoryHandle('src');
          await SL.compositeur.setFolder('sources', src);
          await SL.compositeur.setFolder('fonds', await root.getDirectoryHandle('fonds'));
          await SL.compositeur.setFolder('export', await src.getDirectoryHandle('export', { create: true }));
        });
        await page.fill('#project', 'Ecole');
        await page.waitForTimeout(500);
        has(await page.textContent('#counter'), '3 photo(s) × 2 fond(s) = 6 export(s)', 'compteur d\'exports');
        await page.click('#start');
        await waitText(page, '#progress-label', /fichier/);
        has(await page.textContent('#progress-label'), '6 fichier(s) exporté(s)', 'premier export');
        // numero continu : il ne repart pas a 1 en changeant de classe (CE1 : 1, CP A : 2 et 3)
        eq(await listOpfs(page, 'src/export'), ['CE1/1_Ecole_Bleu.jpg', 'CE1/1_Ecole_Rouge.jpg', 'CP A/2_Ecole_Bleu.jpg',
          'CP A/2_Ecole_Rouge.jpg', 'CP A/3_Ecole_Bleu.jpg', 'CP A/3_Ecole_Rouge.jpg'], 'noms, numero continu entre les classes, sous-dossiers de classe (dossier d\'export exclu des sources)');
        // reprise : rien n'est refait
        await page.evaluate(() => { document.getElementById('progress-label').textContent = ''; });
        await page.click('#start');
        await waitText(page, '#progress-label', /fichier/);
        has(await page.textContent('#progress-label'), '6 déjà présent(s) ignoré(s)', 'la reprise saute les fichiers deja exportes');
        // sans reprise : jamais d'ecrasement (suffixe -2)
        await page.uncheck('#resume');
        await page.evaluate(() => { document.getElementById('progress-label').textContent = ''; });
        await page.click('#start');
        await waitText(page, '#progress-label', /fichier/);
        ok((await listOpfs(page, 'src/export')).includes('CP A/2_Ecole_Bleu-2.jpg'), 'sans reprise, une copie -2 est creee');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'hors ligne : l\'application s\'ouvre sans Internet',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.waitForTimeout(1500);
        await ctx.setOffline(true);
        await page.reload();
        await page.waitForTimeout(800);
        ok(await page.isVisible('#auth-offline'), 'l\'ecran de connexion propose « Utiliser sans compte » hors ligne');
        await page.click('#auth-offline');
        await page.waitForTimeout(300);
        ok(await page.isVisible('#app'), 'l\'application s\'ouvre');
        has(await page.textContent('#offline-banner'), 'Hors ligne', 'bandeau hors ligne');
        await page.click('[data-tab=choix]');
        ok(await page.isVisible('#choix-liste'), 'le choix des fonds marche hors ligne');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'comptes et ecoles : invitation, fiche, acces, espace ecole',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url, { beforeScripts: [sessionMock] });
      try {
        await page.click('#auth-to-signup');
        await page.fill('#auth-email', 'intrus@x.fr'); await page.fill('#auth-password', 'secret1'); await page.fill('#auth-confirm', 'secret1');
        await page.click('#auth-submit'); await page.waitForTimeout(200);
        has(await page.textContent('#auth-message'), "n'a pas d'accès", 'inscription refusee hors invitation');
        await page.click('#auth-to-login');
        await signupLogin(page, 'admin@x.fr', 'secret1');
        await page.click('[data-tab=ecoles]');
        await page.click('#ecole-new');
        await page.fill('#ecole-form [name=nom]', 'École Jaurès');
        await page.fill('#ecole-form [name=ville]', 'Lens');
        await page.click('#ecole-save'); await page.waitForTimeout(300);
        has(await page.textContent('#ecoles-list'), 'École Jaurès', 'ecole creee');
        // erreur : nom manquant
        await page.click('#ecole-new');
        await page.click('#ecole-save'); await page.waitForTimeout(200);
        has(await page.textContent('#ecole-message'), 'obligatoire', 'nom obligatoire');
        await page.click('.list-item');
        await page.fill('#acces-email', 'dir@jaures.fr'); await page.click('#acces-form button'); await page.waitForTimeout(300);
        has(await page.textContent('#acces-list'), "en attente d'inscription", 'acces ajoute');
        await page.click('#logout'); await page.waitForTimeout(1000);
        await signupLogin(page, 'dir@jaures.fr', 'ecole12');
        eq(await page.$$eval('#tabs .tab:not(.hidden)', t => t.map(x => x.dataset.tab)), ['espace'], 'l\'ecole ne voit que son espace');
        has(await page.textContent('#espace-nom'), 'École Jaurès', 'fiche de l\'ecole');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'choix des fonds : numerotation, limite, recapitulatif, sauvegarde',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url, { context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, mobileNoFsa: true });
      const dialogs = dialogsOf(page);
      try {
        await withoutAccount(page);
        // V2 : on arrive sur l'Accueil ; sur telephone, le choix des fonds est dans la barre du bas
        eq(await page.$eval('#tabs .tab.active', t => t.dataset.tab), 'accueil', 'arrivee sur l\'Accueil');
        ok(await page.isVisible('#tabs .tab[data-tab=choix]'), 'choix des fonds dans la barre du bas du telephone');
        ok(await page.isHidden('#tabs .tab[data-tab=compositeur]'), 'outils d\'ordinateur absents sur telephone');
        await page.click('#nav-plus');
        ok(await page.isVisible('#tabs .tab[data-tab=pdf]'), '« Plus » deplie tout le menu');
        await page.click('#tabs .tab[data-tab=choix]');
        ok(!(await page.evaluate(() => document.body.classList.contains('nav-ouverte'))), 'le menu se replie en choisissant');
        eq(await page.$eval('#tabs .tab.active', t => t.dataset.tab), 'choix', 'choix des fonds ouvert');
        const imgs = await makeImages(page, [
          { kind: 'fond', name: 'Rouge.jpg', color: '#c81414' }, { kind: 'fond', name: 'Bleu.jpg', color: '#1430a0' },
          { kind: 'groupe', name: 'groupe_2.png', hair: '#c050c0' }, { kind: 'groupe', name: 'groupe_1.png' }]);
        await page.click('[data-guide=fonds]');
        await page.setInputFiles('#choix-fonds-grid input[type=file]', imgs.slice(0, 2));
        await page.waitForTimeout(1200);
        eq(await page.$$eval('.fond-card', c => c.map(x => x.querySelector('.num-badge').textContent + ':' + x.querySelector('.fond-nom').value)),
          ['1:Bleu', '2:Rouge'], 'fonds numerotes dans l\'ordre des noms');
        await page.click('#choix-fonds [data-choix-back]');
        await page.setInputFiles('#choix-add-classes', imgs.slice(2));
        await page.waitForTimeout(1500);
        eq(await page.$$eval('.choix-card .num-badge', c => c.map(x => x.textContent)), ['Classe 1', 'Classe 2'], 'classes numerotees');
        await page.click('.choix-card >> nth=0 >> .choix-card-img'); await page.waitForTimeout(500);
        await page.click('.pick-card >> nth=1 >> .stepper button >> nth=1'); await page.waitForTimeout(300);
        // erreur : un 2e exemplaire alors qu'un seul est offert
        await page.click('.pick-card >> nth=0 >> .stepper button >> nth=1'); await page.waitForTimeout(400);
        ok(dialogs.some(d => d.includes('Déjà 1 exemplaire')), 'le total ne peut pas depasser le nombre d\'exemplaires');
        await page.click('#choix-groupe [data-choix-back]'); await page.waitForTimeout(400);
        has(await page.textContent('#choix-recap'), 'Classe 1 : Fond 2 ×1', 'recapitulatif');
        const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#choix-csv')]);
        has(readFileSync(await csv.path(), 'utf8'), '"Classe 1";"groupe_1.png";"1";"2";"Rouge";"1"', 'CSV');
        const [bk] = await Promise.all([page.waitForEvent('download'), page.click('#choix-backup')]);
        const bkPath = await bk.path();
        await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('slowik2-choix'); q.onsuccess = q.onblocked = r; }));
        await page.reload(); await page.waitForTimeout(600); await withoutAccount(page);
        await page.click('#tabs .tab[data-tab=choix]'); await page.waitForTimeout(300);
        await page.setInputFiles('#choix-restore', bkPath); await page.waitForTimeout(1200);
        has(await page.textContent('#choix-recap'), 'Classe 1 : Fond 2 ×1', 'restauration de la sauvegarde');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'planche de demande : PDF remplissable et import',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await withoutAccount(page);
        await page.click('[data-tab=choix]');
        // erreur : aucune donnee
        await page.click('#choix-pdf'); await page.waitForTimeout(500);
        has(await page.textContent('#choix-pdf-message'), 'Ajoutez au moins un fond', 'message si rien a mettre dans la planche');
        const imgs = await makeImages(page, [{ kind: 'fond', name: 'A.jpg', color: '#1430a0' }, { kind: 'fond', name: 'B.jpg', color: '#c81414' },
          { kind: 'groupe', name: 'g1.png' }, { kind: 'groupe', name: 'g2.png' }]);
        await page.click('#choix-to-fonds');
        await page.setInputFiles('#choix-fonds-grid input[type=file]', imgs.slice(0, 2)); await page.waitForTimeout(1000);
        await page.click('#choix-fonds [data-choix-back]');
        await page.setInputFiles('#choix-add-classes', imgs.slice(2)); await page.waitForTimeout(1500);
        await page.fill('#choix-ecole', 'École Jaurès');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#choix-pdf')]);
        const pdf = readFileSync(await dl.path()).toString('base64');
        const filled = await page.evaluate(async b64 => {
          const doc = await PDFLib.PDFDocument.load(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
          const f = doc.getForm();
          const names = f.getFields().map(x => x.getName());
          f.getTextField('c1_f2').setText('1');
          f.getTextField('c2_f1').setText('3');   // trop : 1 seul exemplaire offert
          const bytes = await doc.save();
          let s = ''; bytes.forEach(c => { s += String.fromCharCode(c); });
          return { names, b64: btoa(s) };
        }, pdf);
        eq(filled.names, ['c1_f1', 'c1_f2', 'c2_f1', 'c2_f2'], 'une case par classe et par fond');
        await page.setInputFiles('#choix-pdf-import', { name: 'rempli.pdf', mimeType: 'application/pdf', buffer: Buffer.from(filled.b64, 'base64') });
        await page.waitForTimeout(1200);
        has(await page.textContent('#choix-pdf-message'), 'Classe 2 : 3 exemplaires demandés pour 1 offert(s), non importée', 'depassement signale');
        has(await page.textContent('#choix-recap'), 'Classe 1 : Fond 2 ×1', 'choix importes');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'facturation : calcul, numerotation, annulation, vue ecole',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url, { beforeScripts: [sessionMock] });
      try {
        await signupLogin(page, 'admin@x.fr', 'secret1');
        await page.click('[data-tab=ecoles]');
        await page.click('#ecole-new');
        await page.fill('#ecole-form [name=nom]', 'FC Lens'); await page.fill('#ecole-form [name=taux_commission]', '20');
        await page.click('#ecole-save'); await page.waitForTimeout(300);
        await page.fill('#acces-email', 'coach@fc.fr'); await page.click('#acces-form button'); await page.waitForTimeout(300);
        await page.click('[data-tab=facturation]'); await page.waitForTimeout(400);
        await page.click('#fac-new'); await page.waitForTimeout(300);
        await page.selectOption('#fac-n-ecole', { label: 'FC Lens' });
        await page.fill('.fac-ligne .fl-mt', '1 234,56');
        await page.click('#fac-add-ligne'); await page.fill('.fac-ligne >> nth=1 >> .fl-mt', '100');
        // erreur : ligne sans designation
        await page.click('#fac-create'); await page.waitForTimeout(200);
        has(await page.textContent('#fac-n-message'), 'désignation', 'designation obligatoire');
        await page.fill('.fac-ligne >> nth=1 >> .fl-des', 'Photos de groupe');
        const calc = (await page.textContent('#fac-calc')).replace(/\s+/g, ' ');
        has(calc, '1 334,56 €', 'chiffre d\'affaires'); has(calc, '266,91 €', 'commission versee (20 %)'); has(calc, '1 067,65 €', 'part du photographe');
        await page.click('#fac-create'); await page.waitForTimeout(600);
        const n1 = (await page.textContent('#fac-detail-body h2')).replace('Facture ', '');
        ok(/^\d{8}$/.test(n1), 'numero AAAAMMJJ');
        await page.click('#fac-detail [data-fac-back]'); await page.waitForTimeout(300);
        await page.click('#fac-new'); await page.waitForTimeout(300);
        await page.selectOption('#fac-n-ecole', { label: 'FC Lens' }); await page.fill('.fac-ligne .fl-mt', '50');
        await page.click('#fac-create'); await page.waitForTimeout(600);
        eq(await page.textContent('#fac-detail-body h2'), `Facture ${n1}-2`, 'deuxieme facture du jour : -2');
        await page.click('[data-annuler]'); await page.waitForTimeout(400);
        await page.click('#fac-detail [data-fac-back]'); await page.waitForTimeout(400);
        has((await page.textContent('#fac-stats')).replace(/\s+/g, ' '), '1 334,56 €', 'la facture annulee ne compte pas');
        await page.click('#logout'); await page.waitForTimeout(1000);
        await signupLogin(page, 'coach@fc.fr', 'coach12');
        const vue = (await page.textContent('#espace-factures')).replace(/\s+/g, ' ');
        has(vue, n1, 'l\'ecole voit sa facture');
        ok(!vue.includes(`${n1}-2`), 'l\'ecole ne voit pas la facture annulee');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'planche contact : un PDF par classe',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      const dialogs = dialogsOf(page);
      try {
        await withoutAccount(page);
        await page.click('[data-tab=planche]');
        await page.click('#pc-start'); await page.waitForTimeout(300);
        ok(dialogs.some(d => d.includes('Dossier manquant')), 'message si aucun dossier');
        await clearOpfs(page);
        const imgs = await makeImages(page, Array.from({ length: 4 }, (_, i) => ({ kind: 'vert', name: `p${i}.jpg`, w: 300, h: 400 })));
        await writeOpfs(page, [
          ...imgs.slice(0, 3).map((f, i) => ({ path: `exp/CP A/Ecole${i + 1}_Bleu.jpg`, buffer: f.buffer })),
          { path: 'exp/CE1/Ecole1_Bleu.jpg', buffer: imgs[3].buffer }]);
        await page.evaluate(async () => SL.plancheUI.setFolder(await (await navigator.storage.getDirectory()).getDirectoryHandle('exp')));
        has(await page.textContent('#pc-count'), '4 photo(s) dans 2 classe(s)', 'compte des photos');
        await page.click('#pc-start');
        await waitText(page, '#pc-progress', /Terminé|ERREUR/);
        eq(await listOpfs(page, 'exp/Planches contact'), ['Planche contact - CE1.pdf', 'Planche contact - CP A.pdf'], 'un PDF par classe');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'renommer : les photos prennent les noms de la liste, dans l\'ordre',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      const dialogs = dialogsOf(page);
      try {
        await withoutAccount(page);
        await page.click('[data-tab=renommer]');
        await clearOpfs(page);
        // largeur differente par photo : on retrouve quelle photo porte quel nom
        const noms = ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'IMG_3.JPG', 'IMG_20.jpg', 'IMG_21.jpg'];
        const imgs = await makeImages(page, noms.map((name, i) => ({ kind: 'vert', name, w: 100 + 10 * i, h: 80 })));
        await writeOpfs(page, [...imgs.map(f => ({ path: `ren/${f.name}`, buffer: f.buffer })),
          { path: 'ren/notes.txt', buffer: Buffer.from('pas une photo') }]);
        await page.evaluate(async () => SL.renommageUI.setFolder(await (await navigator.storage.getDirectory()).getDirectoryHandle('ren')));
        has(await page.textContent('#rn-etat'), '6 photo(s) : collez la liste', 'photos comptees (sans le .txt)');
        ok(await page.isDisabled('#rn-go'), 'bouton bloque sans liste');
        // colonnes d'Excel, ligne vide, homonymes, echange avec le nom d'une autre photo, nom deja pris
        await page.fill('#rn-liste', 'DUPONT\tLéa\nMARTIN Hugo\n\nDUPONT Léa\nIMG_1\nIMG_21\n');
        has(await page.textContent('#rn-etat'), '6 photo(s) mais 5 nom(s)', 'difference de nombre signalee');
        const apercu = await page.$$eval('#rn-apercu tbody tr', rs => rs.map(r => [...r.cells].slice(2).map(c => c.textContent.trim()).join(' > ')));
        eq(apercu, ['IMG_1.jpg > DUPONT Léa.jpg', 'IMG_2.jpg > MARTIN Hugo.jpg', 'IMG_3.JPG > DUPONT Léa (2).jpg',
          'IMG_10.jpg > IMG_1.jpg', 'IMG_20.jpg > IMG_21.jpg', 'IMG_21.jpg > — (pas de nom)'], 'apercu dans l\'ordre des noms de fichier');
        await page.waitForFunction(() => [...document.querySelectorAll('.rn-vignette')].every(i => i.naturalWidth > 0), null, { timeout: 15000 });
        await page.click('#rn-go');
        await page.waitForFunction(() => !document.querySelector('#rn-annuler').classList.contains('hidden'), null, { timeout: 10000 });
        ok(dialogs.some(d => d.includes('Nombres différents')), 'confirmation si les nombres different');
        eq(await listOpfs(page, 'ren'), ['DUPONT Léa (2).jpg', 'DUPONT Léa.jpg', 'IMG_1.jpg', 'IMG_21 (2).jpg', 'IMG_21.jpg', 'MARTIN Hugo.jpg', 'notes.txt'],
          'noms de la liste, sans ecraser la photo IMG_21 restee hors liste');
        const largeurs = await page.evaluate(async () => {
          const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('ren');
          const out = {};
          for (const n of ['DUPONT Léa.jpg', 'MARTIN Hugo.jpg', 'DUPONT Léa (2).jpg', 'IMG_1.jpg', 'IMG_21 (2).jpg', 'IMG_21.jpg']) {
            out[n] = (await createImageBitmap(await (await d.getFileHandle(n)).getFile())).width;
          }
          return out;
        });
        eq(largeurs, { 'DUPONT Léa.jpg': 120, 'MARTIN Hugo.jpg': 110, 'DUPONT Léa (2).jpg': 130, 'IMG_1.jpg': 100, 'IMG_21 (2).jpg': 140, 'IMG_21.jpg': 150 },
          'chaque photo porte le nom de sa ligne');
        // annulation : chaque photo reprend son nom
        await page.click('#rn-annuler');
        await page.waitForFunction(() => document.querySelector('#rn-annuler').classList.contains('hidden'));
        eq(await listOpfs(page, 'ren'), ['IMG_1.jpg', 'IMG_10.jpg', 'IMG_2.jpg', 'IMG_20.jpg', 'IMG_21.jpg', 'IMG_3.JPG', 'notes.txt'], 'noms d\'origine remis');
        // numero devant le nom
        await page.fill('#rn-liste', 'A\nB\nC\nD\nE\nF');
        await page.check('#rn-numero');
        has(await page.textContent('#rn-etat'), 'tout correspond', 'nombres egaux');
        has(await page.textContent('#rn-apercu'), '06 F.jpg', 'numero sur deux chiffres');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'renommer : navigateur qui refuse move() (renommage par copie, contenu garde, annulation)',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      const dialogs = dialogsOf(page);
      try {
        await withoutAccount(page);
        // comme le PC de Julien : move() refuse sans explication
        await page.evaluate(() => {
          const proto = Object.getPrototypeOf(FileSystemFileHandle.prototype);
          const refus = async function () { throw new TypeError("Failed to execute 'move' on 'FileSystemFileHandle'"); };
          FileSystemFileHandle.prototype.move = refus;
          if (proto.move) proto.move = refus;
        });
        await page.click('[data-tab=renommer]');
        await clearOpfs(page);
        const noms = ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg'];
        const imgs = await makeImages(page, noms.map((name, i) => ({ kind: 'vert', name, w: 100 + 10 * i, h: 80 })));
        await writeOpfs(page, [...imgs.map(f => ({ path: `ren2/${f.name}`, buffer: f.buffer })),
          { path: 'ren2/MARTIN Hugo.jpg', buffer: Buffer.from('autre fichier') }]);
        await page.evaluate(async () => SL.renommageUI.setFolder(await (await navigator.storage.getDirectory()).getDirectoryHandle('ren2')));
        // MARTIN Hugo.jpg (4e photo, hors liste) n'est jamais ecrase : 4 photos, 3 noms
        await page.fill('#rn-liste', 'IMG_2\nMARTIN Hugo\nDUPONT Léa');
        await page.click('#rn-go');
        await page.waitForFunction(() => !document.querySelector('#rn-annuler').classList.contains('hidden'), null, { timeout: 10000 });
        eq(await listOpfs(page, 'ren2'), ['DUPONT Léa.jpg', 'IMG_2.jpg', 'MARTIN Hugo (2).jpg', 'MARTIN Hugo.jpg'], 'renomme par copie, sans ecraser');
        const contenu = await page.evaluate(async () => {
          const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('ren2');
          const w = async n => (await createImageBitmap(await (await d.getFileHandle(n)).getFile())).width;
          return { a: await w('IMG_2.jpg'), b: await w('MARTIN Hugo (2).jpg'), c: await w('DUPONT Léa.jpg') };
        });
        eq(contenu, { a: 100, b: 110, c: 120 }, 'chaque photo garde son image');
        ok(!dialogs.some(d => d.includes('interrompu')), 'pas d\'erreur');
        await page.click('#rn-annuler');
        await page.waitForFunction(() => document.querySelector('#rn-annuler').classList.contains('hidden'));
        eq(await listOpfs(page, 'ren2'), ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'MARTIN Hugo.jpg'], 'annulation par copie');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'photo de classe : groupe cale sur ses 4 bords, marges, texte, 24 x 18 cm a 300 dpi',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await withoutAccount(page);
        await page.click('[data-tab=classe]');
        await clearOpfs(page);
        // groupe : rectangle opaque (pour mesurer) + une poussiere isolee laissee par le detourage
        const fichiers = await page.evaluate(async () => {
          const enc = async (c, type) => { const b = new Uint8Array(await (await c.convertToBlob({ type, quality: 0.95 })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
          const g = new OffscreenCanvas(1600, 1000), x = g.getContext('2d');
          x.fillStyle = 'rgb(220,30,30)'; x.fillRect(300, 200, 1000, 700);
          x.fillRect(40, 40, 6, 6);
          const opaque = new OffscreenCanvas(800, 600), o = opaque.getContext('2d'); o.fillStyle = '#888'; o.fillRect(0, 0, 800, 600);
          const fond = couleur => { const c = new OffscreenCanvas(1200, 900), y = c.getContext('2d'); y.fillStyle = couleur; y.fillRect(0, 0, 1200, 900); return c; };
          return { groupe: await enc(g, 'image/png'), opaque: await enc(opaque, 'image/jpeg'), bleu: await enc(fond('rgb(20,40,160)'), 'image/jpeg'), jaune: await enc(fond('rgb(250,240,190)'), 'image/jpeg') };
        });
        const b = k => Buffer.from(fichiers[k], 'base64');
        await writeOpfs(page, [{ path: 'groupes/CE1 B.png', buffer: b('groupe') }, { path: 'groupes/CM2.jpg', buffer: b('opaque') },
          { path: 'fondsclasse/Bleu.jpg', buffer: b('bleu') }, { path: 'fondsclasse/Jaune.jpg', buffer: b('jaune') }, { path: 'sortie/.garde', buffer: Buffer.from('') }]);
        await page.evaluate(async () => {
          const r = await navigator.storage.getDirectory();
          await SL.photoClasseUI.definir('groupes', await r.getDirectoryHandle('groupes'));
          await SL.photoClasseUI.definir('fonds', await r.getDirectoryHandle('fondsclasse'));
          await SL.photoClasseUI.definir('export', await r.getDirectoryHandle('sortie'));
        });
        const d = new Date(), y = d.getFullYear();
        eq(await page.inputValue('#cl-annee'), d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`, 'annee scolaire calculee');
        await page.fill('#cl-ecole', 'École Jean Jaurès');
        has(await page.textContent('#cl-compte'), '2 photo(s) de groupe × 2 fond(s) = 4', 'compte');
        await page.waitForFunction(() => !document.querySelector('#cl-canvas').classList.contains('hidden'));
        await page.click('#cl-go');
        await waitText(page, '#cl-etat', /créée/, 60000);
        eq(await listOpfs(page, 'sortie'), ['.garde', 'CE1 B - Bleu.jpg', 'CE1 B - Jaune.jpg', 'CM2 - Bleu.jpg', 'CM2 - Jaune.jpg'], 'une photo par groupe et par fond');
        has(await page.textContent('#cl-log'), 'CM2.jpg n\'a pas de fond transparent', 'groupe sans transparence signale');
        ok(!(await page.textContent('#cl-log')).includes('introuvable'), 'police d\'ecole chargee pour l\'export');
        eq(await page.$$eval('#cl-polices button', bs => bs.length), 9, 'choix de 9 polices');
        // ombre portee : pixels plus sombres que le fond autour des lettres blanches, seulement avec l'ombre
        const ombres = await page.evaluate(async () => {
          const P = SL.photoClasse;
          await P.chargerPolice('ecole');
          const groupe = new OffscreenCanvas(100, 60); groupe.getContext('2d').fillRect(0, 0, 100, 60);
          const fond = new OffscreenCanvas(40, 30), f = fond.getContext('2d'); f.fillStyle = 'rgb(128,128,128)'; f.fillRect(0, 0, 40, 30);
          const sombres = ombre => {
            const c = new OffscreenCanvas(1200, 900), x = c.getContext('2d');
            P.dessiner(x, 1200, 900, { groupe, cadre: { x0: 0, y0: 0, x1: 100, y1: 60 }, fond, ecole: 'École Jean Jaurès', annee: '2026-2027', reglages: { ombre } });
            const d = x.getImageData(0, 700, 1200, 130).data;
            let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) n++;
            return n;
          };
          return { aucune: sombres('aucune'), forte: sombres('forte'), defaut: P.REGLAGES.ombre };
        });
        eq(ombres.aucune, 0, 'sans ombre : aucun pixel sombre');
        ok(ombres.forte > 500, `avec ombre : ombre portee sous le texte (${ombres.forte})`);
        eq(ombres.defaut, 'normale', 'ombre normale par defaut');
        eq(await page.inputValue('#cl-t-ombre'), 'normale', 'choix de l\'ombre affiche');
        eq(await page.getAttribute('#cl-polices button[data-police=ecole]', 'aria-checked'), 'true', 'ecriture d\'ecole par defaut');
        ok(await page.evaluate(() => document.fonts.check('20px "Slowik craie"')), 'exemples affiches dans leur police');
        const m = await page.evaluate(async () => {
          const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sortie');
          const lire = async nom => {
            const f = await (await dir.getFileHandle(nom)).getFile();
            const o = new Uint8Array(await f.slice(0, 20).arrayBuffer());
            const bmp = await createImageBitmap(f);
            const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
            x.drawImage(bmp, 0, 0);
            const px = (u, v) => Array.from(x.getImageData(u, v, 1, 1).data.slice(0, 3));
            const clairs = (x0, y0, x1, y1, f2) => { const dd = x.getImageData(x0, y0, x1 - x0, y1 - y0).data; let n = 0; for (let i = 0; i < dd.length; i += 4) if (f2(dd[i] + dd[i + 1] + dd[i + 2])) n++; return n; };
            return {
              taille: [bmp.width, bmp.height], jfif: String.fromCharCode(...o.subarray(6, 10)), unite: o[13], dpi: (o[14] << 8) | o[15],
              // groupe 1000 x 700 dans un cadre de 18 x 10,5 cm : 15 x 10,5 cm, de x = 4,5 cm (531 px) a 19,5 cm (2303 px), y = 3 cm (354 px) a 13,5 cm (1594 px)
              dedansHautGauche: px(540, 363), avantGauche: px(520, 363), dessusHaut: px(540, 344), dedansBasDroite: px(2294, 1585), apresDroite: px(2313, 1585), dessousBas: px(540, 1604),
              poussiere: px(300, 300),
              texteGauche: clairs(354, 1730, 1400, 1815, v => v > 600), texteDroite: clairs(2000, 1730, 2481, 1815, v => v > 600),
              horsTexte: clairs(354, 1949, 2481, 2126, v => v > 600),   // 1,5 derniers cm (jambages de l'ecriture d'ecole compris)
              texteFonce: clairs(354, 1730, 1400, 1815, v => v < 250),
            };
          };
          return { bleu: await lire('CE1 B - Bleu.jpg'), jaune: await lire('CE1 B - Jaune.jpg') };
        });
        const bl = m.bleu, rouge = p => p[0] > 180 && p[1] < 80, bleu = p => p[2] > 120 && p[0] < 60;
        eq(bl.taille, [2835, 2126], '24 x 18 cm a 300 dpi');
        eq([bl.jfif, bl.unite, bl.dpi], ['JFIF', 1, 300], '300 dpi inscrits dans le fichier');
        ok(rouge(bl.dedansHautGauche) && rouge(bl.dedansBasDroite), `groupe aux bonnes dimensions (${bl.dedansHautGauche} ${bl.dedansBasDroite})`);
        ok(bleu(bl.avantGauche) && bleu(bl.dessusHaut) && bleu(bl.apresDroite) && bleu(bl.dessousBas), 'fond autour du groupe, groupe cale sur ses 4 bords');
        ok(bleu(bl.poussiere), 'poussiere du detourage ignoree');
        ok(bl.texteGauche > 200 && bl.texteDroite > 100, `texte blanc sur fond sombre, a gauche et a droite (${bl.texteGauche}, ${bl.texteDroite})`);
        eq(bl.horsTexte, 0, 'texte a 3 cm du bas, pas colle au bord');
        const jaunePale = m.jaune;
        ok(jaunePale.texteFonce > 200, `fond clair : texte fonce (${jaunePale.texteFonce})`);

        // placement a la main dans l'apercu : glisser le groupe, tirer un coin, monter le texte
        await page.selectOption('#cl-fond', 'Bleu.jpg');
        const valeur = async id => parseFloat((await page.inputValue(id)).replace(',', '.'));
        let boite;
        const vers = (x, y) => [boite.x + x / 24 * boite.width, boite.y + y / 18 * boite.height];
        const tirer = async (de, a) => {
          await page.locator('#cl-canvas').scrollIntoViewIfNeeded();
          boite = await page.locator('#cl-canvas').boundingBox();
          await page.mouse.move(...vers(...de)); await page.mouse.down();
          for (let k = 1; k <= 8; k++) await page.mouse.move(...vers(de[0] + (a[0] - de[0]) * k / 8, de[1] + (a[1] - de[1]) * k / 8));
          await page.mouse.up(); await page.waitForTimeout(100);
        };
        await tirer([12, 8], [14, 8]);                       // groupe 15 x 10,5 cm deplace de 2 cm a droite
        ok(Math.abs(await valeur('#cl-m-gauche') - 6.5) < 0.1 && Math.abs(await valeur('#cl-m-haut') - 3) < 0.1, 'groupe deplace');
        await tirer([21.5, 13.5], [19.5, 12.1]);             // coin bas droit : 13 x 9,1 cm, coin haut gauche fixe
        ok(Math.abs(await valeur('#cl-m-droite') - 4.5) < 0.1 && Math.abs(await valeur('#cl-m-bas') - 5.9) < 0.1 && Math.abs(await valeur('#cl-m-gauche') - 6.5) < 0.1, 'groupe reduit par un coin, sans deformation');
        await tirer([10, 15], [10, 14]);                     // ligne du texte montee de 1 cm
        ok(Math.abs(await valeur('#cl-t-bas') - 4) < 0.1, 'texte monte');
        // le reglage est garde (prochaine ouverture) et vaut pour l'export
        await page.evaluate(async () => {
          const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('sortie');
          for (const n of ['CE1 B - Bleu.jpg', 'CE1 B - Jaune.jpg', 'CM2 - Bleu.jpg', 'CM2 - Jaune.jpg']) await d.removeEntry(n);
        });
        await page.evaluate(() => { document.querySelector('#cl-log').innerHTML = ''; });
        await page.click('#cl-go');
        for (let k = 0; k < 300 && !(await page.textContent('#cl-log')).includes('4 photo(s) de classe créée'); k++) await page.waitForTimeout(200);
        const m2 = await page.evaluate(async () => {
          const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sortie');
          const bmp = await createImageBitmap(await (await dir.getFileHandle('CE1 B - Bleu.jpg')).getFile());
          const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
          x.drawImage(bmp, 0, 0);
          const px = (u, v) => Array.from(x.getImageData(u, v, 1, 1).data.slice(0, 3));
          // groupe : x de 6,5 cm (768 px) a 19,5 cm (2303 px), y de 3 cm (354 px) a 12,1 cm (1429 px)
          return { a: px(780, 366), b: px(755, 366), c: px(2290, 1418), d: px(2316, 1418), e: px(780, 1442) };
        });
        ok(rouge(m2.a) && rouge(m2.c), `export : groupe a la place choisie (${m2.a} ${m2.c})`);
        ok(bleu(m2.b) && bleu(m2.d) && bleu(m2.e), 'export : fond autour du groupe');
        // placement propre a une classe : CE1 B deplace seul, CM2 garde le placement commun
        await page.click('#cl-mode-perso');
        await tirer([12, 8], [14, 8]);
        ok(Math.abs(await valeur('#cl-m-gauche') - 6.5) < 0.1, 'placement commun inchange');
        has(await page.textContent('#cl-compte'), '1 classe(s) avec un placement propre', 'classe a placement propre comptee');
        await page.evaluate(async () => {
          const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('sortie');
          for (const n of ['CE1 B - Bleu.jpg', 'CE1 B - Jaune.jpg', 'CM2 - Bleu.jpg', 'CM2 - Jaune.jpg']) await d.removeEntry(n);
          document.querySelector('#cl-log').innerHTML = '';
        });
        await page.click('#cl-go');
        for (let k = 0; k < 300 && !(await page.textContent('#cl-log')).includes('4 photo(s) de classe créée'); k++) await page.waitForTimeout(200);
        const m3 = await page.evaluate(async () => {
          const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sortie');
          const lire = async nom => {
            const bmp = await createImageBitmap(await (await dir.getFileHandle(nom)).getFile());
            const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
            x.drawImage(bmp, 0, 0);
            return (u, v) => Array.from(x.getImageData(u, v, 1, 1).data.slice(0, 3));
          };
          const ce1 = await lire('CE1 B - Bleu.jpg'), cm2 = await lire('CM2 - Bleu.jpg');
          // CE1 B : de 8,5 cm (1004 px) ; CM2 (4:3) dans le cadre commun 13 x 9,1 cm : de 6,93 cm (819 px)
          return { ce1Dedans: ce1(1016, 400), ce1Avant: ce1(990, 400), cm2Dedans: cm2(832, 400), cm2Avant: cm2(806, 400) };
        });
        const gris = p => Math.abs(p[0] - p[2]) < 20 && p[0] > 100 && p[0] < 170;
        ok(rouge(m3.ce1Dedans) && bleu(m3.ce1Avant), `CE1 B a sa place propre (${m3.ce1Dedans} ${m3.ce1Avant})`);
        ok(gris(m3.cm2Dedans) && bleu(m3.cm2Avant), `CM2 garde le placement commun (${m3.cm2Dedans} ${m3.cm2Avant})`);
        await page.click('#cl-mode-commun');
        ok(!(await page.textContent('#cl-compte')).includes('placement propre'), 'retour au placement commun');
        await page.click('#cl-polices button[data-police=craie]');
        await page.reload(); await page.waitForTimeout(400);
        await withoutAccount(page);
        await page.click('[data-tab=classe]');
        ok(Math.abs(await valeur('#cl-m-gauche') - 6.5) < 0.1 && Math.abs(await valeur('#cl-t-bas') - 4) < 0.1, 'placement garde apres rechargement');
        eq(await page.getAttribute('#cl-polices button[data-police=craie]', 'aria-checked'), 'true', 'police gardee apres rechargement');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'assembler PDF : pages 2 par 2 l\'une sous l\'autre (paysage -> portrait), taille reelle ou A4',
    async run({ browser, url }) {
      const { ctx, page } = await openPage(browser, url);
      try {
        await withoutAccount(page);
        await page.click('[data-tab=pdf]');
        // PDF de 5 pages paysage A4 (la 5e enregistree en portrait tournee de 90°, comme le font certains logiciels)
        const source = await page.evaluate(async () => {
          const { PDFDocument, rgb, StandardFonts } = await SL.u.ensurePdfLib();
          const d = await PDFDocument.create();
          const f = await d.embedFont(StandardFonts.Helvetica);
          for (let i = 1; i <= 4; i++) {
            const p = d.addPage([842, 595]);
            p.drawRectangle({ x: 20, y: 20, width: 802, height: 555, color: rgb(i / 5, 0.3, 0.6) });
            p.drawText(`Page ${i}`, { x: 60, y: 500, size: 40, font: f });
          }
          const p5 = d.addPage([595, 842]);
          p5.setRotation({ type: 'degrees', angle: 90 });
          p5.drawText('Page 5', { x: 60, y: 700, size: 40, font: f });
          const b = await d.save();
          let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          return btoa(s);
        });
        const assembler = async () => {
          const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }),
            page.setInputFiles('#pdf-fichier', { name: 'Bons de commande.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source, 'base64') })]);
          eq(dl.suggestedFilename(), 'Bons de commande - 2 pages par feuille.pdf', 'nom du PDF assemble');
          const b64 = readFileSync(await dl.path()).toString('base64');
          return page.evaluate(async b64 => {
            const { PDFDocument } = await SL.u.ensurePdfLib();
            const d = await PDFDocument.load(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
            return d.getPages().map(p => {
              let texte = '';
              const contenu = p.node.normalizedEntries().Contents;
              const parts = contenu.asArray ? contenu.asArray() : [contenu];
              for (const ref of parts) {
                const st = p.doc.context.lookup(ref);
                const brut = st.getContents();
                let octets = brut;
                try { octets = pako.inflate(brut); } catch (e) { /* non compresse */ }
                texte += String.fromCharCode(...octets) + '\n';
              }
              const { width, height } = p.getSize();
              return { w: Math.round(width), h: Math.round(height), dessins: (texte.match(/ Do/g) || []).length, texte };
            });
          }, b64);
        };
        const reel = await assembler();
        eq(reel.map(p => [p.w, p.h]), [[842, 1190], [842, 1190], [842, 1190]], '5 pages -> 3 pages portrait, taille reelle (A4 paysage x 2 = A3 portrait)');
        eq(reel.map(p => p.dessins), [2, 2, 1], 'pages 1+2, 3+4, puis 5 seule');
        ok(/1 0 0 1 0 595 cm[\s\S]*Do[\s\S]*1 0 0 1 0 0 cm[\s\S]*Do/.test(reel[0].texte), 'page 1 en haut, page 2 en dessous');
        ok(/ -1 1 /.test(reel[2].texte), 'page tournee remise dans le bon sens');
        has(await page.textContent('#pdf-resultats'), '5 page(s) → 3 page(s) de 29,7 × 42 cm', 'resume');
        await page.check('input[name=pdf-format][value=a4]');
        const a4 = await assembler();
        eq(a4.map(p => [p.w, p.h]), [[595, 842], [595, 842], [595, 842]], 'format A4 portrait');
        eq(page.errors, [], 'aucune erreur JavaScript');
      } finally { await close(ctx); }
    },
  },

  {
    name: 'listes d\'eleves : photo lue sur le telephone, verifiee, retrouvee sur l\'ordinateur pour renommer',
    async run({ browser, url }) {
      const tables = { listes_eleves: [] };
      const handle = msg => {
        const { args } = JSON.parse(msg);
        const t = tables[args.table];
        if (!t) return { data: [], error: null };
        if (args.op === 'upsert') {
          const i = t.findIndex(r => r.id === args.payload.id);
          if (i >= 0) t[i] = args.payload; else t.push(args.payload);
          return { data: null, error: null };
        }
        return { data: t.slice(), error: null };
      };
      const appareil = async (opts) => {
        const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 900 } }, opts));
        await ctx.exposeFunction('__srv', m => JSON.stringify(handle(m)));
        await ctx.addInitScript({ path: mock('supabase-shared.js') });
        await ctx.addInitScript({ path: mock('auto-dialog.js') });
        if (opts && opts.telephone) await ctx.addInitScript(() => { delete window.showDirectoryPicker; });
        const page = await ctx.newPage();
        page.errors = [];
        page.on('pageerror', e => page.errors.push(e.message));
        page.dialogs = [];
        page.on('console', m => { if (m.text().startsWith('DLG')) page.dialogs.push(m.text().slice(4)); });
        await page.goto(url); await page.waitForTimeout(600);
        return { ctx, page };
      };
      const ELEVES = [['DUPONT', 'Léa'], ['MARTIN', 'Hugo'], ['LEFÈVRE', 'Chloé'], ["N'DIAYE", 'Aminata'], ['DA SILVA', 'Inès'], ['BERNARD', 'Noé']];
      const tel = await appareil({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, telephone: true });
      let pc = null;
      try {
        const p = tel.page;
        ok(await p.isHidden('[data-tab=renommer]'), 'pas de renommage sur le telephone');
        await p.click('[data-tab=listes]');
        // feuille imprimee photographiee un peu de travers : titre, en-tete, numeros et dates a ignorer
        const feuille = await p.evaluate(async eleves => {
          const c = new OffscreenCanvas(1500, 1200), x = c.getContext('2d');
          x.fillStyle = '#8a7a66'; x.fillRect(0, 0, 1500, 1200);
          x.translate(750, 600); x.rotate(1.5 * Math.PI / 180); x.translate(-700, -560);
          x.fillStyle = '#fbfaf5'; x.fillRect(0, 0, 1400, 1120);
          x.fillStyle = '#111'; x.font = 'bold 34px sans-serif'; x.fillText('Classe : CM1 A', 60, 80);
          const cols = [60, 160, 520, 900], hauts = ['N°', 'Nom', 'Prénom', 'Date de naissance'];
          x.font = 'bold 30px sans-serif'; hauts.forEach((h, i) => x.fillText(h, cols[i] + 12, 170));
          x.font = '30px sans-serif';
          eleves.forEach(([n, pr], k) => {
            const y = 240 + k * 64;
            [String(k + 1), n, pr, `0${k + 1}/0${k + 2}/2016`].forEach((t, i) => x.fillText(t, cols[i] + 12, y));
          });
          x.strokeStyle = '#333'; x.lineWidth = 2;
          for (let k = 0; k <= eleves.length + 1; k++) { x.beginPath(); x.moveTo(60, 125 + k * 64); x.lineTo(1300, 125 + k * 64); x.stroke(); }
          [...cols, 1300].forEach(cx => { x.beginPath(); x.moveTo(cx, 125); x.lineTo(cx, 125 + (eleves.length + 1) * 64); x.stroke(); });
          const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
          let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          return btoa(s);
        }, ELEVES);
        await p.setInputFiles('#ls-fichiers', { name: 'liste.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(feuille, 'base64') });
        await p.waitForSelector('#ls-revue:not(.hidden)', { timeout: 120000 });
        eq(await p.inputValue('#ls-nom'), 'CM1 A', 'nom de la liste pris sur la feuille');
        const lus = () => p.$$eval('#ls-table tbody tr', rs => rs.map(r => [...r.querySelectorAll('input')].map(i => i.value).join(' | ')));
        eq(await lus(), ELEVES.map(([n, pr]) => `${n} | ${pr}`), 'nom et prenom de chaque eleve, sans numero ni date');
        ok(await p.$$eval('#ls-table .ls-extrait', is => is.length) === ELEVES.length, 'extrait de la feuille a cote de chaque nom');
        // ligne ajoutee vide : refusee tant qu'elle n'est pas remplie ou supprimee
        await p.click('#ls-table tbody tr:nth-child(2) [data-act=inserer]');
        await p.click('#ls-enregistrer'); await p.waitForTimeout(300);
        ok(p.dialogs.some(d => d.includes('Ligne(s) 2 sans nom')), 'ligne vide signalee');
        await p.click('#ls-table tbody tr:nth-child(2) [data-act=suppr]');
        await p.fill('#ls-table tbody tr:nth-child(6) input[data-champ=prenom]', 'Noé-Paul');
        await p.click('#ls-enregistrer');
        await p.waitForSelector('#ls-revue.hidden', { state: 'attached' });
        await waitText(p, '#ls-liste', /CM1 A/);
        has(await p.textContent('#ls-liste'), '6 élève(s)', 'liste enregistree');
        await p.waitForFunction(() => /Synchronisées/.test(document.querySelector('#ls-sync').textContent), null, { timeout: 10000 });
        eq(tables.listes_eleves.length, 1, 'liste envoyee en ligne');
        eq(tables.listes_eleves[0].eleves[5], { nom: 'BERNARD', prenom: 'Noé-Paul' }, 'correction enregistree');
        // photo sans liste : message clair
        const blanc = await p.evaluate(async () => {
          const c = new OffscreenCanvas(800, 600), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
          const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
          return btoa(String.fromCharCode(...b));
        });
        await p.setInputFiles('#ls-fichiers', { name: 'vide.png', mimeType: 'image/png', buffer: Buffer.from(blanc, 'base64') });
        for (let k = 0; k < 120 && !p.dialogs.some(d => d.includes('Aucun nom')); k++) await p.waitForTimeout(500);
        ok(p.dialogs.some(d => d.includes('Aucun nom')), 'photo sans liste signalee');
        eq(p.errors, [], 'telephone : aucune erreur JavaScript');

        // ordinateur : la liste arrive dans Renommer
        pc = await appareil();
        await pc.page.click('[data-tab=renommer]');
        await pc.page.waitForFunction(() => [...document.querySelectorAll('#rn-listes option')].some(o => /CM1 A \(6\)/.test(o.textContent)), null, { timeout: 10000 });
        const id = tables.listes_eleves[0].id;
        await pc.page.selectOption('#rn-listes', id);
        await pc.page.waitForFunction(() => document.querySelector('#rn-liste').value.length > 0);
        eq((await pc.page.inputValue('#rn-liste')).split('\n'), ['DUPONT Léa', 'MARTIN Hugo', 'LEFÈVRE Chloé', "N'DIAYE Aminata", 'DA SILVA Inès', 'BERNARD Noé-Paul'], 'liste mise dans Renommer');
        await pc.page.selectOption('#rn-ordre', 'pn');
        await pc.page.waitForFunction(() => document.querySelector('#rn-liste').value.startsWith('Léa DUPONT'));
        has(await pc.page.textContent('#rn-etat'), '6 nom(s)', 'Renommer compte les noms');
        // depuis l'onglet Listes de l'ordinateur : bouton « Renommer les photos »
        await pc.page.click('[data-tab=listes]');
        await pc.page.click('#ls-liste [data-act=renommer]');
        await pc.page.waitForSelector('#page-renommer.active');
        eq(pc.page.errors, [], 'ordinateur : aucune erreur JavaScript');
      } finally { await close(tel.ctx, pc && pc.ctx); }
    },
  },

  {
    name: 'synchronisation : deux appareils, hors ligne, menage',
    async run({ browser, url }) {
      // « Serveur » partage entre les deux appareils
      const tables = { choix_fonds_sync: [], choix_classes_sync: [] };
      const files = {};
      let clock = Date.parse('2026-10-16T10:00:00Z');
      const match = (r, filters) => filters.every(([k, c, v]) => (k === 'eq' ? r[c] === v : k === 'lt' ? r[c] < v : r[c] > v));
      const handle = msg => {
        const { op, args } = JSON.parse(msg);
        if (op === 'put') { files[args.k] = args.v; return {}; }
        if (op === 'get') return { v: files[args.k] || null };
        if (op === 'del') { delete files[args.k]; return {}; }
        if (op === 'list') return { items: Object.keys(files).filter(k => k.startsWith(args.k)).map(k => ({ name: k.slice(args.k.length), metadata: { size: files[k].length } })) };
        const t = tables[args.table];
        if (!t) return { data: [], error: null };
        if (args.op === 'delete') { tables[args.table] = t.filter(r => !match(r, args.filters)); return { data: null, error: null }; }
        if (args.op === 'upsert') {
          const row = Object.assign({}, args.payload, { synced_at: new Date(clock += 1000).toISOString() });
          const i = t.findIndex(r => r.id === row.id);
          if (i >= 0) t[i] = row; else t.push(row);
          return { data: null, error: null };
        }
        let rows = t.filter(r => match(r, args.filters));
        if (args.order) rows = rows.sort((a, b) => String(a[args.order]).localeCompare(String(b[args.order])));
        return { data: rows, error: null };
      };
      const device = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
        await ctx.exposeFunction('__srv', m => JSON.stringify(handle(m)));
        await ctx.addInitScript({ path: mock('supabase-shared.js') });
        await ctx.addInitScript({ path: mock('auto-dialog.js') });
        const page = await ctx.newPage();
        page.errors = [];
        page.on('pageerror', e => page.errors.push(e.message));
        await page.goto(url); await page.waitForTimeout(600);
        await page.click('[data-tab=choix]'); await page.waitForTimeout(400);
        return { ctx, page };
      };
      const pc = await device();
      let tel = null;
      try {
        const imgs = await makeImages(pc.page, [{ kind: 'fond', name: 'Bleu.jpg', color: '#1430a0' }, { kind: 'groupe', name: 'g1.png' }, { kind: 'groupe', name: 'g2.png' }]);
        await pc.page.click('[data-guide=fonds]');
        await pc.page.setInputFiles('#choix-fonds-grid input[type=file]', imgs.slice(0, 1)); await pc.page.waitForTimeout(800);
        await pc.page.click('#choix-fonds [data-choix-back]');
        await pc.page.setInputFiles('#choix-add-classes', imgs.slice(1)); await pc.page.waitForTimeout(3000);
        eq([tables.choix_fonds_sync.length, tables.choix_classes_sync.length], [1, 2], 'envoi vers la base');
        tel = await device();
        await tel.page.waitForTimeout(2500);
        eq(await tel.page.$$eval('.choix-card .num-badge', c => c.map(x => x.textContent)), ['Classe 1', 'Classe 2'], 'le 2e appareil recoit les classes');
        // suppression hors ligne sur le PC, envoyee au retour d'Internet
        await pc.ctx.setOffline(true);
        await pc.page.click('.choix-card >> nth=1 >> .choix-card-img'); await pc.page.waitForTimeout(400);
        await pc.page.click('[data-del]'); await pc.page.waitForTimeout(1500);
        has(await pc.page.textContent('#choix-sync'), 'Hors ligne', 'etat hors ligne');
        await pc.ctx.setOffline(false);
        await pc.page.evaluate(() => window.dispatchEvent(new Event('online'))); await pc.page.waitForTimeout(2500);
        await tel.page.evaluate(() => SL.choixSync.syncNow()); await tel.page.waitForTimeout(1500);
        eq(await tel.page.$$eval('.choix-card .num-badge', c => c.map(x => x.textContent)), ['Classe 1'], 'la suppression arrive sur le 2e appareil');
        has(await pc.page.textContent('#choix-quota'), 'Espace en ligne utilisé', 'jauge d\'espace');
        // menage des traces de suppression de plus de 30 jours
        tables.choix_classes_sync.forEach(r => { if (r.deleted) r.updated = Date.now() - 40 * 864e5; });
        await tel.page.evaluate(() => { localStorage.removeItem('slowik2.sync.purge'); return SL.choixSync.syncNow(); }); await tel.page.waitForTimeout(1200);
        eq(tables.choix_classes_sync.filter(r => r.deleted).length, 0, 'traces anciennes effacees');
        eq([...pc.page.errors, ...tel.page.errors], [], 'aucune erreur JavaScript');
      } finally { await close(pc.ctx, tel && tel.ctx); }
    },
  },
];
