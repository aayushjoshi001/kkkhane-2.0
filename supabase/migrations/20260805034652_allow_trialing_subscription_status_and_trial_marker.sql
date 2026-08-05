-- Let a subscription say it is on trial.
--
-- restaurants.subscription_status has always been constrained to
-- active/past_due/suspended/cancelled. A 14-day full-access trial needs to be
-- distinguishable from a paid 'active' subscription for exactly one reason: the
-- nightly auto-suspend job treats an expired subscription as a billing failure
-- and suspends the tenant outright. A trial running out is not a billing
-- failure — the tenant never owed anything — so it must downgrade to free
-- instead, and the job can only tell the two apart if the status says so.
--
-- Widening a CHECK constraint cannot invalidate an existing row (every current
-- value stays legal), so this needs no backfill and no NOT VALID dance.
alter table public.restaurants
    drop constraint if exists restaurants_subscription_status_check;

alter table public.restaurants
    add constraint restaurants_subscription_status_check
    check (subscription_status = any (array[
        'active'::text,
        'trialing'::text,
        'past_due'::text,
        'suspended'::text,
        'cancelled'::text
    ]));

comment on column public.restaurants.subscription_status is
    'active = paying (or a manually-billed enterprise). trialing = inside the 14-day full-access trial; subscription_expires_at is when it ends, and lapsing downgrades to free rather than suspending. past_due/suspended/cancelled are billing states.';

-- When this tenant's trial ends, kept after it has ended.
--
-- subscription_expires_at cannot answer this on its own: the downgrade clears
-- it (a Free plan does not expire), so the moment the trial ends the only
-- record that there ever was one is gone. That leaves the app unable to tell a
-- tenant whose trial just ran out from one that signed up on Free years ago —
-- and those two need to be told very different things.
--
-- Written once at provisioning and never cleared, so it doubles as the answer
-- to "did this tenant ever have a trial". NULL means no: every tenant that
-- predates this, plus demo tenants and anything a super admin created by hand.
alter table public.restaurants
    add column if not exists trial_ends_at timestamptz;

comment on column public.restaurants.trial_ends_at is
    'When the 14-day signup trial ends (or ended). Set once at provisioning and never cleared, so it survives the downgrade that clears subscription_expires_at. NULL = this tenant never had a trial.';
