# Architecture

How KKKhane fits together, and the handful of invariants that everything else
depends on. Read this before your first change; it is short on purpose.

For the exhaustive reference — every table, every panel, every feature —
see [PROJECT_REPORT.md](PROJECT_REPORT.md).

---

## The shape of it

One Next.js application, one Postgres database, many businesses.

```
   diner's phone            staff device              manager's laptop
   /t/{table}  /r/{room}    /waiter /cashier          /admin/*
   (no account)             /kitchen /bar
        │                        │                          │
        └────────────────────────┴──────────────────────────┘
                                 │
                    src/proxy.ts  — session + role gate,
                                    rate limit on public QR routes
                                 │
        ┌────────────────────────┼──────────────────────────┐
        │                        │                          │
  Server Components        Server Actions              Route handlers
  (read path)              (src/lib/actions)           (src/app/api/*)
        │                        │                          │
        └────────────────────────┴──────────────────────────┘
                                 │
                        Supabase — Postgres 17
                        Auth · Storage · Realtime
```

Everything that moves money or crosses a tenant goes through a route handler or
a server action, never through the browser's Supabase client. The browser client
exists for reads under RLS and for Realtime subscriptions.

---

## Multi-tenancy

**A tenant is a restaurant.** Every business-owned table carries a
`restaurant_id`, and that column is the whole tenant boundary. There is no
schema-per-tenant and no database-per-tenant.

Three client factories, and the difference between them matters:

| Factory | Key | RLS | Use it for |
|---|---|---|---|
| `createClient()` (`lib/supabase/client.ts`) | anon | **on** | browser reads, Realtime |
| `createServerClient()` (`lib/supabase/server.ts`) | anon + user session | **on** | server-side reads as the signed-in user |
| `createAdminClient()` (`lib/supabase/server.ts`) | service role | **off** | privileged writes, cross-tenant work |

### The invariant

`createAdminClient()` bypasses RLS completely. Postgres will happily return
another restaurant's rows. **The query text is the only tenant boundary that
exists on that client.**

So: every query it builds against a `restaurant_id` table must constrain
`restaurant_id`. Selects, updates and deletes filter it; inserts and upserts
carry it in the payload.

A row id is *not* a tenant check. `eq('id', bookingId)` looks safe and is not —
an id from another restaurant is served without complaint.

```ts
// wrong — serves any restaurant's booking
await admin.from('bookings').select('*').eq('id', bookingId)

// right
await admin.from('bookings').select('*')
  .eq('id', bookingId)
  .eq('restaurant_id', currentUser.restaurantId)
```

This is enforced by a lint rule, not by memory: `srms/require-tenant-scope` in
`eslint-rules/`. It reads every chain rooted at a locally created admin client
and reports the unscoped ones. What it cannot judge, it stays quiet about — a
client passed in as a function parameter (the filter belongs to the caller),
`.rpc()` calls (the scoping lives in the SQL body), and child tables like
`order_items` that have no `restaurant_id` of their own and inherit tenancy
through a parent FK.

For the queries that genuinely must cross or precede a tenant — a pre-auth
lookup resolving *which* tenant a user belongs to, for instance — there is an
escape hatch, and the reason is mandatory:

```ts
// tenant-scope-exempt: pre-auth lookup — the tenant is what we are resolving
const { data } = await admin.from('users').select('restaurant_id').eq('id', uid)
```

A bare marker with no reason is itself reported. An unexplained exemption is
indistinguishable from the bug the rule exists to catch.

The rule's table lists are generated from the migrations, not hand-maintained.
After any migration that adds a table or a `restaurant_id` column:

```bash
npm run gen:tenant-tables
```

The rule currently runs at `warn` because there is an inherited backlog. New
code should not add to it.

---

## Authentication and roles

Full detail in [AUTH_FLOW.md](AUTH_FLOW.md). The short version:

Supabase Auth issues the session. A Postgres auth hook
(`scripts/004_jwt_claims_hook.sql`) stamps `role` and `restaurant_id` into the
JWT, so `src/proxy.ts` can gate a route without a database round trip.

