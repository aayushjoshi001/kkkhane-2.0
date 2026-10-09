# KKKhane — Authentication & Onboarding Flow

How an account gets created, how someone logs in, and how the app keeps a
logged-in session's permissions in sync with what's actually in the database.

This is a living description of the *current* code, not a plan — see
`docs/FLOW_INTEGRATION_PLAN.md` for the history of how it got here.

## The people who show up in this doc

| Role | `role_id` | Gets here via |
|---|---|---|
| Restaurant owner / manager | 2 | `/signup` (self-service) |
| Staff (kitchen/waiter/cashier) | 3/4/6 | Manager's email invitation from the Staff page |
| Super admin (platform staff) | 1 | Created by another super admin via `/admin/super-admin` |
| Anonymous diner scanning a table QR | — | No account at all — session/cookie based, unrelated to this doc |

There used to be a second, QR-based "scan to join" path for adding staff
(a new hire would sign up on their own device, show a QR code, and an admin
would scan it to attach them). It was removed. Staff now join only through an
expiring email invitation created by their manager.

---

## 1. Creating an account — `/signup`

[`src/app/signup/SignupForm.tsx`](../src/app/signup/SignupForm.tsx) collects
the owner's name, email and password. Business details are collected later in
onboarding, after the email identity is verified.

Submit → [`registerUserAction()`](../src/app/signup/actions.ts):
1. Rate-limited (3/hour/IP) and protected by Turnstile when configured.
2. Validates the name, email and password.
3. `supabase.auth.admin.generateLink({ type: 'signup' })` creates an
   unconfirmed Auth account and an OTP whose length follows the Supabase project setting. The transactional email
   provider sends that code; the browser cannot continue until
   `verifyOtp({ type: 'signup' })` succeeds.
4. If email delivery fails, the unconfirmed Auth user is deleted so the person
   can retry once delivery is configured.
5. After verification, the new account is signed in and sent to onboarding,
   which calls the **one shared provisioning function**,
   [`provisionRestaurant()`](../src/lib/provisioning.ts): creates the
   `restaurants` row, upserts the owner's `users` row (`role_id: 2`,
   manager), inserts default `settings`, and seeds a starter menu + 6 tables
   (each with a QR token — that's the *customer table-ordering* QR, unrelated
   to the removed staff-invite QR) so the restaurant isn't empty on day one.
6. Google OAuth signup skips the code because Google already verified the
   address, but follows the same onboarding path.

**`provisionRestaurant()` is also the same function used by**
`/onboarding/create` (§2) and super-admin tenant creation
(`createTenantWithOwner` in `src/app/(admin)/admin/super-admin/actions.ts`) —
there is deliberately only one place that knows how to build a restaurant
from scratch, so every creation path gets starter tables/menu and consistent
tier defaults.

### Adding staff (admin-driven, no self-service signup)

There's no public signup or direct manager-chosen password for staff. Under
**Staff → Invite Staff**, a manager enters the person's name, email and role.
[`createInvitationAction()`](../src/app/(admin)/admin/staff/invite-actions.ts)
stores only a hash of an expiring token and emails the plaintext link.

The recipient opens `/invite/[token]`, where the manager-provided name and
email are read-only. They add a phone number and choose their own password,
then select **Join Team**. Acceptance re-checks the restaurant's seat limit,
creates the Auth user, writes the tenant-scoped `public.users` row with the
manager-selected role, consumes the invitation, signs the staff member in and
redirects them to that role's landing page.

---

## 2. Logging in — `/login`

[`src/app/login/LoginForm.tsx`](../src/app/login/LoginForm.tsx) is a plain
email/password form (with a phone-number UI toggle that's cosmetic — it
still submits as `email`). It links out to `/signup` for people without an
account yet.

Submit → [`loginAction()`](../src/app/login/actions.ts):
1. Rate-limited (5/15min/IP).
2. `supabase.auth.signInWithPassword()`.
3. If middleware bounced the user here from a specific protected page
   (`?redirect=/kitchen`), send them back there.
4. Otherwise, resolve their landing page via `getCurrentUser()` (§4) and the
   shared [`ROLE_LANDING`](../src/lib/roleLanding.ts) map — which also
   transparently redirects to `/onboarding` (no restaurant) or `/suspended`
   (restaurant past due) when appropriate, instead of re-deriving that logic
   here by hand.

---

## 3. The onboarding hub — `/onboarding`

Reachable only by an authenticated user with **no restaurant yet**
(`getOptionalUser().restaurantId` is falsy — anyone else is redirected to
`/admin/dashboard`). In practice this state is rare now that the only
public account-creation path (`/signup`) always creates a restaurant in the
same step — but it's still the correct landing spot if a restaurant is ever
missing (e.g. it was deleted, or an account was created directly in the
Supabase dashboard).

[`OnboardingGetStarted.tsx`](../src/app/(onboarding)/onboarding/OnboardingGetStarted.tsx)
shows a short "you'll set up your restaurant next" screen and continues to
`/onboarding/create`.

