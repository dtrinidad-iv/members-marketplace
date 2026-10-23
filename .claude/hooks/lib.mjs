// Shared helpers for Claude Code hooks. Hooks get the event as JSON on stdin.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

export function readEvent() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

export const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

export function relPath(file) {
  return file ? relative(projectDir(), file).split('\\').join('/') : '';
}

// PreToolUse decision: "allow" | "deny" | "ask"
export function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// Exit 2 = blocking feedback shown to Claude (PostToolUse: tool already ran, Claude must fix).
export function feedback(message) {
  process.stderr.write(message);
  process.exit(2);
}

// Text a Write/Edit/MultiEdit call is about to put in a file.
export function incomingText(input = {}) {
  if (typeof input.content === 'string') return input.content;
  if (typeof input.new_string === 'string') return input.new_string;
  if (Array.isArray(input.edits)) return input.edits.map((e) => e.new_string || '').join('\n');
  return '';
}

// Returns a description of the first Supabase secret found in text, or null.
// Mentions like "never use the service_role key" are fine; actual key values are not.
export function hasSecret(text = '') {
  if (/\bsb_secret_[A-Za-z0-9_-]{8,}/.test(text)) return 'Supabase secret key (sb_secret_…)';
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') return 'service_role JWT';
    } catch { /* not a JWT we can read */ }
  }
  return null;
}
