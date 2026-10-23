#!/usr/bin/env node
// PreToolUse(Write|Edit|MultiEdit):
//  1. never write a Supabase secret / service_role key into the repo
//  2. never edit a migration that is already committed (it may be applied in production)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readEvent, decide, incomingText, relPath, projectDir, hasSecret } from './lib.mjs';

const { tool_input: input = {} } = readEvent();
const file = relPath(input.file_path);
const text = incomingText(input);

const secret = hasSecret(text);
if (secret) {
  decide('deny', `Blocked: this content contains a ${secret}, which bypasses RLS. Only the public anon/publishable key may appear in this repo; keep secrets in server-side env vars.`);
}

if (/^supabase\/migrations\/.+\.sql$/.test(file) && existsSync(input.file_path)) {
  let committed = false;
  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${file}`], { cwd: projectDir(), stdio: 'ignore' });
    committed = true;
  } catch { /* new / uncommitted migration: fine to edit */ }
  if (committed) {
    decide('deny', `Blocked: ${file} is already committed and may be applied in production. Create a new migration instead (supabase migration new <name>, or the /new-migration skill).`);
  }
}
process.exit(0);
