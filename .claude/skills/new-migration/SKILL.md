---
name: new-migration
description: Create a new Supabase migration with RLS, apply it locally, add tests and get it reviewed. Use for any database change (new table, column, policy, function or bucket).
argument-hint: <what the change is, e.g. "add listing reports table">
---

Database change requested: $ARGUMENTS

1. Create the file with `supabase migration new <snake_case_name>`. Never edit a migration that is already committed (a hook blocks it).
2. Write the SQL following the conventions in the existing migration:
   - `alter table … enable row level security` on every new table, with explicit policies per command.
   - Members-only reads call `(select public.is_active_member())`. Ownership checks use `(select auth.uid())`.
   - Columns users must not change get column-level grants, not just policies.
   - `security definer` functions use `set search_path = ''` and minimal `grant execute`.
   - Index columns used in policies and filters.
3. Apply locally with `supabase db reset`. Fix any SQL error before continuing.
4. Use the **test-writer** subagent to add role-by-role tests to `tests/rls.test.mjs`, then run `npm run test:rls`.
5. Use the **rls-reviewer** subagent on the new migration. Fix everything it rates high or medium, and re-run the tests.
6. If the front end needs the new data, add the method to both backends (`src/mp.js` and `src/mp-mock.js`).
7. Summarise: the migration file, what each role can now do, and the test results.
