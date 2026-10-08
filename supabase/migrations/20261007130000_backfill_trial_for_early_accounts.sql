-- Backfill the 14-day full-access trial for any restaurant that:
--   • is on the free tier (never upgraded or started a trial before)
--   • is active (not suspended, not already trialing)
--   • was created fewer than 14 days ago — so they are within the window
--     a self-serve sign-up would have entitled them to anyway
--   • has no trial marker yet (trial_ends_at IS NULL)
--
-- subscription_expires_at is computed from created_at, not NOW(), so a tenant
-- who signed up 10 days ago gets 4 days left rather than a fresh 14. This
-- matches the intent: the trial started when they joined, not when this job ran.
--
-- TIER_LIMITS for 'platinum' use INT4_MAX (2_147_483_647) for every cap,
-- which is what provisionRestaurant writes for TRIAL_TIER. Raising them here
-- ensures check_plan_limit() does not block trialing tenants who were seeded
-- with the tight free caps.
--
-- settings.features_v2 is NOT updated here. getRestaurantFeatures() already
-- calls isTrialing() at read time and forces every entitlement and module on
-- while the trial is live — so the stored flags do not matter until the cron
-- writes them back down on expiry (which uses applyTierEntitlements correctly
-- with previousTier = 'platinum', revoking only what platinum had granted).

UPDATE restaurants
SET
    subscription_tier       = 'platinum',
    subscription_status     = 'trialing',
    subscription_expires_at = created_at + INTERVAL '14 days',
    trial_ends_at           = created_at + INTERVAL '14 days',
    max_staff               = 2147483647,
    max_menu_items          = 2147483647,
    max_tables              = 2147483647
WHERE
    subscription_tier   = 'free'
    AND subscription_status = 'active'
    AND trial_ends_at IS NULL
    AND created_at > NOW() - INTERVAL '14 days';
