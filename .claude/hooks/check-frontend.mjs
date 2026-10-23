#!/usr/bin/env node
// PostToolUse(Write|Edit|MultiEdit) on src/: catch the mistakes that break a
// Squarespace site, then rebuild the demo so it never drifts from src/.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEvent, feedback, relPath, projectDir, hasSecret } from './lib.mjs';

const { tool_input: input = {} } = readEvent();
const file = relPath(input.file_path);
if (!/^src\/.+\.(js|css)$/.test(file)) process.exit(0);

const abs = join(projectDir(), file);
const src = readFileSync(abs, 'utf8');
const problems = [];

if (file.endsWith('.js')) {
  try { execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' }); } catch (e) {
    problems.push(`Syntax error:\n${String(e.stderr).trim()}`);
  }
  src.split('\n').forEach((line, i) => {
    if (/\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML\(|document\.write\(/.test(line)) {
      problems.push(`${file}:${i + 1} writes HTML strings. Listing data is user content, so build DOM with h()/textContent to avoid XSS.`);
    }
  });
  if (hasSecret(src)) problems.push(`${file} contains a secret key. Front-end code may only use the anon key.`);
}

if (file.endsWith('.css')) {
  // Every selector must be scoped to .mp* (or :root tokens) so the Squarespace theme is untouched.
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/(?<=^|[{};])\s*([^{};]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@') || /^(from|to|\d+%)/.test(sel)) continue;
    for (const part of sel.split(',').map((s) => s.trim())) {
      if (!/\.mp|^:root\b/.test(part)) problems.push(`Unscoped CSS selector "${part}" would restyle the client's Squarespace theme. Prefix it with an .mp-* class.`);
    }
  }
}

if (problems.length) feedback(`Front-end check failed for ${file}:\n- ${problems.join('\n- ')}\n`);

try { execFileSync(process.execPath, [join(projectDir(), 'scripts/build-demo.mjs')], { stdio: 'ignore' }); } catch { /* demo build is best effort */ }
process.exit(0);
