# Members Marketplace: Project Walkthrough

> A plain-English tour of the project: what it is, how the pieces fit together, and where to make changes.

---

## 1. The project in one paragraph

A client already has a **Squarespace** website. They want a **members-only marketplace** on it, where approved members can browse listings (with photos, prices and seller contacts), save favourites and post their own. Squarespace can't do that, so:

- **Squarespace** stays as-is. It handles pages, design and marketing content.
- **Supabase** is the backend: user accounts (Auth), the database (Postgres) and photo storage (Storage).
- **One JavaScript file (`src/mp.js`)** is pasted into Squarespace. It finds placeholder `<div>`s on the pages and turns them into the marketplace UI.

There is no React, no bundler and no build step for production. The whole front end is a single vanilla JS file plus a CSS file, loaded from a CDN.

---

## 2. The big picture

```
┌──────────────────────── Squarespace site ─────────────────────────┐
│                                                                   │
│  Header Code Injection (once, site-wide)                          │
│    • window.MP_CONFIG = { supabaseUrl, anonKey, paths… }          │
│    • <script src="supabase-js">                                   │
│    • <script src="jsDelivr/…@v1.0.0/src/mp.js">                   │
│    • <link  href="jsDelivr/…@v1.0.0/src/mp.css">                  │
│                                                                   │
│  /marketplace page → Code Block: <div data-mp="marketplace">      │
│  /login page       → Code Block: <div data-mp="login">            │
│  /saved page       → Code Block: <div data-mp="saved">   …etc     │
└───────────────────────────────┬───────────────────────────────────┘
                                │ mp.js finds every [data-mp] and renders it
                                ▼
                    supabase-js (uses the PUBLIC anon key only)
                                │
                                ▼
┌──────────────────────────── Supabase ─────────────────────────────┐
│  Auth      → email/password accounts, sessions (JWT)              │
│  Postgres  → profiles, listings, saved_listings  + RLS policies   │
│  Storage   → private "listing-images" bucket + storage policies   │
└───────────────────────────────────────────────────────────────────┘
```

**The most important idea:** the browser is untrusted. Anyone can open DevTools and call Supabase directly with the anon key. So hiding a button or redirecting a page is only there for user experience. **Real security comes from the database rules (RLS)**, which decide what each request may read or write based on who is logged in.

---

## 3. The three kinds of users

Everything in the project depends on which of these the current user is:

| Who | How they got there | What they can see/do |
|---|---|---|
| **Visitor** (`anon`) | Not logged in | Only *teaser* cards (title, category, city). No price, photo, description or contact. |
| **Pending member** | Signed up, not yet approved | Logged in, can see their own profile, but listings are still locked. |
| **Active member** | An admin set `membership_status = 'active'` | Everything: full listings, photos, save/bookmark, post listings. |

There's also `suspended`, which is treated like pending. The code calls these three states `anon`, `pending` and `member` (see `mode()` in `src/mp.js:546`).

**Members can never approve themselves.** Only an admin (via the SQL editor or a future webhook) can change `membership_status`. The steps are in `supabase/admin.sql`.

---

## 4. Folder map

```
members-marketplace/
├── src/                     ← the product
│   ├── mp.js                  the entire front end (≈880 lines)
│   ├── mp.css                 styles, all scoped to .mp-*
│   └── mp-mock.js             fake in-browser backend for the demo only
│
├── supabase/                ← the backend / security boundary
│   ├── migrations/…_marketplace.sql   tables, RLS, triggers, storage bucket
│   ├── seed.sql               local demo users + listings (pw: demo1234)
│   ├── admin.sql              snippets to approve/suspend members
│   └── config.toml            local Supabase CLI config
│
├── squarespace/             ← what the client pastes into Squarespace
│   ├── header-injection.html  goes in Settings → Code Injection → Header
│   └── code-blocks.md         which <div data-mp="…"> goes on which page
│
├── demo/shell.html          ← fake "Squarespace site" + dev panel for the demo
├── scripts/
│   ├── build-demo.mjs         inlines src/* into shell.html → docs/index.html
│   └── screenshots.mjs        regenerates screenshots/ with headless Chrome
├── docs/index.html          ← BUILT demo, served by GitHub Pages (don't hand-edit)
├── dist/marketplace-demo.html ← BUILT demo fragment (don't hand-edit)
├── screenshots/             ← PNGs used in README
│
├── tests/
│   ├── rls.test.mjs           hits REAL local Supabase as each user type
│   ├── demo.e2e.test.mjs      drives the demo in headless Chrome
│   └── hooks.test.mjs         tests the Claude Code guard hooks
│
├── .claude/                 ← Claude Code guardrails (hooks, subagents, skills)
├── CLAUDE.md                ← project rules for Claude
└── README.md                ← public-facing overview + screenshots
```

