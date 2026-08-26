# KKKhane — Complete Flow Integration Plan

> **Historical.** This is the plan that produced the current unified order
> pipeline, kept for the reasoning behind those decisions. It is not a
> description of today's code — for that see [ARCHITECTURE.md](ARCHITECTURE.md)
> and [AUTH_FLOW.md](AUTH_FLOW.md).
>
> Original status line: **PLANNING** (no implementation yet)
> Decisions locked: (1) unify takeout into the `orders` pipeline; (2) customer
> can *request* to open a session, waiter approves (no silent auto-session).

## Guiding principles
- **One order system.** Dine-in and takeout flow through the same
  `orders` / `order_items` / `place_order` RPC so kitchen, inventory, loyalty,
  and reporting stay consistent.
- **One provisioning path.** A single `provisionRestaurant()` is the only way a
  restaurant is created — no drift between signup and onboarding.
- **Waiter stays in control of sessions**, but the customer gets an in-app way
  to request one.

## End-to-end flow map (current)
```
Marketing (/) ──► /signup ──► auto sign-in ──► /admin/dashboard        ✅
            └──► /login  ──► role landing (admin/kitchen/waiter)       ✅
OAuth/phone signup ──► /onboarding/create ──► restaurant created       ✅
Customer: scan QR ──► /t/[tableSlug] ──► menu ──► checkout ──► receipt  ⚠️ needs waiter session
Takeout: /takeout/[slug] ──► form ──► takeout_orders ──► kitchen/waiter ⚠️ forked system
```

## Confirmed loopholes
1. **New restaurant is born empty.** Both provisioning paths create
   restaurant + user + settings but **no tables/QR/menu** → `/t/[token]` 404s,
   dashboard empty, no setup wizard.
   - `src/app/signup/actions.ts:127`
   - `src/app/(onboarding)/onboarding/create/actions.ts:46`
2. **Two divergent provisioning code paths** (feature defaults already drift).
3. **Customer can't self-order** — `/t/[tableSlug]/page.tsx:73` requires a
   waiter-opened session; otherwise view-only.
4. **Takeout is a forked JSONB system** — no `order_items`, no ingredient
   deduction, no KOT, status enum mismatch (kitchen queries
   `['placed','confirmed','preparing']` vs `updateTakeoutStatus` writing
   `ready_for_pickup`/`picked_up`), no online payment.
   - `src/app/api/takeout/actions.ts:134`
   - `src/app/(staff)/kitchen/page.tsx:54`
5. **`/cashier` is not role-gated** — missing from middleware `ROUTE_RULES`
   (`src/middleware.ts:11`) and page only calls `getCurrentUser()` not
   `requireRole()` (`src/app/(staff)/cashier/page.tsx:8`).

---

## Phase 1 — Provisioning (unblocks the customer flow) ✅ DONE
- [x] New `src/lib/provisioning.ts` → `provisionRestaurant({...})`:
      insert restaurant → upsert user (manager role, full_name set) →
      insert settings → seed 3 menu categories + 6 sample items → seed 6 tables
      each with an auto-generated `qr_token`. JS rollback on failure.
- [x] New `src/lib/tiers.ts` — single source of tier limits + feature defaults
      (deleted duplicated constants from both action files).
- [x] Refactor `signup/actions.ts` + `onboarding/create/actions.ts` to call it.
      (Also fixed onboarding **`users.full_name` NOT NULL** latent bug.)
- [x] `SetupChecklist` on `/admin/dashboard` already existed — enhanced with
      "invite staff" + "set business hours & tax" steps; auto-hides when done.
- [x] `/admin/tables` QR generate + PNG download + `/t/[qr_token]` preview
      already implemented (`TableManager.tsx`) — verified, no change needed.
- [~] Postgres RPC `provision_restaurant` (true txn atomicity) — **deferred as
      optional hardening**; kept the codebase's existing JS-rollback pattern for
      consistency. No migration needed for Phase 1.

Verification: full `tsc --noEmit` = 0 errors; `/signup`, `/onboarding/create`,
`/admin/dashboard`, `/` all compile and serve. End-to-end provisioning not yet
run against a live DB (signup gated by Turnstile; onboarding needs a logged-in
user) — recommend a Supabase-branch test before production.

## Phase 2 — Takeout completion (unify into orders)  ✅ DONE

App-layer cutover COMPLETE (adapter strategy via `src/lib/takeout.ts`):
- [x] `createTakeoutOrder` → `place_takeout_order` RPC (KOT + inventory + promo +
      tax + loyalty). Verified live (rollback-wrapped): 2×99 → tax 25.74 →
      total 223.74, order_type=takeout, 1 order_item, nothing persisted.
- [x] `api/takeout/actions.ts` + `admin/takeout/actions.ts` read/update/complete
      operate on `orders` (order_type='takeout'); status maps via adapter.
- [x] `TakeoutForm` uses `orderId`; customer order page + `TakeoutOrderTracker`
      read from `orders` and subscribe realtime to `orders` (status remapped).
- [x] Kitchen `TakeoutQueue`, waiter `WaiterTakeoutFeed`, admin `TakeoutDashboard`,
      and super-admin takeout list all fed from `orders(takeout)` via adapter;
      realtime re-pointed to `orders` (filtered to order_type='takeout').
- [x] `order_type='dine_in'` filter added to kitchen + waiter dine-in queries and
      OrderQueue realtime guard, so takeout doesn't double-display.
- [x] tsc: 0 errors project-wide. Routes /kitchen /waiter /admin/takeout compile.
- [ ] FOLLOW-UP: `takeout_orders` table is now legacy (read by nothing). Keep
      read-only for one release, then drop in a later migration.

