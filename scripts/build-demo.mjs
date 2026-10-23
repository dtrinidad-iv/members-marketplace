// Inlines src/*.{css,js} into demo/shell.html → dist/marketplace-demo.html
// (a single self-contained file you can open locally or host anywhere).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shellPath = resolve(root, 'demo/shell.html');
const out = readFileSync(shellPath, 'utf8').replace(
  /\/\* @inline (\S+) \*\//g,
  (_, rel) => readFileSync(resolve(dirname(shellPath), rel), 'utf8').replace(/<\/script/gi, '<\\/script'),
);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/marketplace-demo.html'), out);
console.log(`dist/marketplace-demo.html (${(out.length / 1024).toFixed(1)} KB)`);