---

## 5. The backend: `supabase/migrations/20261024000000_marketplace.sql`

This one file defines all the data and the security rules. Here it is one piece at a time.

### 5.1 Tables

**`profiles`**: one row per user, linked to Supabase's built-in `auth.users`.

| column | notes |
|---|---|
| `id` | same as the auth user id |
| `display_name` | max 80 chars, **the only column a user can edit** |
| `membership_status` | `pending` (default) / `active` / `suspended` |
| `role` | `member` / `admin` |

**`listings`**: the items for sale.

| column | notes |
|---|---|
| `seller_id` | defaults to `auth.uid()`, so it's whoever is logged in |
| `seller_display_name` | **set by a trigger**, so the client can't fake it |
| `title`, `description`, `category`, `city`, `price_cents`, `contact_email` | the content (price stored in cents) |
| `image_path` | path inside the private storage bucket, e.g. `<uid>/<uuid>.jpg` |
| `status` | `draft` / `published` / `archived` |
| `fts` | auto-generated full-text-search column (title + description) with a GIN index |

**`saved_listings`**: bookmarks, with the pair `(user_id, listing_id)` as the primary key.

### 5.2 Automatic behaviour (triggers & functions)

- **`handle_new_user()`** runs when someone signs up and creates their `profiles` row (status `pending`).
- **`listings_before_write()`** runs on every insert/update of a listing. It overwrites `seller_display_name`, `updated_at` and `created_at`, so those can't be spoofed.
- **`is_active_member()`** returns true or false for the current user. Almost every policy uses it. It's `SECURITY DEFINER` so it can read `profiles` without tripping RLS recursion, with `search_path = ''` for safety.
- **`get_listing_previews(category, limit)`** is the only thing visitors can call. It returns safe columns only (`id, title, category, city, created_at`) and is capped at 24 rows.

### 5.3 The RLS rules in plain English

| Table | Rule |
|---|---|
| profiles | You can read and update **only your own** row. Column grant: you can update **only `display_name`**. |
| listings: read | Active members see all **published** listings. Anyone sees **their own** (including drafts). |
| listings: create | Only active members, and only as themselves. |
| listings: update/delete | Only the seller. |
| saved_listings | Read/delete your own. Insert your own, active members only. |
| storage `listing-images` | Private bucket. Active members can read. Uploads must go into a folder named after your own user id. JPG/PNG/WebP only, max 5 MB. |

Images are never public URLs. The front end asks for **signed URLs** that expire after one hour.

### 5.4 Seed data (`supabase/seed.sql`)

| email | status |
|---|---|
| `member@demo.com` (Jordan Lee) | active |
| `pending@demo.com` (Sam Rivera) | pending |
| `ines@demo.com`, `theo@demo.com` | active sellers |

There are 4 published listings and 1 draft (only Inés can see the draft). All passwords are `demo1234`.

---

## 6. The front end: `src/mp.js`

The whole file is wrapped in an IIFE `(function (w, d) { … })(window, document)` so nothing leaks into Squarespace's globals except `window.MP`. Top to bottom, the sections are:

### 6.1 Config (`mp.js:16`)
`DEFAULTS` merged with `window.MP_CONFIG`, which the client sets in the header injection. Holds the Supabase URL and anon key, page paths (`/login`, `/saved`, …), which paths are protected, categories and page size.

There are two optional overrides, which only the demo uses:
- `backend`: swap Supabase for the mock.
- `router`: swap real page navigation for in-page hash routing.

### 6.2 Router + `safeNext()` (`mp.js:47`, `mp.js:60`)
- On Squarespace, every page is a real page load, so `go(url)` is just `location.assign`.
- `setQuery()` updates the URL without reloading. Filters use it, which is why filtered views can be shared.
- **`safeNext(raw)`** sanitises the `?next=` redirect after login. It only allows same-site paths starting with `/` (no `//evil.com`) and never sends you back to login/signup/forgot/reset. This prevents open redirects and login loops.

### 6.3 Backend adapter: `createSupabaseBackend()` (`mp.js:80`)
This is the **only code that talks to the network**. It exposes a small interface:

```
auth: onChange, signIn, signUp, signOut, sendReset, updatePassword
getProfile, listListings, listPreviews, getListing,
savedIds, listSaved, save, unsave, createListing, signImages
```

Everything else in `mp.js` calls `api.something()` and never touches Supabase directly. That's what makes it possible to swap in the mock for the demo.

