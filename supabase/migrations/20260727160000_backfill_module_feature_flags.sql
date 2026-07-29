-- Write the module flags that provisioning never wrote.
--
-- features_v2 is built from TIER_FEATURES (src/lib/tiers.ts), which had no
-- entry for staffManagementEnabled, tableManagementEnabled or financeEnabled.
-- So those keys were *absent* rather than set, on every restaurant ever
-- created. The server read an absent key as "off" and redirected away from the
-- page, while the client read the same absent key as "on" and rendered a nav
-- link to it — a link straight to a redirect. Upgrading the plan did not help,
-- because changing the subscription tier only ever wrote the seat/table caps.
--
-- The application now resolves an absent flag from the plan, so this backfill
-- is not strictly required for the app to behave. It is here so the stored row
-- says what is actually true: anything reading settings directly, a support
-- engineer looking at the table, or a future code path that forgets to call the
-- resolver, all see the same answer the app does.
--
-- Mirrors applyTierModuleDefaults() exactly:
--   * staff/table management are core — default on where absent
--   * accounting is opt-in — default off where absent, and revoked outright
--     below Premium, which preserves the old downgrade protection
--   * an explicitly stored value is never overwritten while the plan allows it
UPDATE public.settings s
SET features_v2 = s.features_v2 || jsonb_build_object(
        'staffManagementEnabled',
            COALESCE((s.features_v2 ->> 'staffManagementEnabled')::boolean, true),
        'tableManagementEnabled',
            COALESCE((s.features_v2 ->> 'tableManagementEnabled')::boolean, true),
        'financeEnabled',
            CASE
                WHEN r.subscription_tier IN ('premium', 'platinum', 'enterprise')
                    THEN COALESCE((s.features_v2 ->> 'financeEnabled')::boolean, false)
                ELSE false
            END
    )
FROM public.restaurants r
WHERE r.id = s.restaurant_id
  AND s.features_v2 IS NOT NULL
  AND (
        NOT (s.features_v2 ? 'staffManagementEnabled')
     OR NOT (s.features_v2 ? 'tableManagementEnabled')
     OR NOT (s.features_v2 ? 'financeEnabled')
     -- Also correct a stored finance flag the plan no longer entitles.
     OR (    (s.features_v2 ->> 'financeEnabled')::boolean IS TRUE
         AND r.subscription_tier NOT IN ('premium', 'platinum', 'enterprise'))
  );
