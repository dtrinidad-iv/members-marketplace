#!/usr/bin/env node
// SessionStart: tell Claude whether the local Supabase stack is up, so it knows
// whether `npm run test:rls` can run before it tries.
import { execFileSync } from 'node:child_process';
import { projectDir } from './lib.mjs';

let line;
try {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: projectDir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
  const api = (out.match(/^API_URL="?([^"\n]+)/m) || [])[1];
  line = api ? `Local Supabase is running (API ${api}, Studio http://127.0.0.1:54323).` : 'Local Supabase status unknown.';
} catch {
  line = 'Local Supabase is NOT running. Start it with `colima start && npm run db:start` before running RLS tests.';
}
process.stdout.write(`${line}\n`);