> **Rule:** if you add a method here, add the same method to `src/mp-mock.js`.

### 6.4 Auth store (`mp.js:187`)
There's one global `state = { ready, event, session, user, profile }`.

How it flows:
1. `api.auth.onChange(...)` listens to Supabase's `onAuthStateChange`.
2. The handler **defers with `setTimeout(…, 0)`**. supabase-js holds a lock during that callback, and awaiting another Supabase call inside it deadlocks. This is a well-known trap.
3. `handleAuth()` loads the profile when needed, updates `state` and calls `emit()`.
4. `emit()`:
   - toggles CSS classes on `<html>`: `mp-auth-in`, `mp-auth-out`, `mp-member-active`. Squarespace CSS can use these to show or hide nav links.
   - calls every subscriber function (components re-render).
   - fires a `mp:auth` DOM event.
5. **`ready`** is a Promise that resolves on the first auth event (`INITIAL_SESSION`). Components wait for it before deciding what to show. There's a 5-second fallback so the page never hangs.
6. `authSeq` makes sure that if two auth events race, only the newest one wins.

Helpers:
- `subscribe(fn)` registers for state changes.
- `isActive()` is true if `profile.membership_status === 'active'`.
- `signedIn()` waits until state shows a logged-in user, which is used after login before redirecting.

### 6.5 Route guard (`mp.js:246`)
`guard()` runs after mounting:
1. If the page isn't protected, it reveals the page and stops.
2. It waits for `ready`.
3. If logged in, it reveals the page.
4. If not logged in, it redirects to `/login?next=<current url>`.
5. **Loop breaker:** if more than 3 redirects happen within 10 seconds (tracked in `sessionStorage`), it stops redirecting and logs a warning. Data is still safe because RLS protects it.

The **anti-flicker**: the header snippet adds `mp-pending` to `<html>` on protected pages, and the CSS hides `main` until `reveal()` removes the class. There's a 5-second failsafe.

Signing out while on a protected page sends you to `/login`.

### 6.6 DOM helpers (`mp.js:290`)
- **`h(tag, attrs, ...children)`** is a tiny hyperscript builder. Strings become text nodes, so user content can never become HTML. This is how the project avoids XSS. **Never use `innerHTML`** (a hook enforces this).
- `icon(name)` builds inline SVG icons.
- `money(cents)` formats currency.
- `debounce`, `link`, `friendlyError` (turns Supabase errors into human messages), `toast`.
- `placeholder(cat)` is a coloured tile with the category initial (or a lock icon).

### 6.7 Saved items (`mp.js:367`)
Shared across all components. `toggleSave(id)` is **optimistic**: it updates the heart immediately, calls the API, and **rolls back** if the call fails. Every `saveButton` subscribes, so all hearts for the same listing stay in sync.

### 6.8 Cards & dialogs (`mp.js:415`)
- `listingCard()` is the full card for members: image, price, seller, save button.
- `previewCard()` is the locked teaser: lock icon, blurred `$•••`, "Members only".
- `openDialog()` wraps a native `<dialog>` with backdrop-click-to-close.
- `openListing(id)` is the detail view. It fetches the listing and a signed image URL, then shows the description, a "Contact seller" mailto link and a save button.
- `gatePrompt(kind)` shows either the "pending approval" message or the "Join now / Log in" prompt.

### 6.9 Components (`mp.js:507`)
Each one is a function `(el) => { … }` that renders into the `<div data-mp="name">`.

| `data-mp=` | What it does |
|---|---|
| `marketplace` | The main grid. In `anon`/`pending` mode it calls `listPreviews` and shows locked cards plus a gate prompt. In `member` mode it shows filters (search, category, max price, sort), full cards and a "Load more" button. Filters sync to the URL. Supports `?listing=<id>` deep links. Options: `data-limit="4"` (compact strip, no filters), `data-category="Ceramics"`, `data-filters="false"`. Re-renders when the mode changes, e.g. when an admin approves you. `reqId` discards stale responses. |
| `saved` | Your bookmarked listings. |
| `login` | Login form. If you're already logged in it redirects to `next` right away. |
| `signup` | Creates the account. If email confirmation is on it shows "Check your email", otherwise it redirects. |
| `forgot` | Sends a reset email. **Shows the same message whether or not the email exists**, so attackers can't probe which emails have accounts. |
| `reset` | Waits for Supabase's `PASSWORD_RECOVERY` event (from the emailed link), then shows a new-password form. Shows "invalid or expired" after 3 seconds if no event arrives. |
| `account` | Name, email, status badge, change password, log out. |
| `sell` | Post-a-listing form with photo upload and preview. Checks type and size on the client (storage policy enforces it for real). |
| `auth-nav` | Log in/Join links, or Saved/Account/Log out links. |
| `guard` | Empty marker. Putting it on any page makes that page protected. |

