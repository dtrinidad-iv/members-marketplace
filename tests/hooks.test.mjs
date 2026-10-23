// Tests for the Claude Code hooks in .claude/hooks (feeds them the same JSON
// Claude Code sends on stdin). Run: npm run test:hooks
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, '.claude/hooks');

function run(hook, event, projectDir = ROOT) {
  const r = spawnSync(process.execPath, [join(HOOKS, hook)], {
    input: JSON.stringify(event),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  });
  let decision = null;
  try { decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch { /* no decision */ }
  return { code: r.status, decision, stdout: r.stdout, stderr: r.stderr };
}

const bash = (command) => run('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command } });
const write = (file, content) => run('guard-files.mjs', { tool_name: 'Write', tool_input: { file_path: join(ROOT, file), content } });
const edit = (file, new_string) => run('guard-files.mjs', { tool_name: 'Edit', tool_input: { file_path: join(ROOT, file), old_string: 'x', new_string } });

// Local-dev demo keys printed by `supabase start` (public, identical on every machine).
const jwt = (role) => ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  Buffer.from(JSON.stringify({ iss: 'supabase-demo', role, exp: 1983812996 })).toString('base64url'), 'sig'].join('.');

test('bash: destructive commands are denied', () => {
  for (const c of [
    'git push --force origin main',
    'git push -f',
    'supabase db reset --linked',
    'supabase projects delete abc',
    'rm -rf supabase/migrations',
    'git tag -d v1.0.0',
  ]) assert.equal(bash(c).decision, 'deny', c);
});

test('bash: production / GitHub changes ask the user', () => {
  for (const c of ['supabase db push', 'supabase link --project-ref x', 'git push origin main', 'git push origin v1.1.0', 'gh release create v1.1.0'])
    assert.equal(bash(c).decision, 'ask', c);
});

test('bash: everyday commands pass through', () => {
  for (const c of ['npm test', 'supabase db reset', 'supabase status', 'git status', 'git commit -m "push notification copy"']) {
    const r = bash(c);
    assert.equal(r.code, 0, c);
    assert.equal(r.decision, null, c);
  }
});

test('files: secret keys are blocked, anon key is allowed', () => {
  assert.equal(write('squarespace/x.html', `key: '${jwt('service_role')}'`).decision, 'deny');
  assert.equal(write('README.md', 'SUPABASE_SECRET=sb_secret_N7UND0UgjKTVK').decision, 'deny');
  assert.equal(edit('squarespace/header-injection.html', `supabaseAnonKey: '${jwt('anon')}'`).decision, null);
});

test('files: committed migrations are append-only', () => {
  const r = edit('supabase/migrations/20261024000000_marketplace.sql', 'drop policy x;');
  assert.equal(r.decision, 'deny');
  assert.match(r.stdout, /new migration/);
  assert.equal(write('supabase/migrations/29990101000000_new_table.sql', 'create table t();').decision, null);
});

test('frontend: real src files pass', () => {
  for (const f of ['src/mp.js', 'src/mp.css', 'src/mp-mock.js']) {
    const r = run('check-frontend.mjs', { tool_name: 'Edit', tool_input: { file_path: join(ROOT, f) } });
    assert.equal(r.code, 0, `${f}: ${r.stderr}`);
  }
});

test('frontend: innerHTML, syntax errors and unscoped CSS are reported to Claude', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-hook-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/bad.js'), 'card.innerHTML = item.title;\n');
  writeFileSync(join(dir, 'src/broken.js'), 'function (\n');
  writeFileSync(join(dir, 'src/bad.css'), '.mp-card { color: red }\nbody, .mp-x { margin: 0 }\n@media (max-width: 9px) { h1 { font-size: 2em } }\n');
  const check = (f) => run('check-frontend.mjs', { tool_name: 'Write', tool_input: { file_path: join(dir, f) } }, dir);

  const html = check('src/bad.js');
  assert.equal(html.code, 2);
  assert.match(html.stderr, /bad\.js:1 writes HTML strings/);
  assert.match(check('src/broken.js').stderr, /Syntax error/);
  const css = check('src/bad.css');
  assert.equal(css.code, 2);
  assert.match(css.stderr, /"body"/);
  assert.match(css.stderr, /"h1"/);
  assert.doesNotMatch(css.stderr, /"\.mp-/);
});

test('frontend: files outside src/ are ignored', () => {
  assert.equal(run('check-frontend.mjs', { tool_name: 'Edit', tool_input: { file_path: join(ROOT, 'README.md') } }).code, 0);
});

test('session start reports local Supabase status', () => {
  const r = run('session-status.mjs', { hook_event_name: 'SessionStart' });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Local Supabase (is running|is NOT running|status unknown)/);
});

test('frontend: a secret key value in src is reported, a comment about it is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-hook-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/ok.js'), '// never the service_role key\nconst k = 1;\n');
  writeFileSync(join(dir, 'src/leak.js'), `const k = '${jwt('service_role')}';\n`);
  const check = (f) => run('check-frontend.mjs', { tool_name: 'Write', tool_input: { file_path: join(dir, f) } }, dir);
  assert.equal(check('src/ok.js').code, 0);
  assert.match(check('src/leak.js').stderr, /contains a secret key/);
});