[`OnboardingCreateClient.tsx`](../src/app/(onboarding)/onboarding/create/OnboardingCreateClient.tsx)
collects restaurant name, business type, phone, address, and a map pin.
Submit → [`createOnboardingRestaurant()`](../src/app/(onboarding)/onboarding/create/actions.ts)
calls the same `provisionRestaurant()` as `/signup`, with `tier: 'free'`.

On success, the UI shows a "Welcome" modal. Clicking **Continue**:
```ts
await supabase.auth.refreshSession()   // re-mint the JWT with the new restaurant/role
router.refresh()
router.push('/admin/dashboard')
```
This `refreshSession()` call matters — see §4.2 for why.

---

## 4. Session & role resolution — how the app knows who you are

This is the part that caused the most confusion ("why did I get bounced to
the wrong page"), so it's worth being precise.

### 4.1 Where role/restaurant come from

A Postgres function, `custom_access_token_hook` (configured in the Supabase
project's Auth Hooks, defined in `scripts/004_jwt_claims_hook.sql` — not a
tracked migration), runs **every time a JWT is minted** (login, signup
sign-in, or an automatic token refresh). It looks up the signing-in user's
`public.users` row and embeds two custom claims:
- If they have a restaurant: `app_role: "<role name>"`, `restaurant_id: "<uuid>"`.
- If not (or `is_active = false`): `app_role: "unauthenticated"`, `restaurant_id: null`.

Crucially: **these claims are frozen at mint time.** If an admin changes your
role or restaurant *after* your JWT was issued, your browser's copy of the
JWT still has the old claims until it naturally refreshes.

### 4.2 Two ways the app reads "who is this"

- [`getCurrentUser()` / `getOptionalUser()`](../src/lib/auth.ts) (used by
  every server page/action): try the JWT claims first (fast, no DB call). If
  `restaurant_id` is falsy (the `"unauthenticated"` sentinel decodes to a
  falsy `restaurant_id`), they **fall back to a live DB query** — so a
  restaurant-less user's page always sees accurate state even with a stale
  token.
- [`src/proxy.ts`](../src/proxy.ts) (the Next.js middleware-equivalent that
  gates `/admin`, `/kitchen`, `/waiter`, `/cashier`): reads the JWT claims
  **directly**, with no DB fallback (deliberately — middleware should stay
  fast and DB-free). It explicitly treats the `"unauthenticated"` sentinel
  the same as "no role," letting the request through to the page-level check
  instead of bouncing it — this is what prevents a redirect loop that used
  to happen right after onboarding (fixed alongside the `refreshSession()`
  call in §3: without re-minting the token, the claims stay stale and every
  soft-navigation to `/admin/dashboard` would get redirected away and back,
  forever).

### 4.3 Role/status changes to an *already logged-in* session

If an admin promotes, demotes, suspends, or deletes a staff member who is
currently logged in elsewhere, that change needs to reach their open tab
without waiting for their JWT to expire. This is handled by
[`SessionSync`](../src/components/shared/SessionSync.tsx), mounted in every
authenticated layout (`admin`, `kitchen`, `waiter`, `cashier`):

- Subscribes to Supabase Realtime on `public.users`, filtered to
  `id=eq.<this user's id>` (published via migration
  `20260702120000_realtime_users_session_sync.sql`, with `REPLICA IDENTITY
  FULL` so both old and new column values are available in the payload).
- On `UPDATE` where `is_active` flips to `false` → signs the user out.
- On `UPDATE` where `role_id` or `restaurant_id` actually changed →
  `refreshSession()` + `router.refresh()` + send them to `/` (which routes
  them to the correct landing page for their new role).
- On `DELETE` → signs the user out.

This closes the gap within a few seconds instead of up to an hour.

---

## 5. Logging out

One shared helper, [`signOutAndRedirect()`](../src/lib/auth/signOut.ts):
revokes the session server-side (`supabase.auth.signOut()`, default `scope:
'global'`) then sends the browser to `/login` with a fresh render. Used by
every sidebar/layout that has a logout button.

## 6. Password reset

`/forgot-password` asks Supabase Admin Auth to generate a recovery
OTP, then sends that OTP through the configured transactional email provider.
The response always advances to code entry regardless of whether the email
exists, so registered addresses cannot be enumerated. The user enters the OTP
and a new password; the server verifies the one-time `recovery` token, updates
the password, signs out the temporary recovery session, and returns to login.

---

## End-to-end map

```
Anonymous visitor
 ├─ "I'm starting a restaurant" → /signup → provisionRestaurant() → sign in → /admin/dashboard
 └─ Already have an account     → /login  → role-based landing page (or /onboarding, or /suspended)

Manager inviting staff → Staff → "Invite Staff" → email link → phone + password → Join Team
  → account created with the manager-selected role → role-based landing page

Rare: authenticated but no restaurant → /onboarding → /onboarding/create → provisionRestaurant()
      → refreshSession() → /admin/dashboard

Already logged in, admin changes your role/status elsewhere
 → SessionSync (Realtime) → refreshSession() or sign-out within seconds
```
