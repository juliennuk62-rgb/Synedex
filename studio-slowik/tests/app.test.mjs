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
