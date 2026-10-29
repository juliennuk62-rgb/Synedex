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
        eq(await listOpfs(page, 'src/export'), ['CE1/Ecole1_Bleu.jpg', 'CE1/Ecole1_Rouge.jpg', 'CP A/Ecole1_Bleu.jpg',
          'CP A/Ecole1_Rouge.jpg', 'CP A/Ecole2_Bleu.jpg', 'CP A/Ecole2_Rouge.jpg'], 'noms et sous-dossiers de classe (dossier d\'export exclu des sources)');
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
        ok((await listOpfs(page, 'src/export')).includes('CP A/Ecole1_Bleu-2.jpg'), 'sans reprise, une copie -2 est creee');
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
        eq(await page.$eval('#tabs .tab.active', t => t.dataset.tab), 'choix', 'sur telephone, le choix des fonds s\'ouvre directement');
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
        await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('slowik-choix'); q.onsuccess = q.onblocked = r; }));
        await page.reload(); await page.waitForTimeout(600); await withoutAccount(page);
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
              horsTexte: clairs(354, 1830, 2481, 2126, v => v > 600),
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
        const boite = await page.locator('#cl-canvas').boundingBox();
        const vers = (x, y) => [boite.x + x / 24 * boite.width, boite.y + y / 18 * boite.height];
        const tirer = async (de, a) => {
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
        await page.reload(); await page.waitForTimeout(400);
        await withoutAccount(page);
        await page.click('[data-tab=classe]');
        ok(Math.abs(await valeur('#cl-m-gauche') - 6.5) < 0.1 && Math.abs(await valeur('#cl-t-bas') - 4) < 0.1, 'placement garde apres rechargement');
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
        await tel.page.evaluate(() => { localStorage.removeItem('slowik.sync.purge'); return SL.choixSync.syncNow(); }); await tel.page.waitForTimeout(1200);
        eq(tables.choix_classes_sync.filter(r => r.deleted).length, 0, 'traces anciennes effacees');
        eq([...pc.page.errors, ...tel.page.errors], [], 'aucune erreur JavaScript');
      } finally { await close(pc.ctx, tel && tel.ctx); }
    },
  },
];
