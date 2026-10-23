---
name: release
description: Cut a versioned release that Squarespace loads through jsDelivr (checks, version bump, tag). Use when the user asks to release, ship or publish a new version.
argument-hint: <new version, e.g. 1.1.0>
disable-model-invocation: true
---

Release version: $ARGUMENTS (semver: patch = fixes, minor = new features, major = breaking config or markup changes).

1. Make sure the working tree is clean apart from the release changes (`git status`).
2. Run every check and stop on any failure:
   - `npm test` (hooks, demo end-to-end and RLS; needs local Supabase running).
   - Use the **rls-reviewer** and **frontend-reviewer** subagents in parallel on changes since the last tag (`git diff $(git describe --tags --abbrev=0)..HEAD`).
3. Bump the version in:
   - the banner comment and `version:` in `src/mp.js`
   - `package.json`
   - both jsDelivr URLs in `squarespace/header-injection.html` (`@vX.Y.Z`)
4. Rebuild the demo with `npm run build:demo`.
5. Commit as `Release vX.Y.Z` with a short changelog in the body, then `git tag vX.Y.Z`.
6. Show the user the changelog and the exact header-injection lines to paste into Squarespace. Don't push; the push hook asks the user, and they decide when it goes live.
7. Remind the user that rolling back means changing the tag in the header injection back to the previous version.
