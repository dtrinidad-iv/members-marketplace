#!/usr/bin/env node
// PreToolUse(Bash): stop destructive commands, and make anything that touches
// production or GitHub wait for a human.
import { readEvent, decide } from './lib.mjs';

const cmd = String(readEvent().tool_input?.command || '');

const DENY = [
  [/\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/, 'Force-pushing rewrites shared history. Push normally or ask the user.'],
  [/\bsupabase\s+db\s+reset\b[^\n]*--linked/, 'This would wipe the linked (production) database. Only reset the local stack.'],
  [/\bsupabase\s+projects\s+delete\b/, 'Deleting a Supabase project is irreversible.'],
  [/\brm\s+-[a-z]*r[a-z]*\s+[^\n]*supabase\/migrations/, 'Migrations are the database history. Write a new migration instead of deleting one.'],
  [/\bgit\s+tag\s+-d\b|\bgit\s+push\b[^\n]*--delete\b[^\n]*\bv\d/, 'Released tags are referenced by live Squarespace sites through jsDelivr. Never delete them.'],
];

const ASK = [
  [/\bsupabase\s+db\s+push\b/, 'Applies migrations to the linked Supabase project (production).'],
  [/\bsupabase\s+(link|secrets\s+set)\b/, 'Connects to or changes a remote Supabase project.'],
  [/\bgit\s+push\b/, 'Publishes commits/tags to GitHub (a tag push ships code to live sites via jsDelivr).'],
  [/\bgh\s+(release|repo\s+(create|delete|edit))\b/, 'Changes the public GitHub repository.'],
];

for (const [re, reason] of DENY) if (re.test(cmd)) decide('deny', `Blocked by project hook: ${reason}`);
for (const [re, reason] of ASK) if (re.test(cmd)) decide('ask', `Needs your OK: ${reason}`);
process.exit(0);
