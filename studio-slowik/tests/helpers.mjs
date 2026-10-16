// Outils communs des tests : serveur local, navigateur, images de test, verifications.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCKS = join(ROOT, 'tests', 'mocks');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};

// Le site est servi sous /app/ (comme sur GitHub Pages, dans un sous-dossier).
export async function startServer() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (path.startsWith('/app/')) file = join(ROOT, path.slice(5) || 'index.html');
    if (path === '/app/') file = join(ROOT, 'index.html');
    if (!file || !file.startsWith(ROOT)) { res.writeHead(404).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (e) {
      res.writeHead(404).end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/app/index.html`;
  return { url, close: () => new Promise(r => server.close(r)) };
}

export const mock = name => join(MOCKS, name);

// --- verifications -----------------------------------------------------------------
export class Fail extends Error {}
export function ok(cond, msg) { if (!cond) throw new Fail(msg); }
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Fail(`${msg}\n      attendu : ${e}\n      obtenu  : ${a}`);
}
export function has(text, part, msg) {
  if (!String(text).includes(part)) throw new Fail(`${msg}\n      attendu dans : ${JSON.stringify(String(text).slice(0, 300))}\n      le texte : ${JSON.stringify(part)}`);
}

// --- page ------------------------------------------------------------------------------
// Nouvelle page avec fenetres de confirmation acceptees automatiquement et erreurs relevees.
export async function openPage(browser, url, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 900 }, acceptDownloads: true }, opts.context || {}));
  if (opts.beforeScripts) for (const s of opts.beforeScripts) await ctx.addInitScript(s);
  await ctx.addInitScript({ path: mock('auto-dialog.js') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  if (opts.mobileNoFsa) await page.addInitScript(() => { delete window.showDirectoryPicker; });
  await page.goto(url);
  await page.waitForTimeout(400);
  return { ctx, page };
}

// Ouvre l'application sans compte (bouton de l'ecran de connexion).
export async function withoutAccount(page) {
  if (await page.isVisible('#auth-offline')) await page.click('#auth-offline');
  await page.waitForTimeout(200);
}

// Inscription puis connexion avec la base simulee.
export async function signupLogin(page, email, pw) {
  await page.click('#auth-to-signup');
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', pw);
  await page.fill('#auth-confirm', pw);
  await page.click('#auth-submit');
  await page.waitForTimeout(150);
  await page.fill('#auth-password', pw);
  await page.click('#auth-submit');
  await page.waitForTimeout(500);
}

export const waitText = (page, selector, re, timeout = 60000) =>
  page.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), [selector, re.source], { timeout });

// --- images de test, dessinees dans le navigateur ---------------------------------------
// kind : 'fond' (couleur unie), 'groupe' (PNG detoure : silhouettes sur fond transparent),
//        'vert' (photo sur fond vert, JPEG)
export async function makeImages(page, specs) {
  const out = await page.evaluate(async specs => {
    const res = [];
    for (const s of specs) {
      const c = new OffscreenCanvas(s.w || 800, s.h || 600);
      const x = c.getContext('2d');
      const W = c.width, H = c.height;
      if (s.kind === 'fond') { x.fillStyle = s.color; x.fillRect(0, 0, W, H); }
      if (s.kind === 'vert') { x.fillStyle = 'rgb(40,170,70)'; x.fillRect(0, 0, W, H); }
      if (s.kind === 'groupe' || s.kind === 'vert') {
        for (let k = 0; k < 4; k++) {
          x.fillStyle = '#e0b090';
          x.beginPath(); x.ellipse(W * (0.2 + k * 0.2), H * 0.65, W * 0.07, H * 0.3, 0, 0, 7); x.fill();
          x.fillStyle = s.hair || '#e6c83c';
          x.beginPath(); x.ellipse(W * (0.2 + k * 0.2), H * 0.3, W * 0.05, H * 0.08, 0, 0, 7); x.fill();
        }
      }
      const type = s.kind === 'groupe' ? 'image/png' : 'image/jpeg';
      const blob = await c.convertToBlob({ type, quality: 0.9 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      res.push({ name: s.name, mimeType: type, b64: btoa(bin) });
    }
    return res;
  }, specs);
  return out.map(f => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.b64, 'base64') }));
}

// Ecrit des fichiers dans le stockage prive du navigateur (OPFS), qui imite des dossiers du PC.
export async function writeOpfs(page, files) {
  await page.evaluate(async files => {
    const root = await navigator.storage.getDirectory();
    for (const f of files) {
      const parts = f.path.split('/');
      let d = root;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(Uint8Array.from(atob(f.b64), c => c.charCodeAt(0)));
      await w.close();
    }
  }, files.map(f => ({ path: f.path, b64: f.buffer.toString('base64') })));
}

export async function listOpfs(page, dir) {
  return page.evaluate(async dir => {
    const out = [];
    let d = await navigator.storage.getDirectory();
    for (const p of dir.split('/')) d = await d.getDirectoryHandle(p);
    async function walk(h, pre) {
      for await (const [n, x] of h.entries()) {
        if (x.kind === 'file') out.push(pre + n); else await walk(x, pre + n + '/');
      }
    }
    await walk(d, '');
    return out.sort();
  }, dir);
}

export async function clearOpfs(page) {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
  });
}
