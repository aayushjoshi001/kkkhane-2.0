-- Feature 05: order-time pairing recommendations ("pairs well with").
-- Stores a precomputed, ranked "frequently ordered together" table per menu item,
-- refreshed nightly by refresh_menu_item_pairings() so the customer menu and cart
-- can render suggestions with a plain lookup — no live aggregation on request path.

CREATE TABLE IF NOT EXISTS public.menu_item_pairings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    paired_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    co_order_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_menu_item_pairing UNIQUE (restaurant_id, item_id, paired_item_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_pairings_lookup
    ON public.menu_item_pairings (restaurant_id, item_id, co_order_count DESC);

ALTER TABLE public.menu_item_pairings ENABLE ROW LEVEL SECURITY;

-- Read-only for everyone, same as combo_items/menu_items — this only ever
-- powers menu recommendations, never anything sensitive. Writes happen
-- exclusively through refresh_menu_item_pairings() (SECURITY DEFINER) or the
-- service-role cron client, so no write policy is needed.
CREATE POLICY "public_read_menu_item_pairings" ON public.menu_item_pairings
    FOR SELECT USING (true);

-- Recomputes co-occurrence pairings from order history. Pass a restaurant_id to
-- refresh just that tenant (used after a backfill or on demand); pass NULL
-- (default) to refresh every restaurant, which is what the nightly cron does.
CREATE OR REPLACE FUNCTION public.refresh_menu_item_pairings(p_restaurant_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    DELETE FROM menu_item_pairings
    WHERE p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id;

    INSERT INTO menu_item_pairings (restaurant_id, item_id, paired_item_id, co_order_count)
    SELECT restaurant_id, item_id, paired_item_id, co_order_count
    FROM (
        SELECT
            o.restaurant_id,
            a.menu_item_id AS item_id,
            b.menu_item_id AS paired_item_id,
            count(*) AS co_order_count,
            row_number() OVER (
                PARTITION BY o.restaurant_id, a.menu_item_id
                ORDER BY count(*) DESC
            ) AS rn
        FROM order_items a
        JOIN order_items b
            ON a.order_id = b.order_id
            AND a.menu_item_id <> b.menu_item_id
        JOIN orders o
            ON o.id = a.order_id
        WHERE o.status <> 'cancelled'
            AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
        GROUP BY o.restaurant_id, a.menu_item_id, b.menu_item_id
        -- Require at least 2 co-orders so a single one-off order can't seed a
        -- "recommendation" — this is signal, not a cold-start guess.
        HAVING count(*) >= 2
    ) ranked
    WHERE rn <= 5;
END;
$$;