`src/proxy.ts` holds the route rules, first match wins:

| Pattern | Roles allowed |
|---|---|
| `/admin/*` | `super_admin`, `manager` |
| `/kitchen/*` | `kitchen`, `manager`, `super_admin` |
| `/bar/*` | `bartender`, `manager`, `super_admin` |
| `/waiter/*` | `waiter`, `manager`, `super_admin` |
| `/cashier/*` | `cashier`, `waiter`, `manager`, `super_admin` |

**The proxy is a convenience, not the security boundary.** It stops a wrong-role
user seeing a page. It does not stop a crafted POST. Every server action and
route handler re-checks the role itself — privileged finance and staff actions
require `manager` or above at the point of the write.

Where a role lands after login is `ROLE_LANDING` in `src/lib/roleLanding.ts`,
which exists because that mapping was previously duplicated across three files
and drifted.

### Demo accounts

Demo logins for each role are re-asserted from `src/lib/demoAccounts.ts` on
every demo sign-in, so editing those users directly in the database does not
stick. They are gated behind `SHOW_DEMO_ACCOUNTS`, which must stay unset in
production — that switch is what keeps them off the live site.

---

## Business modes and feature flags

A tenant picks a `business_type` at onboarding (8 of them). That maps to one of
five **operational modes** — `dine_in`, `counter_service`, `bar_service`,
`delivery_only`, `hotel` — in `src/lib/businessMode.ts`. `business_type` is the
stored source of truth; mode is always derived, never stored, so the two cannot
drift.

A tenant also has a **tier**: `free`, `basic`, `premium`, `platinum`,
`enterprise`. Tiers grant modules and entitlements; the finance suite is
`premium` and above.

Which flags a tenant ends up with is resolved by exactly two functions in
`src/lib/tiers.ts`:

- `resolveFeatureDefaults()` — fills flags an older row predates
- `applyTierModuleDefaults()` — applies what the tier grants and revokes

**These two are the only source of truth for feature defaults.** Never
hand-write `features.something ?? true` at a call site: that is how a flag ends
up meaning one thing in the nav and another in the API. Add the default to the
resolver.

Resolved flags are cached ~30s (`getRestaurantFeatures`), so a flag change takes
up to half a minute to appear.

---

## The money path

The rule here is stricter than anywhere else in the codebase: **a monetary total
has exactly one implementation.** Every duplicate found so far had already
drifted from its twin, and each drift was a real wrong number on a real bill.

| Module | Owns |
|---|---|
| `lib/folio.ts` | What a hotel stay costs. Room nights at the rate of the room actually occupied that night, food, manual charges, service charge, VAT, discounts. |
| `lib/invoiceSummary.ts` | What an invoice totals to. |
| `lib/roomServiceCharge.ts` | The service charge rule — a percentage on kitchen items, gated on a feature flag and a per-room allowlist. |
| `lib/folioVat.ts` | VAT on room and manual charges. |
| `lib/ledger.ts` | Whether money moved, and the day-book row that records it. |
| `lib/bookingBill.ts`, `lib/bookingGroup.ts` | Group and multi-room stay billing. |

Both the settlement path (`api/bookings/checkout`) and the guest-facing bill
(`api/rooms/stay-billing`) call `computeFolioTotal`. They each used to keep their
own copy, and by the time that was noticed one skipped already-paid orders and
the other applied no tax at all.

The same rule binds the UI. A cashier screen that previews a total must call the
same helper the server will use at settlement. Three cashier screens each
carried their own service-charge arithmetic until they were unified; a preview
that computes its own number is a bug waiting for a guest to notice.

**Server-authoritative, always.** A total shown in the browser is a preview.
Settlement recomputes it server-side from the database. Never accept a price,
discount or total from the client.

### The books

`day_book_entries` is the spine. Vouchers, suppliers, staff payroll, income and
expenses, and the cash book all post through `postFinancialTransaction` in
`lib/ledger.ts` — one session lookup, one bank-account resolution, one row
shape. They each used to insert their own, with predictable results.

