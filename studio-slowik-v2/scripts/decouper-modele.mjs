// Decoupe un modele ONNX en morceaux de moins de 100 Mo (limite des fichiers sur GitHub) et ecrit
// le manifeste lu par l'IA de groupe (detourage/js/ui/ia-groupe.js) : tailles et SHA-256.
// Usage : node scripts/decouper-modele.mjs modele.onnx dossier-de-sortie [taille-max-en-octets] [description]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [,, src, out, max = String(95 * 1024 * 1024), description = ''] = process.argv;
if (!src || !out) { console.error('Usage : node scripts/decouper-modele.mjs modele.onnx dossier [taille-max] [description]'); process.exit(1); }
const data = readFileSync(src);
const taille = Number(max);
mkdirSync(out, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const morceaux = [];
for (let i = 0, k = 0; i < data.length; i += taille, k++) {
  const b = data.subarray(i, Math.min(data.length, i + taille));
  const nom = `modele.${String(k).padStart(3, '0')}`;
  writeFileSync(join(out, nom), b);
  morceaux.push({ nom, taille: b.length, sha256: sha(b) });
}
const manifeste = { description, taille: data.length, sha256: sha(data), morceaux };
writeFileSync(join(out, 'manifeste.json'), JSON.stringify(manifeste, null, 2) + '\n');
console.log(`${morceaux.length} morceau(x), ${data.length} octets`);
