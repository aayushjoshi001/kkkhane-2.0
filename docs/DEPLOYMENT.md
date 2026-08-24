# Deployment

How a change reaches kkkhane.com, what production is actually made of, and the
several things about this setup that will surprise you.

For the day-to-day coding loop, see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Environments

| | Local | Production |
|---|---|---|
| App | `localhost:3000` | kkkhane.com, www.kkkhane.com |
| Supabase | `127.0.0.1:54321` (Docker) | Supabase cloud, `ap-southeast-1` |
| Config | `.env.local` | Vercel env vars (Sensitive) |
| Schema changes | freely, then captured as a migration | reviewed migrations only |
| Who | anyone | lead only |

There is no staging environment. Vercel preview deployments on a PR are the
closest thing, and they run against **production** Supabase — so a preview is
safe to look at and not safe to write test data through.

## The Vercel project

| | |
|---|---|
| Team | `infokkkhane-uxs-projects` |
| Project | `kkkhane` (`prj_DiPzJ9pOsTZjHNQooBNjuwOPDtDA`) |
| Region | `sin1` (Singapore) |
| Framework | Next.js, auto-detected |

**Region matters.** Functions ran in `iad1` (Virginia) while the database sits
in `ap-southeast-1` (Singapore) — roughly 230 ms per query, across many queries
per request. `vercel.json` pins `sin1`. Do not remove it. The database itself
was never the bottleneck.

The Vercel **MCP server returns 403** on this scope. Use the CLI (`vercel …`)
for anything Vercel-related.

---

## Three things that will catch you out

### 1. `origin` does not deploy. `prod` does.

```
prod    git@github.com:infokkkhane-ux/KKKhane.git     ← Vercel watches this
origin  git@github.com:siddanta-ar1/The-House.git     ← mirror, deploys nothing
```

Pushing to `origin` looks like a successful release and ships nothing. A
production release is a push to `prod`.

### 2. Commits must be authored by the Vercel account owner.

Any commit **not** authored by `info.kkkhane@gmail.com` deploys as
`readyState=BLOCKED / TEAM_ACCESS_REQUIRED`. This applies to git-push deploys,
not only to `vercel --prod` from the CLI — so a contributor's commit reaching
`main` blocks the deploy silently.

Merge contributor PRs **locally with `--no-ff`** so the merge commit carries a
clean author:

```bash
git checkout main && git pull prod main
git merge --no-ff feat/their-branch
git push prod main
```

Check before pushing:

```bash
git log --format='%ae' prod/main..main | sort -u
```

Anything other than `info.kkkhane@gmail.com` in that list will block.

### 3. Environment variables are Sensitive and cannot be read back.

`vercel env pull` returns `KEY=""` for them. The only copy of the values is
`.env.local.production-backup` on the lead's machine, which is git-ignored and
must stay that way. Losing that file means regenerating every secret.

---

## Releasing

```bash
# 1. main is green
npm run typecheck && npm run lint && npm run build

# 2. schema first, if the release has one — see "Migrations" below
supabase db push

# 3. ship
git push prod main
```

Vercel builds and promotes automatically. Watch it:

```bash
vercel ls
vercel inspect <deployment-url>
vercel logs <deployment-url>
```

A deployment that reports `BLOCKED` is the author problem above, not a build
failure.

### Migrations go first

The app and the schema deploy separately, so ordering is on you. Push the
migration **before** the code that depends on it, and write migrations to be
backward-compatible with the currently-deployed app for the minute or two the
two are out of step: add columns nullable or with a default, add before you
remove, and split a rename into add → backfill → drop across two releases.

```bash
supabase projects list            # confirm what is linked, every time
supabase db push                  # applies pending migrations to the remote
```

`supabase db push` is irreversible against production. Read what it is about to
apply first.

Two gotchas that have bitten this project:

- **`list_migrations` reads the ledger, not the schema.** A migration can be
  recorded as applied while its objects are absent, or the reverse. Verify the
  actual object exists before concluding anything.
- **Applying a migration through the MCP server mints its own version number**,
  which then differs from the filename on disk, and a later `db push` re-runs
  the file. Keep the filename and the applied version pinned to each other.

Never edit a merged migration or the baseline to fix an apply failure. Add a new
migration.

---

## Rollback

**Code** — instant, and the first thing to reach for:

```bash
vercel rollback              # promote the previous production deployment
```

Or promote a known-good one from `vercel ls`. Follow up with a revert commit so
the repo matches what is live.