On top of that sit the day book, cash book, bank book and bank ledger, shift
cash reconciliation, and customer credit / receivables.

Dates are Nepal Standard Time (`lib/timezone.ts`), and reports are frequently
rendered in Bikram Sambat (`lib/nepaliDate.ts`, `nepali-date-converter`). A
"day" in the books is a day-book *session*, opened and closed by staff — not a
calendar midnight. Do not substitute one for the other.

---

## Realtime

`src/lib/realtime/` wraps Supabase Realtime. Subscribe with
`useRestaurantTable(restaurantId, table, handler)` — one channel per restaurant,
shared across hooks (`restaurantChannel.ts`).

Realtime drops messages. `channelCatchUp.ts` / `useRestaurantCatchUp.ts` refetch
on reconnect to close the gap. A failed catch-up read must never sign the user
out — that bug shipped once already.

**Anything a Realtime handler fetches needs a staleness guard.** The screen may
have moved on between the event firing and the response landing, and writing a
late response into current state puts one guest's data on another's screen. The
cashier's room panel does this with a request counter; copy that pattern.

---

## Printing

Thermal printers take raw ESC/POS over [QZ Tray](https://qz.io), a local
helper the staff machine runs.

- `lib/print/escpos.ts` — byte generation
- `lib/print/qzClient.ts`, `qzKeys.ts` — QZ connection and signing
- `lib/print/printClaims.ts` — a claim, so two devices watching the same order
  do not both print the ticket

Two things bite:

1. **The CUPS queue must be raw.** Point it at a real printer driver and the
   printer emits pages of garbage. It is a raw byte stream, not a document.
2. **Silent printing needs a signing certificate.** Without `QZ_CERTIFICATE`
   and `QZ_PRIVATE_KEY`, QZ prompts the cashier to approve every job.

A printed ticket is *state*, not a side effect of a Realtime event — that is
what `printClaims` records, and why a dropped socket does not silently lose a
kitchen ticket.

---

## Background work and caching

- **Upstash Redis** (`lib/redis.ts`) — rate limiting and short-lived caches. It
  **fails open**: unreachable Redis means requests pass rather than 500. A
  circuit breaker prevents each request paying the full retry backoff. Do not
  wrap Redis calls in an external `setTimeout` race — it defeats the breaker,
  which is a bug this file has already had.
- **Upstash QStash** — deferred jobs, signature-verified on the way back in.
- **Vercel Cron** — scheduled jobs under `/api/cron/*`, gated by `CRON_SECRET`,
  which fails closed when unset.

---

## Database

`supabase/migrations/` is the only way the schema changes. A frozen baseline
(`20260708150000_baseline.sql`) plus every migration since; `migrations_archive/`
holds the pre-baseline history for reference only and is never replayed.

Never edit a merged migration or the baseline. Add a new one.

Settlement and checkout run as `SECURITY DEFINER` Postgres functions so the
whole thing is one transaction with proper row locking. Those functions:

- pin `search_path` (an unpinned one is a privilege-escalation path)
- must not be executable by `PUBLIC` — revoke from `PUBLIC`, then re-grant to
  `service_role`
- do their own tenant scoping, since the lint rule cannot see inside them

`npm run db:reset` replays baseline plus every migration from zero — the same
sequence production will run. If it applies cleanly from empty, it is safe to
ship. See [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Conventions that are load-bearing

- **One implementation per total.** If you are writing arithmetic that already
  exists in `lib/`, import it instead.
- **Feature defaults live in the resolvers.** Never `?? true` at a call site.
- **`restaurant_id` on every admin-client query.** The linter checks; do not
  silence it without a written reason.
- **Server actions and route handlers re-check the role.** The proxy is not the
  boundary.
- **Money is recomputed server-side at settlement.** The client's number is a
  preview.
- **Realtime responses are guarded against staleness.**
- **Schema changes are migrations.** Always.