`authForm()` (`mp.js:638`) is the shared form builder: it handles validation, the disabled "Please wait…" button and error display.

### 6.10 Mount (`mp.js:849`)
`mount()` finds every `[data-mp]` element, runs its component once (`__mpMounted` flag), then runs `guard()`. It runs on `DOMContentLoaded` and also on Squarespace 7.0's `mercury:load` event, for templates that load pages via AJAX.

Everything is exposed as **`window.MP`**: `{ version, config, api, state, ready, subscribe, mount, refreshProfile, toast, components }`. You can add your own component with `MP.components.myThing = (el) => {}`.

---

## 7. Styles: `src/mp.css`

- **Every selector starts with `.mp`**, so it never restyles the client's Squarespace theme (a hook enforces this).
- Fonts are `inherit`, so the marketplace uses the site's typography.
- Colours come from CSS variables you can override in Squarespace Custom CSS:
  ```css
  :root { --mp-accent: #1f4d3f; --mp-accent-ink: #fff; --mp-radius: 6px; }
  ```
- `html.mp-pending main { visibility: hidden }` is the anti-flicker rule.

---

## 8. The demo (no Supabase needed)

**Live:** https://dtrinidad-iv.github.io/members-marketplace/

How it's put together:

1. **`src/mp-mock.js`** is a fake backend with the **same interface** as `createSupabaseBackend()`. Data lives in `localStorage` (`mp_mock_v1`). It **reimplements the RLS rules in JS**, e.g. `canSee = (published && isActive()) || own listing`. It also generates SVG "product photos" and fakes emails (the reset link shows in a simulated inbox). `api.debug` powers the dev panel: log in as a user, approve/suspend, and `rlsReport()` shows what each query would return.
2. **`demo/shell.html`** is a mock Squarespace page ("Makers Guild") plus a **dev panel**. It sets `MP_CONFIG.backend = mock` and a custom `router` that fakes navigation inside one page.
3. **`scripts/build-demo.mjs`** replaces `/* @inline ../src/… */` markers in the shell with the real file contents and writes `docs/index.html` (GitHub Pages) and `dist/marketplace-demo.html`.

So the demo runs **the exact same `mp.js`** as production. Only the backend and router are swapped.

> **Rule:** `mp-mock.js` must match both the interface *and* the RLS rules. If you change a policy in SQL, change `canSee` and the related checks in the mock too.

---

## 9. Squarespace install (`squarespace/`)

1. **Header injection** (`header-injection.html`), pasted once site-wide:
   - the anti-flicker script (protected paths list must match `MP_CONFIG.protectedPaths`)
   - `window.MP_CONFIG` with the Supabase URL and **anon** key
   - CSS + supabase-js + mp.js, all `defer`, loaded from **jsDelivr at a pinned tag** (`@v1.0.0`)
2. **Pages + Code Blocks** (`code-blocks.md`): `/marketplace`, `/login`, `/join`, `/forgot-password`, `/reset-password`, `/saved`, `/sell`, `/account`.
3. **Header nav:** Squarespace 7.1 headers can't hold Code Blocks, so either use CSS on `html.mp-auth-in` / `html.mp-auth-out` to show or hide native links, or put `data-mp="auth-nav"` somewhere site-wide.
4. **Supabase dashboard:** Site URL, redirect URLs for `/reset-password` and `/login`, CORS for the domain.

**Versioning and rollback:** live sites load `…@v1.0.0/src/mp.js`. A new release gets a new tag (`v1.1.0`) and the header URL changes. To roll back, change the URL back to the old tag. **That's why tags must never be moved or deleted:** a live site may depend on them.

---

## 10. Tests (`tests/`)

| Command | What it does |
|---|---|
| `npm run test:rls` | Resets local DB, then logs in as visitor / pending / member / seller against the **real** local Supabase and checks reads, writes, self-activation attempts, uploads to other folders, signed URLs. **This is what proves the security.** |
| `npm run test:e2e` | Builds the demo, drives it in headless Chrome: gating, login redirect with `next`, filters, deep links, saving, approval, posting, password reset, mobile width, no console errors. |
| `npm run test:hooks` | Checks the Claude Code hooks block and allow the right things. |
| `npm test` | All of the above. |

The RLS tests need local Supabase running:
```bash
colima start && npm run db:start
# Studio: http://127.0.0.1:54323   Fake inbox: http://127.0.0.1:54324
```

---

## 11. Claude Code guardrails (`.claude/`)

