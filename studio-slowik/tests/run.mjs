// Lance tous les tests : node tests/run.mjs  (ou npm test)
// Option : node tests/run.mjs facturation  -> seulement les tests dont le nom contient « facturation ».
// Navigateur : Chromium de Playwright, ou celui indique par la variable CHROMIUM_PATH.
import { chromium } from 'playwright';
import { startServer, Fail } from './helpers.mjs';
import { tests as app } from './app.test.mjs';
import { tests as detourage } from './detourage.test.mjs';

const tests = [...app, ...detourage];

const filter = process.argv[2] || '';
const server = await startServer();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let passed = 0;
const failed = [];
const t0 = Date.now();

for (const t of tests.filter(x => x.name.includes(filter))) {
  const start = Date.now();
  try {
    await t.run({ browser, url: server.url });
    passed++;
    console.log(`  ok    ${t.name} (${((Date.now() - start) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed.push(t.name);
    console.log(`  ECHEC ${t.name}\n      ${e instanceof Fail ? e.message : (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')}`);
  }
}

await browser.close();
await server.close();
console.log(`\n${passed} réussi(s), ${failed.length} échec(s) en ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
if (failed.length) {
  console.log('Échecs : ' + failed.join(', '));
  process.exit(1);
}
