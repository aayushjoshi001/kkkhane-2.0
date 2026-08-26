# CLAUDE.md

Guidance for Claude Code and other AI agents working in this repository.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before making a non-trivial
change. This file is the short version plus the things that are easy to get
wrong here.

---

## What this is

KKKhane — a multi-tenant hotel and restaurant management SaaS for Nepal, live at
kkkhane.com with paying businesses on it. Next.js 16 App Router, React 19,
TypeScript, Tailwind v4, Supabase (Postgres 17), deployed on Vercel in `sin1`.

**Real money and real guest data run through this codebase.** A wrong number
here reaches a cashier's drawer or a guest's bill. Treat the finance surface
accordingly: verify against the database or the code, never against a plausible
assumption.

## Commands

```bash
npm run dev                # dev server
npm run typecheck          # tsc --noEmit — must be clean
npm run lint               # eslint, incl. the repo's tenant-scoping rule
npm run build              # production build
npm test                   # Playwright, chromium

npm run db:reset           # replay baseline + all migrations locally
npm run db:diff <name>     # capture local schema change as a migration
npm run gen:tenant-tables  # regenerate lint rule table lists after a migration
```

Run `typecheck` and `lint` before reporting a change complete. `npm run lint`
carries an inherited backlog of ~650 errors and ~3,500 warnings, nearly all
`no-explicit-any` and unused vars. Do not try to fix them wholesale. The bar is
that a change does not add new ones.

## The five invariants

Violating any of these is a bug even when the code runs.

1. **`createAdminClient()` bypasses RLS.** It uses the service-role key, so
   Postgres filters nothing — the query text is the only thing keeping one
   restaurant's data out of another's. Every query it builds against a
   tenant-scoped table must constrain `restaurant_id`. **A row id is not a
   tenant check**: `.eq('id', x)` alone serves another tenant's row. The
   `srms/require-tenant-scope` lint rule enforces this; the escape hatch is a
   `// tenant-scope-exempt: <reason>` comment, and the reason is required.

2. **A monetary total has exactly one implementation.** `lib/folio.ts` owns what
   a stay costs, `lib/invoiceSummary.ts` owns invoice totals,
   `lib/roomServiceCharge.ts` the service charge, `lib/folioVat.ts` the VAT,
   `lib/ledger.ts` the day-book posting. Import them — including in UI previews,
   which must call the same helper settlement will call. Every duplicate found
   in this repo had already drifted from its twin, and each drift was a wrong
   number on a real bill.

3. **The server recomputes money at settlement.** Never trust a price, discount
   or total from the request body. What the browser showed was a preview.

4. **Authorization is re-checked at the write.** `src/proxy.ts` gates routes,
   but it is a convenience, not the security boundary — it does not stop a
   crafted POST. Every server action and route handler checks the role itself.

5. **The schema only changes through a migration.** New file in
   `supabase/migrations/`; never edit a merged migration or the baseline
   (`20260708150000_baseline.sql`). Verify with `npm run db:reset`, which
   replays from zero exactly as production will.

## Things that have already gone wrong here

- **Realtime responses landing late.** A subscription handler refetches for
  whatever record was open when the event fired. If the user has since moved on,
  writing that response into state shows one guest's data under another guest's
  name. Guard every fetch a handler starts with a request counter. See
  `CashierRoomManager.tsx` for the pattern.
- **Duplicated arithmetic drifting.** Three cashier screens each had their own
  service-charge calculation. Checkout and the guest bill each had their own
  folio. In both cases the copies disagreed before anyone noticed.
- **Hand-written feature defaults.** `features.x ?? true` at a call site means
  the flag says one thing in the nav and another in the API. Defaults belong in
  `resolveFeatureDefaults` / `applyTierModuleDefaults` in `lib/tiers.ts`, which
  are the only two resolvers.
- **`SECURITY DEFINER` functions with an unpinned `search_path`** — a
  privilege-escalation path. Pin it. Revoke execute from `PUBLIC` (not just
  `anon`), then re-grant to `service_role`.
- **External timeouts racing the Redis client.** `lib/redis.ts` has its own
  backoff and circuit breaker; wrapping a call in `setTimeout` defeats both and
  makes every request pay the full delay. Redis here **fails open** by design.
- **Day boundaries.** A "day" in the books is a day-book *session* opened and
  closed by staff, not calendar midnight. Dates are Nepal Standard Time
  (`lib/timezone.ts`), often displayed in Bikram Sambat (`lib/nepaliDate.ts`).

## Working style in this repo

- **Match the surrounding code.** It is densely commented, and the comments
  explain *why* — what broke, what was rejected, what the constraint is. Write
  that kind of comment, not a restatement of the line below it.
- **Commit messages carry the reasoning.** Conventional Commits subject, then a
  body explaining the symptom, the mechanism and the decision. Read
  `git log` before writing one.
- **Never point a dev server, a script or a test at the production project.**
  Check what `supabase` is linked to before any `db push`.
- **Do not commit secrets.** `.env*` is ignored except the examples; `.mcp.json`
  and its backups hold a personal Supabase access token and are ignored too.
- **`scratch/` is ignored** — put throwaway scripts and data exports there, not
  in the repo root.
- **Do not delete or rewrite existing migrations** to make something apply
  cleanly. Add a new one.

## Layout

```
src/app/(admin)/admin/   manager + super-admin surface (~35 modules)
src/app/(staff)/         waiter · cashier · kitchen · bar
src/app/(public)/        QR entry: /t/{table}, /r/{room}, /takeout
src/app/api/             route handlers — the write path
src/lib/                 supabase/ actions/ realtime/ print/ finance-events/
                         + the money modules named above
supabase/migrations/     the only way the schema changes
eslint-rules/            repo-specific invariant rules
tests/                   Playwright end-to-end
docs/                    architecture, development, deployment, auth
```

## Where to look first

| Question | File |
|---|---|
| What does this stay cost? | `src/lib/folio.ts` |
| What does this invoice total? | `src/lib/invoiceSummary.ts` |
| Did money move, and where is it recorded? | `src/lib/ledger.ts` |
| Can this role reach this route? | `src/proxy.ts`, `src/lib/roleLanding.ts` |
| Does this tenant have this feature? | `src/lib/tiers.ts`, `src/lib/features.ts` |
| What mode is this business in? | `src/lib/businessMode.ts` |
| How does a printed ticket happen? | `src/lib/print/` |
