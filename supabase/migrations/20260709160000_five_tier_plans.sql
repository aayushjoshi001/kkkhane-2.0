-- Move from the 4 internal tiers (free/basic/pro/enterprise) to the 5 published
-- plans (free/basic/premium/platinum/enterprise). 'pro' becomes 'premium'.
--
-- Ordering matters: restaurants_subscription_tier_check must accept 'premium'
-- before any row can be rewritten to it, so we drop the constraint, backfill,
-- then re-add it. Doing it the other way round fails on the first UPDATE.

ALTER TABLE public.restaurants
    DROP CONSTRAINT IF EXISTS restaurants_subscription_tier_check;

UPDATE public.restaurants
SET subscription_tier = 'premium'
WHERE subscription_tier = 'pro';

ALTER TABLE public.restaurants
    ADD CONSTRAINT restaurants_subscription_tier_check
    CHECK (subscription_tier = ANY (ARRAY['free', 'basic', 'premium', 'platinum', 'enterprise']));

-- Per-tier caps, mirroring TIER_LIMITS in src/lib/tiers.ts. 2147483647 is int4's
-- ceiling and is what "unlimited" means in both places.
--
-- The new Basic cap (5 staff / 20 tables) is tighter than the old one (10 / 30),
-- and Premium's (24 / 50) is tighter than the Pro it replaces (50 / 100). We
-- never lower a restaurant below what it is already using: an existing customer
-- keeps the capacity they have and simply cannot add more. GREATEST() does that.
WITH tier_limits(tier, max_staff, max_menu_items, max_tables) AS (
    VALUES ('free',       3,          100,        10),
           ('basic',      5,          500,        20),
           ('premium',    24,         1000,       50),
           ('platinum',   2147483647, 2147483647, 2147483647),
           ('enterprise', 2147483647, 2147483647, 2147483647)
)
UPDATE public.restaurants r
SET max_staff      = GREATEST(t.max_staff,
                              (SELECT count(*) FROM public.users      u WHERE u.restaurant_id = r.id)),
    max_menu_items = GREATEST(t.max_menu_items,
                              (SELECT count(*) FROM public.menu_items m WHERE m.restaurant_id = r.id)),
    max_tables     = GREATEST(t.max_tables,
                              (SELECT count(*) FROM public.tables     tb WHERE tb.restaurant_id = r.id))
FROM tier_limits t
WHERE r.subscription_tier = t.tier;

-- subscription_plans was never seeded, so check_plan_limit() has always taken its
-- "no plan restrictions" early-return. Seeding it makes the DB agree with
-- TIER_LIMITS. Nothing calls check_plan_limit() yet, so this changes no behavior
-- today; it stops the RPC from silently allowing everything once something does.
--
-- Display prices live in src/lib/pricing.ts. price_yearly here is the annual list
-- price (before any first-year discount) and exists so the row is not misleading.
INSERT INTO public.subscription_plans
    (id, name, price_monthly, price_yearly, currency, max_menu_items, max_staff, max_tables, is_active)
VALUES
    ('free',       'Free',       0, 0,     'NPR', 100,        3,          10,         true),
    ('basic',      'Basic',      0, 9999,  'NPR', 500,        5,          20,         true),
    ('premium',    'Premium',    0, 30000, 'NPR', 1000,       24,         50,         true),
    ('platinum',   'Platinum',   0, 55000, 'NPR', 2147483647, 2147483647, 2147483647, true),
    ('enterprise', 'Enterprise', 0, 0,     'NPR', 2147483647, 2147483647, 2147483647, true)
ON CONFLICT (id) DO UPDATE SET
    name           = EXCLUDED.name,
    price_yearly   = EXCLUDED.price_yearly,
    currency       = EXCLUDED.currency,
    max_menu_items = EXCLUDED.max_menu_items,
    max_staff      = EXCLUDED.max_staff,
    max_tables     = EXCLUDED.max_tables,
    is_active      = EXCLUDED.is_active;

DELETE FROM public.subscription_plans
WHERE id NOT IN ('free', 'basic', 'premium', 'platinum', 'enterprise');
