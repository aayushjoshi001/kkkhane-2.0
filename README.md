# KKKhane

Multi-tenant hotel and restaurant management SaaS, built for Nepal. One
deployment serves many businesses; each one gets a point-of-sale, a QR ordering
menu, a kitchen and bar display, room bookings with folio billing, and a full
set of books — day book, cash book, bank book, shift reconciliation and
receivables.

Live at **[kkkhane.com](https://kkkhane.com)**.

| | |
|---|---|
| **Stack** | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 |
| **Backend** | Supabase — Postgres 17, Auth, Storage, Realtime |
| **Hosting** | Vercel (`sin1`, Singapore — next to the database) |
| **Extras** | Upstash Redis + QStash · Resend · Sentry · QZ Tray (ESC/POS printing) |

---

## What it actually does

A tenant is a **restaurant**, and every business-owned row in the database
carries its `restaurant_id`. A tenant runs in one of two modes:

- **Restaurant** — tables, QR ordering, waiter and cashier screens, kitchen and
  bar display, takeout, billing.
- **Hotel + restaurant** — all of the above, plus rooms, reservations,
  housekeeping, in-room ordering, and a stay folio that rolls room nights, food,
  manual charges, service charge and VAT into one settlement.

Which modules a tenant sees is decided by feature flags resolved from its plan
and mode, never by hand-written defaults. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#feature-flags).

## Who uses it

| Role | Lands on | Can reach |
|---|---|---|
| `super_admin` | `/admin/super-admin/dashboard` | Everything, across tenants |
| `manager` | `/admin/dashboard` | All of its own tenant's admin surface |
| `cashier` | `/cashier` | Cashier, waiter screens |
| `waiter` | `/waiter` | Waiter, cashier screens |
| `kitchen` | `/kitchen` | Kitchen display |
| `bartender` | `/bar` | Bar display |
| diner | `/t/{table}`, `/r/{room}` | No account — QR session only |

Route access is enforced in `src/proxy.ts` before a page renders, and again in
every server action and API route. The table is
`ROLE_LANDING` in `src/lib/roleLanding.ts`.

---

## Getting started

**Prerequisites:** Node ≥ 20.9, the [Supabase CLI](https://supabase.com/docs/guides/cli),
and Docker running (Supabase runs locally in containers).

```bash
git clone git@github.com:infokkkhane-ux/KKKhane.git
cd KKKhane
npm install

cp .env.example .env.local     # then fill it in — see the comments in the file
supabase start                 # API :54321 · DB :54322 · Studio :54323
npm run dev                    # http://localhost:3000
```

For local work `.env.local` should point at `127.0.0.1:54321` with the keys
`supabase start` prints. Never point a dev server at the production project.

Set `SHOW_DEMO_ACCOUNTS=1` to get one-click demo logins for each role on the
login screen. That switch is what keeps demo accounts off the live site, so it
must stay unset in production.

### Everyday commands

```bash
npm run dev                # dev server (Turbopack)
npm run build              # production build
npm run typecheck          # tsc --noEmit
npm run lint               # eslint, including the repo's own invariant rules
npm test                   # Playwright, chromium

npm run db:reset           # drop local DB, replay baseline + every migration
npm run db:diff <name>     # capture local schema changes as a new migration
npm run db:push            # apply migrations to the linked remote project

npm run gen:tenant-tables  # regenerate the lint rule's tenant table lists
```

`npm run db:push` writes to whichever Supabase project is linked. Confirm with
`supabase projects list` before running it — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Layout

```
src/
  app/
    (admin)/admin/     Manager and super-admin surface — ~35 modules:
                       orders, menu, rooms, bookings, staff, shifts,
                       finance, day-book, cash-book, bank-book,
                       reconciliation, reports, settings, …
    (staff)/           Operational screens: waiter, cashier, kitchen, bar
    (public)/          QR entry points: /t/{table}, /r/{room}, /takeout
    (onboarding)/      New-tenant setup
    api/               Route handlers — the write path for anything
                       money-related or cross-tenant
    …                  Marketing and auth pages (/, /pricing, /login, …)
  components/          admin · waiter · kitchen · customer · finance ·
                       marketing · shared · ui
  lib/
    supabase/          Client factories — see the tenancy note below
    actions/           Server actions
    realtime/          Supabase Realtime subscription hooks
    print/             ESC/POS receipt and ticket rendering
    finance-events/    Ledger event emission
    folio.ts           THE stay-billing calculation. Single source of truth.
    invoiceSummary.ts  THE invoice total calculation. Single source of truth.
    features.ts        Feature-flag resolution
    …
  types/
supabase/
  migrations/          The only way the schema ever changes
  migrations_archive/  Pre-baseline history, kept for reference only
eslint-rules/          Repo-specific lint rules (tenant scoping)
scripts/               The few scripts that are still live
tests/                 Playwright end-to-end specs
docs/                  Everything below
```

## Two rules worth knowing before you write code

**1. The schema only changes through a migration.** Not through Studio, not
through a one-off script. Write it in `supabase/migrations/`, verify it with
`npm run db:reset`, get it reviewed, then push. If it isn't a migration file, it
doesn't reach production.

**2. `createAdminClient()` turns RLS off.** It holds the service-role key, so
Postgres will not filter anything: the query text is the only thing keeping one
restaurant's data out of another's. Every query it builds against a
tenant-scoped table must constrain `restaurant_id`. `npm run lint` enforces
this — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#multi-tenancy).

---

## Documentation

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system fits together — tenancy, roles, the money path, realtime, printing |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | The daily loop: branch, migrate, review, merge |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environments, secrets, releasing, rollback |
| [docs/AUTH_FLOW.md](docs/AUTH_FLOW.md) | Signup, login, roles, JWT claims, session sync |
| [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md) | Deep reference: every table, panel and feature |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Conventions, commits, review expectations |
| [CLAUDE.md](CLAUDE.md) | Context and house rules for AI coding agents |

[docs/FLOW_INTEGRATION_PLAN.md](docs/FLOW_INTEGRATION_PLAN.md) is historical —
the plan that produced the current order pipeline. Kept for the reasoning, not
as a description of today's code.

---

Private and proprietary. All rights reserved.
