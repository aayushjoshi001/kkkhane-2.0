# Team Dev Workflow: branch, migrate, ship

> **The House · KKKhane · Engineering**

How the two of us take a feature from a local branch to production — coding
against a local Supabase, versioning the database with migrations, and merging
to `main` so Vercel and prod Supabase update in lockstep.

| | |
|---|---|
| **Stack** | Next.js 16 · Turbopack · Supabase (Postgres 17) · Vercel |
| **Remotes** | `prod` → `infokkkhane-ux/KKKhane` (Vercel watches this) · `origin` → `siddanta-ar1/The-House` (mirror + PRs, deploys nothing) |
| **Team** | 1 lead · 1 dev |

> **New here?** Read [ARCHITECTURE.md](ARCHITECTURE.md) for how the system fits
> together and [../CONTRIBUTING.md](../CONTRIBUTING.md) for conventions and what
> review looks for. [DEPLOYMENT.md](DEPLOYMENT.md) covers production.

---

## Environment map

Two Supabases. All work happens on the local one; production only ever changes
through reviewed migrations.

### 🟢 Local — your machine
Where all coding & schema changes happen first. Disposable, resettable.

| | |
|---|---|
| API | `127.0.0.1:54321` |
| DB | `127.0.0.1:54322` |
| Studio | `127.0.0.1:54323` |
| env | `.env.local` |
| start | `supabase start` |

### 🟠 Production — Supabase cloud
Live restaurant data. Read-only to changes except via reviewed migrations.

| | |
|---|---|
| host | `*.supabase.co` |
| schema | from migrations |
| env | Vercel + backup file |
| apply | `supabase db push` |
| owner | lead only |

**The migration path:** `local` → *migrations only* → *on merge to main* → `production`

> ### ⭐ The one rule that keeps both databases identical
> The production schema is **never** edited by hand in Studio. Every table,
> column, policy, or function change is written as a timestamped SQL migration,
> tested locally with `supabase db reset`, reviewed in a PR, and only then
> applied to prod. **If it isn't a migration file, it doesn't reach production.**

---

## 01 · Branch strategy

> `main` is protected — never commit to it directly.

One long-lived branch, `main`, is always deployable and mirrors production.
Everything else is a short-lived branch named for its intent, opened from the
latest `main` and deleted after merge.

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | New feature or capability | `feat/delivery-ordering` |
| `fix/` | Bug fix on existing behavior | `fix/kitchen-order-race-condition` |
| `chore/` | Tooling, deps, config, no user impact | `chore/bump-next-16` |
| `hotfix/` | Urgent prod fix, fast-tracked review | `hotfix/csp-qz-tray` |

Keep the slug short and kebab-case. One branch = one reviewable unit of work.
If a feature is large, split it into stacked branches rather than letting one
balloon.

---

## 02 · The daily coding loop

> Developer, per feature.

This is the full path for a normal change. Steps marked **[dev]** are the
developer's; the merge and prod steps at the end belong to the **[lead]**.

### 1. Sync main & branch off — [dev]
Always start from a fresh `main` so you're not building on stale schema.

```bash
git checkout main && git pull origin main
git checkout -b feat/table-lifecycle-cleaning
```

### 2. Boot the local stack — [dev]
Bring up local Supabase (Postgres, Auth, Storage, Studio) and the app.
`.env.local` already points at `127.0.0.1:54321`.

```bash
supabase start        # API :54321 · DB :54322 · Studio :54323
npm run dev           # next dev --turbo
```

### 3. Write code + schema changes — [dev]
Build the feature against your local DB. If the change needs a schema edit,
create a **new** migration — never touch the frozen baseline
(`20260708150000_baseline.sql`) or an already-merged migration.

```bash
supabase migration new add_table_cleaning_status
# → supabase/migrations/<timestamp>_add_table_cleaning_status.sql
# edit that file: ALTER TABLE / CREATE POLICY / etc.
```

### 4. Reset & replay to verify the migration — [dev]
`db reset` drops the local DB and replays the baseline + every migration in
order — the same sequence prod will run. If it applies cleanly from zero, it's
safe to ship.

```bash
supabase db reset     # replays baseline + all migrations locally
npm test              # playwright, chromium
npm run typecheck     # tsc --noEmit
npm run lint          # incl. srms/require-tenant-scope
```

If the migration added a table or a `restaurant_id` column, regenerate the
tenant-scoping lint rule's table lists in the same commit:

```bash
npm run gen:tenant-tables
```