These make Claude (and in effect you) follow the project rules automatically.

**Hooks** (`.claude/settings.json` → `.claude/hooks/`):

| Hook | Triggers | Effect |
|---|---|---|
| `guard-bash.mjs` | before any shell command | **Blocks:** force push, `db reset --linked`, deleting migrations or tags, deleting Supabase projects. **Asks you first:** `supabase db push`, `supabase link`, `git push`, `gh release/repo…`. |
| `guard-files.mjs` | before any file write | Blocks `service_role` / `sb_secret_` keys. Blocks edits to already-committed migrations. |
| `check-frontend.mjs` | after editing `src/` | Syntax-checks JS, flags `innerHTML` and unscoped CSS, then rebuilds the demo. |
| `session-status.mjs` | session start | Reports whether local Supabase is running. |

**Subagents** (`.claude/agents/`): `rls-reviewer` (SQL security audit), `frontend-reviewer` (Squarespace compatibility, XSS, auth loops), `test-writer`.

**Skills** (`.claude/skills/`):
- `/new-migration <change>` writes a new migration, applies it, adds tests and gets it reviewed.
- `/release <version>` runs all tests and reviewers, bumps the version in `mp.js`, `package.json` and the header injection, rebuilds the demo, commits and tags. **It doesn't push**; you decide when it goes live.

---

## 12. The project rules (short version of `CLAUDE.md`)

1. **Only the anon key in the browser.** Never the service_role / secret key.
2. **Hidden UI is not security.** Members-only means an RLS/storage policy, with a test in `tests/rls.test.mjs`.
3. **Migrations are append-only.** Don't edit a committed one; add a new one.
4. **No HTML strings with data.** Use `h()` / `textContent`.
5. **Don't touch the host theme.** Use `.mp*` selectors, inherited fonts, `--mp-*` colours.
6. **Auth:** don't `await` Supabase inside `onAuthStateChange`; redirect only after `ready`; always pass `?next=` through `safeNext()`.
7. **New backend method → add it to both `mp.js` and `mp-mock.js`.**
8. **Never move or delete a release tag.**

---

## 13. Common tasks: where to make changes

| I want to… | Touch these |
|---|---|
| Add a column/table/policy | `/new-migration` → new file in `supabase/migrations/`, update `seed.sql` if needed, add RLS tests, mirror the rule in `mp-mock.js`, update `LISTING_COLS` in `mp.js` if it's a listing column |
| Add a new backend call | `createSupabaseBackend()` in `mp.js` **and** the `api` object in `mp-mock.js` |
| Add a new page/widget | New `components.xyz = (el) => {}` in `mp.js`, styles in `mp.css` (`.mp-xyz`), add it to `squarespace/code-blocks.md`, add an e2e test |
| Change a category list | `DEFAULTS.categories` in `mp.js` (and `CATS` in `mp-mock.js`), or override via `MP_CONFIG.categories` |
| Make another page protected | Add the path to `protectedPaths` in `MP_CONFIG` **and** the anti-flicker list in `header-injection.html`, or drop `<div data-mp="guard">` on the page |
| Change colours | `--mp-*` variables (`mp.css` `:root`, or override in Squarespace Custom CSS) |
| Approve a member | `supabase/admin.sql` (run in Supabase SQL editor) |
| Update the public demo | `npm run build:demo`, then commit `docs/` |
| Ship a new version | `/release X.Y.Z`, push the tag, update the jsDelivr tag in Squarespace header injection |

---

## 14. Request lifecycle example: a member opens `/marketplace`

1. The Squarespace page loads. The header sets `MP_CONFIG` and loads supabase-js and mp.js (deferred).
2. `mp.js` runs: it builds the config, creates the Supabase client (which restores the session from localStorage) and subscribes to auth.
3. `mount()` finds `<div data-mp="marketplace">` and renders the filter bar and skeleton cards, then waits on `ready`.
4. supabase-js fires `INITIAL_SESSION`. After `setTimeout`, `handleAuth` loads the profile (`active`). `ready` resolves and `emit()` runs.
5. The marketplace sees `mode() === 'member'` and calls `api.listListings(filters)`.
6. Supabase runs `select … from listings where status='published'` **with the user's JWT**. RLS checks `is_active_member()`, which is true, so rows come back.
7. `api.signImages(paths)` returns 1-hour signed URLs (the storage policy checks `is_active_member()` again).
8. Cards render with `h()`. Hearts reflect `savedIds()`.

For a **visitor**, step 5 calls `get_listing_previews()` instead. A direct `select from listings` would return **0 rows** because of RLS, even if someone tried it from DevTools.
