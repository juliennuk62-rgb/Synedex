// Regenere la liste des fichiers et la version du service worker (sw.js).
// A lancer apres chaque modification : node studio-slowik/scripts/build-sw.mjs
// Avec --check : echoue si sw.js n'est pas a jour (pour les tests).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['supabase', 'scripts', 'tests', 'node_modules', '.git']);
const SKIP_FILES = new Set(['sw.js', 'README.md', 'package.json', 'package-lock.json']);
const EXT = /\.(html|css|js|png|webmanifest|svg|woff2)$/;

// IA du detourage (28 Mo) et lecteur de listes (8 Mo) : pas precharges, gardes a part a la premiere
// utilisation (voir sw.js).
const SKIP_PATHS = new Set([join(ROOT, 'detourage', 'ia'), join(ROOT, 'js', 'vendor', 'ocr')]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name) && !SKIP_PATHS.has(p)) out.push(...walk(p)); }
    else if (EXT.test(name) && !SKIP_FILES.has(name) && !name.startsWith('.')) out.push(p);
  }
  return out;
}

const files = walk(ROOT).map(p => relative(ROOT, p).split('\\').join('/'));
const hash = createHash('sha256');
files.forEach(f => { hash.update(f); hash.update(readFileSync(join(ROOT, f))); });
const version = hash.digest('hex').slice(0, 12);

const swPath = join(ROOT, 'sw.js');
const current = readFileSync(swPath, 'utf8');
const list = ['./', ...files].map(f => `  '${f}',`).join('\n');
const next = current
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/\/\/ FICHIERS:DEBUT\n[\s\S]*?\n\s*\/\/ FICHIERS:FIN/, `// FICHIERS:DEBUT\n${list}\n  // FICHIERS:FIN`);

if (process.argv.includes('--check')) {
  if (next !== current) { console.error('sw.js n\'est pas a jour : lancez node scripts/build-sw.mjs'); process.exit(1); }
  console.log(`sw.js a jour (${files.length} fichiers, version ${version})`);
} else {
  writeFileSync(swPath, next);
  console.log(`sw.js : ${files.length} fichiers, version ${version}`);
}