> **⚠ Check before you commit**
> Migration replays with no errors, regenerated types compile, `npm run typecheck`
> is clean, `npm run lint` has no *new* problems, and the Playwright suite is
> green. A migration that only works because your local DB drifted is a prod
> incident waiting to happen.

### 5. Commit in reviewable chunks — [dev]
Use conventional commits — the same style already in the history (`feat(db):`,
`fix(csp):`). Scope tells the reviewer what area changed.

```bash
git add -p
git commit -m "feat(tables): add cleaning lifecycle status + policy"
```

### 6. Rebase on main, then push — [dev]
Pull the latest `main` into your branch before pushing so the PR is a clean
fast-forward and migration timestamps stay in order.

```bash
git fetch origin && git rebase origin/main
git push -u origin feat/table-lifecycle-cleaning
```

### 7. Open a PR into main — [dev]
Describe what changed, why, and call out any migration explicitly. Vercel builds
a **preview deployment** automatically so the lead can click through the change
before approving.

```bash
gh pr create --base main --fill
# PR body: what / why · ⚠ contains migration: add_table_cleaning_status
```

### 8. Review & merge — [lead]
Lead reviews the diff and the migration, checks the Vercel preview, and
squash-merges into `main`. The feature branch is deleted on merge.

### 9. Deploy: app + database — [lead]
Both gates are manual. Vercel watches the **`prod`** remote, not `origin` — a
push to `origin` looks like a release and ships nothing.

```bash
supabase link --project-ref <prod-ref>   # once
supabase projects list                   # confirm what is linked, every time
supabase db push                         # migrations to prod, FIRST

git log --format='%ae' prod/main..main | sort -u   # must be info.kkkhane@gmail.com only
git push prod main                       # triggers the production deploy
```

A commit authored by anyone else deploys as `BLOCKED / TEAM_ACCESS_REQUIRED`,
which is why contributor PRs are merged locally with `--no-ff`. Full detail and
rollback in [DEPLOYMENT.md](DEPLOYMENT.md).

> **Order of operations**
> Run `supabase db push` **before or together with** the app deploy when the new
> code depends on the new schema. For an additive migration (new nullable column,
> new table) either order is safe; for anything the app immediately reads, push
> the DB first.

---

## 03 · Migration rules

> The database is code too.

The `supabase/migrations/` folder is the single source of truth for the schema.
Prod and every laptop rebuild themselves from it, so the rules are strict.

1. **Forward-only** — Never edit a migration that's merged. Fix mistakes with a new migration on top.
2. **Baseline is frozen** — `20260708150000_baseline.sql` is the archived starting point; treat it as read-only.
3. **Test from zero** — Every change must survive a full `supabase db reset` before it can be pushed.
4. **One concern per file** — Keep migrations small and named for intent so review and rollback stay tractable.
5. **Additive first** — Prefer nullable columns and new tables. Coordinate destructive changes with a deploy plan.
6. **Types follow schema** — Regenerate TypeScript types after schema changes so the app and DB never disagree.

---

## 04 · Who owns what

> Two people, clear lanes.

### 🟢 Developer
Builds features on branches against local Supabase.

- Owns feature & fix branches end to end
- Writes and locally tests every migration
- Keeps branches rebased on `main`
- Opens PRs with clear descriptions
- Responds to review; never merges own PR
- Never pushes to `main` or touches prod

### 🟠 Lead developer
Guards `main`, production, and the release gate.

- Reviews & squash-merges all PRs
- Runs `supabase db push` to prod
- Owns Vercel & prod Supabase secrets
- Holds the `.env.local.production-backup`
- Sequences DB-then-app deploys
- Cuts hotfixes and coordinates rollbacks

---

## 05 · Never do this

> The fast path to a prod incident.

- ✕ **Push straight to main** — Every change lands via PR so it gets review + a preview build.
- ✕ **Edit prod in Studio** — Manual schema edits break the migration chain and desync local ↔ prod.
- ✕ **Commit any `.env*` file** — Secrets live in Vercel and the encrypted backup only. They're gitignored for a reason.
- ✕ **Run raw destructive SQL on prod** — No ad-hoc `DROP`/`DELETE`. If it must happen, it's a reviewed migration.
- ✕ **Rewrite a merged migration** — Timestamps are history. Always add a new one instead.
- ✕ **Ship a migration untested locally** — If `db reset` hasn't replayed it clean, it isn't ready.

---

*KKKhane — developer workflow*
`main → feat/* · fix/*  |  local:54321 → prod`
