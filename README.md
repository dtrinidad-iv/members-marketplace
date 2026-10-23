# Members Marketplace — Supabase + Squarespace

A secure, members-only marketplace that runs inside an existing Squarespace site. Squarespace stays the CMS and the design; Supabase handles accounts, data, files and access rules.

```
Squarespace page ──► Code Block <div data-mp="marketplace">
        │
        └─ mp.js (vanilla JS, ~40 KB unminified, deferred) ──► supabase-js ──► Supabase
                                                       (anon key)   ├─ Auth (JWT sessions)
                                                                    ├─ Postgres + RLS
                                                                    └─ Storage (private bucket)
```

## What's here

| Path | What it is |
|---|---|
| `supabase/migrations/…_marketplace.sql` | Tables, Row Level Security, triggers, storage bucket + policies |
| `supabase/seed.sql` | Local demo accounts and listings (password `demo1234`) |
| `supabase/admin.sql` | Approve/suspend members, verify RLS as `anon` |
| `tests/` | RLS tests (real local Supabase), demo end-to-end tests (headless Chrome), hook tests |
| `CLAUDE.md`, `.claude/` | Claude Code setup: project rules, hooks, subagents, workflows |
| `src/mp.js` | The whole front end: auth store, route guard, components |
| `src/mp.css` | Styles, all scoped to `.mp-*` and themable through CSS variables |
| `src/mp-mock.js` | Demo-only in-browser backend with the same rules (no setup needed) |
| `squarespace/header-injection.html` | What goes in Settings → Code Injection → Header |
| `squarespace/code-blocks.md` | Which Code Block goes on which page, plus Supabase settings |
| `dist/marketplace-demo.html` | Clickable demo (open it in a browser, no server needed) |

## Features → requirements

| Job requirement | Where it's handled |
|---|---|
| Secure schemas, storage, **strict RLS** | Migration: every table has RLS; access via `is_active_member()`; private bucket with per-user upload folders |
| Users can't escalate themselves | Column-level grant: users can update `display_name` only, never `membership_status`/`role` |
| Sign-up, login, password reset | `login`, `signup`, `forgot`, `reset` components (PKCE flow, `PASSWORD_RECOVERY` event) |
| Session persistence + `onAuthStateChange` | Single auth store driven by `onAuthStateChange`; `INITIAL_SESSION` gates first render |
| Protected redirects **without loops** | Guard waits for the initial session, `next` is same-site only and never an auth page, loop breaker (max 3 in 10 s) |
| No site slowdown | Deferred scripts, pinned CDN versions, skeleton loaders, anti-flicker only on protected pages |
| Filtered data views | Full-text search (`tsvector` + GIN index), category, max price, sort, pagination, filters reflected in the URL |
| Cards, detail views, access-gated prompts | Cards → `<dialog>` detail with deep link `?listing=id`; visitors and pending members get teaser cards + join prompt |
| Save / bookmark | `saved_listings` table, optimistic UI with rollback |
| No style conflicts / SEO safe | All CSS namespaced `.mp-*`, fonts inherited; marketing content stays native Squarespace HTML |
| GitHub, versioned scripts | Tagged releases served by jsDelivr (`@v1.0.0`) → instant rollback |

## Security notes

- The browser only has the **anon** key. Everything sensitive is enforced in Postgres (RLS) and Storage policies, so redirects and hidden buttons are UX only.
- Visitors can call `get_listing_previews()` (title/category/city only). Price, description, contact and photos need an **active** membership.
- Images live in a **private** bucket and are served with 1-hour signed URLs.
- `SECURITY DEFINER` functions pin `search_path = ''`.
- All user content is rendered with `textContent` (no `innerHTML`), so listing text can't inject scripts.
- `onAuthStateChange` work is deferred with `setTimeout` to avoid the supabase-js lock deadlock.

## Run the demo

```bash
node scripts/build-demo.mjs        # rebuilds dist/marketplace-demo.html from src/
open dist/marketplace-demo.html
```

Demo accounts (password `demo1234`): `member@demo.com` (active), `pending@demo.com` (pending).

## Local Supabase + tests

Needs the Supabase CLI and a Docker runtime (Colima or Docker Desktop).

```bash
colima start                 # Docker runtime
npm install
npm run db:start             # Postgres, Auth, Storage, Studio; applies migrations + seed
npm test                     # all 43 tests (below)
```

| Command | Tests | What it covers |
|---|---|---|
| `npm run test:rls` | 23 | Logs in as visitor, pending, member and seller against the real API: reads, writes, privilege escalation, storage uploads and signed URLs |
| `npm run test:e2e` | 10 | Drives the demo in headless Chrome: gating, redirects, filters, deep links, saving, approval, posting, password reset, mobile layout |
| `npm run test:hooks` | 10 | The Claude Code hooks block and allow what they should |

Studio: http://127.0.0.1:54323 · Emails (reset links): http://127.0.0.1:54324

## Working with Claude Code

This repo is set up for [Claude Code](https://claude.com/claude-code). The guardrails live in the repo, so every session follows the same rules.

- **`CLAUDE.md`**: architecture and the project's rules (anon key only, RLS for anything members-only, append-only migrations, no `innerHTML`, scoped CSS).
- **Hooks** (`.claude/hooks/`, configured in `.claude/settings.json`):
  | Hook | When | What it does |
  |---|---|---|
  | `guard-bash` | before shell commands | Blocks force pushes, deleting migrations or release tags, and resetting/deleting the production database. Asks a human before `supabase db push`, `git push` and GitHub changes. |
  | `guard-files` | before file writes | Blocks `service_role` keys and `sb_secret_` values from entering the repo. Blocks edits to committed migrations. |
  | `check-frontend` | after edits to `src/` | Syntax-checks JS and flags `innerHTML` (XSS) and CSS selectors that would leak into the Squarespace theme; Claude has to fix them. Rebuilds the demo. |
  | `session-status` | session start | Tells Claude whether local Supabase is running. |
- **Subagents** (`.claude/agents/`): `rls-reviewer` audits migrations for access-control holes, `frontend-reviewer` checks Squarespace compatibility, XSS and auth flows, and `test-writer` adds role-by-role RLS and e2e tests.
- **Workflows** (`.claude/skills/`): `/new-migration <change>` writes the migration, applies it, adds tests and gets it reviewed. `/release <version>` runs every check, bumps versions and tags (user-triggered only; never pushes by itself).

## Go live

1. Create a Supabase project, then `supabase link --project-ref <ref>` and `supabase db push` (or paste the migration into the SQL editor). Don't push `seed.sql`.
2. Releases are tagged (`v1.0.0`) and served by jsDelivr. Use `/release` for new versions.
3. Paste `squarespace/header-injection.html` into Code Injection → Header (fill in the Supabase URL and anon key).
4. Create the pages and Code Blocks listed in `squarespace/code-blocks.md`.
5. Approve members with `supabase/admin.sql` (or later, a Stripe webhook / admin page).
