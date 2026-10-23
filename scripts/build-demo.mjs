// Inlines src/*.{css,js} into demo/shell.html and writes:
//   dist/marketplace-demo.html  page fragment (for hosts that add their own <head>)
//   docs/index.html             full standalone page, served by GitHub Pages
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

const description = 'Working prototype of a members-only marketplace on Supabase (Auth, Row Level Security, Storage) embedded in a Squarespace site with vanilla JS Code Blocks.';
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta property="og:title" content="Members Marketplace on Supabase + Squarespace">
<meta property="og:description" content="${description}">
<style>
:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
${out}
</html>
`;
mkdirSync(resolve(root, 'docs'), { recursive: true });
writeFileSync(resolve(root, 'docs/index.html'), page);
writeFileSync(resolve(root, 'docs/.nojekyll'), '');
console.log(`docs/index.html (${(page.length / 1024).toFixed(1)} KB)`);
