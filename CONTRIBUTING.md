# Contributing

This is a small team working on software that handles other people's money. The
conventions below exist because each one has already been learned the expensive
way.

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) if you have not read it.
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the full branch-to-production
loop.

---

## Branches

`main` is protected and always deployable. Never commit to it directly.

Branch from a freshly pulled `main`, one reviewable unit of work per branch,
kebab-case slug:

| Prefix | For |
|---|---|
| `feat/` | new capability |
| `fix/` | a bug in existing behaviour |
| `chore/` | tooling, deps, config — no user-visible change |
| `hotfix/` | urgent production fix, fast-tracked |

If a feature is getting large, stack branches rather than letting one balloon.
Delete the branch after merge.

## Commits

Conventional Commits for the subject line: `type(scope): imperative summary`,
lowercase, no trailing period, under ~72 characters.

```
fix(billing): stop the room panel billing the wrong guest
feat(hotel): let one guest hold several rooms on one reservation
chore(lint): enforce the tenant-scoping invariant in the linter
```

**The body is where the value is.** Explain what was wrong and why the fix is
the right one — the symptom a user saw, the mechanism behind it, and what you
decided not to do. Existing history in this repo is written that way; match it.
Six months from now the diff will still be readable and the reasoning will not
be recoverable from anywhere else.

Do not commit generated files, `.env*` with real values, scratch scripts, or
data exports. `scratch/` is git-ignored — put throwaway work there.

## Before you open a PR

```bash
npm run typecheck   # must pass clean
npm run lint        # must not add new problems
npm run build       # must succeed
npm test            # Playwright, if you touched a covered flow
```

`npm run lint` currently reports an inherited backlog of warnings. The bar is
that your change does not grow it. In particular, a new
`srms/require-tenant-scope` warning is a blocker, not a nit — see below.

If you changed the schema, `npm run db:reset` must replay cleanly from zero.

## Review

Every change is reviewed before merge. A reviewer is specifically looking for:

- **Tenant scoping.** Does every `createAdminClient()` query constrain
  `restaurant_id`? A row id is not a tenant check.
- **Authorization at the write.** Does the server action or route handler check
  the role itself, rather than trusting that the proxy already did?
- **Money computed once.** Does this add a second implementation of a total that
  already exists in `lib/`? Does a UI preview use the same helper settlement
  will use?
- **Client-supplied amounts.** Is any price, discount or total taken from the
  request body and trusted?
- **Migrations.** New file, never an edit to a merged one or the baseline. Does
  it replay from zero?
- **Realtime staleness.** Does anything a subscription handler fetches get
  written into state without checking the screen has not moved on?
- **Feature flags.** Any hand-written `?? true` instead of a default in the
  resolver?

## The rules that are not negotiable

1. **The schema only changes through a migration.** Not Studio, not a script.
   If it isn't a migration file, it doesn't reach production.
2. **`createAdminClient()` has RLS off.** The query text is the only tenant
   boundary. Constrain `restaurant_id` or write a `tenant-scope-exempt: <reason>`
   comment explaining why it cannot be.
3. **A monetary total has one implementation.** Import it. Every duplicate found
   so far had already drifted, and every drift was a wrong number on a real bill.
4. **Settlement recomputes server-side.** Whatever the browser showed was a
   preview.
5. **Never point a dev server or a test run at the production project.**

## Secrets

Real credentials live in Vercel, marked Sensitive, and in `.env.local` on your
machine. They do not go in the repo, in a commit message, in a doc, or in an
issue. `.env.example` documents the *shape* — if you add a `process.env.X`, add
it there in the same commit.

If a secret does get committed, rotating it comes first; removing it from
history comes second. A pushed secret is a leaked secret.