### (historical) original in-progress notes

DB foundation DONE & applied to live DB (migration `20260622180000_unify_takeout`):
- [x] `orders.order_type` enum ('dine_in'|'takeout'), `session_id` now nullable,
      `customer_name/phone/email`, `pickup_time`, `legacy_takeout_id` columns.
- [x] `orders_session_per_type_chk` CHECK (dine_in⇒session, takeout⇒no session).
- [x] `place_takeout_order(...)` RPC mirroring place_order (KOT + ingredient
      deduction + promo + tax + loyalty), no session.
- [x] Backfill of existing takeout_orders → orders/order_items (idempotent via
      legacy_takeout_id). Verified live: 1 legacy order → 1 order + 1 item.
- [x] Decision: takeout terminal 'picked up' maps to order_status 'delivered'
      (no enum change). Dry-run validated on main DB (BEGIN/ROLLBACK) before apply.

Remaining app-layer (mechanical; use an adapter to minimize component churn):
- [ ] `src/lib/takeout.ts` — order_status⇄takeout_status maps + `mapOrderRowToTakeout()`.
- [ ] `api/takeout/actions.ts` + `admin/takeout/actions.ts`: createTakeoutOrder →
      `place_takeout_order` RPC; get/update/complete operate on `orders`
      (order_type='takeout'), returning the TakeoutOrder shape via the adapter.
- [ ] `TakeoutForm` → use `result.orderId`; customer order page + `TakeoutOrderTracker`
      read from `orders` and subscribe realtime to `orders` (remap payload).
- [ ] Re-point staff page queries + realtime (kitchen `TakeoutQueue`, waiter
      `WaiterTakeoutFeed`, admin `TakeoutDashboard`) from `takeout_orders` →
      `orders(takeout)`. Add `order_type='dine_in'` to the main kitchen OrderQueue
      query so takeout doesn't appear twice. Must land as ONE change (else the
      takeout UI half-breaks: new orders go to `orders` while staff read stale
      `takeout_orders`).
- [ ] After cutover: keep `takeout_orders` read-only for a release, then drop.

### (Superseded) original migration checklist
- [x] Migration `0xx_unify_takeout.sql`:
      - `orders.order_type` enum `('dine_in','takeout')` default `dine_in`
      - make `orders.session_id` nullable
      - add `customer_name`, `customer_phone`, `customer_email`, `pickup_time`
      - backfill `takeout_orders` → `orders` + `order_items`, then deprecate
      - ⚠️ update stale CHECK constraints + confirm trigger `search_path`
        (see memory: db-search-path-and-enum-gotchas)
- [ ] Extend `place_order` RPC (or add `place_takeout_order`): accepts
      `p_order_type`, `p_customer_*`, `p_pickup_time`, no session — reuses item
      insertion, pricing, tax, ingredient deduction, loyalty, SMS.
- [ ] Standardize lifecycle:
      `pending → confirmed → preparing → ready → completed/picked_up (+cancelled)`;
      fix kitchen query + `updateTakeoutStatus` to match.
- [ ] Merge takeout into kitchen `OrderQueue` with a "Takeout" badge
      (retire separate `TakeoutQueue`).
- [ ] Link `/takeout/[slug]` from menu/marketing; gate by `takeoutEnabled`;
      route payment through existing Nepal-pay/payment-proof path.

## Phase 3 — Customer "request to open session" (waiter-approved)  ✅ DONE
- [x] On `/t/[token]` with no active session: "Ring for Service" →
      `requestSessionOpen()` creates `service_request` type `open_session`
      (already built; migration 20260618 added the enum value).
- [x] Waiter `ServiceRequestFeed`: Approve → `openSessionFromRequest()` opens the
      session and completes the request (already built).
- [x] Customer page polls every 3s (`/api/session/active`) → unlocks ordering
      within ~3s of the waiter opening the session (already built).
- [x] Per-restaurant toggle `selfOrderRequestEnabled` (default on): added to the
      features_v2 type, gated in TablePageClient (hides Ring button when off,
      shows "waiting for waiter"), passed from the table page, and exposed as a
      toggle in admin Settings. tsc: 0 errors; /t/[token] compiles.

## Phase 4 — Security & consistency  ✅ DONE
- [x] Added `/cashier` to middleware `ROUTE_RULES`
      (`allowedRoles: ['waiter','manager','super_admin']`).
- [x] Replaced `getCurrentUser()` with `requireRole('waiter','manager','super_admin')`
      in `cashier/page.tsx` + `cashier/layout.tsx`. Cashier is a function of
      waiter/manager (not a distinct role) — no ROLE_LANDING entry needed.
- [x] Feature-flag defaults already deduped into `src/lib/tiers.ts` (Phase 1).
- [x] Verified `getCurrentUser()` redirects no-restaurant users to `/onboarding`
      (not in ROUTE_RULES → no loop). tsc 0 errors; `/cashier` now 307s when
      unauthenticated.

## Cross-cutting
- [ ] Confirm live schema via Supabase `list_tables` before Phase 2 migration.
- [ ] Run migrations on a Supabase branch first; verify with `get_advisors`.
- [ ] Extend Playwright flows (`golden-path.spec.ts`, `takeout.spec.ts`) for the
      full journey; add a test-mode bypass for the login Turnstile CAPTCHA.
- [ ] Suggested order: Phase 1 → 2 → 3 → 4.

## Notes / assumptions
- Order columns assumed from action code; confirm against live schema before
  writing the Phase 2 migration.
- Signup → sign-in → dashboard is already correctly wired
  (`SignupForm.tsx:284`); JWT/role gating has a sane DB fallback.