**Schema** — there is no automatic rollback. A migration that has run has run.
Recovery is a new forward migration that undoes it, written and tested locally
against `npm run db:reset` first. This is the reason the compatibility rules
above are not optional: a code rollback must be able to run against the new
schema.

Supabase's own daily backups are the last resort. Restoring one loses every
transaction since it was taken, on a live POS — treat it as a disaster measure,
not a rollback.

---

## Configuration

### Secrets

Every variable and what it does is documented in
[`.env.example`](../.env.example). Add anything new there in the same commit
that reads it.

Three of them **fail closed** — the endpoint rejects every request when the
variable is unset, rather than running unauthenticated:

| | Gates |
|---|---|
| `CRON_SECRET` | `/api/cron/*` |
| `REVALIDATE_SECRET` | `/api/revalidate` |
| `SRMS_API_KEY` | `/api/orders`, the external orders API |

Redis, by contrast, **fails open**: an unreachable Upstash means rate limiting
is skipped and requests pass. That is deliberate — a dead cache must not take
the POS down — but it means an outage is silent. Check it after any
infrastructure change.

### Cron jobs

Declared in `vercel.json`:

| Path | Schedule (UTC) |
|---|---|
| `/api/cron/generate-eod-reports` | `15 18 * * *` |
| `/api/cron/accrue-salaries` | `15 18 * * *` |
| `/api/cron/auto-suspend` | `0 0 * * *` |
| `/api/cron/refresh-item-pairings` | `30 3 * * *` |

Vercel's Hobby plan documents a limit of **two** cron jobs per project and four
are declared here, so this looks like a problem. It was checked on 2026-08-04
and it is not one: `generate-eod-reports` (first in the file) and
`refresh-item-pairings` (**third**) both demonstrably ran, which could not
happen if registration stopped at the first two. All four are registered.

`auto-suspend` and `accrue-salaries` write nothing, and that is also expected
rather than a fault — no restaurant currently qualifies for suspension, and
`staff_salary_history` is empty, so `insertAccruals` correctly returns
`{inserted: 0}`. **`accrue-salaries` cannot do anything until salary records
exist.** The gap there is data, not scheduling.

Two things to know when checking on these:

- Neither `vercel inspect` nor the (403ing) MCP server exposes the registered
  cron list. The only available proof that a job ran is the row it wrote —
  check the target table, not the dashboard.
- Cron schedules drift. Against `15 18 * * *`, `generate-eod-reports` has fired
  as late as 18:37 UTC. That matters because 18:15 UTC is the NST-midnight
  end-of-day boundary, and a ~22 minute drift crosses it.
- The routes look POST-only; each ends with `export const GET = POST` because
  Vercel Cron invokes with GET. That is deliberate, not a bug.

Hobby also caps function duration at **60 s** — three cron routes already sit
exactly at that ceiling — and provides no firewall or WAF. Worth confirming
against the current plan before a traffic event.

> **Plan/ToS note.** Hobby forbids commercial use, and this is a paid
> multi-tenant SaaS with live tenants. That is an account-suspension risk on
> production, independent of any technical limit.

### Deploy size

`.vercelignore` keeps the upload small — the CLI was shipping ~700 MB of local
build artifacts and test output, which stalled `vercel --prod` before the build
started. Vercel rebuilds `.next` remotely, so none of it is needed. Do not add
large fixtures or exports outside the ignored paths.

---

## Domains and auth redirects

`kkkhane.com` and `www.kkkhane.com` both point at the project.

If Google sign-in lands users on the marketing home page instead of their
dashboard, it is almost always the **Supabase Redirect URLs allowlist**, not
application code — apex vs `www` mismatch. Fix it in Supabase Auth settings,
and make sure `NEXT_PUBLIC_APP_URL` matches the domain users actually arrive on.

## Printing on site

Thermal printers need [QZ Tray](https://qz.io) installed on the staff machine,
and the **CUPS queue must be raw**. Pointing it at a real printer driver makes
the printer emit pages of garbage — it is a raw ESC/POS byte stream, not a
document. Silent printing needs `QZ_CERTIFICATE` and `QZ_PRIVATE_KEY` set;
without them QZ asks the cashier to approve every job.

---

## Health checks after a release

1. `/api/health` responds.
2. Sign in as a manager; the dashboard loads with real numbers.
3. Open a table or room bill and confirm the total matches what settlement
   records — the money path is the thing worth checking by hand.
4. Send a test order to the kitchen display; confirm it appears and prints.
5. `vercel logs` and Sentry are clean of new error classes.
