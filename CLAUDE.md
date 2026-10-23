# Members Marketplace

Members-only marketplace embedded in a client's existing Squarespace site. Squarespace is the CMS; Supabase (Auth, Postgres + RLS, Storage) is the backend; the front end is vanilla ES2020 injected through Code Injection and Code Blocks. There is no build step for production code.

## Layout

- `supabase/migrations/` holds the schema, RLS and storage policies. This is the security boundary.
- `supabase/seed.sql` has local demo data. Password for all demo users: `demo1234`.
- `src/mp.js` is the whole front end: backend adapter, auth store, route guard, and `data-mp` components.
- `src/mp-mock.js` is a demo-only backend. It must mirror both the interface of the Supabase backend in `mp.js` and the RLS rules.
- `src/mp.css` holds styles. Every selector is scoped to `.mp*`.
- `squarespace/` contains the snippets the client pastes into Squarespace.
- `demo/shell.html` → `docs/index.html` is the clickable demo, served by GitHub Pages at https://dtrinidad-iv.github.io/members-marketplace/ (`npm run build:demo`, then commit `docs/`).
- `tests/` has the hook tests, the end-to-end demo tests and the RLS tests.

## Commands

```bash
colima start && npm run db:start   # local Supabase (Studio :54323, emails :54324)
npm test                           # hooks + e2e + RLS (RLS resets the local DB)
npm run test:rls | test:e2e | test:hooks
npm run build:demo
```

## Rules

- **The browser only ever has the anon key.** Never put the service_role / `sb_secret_` key in this repo. A hook blocks it.
- **Hidden UI is not security.** Anything members-only must be enforced by RLS or storage policies, and covered in `tests/rls.test.mjs`.
- **Migrations are append-only** once committed. Use `/new-migration`. A hook blocks edits to committed migrations.
- **No HTML strings with data.** Build DOM with `h()` and `textContent`. A hook flags `innerHTML`.
- **Don't touch the host theme.** Scope CSS to `.mp*`, inherit fonts, use `--mp-*` variables for color.
- **Auth:** never await Supabase calls inside `onAuthStateChange` (defer with `setTimeout`). Redirect only after `ready`. Pass `?next=` through `safeNext()`.
- When adding a backend method, add it to both `createSupabaseBackend()` in `mp.js` and `mp-mock.js`.
- Released tags (`vX.Y.Z`) are loaded by live sites through jsDelivr. Never move or delete a tag. Use `/release`.

## Subagents

- `rls-reviewer`: after any migration change and before releases.
- `frontend-reviewer`: after changes to `src/` and before releases.
- `test-writer`: adds RLS and e2e tests for new tables and flows.
