-- Bar Order Tickets (BOT): route each dish to the station that makes it.
--
-- Until now every order line went to the kitchen. A bar item (a cocktail, a
-- coffee) was cooked-and-plated on the same screen and printed on the same
-- KOT as the food. This splits the queue in two.
--
-- Routing resolves item -> category -> 'kitchen':
--   menu_categories.station  the default for everything in the category
--   menu_items.station       nullable override for the odd item out
--   order_items.station      RESOLVED AND FROZEN at insert time
--
-- order_items.station is stamped by a trigger rather than by the callers.
-- Five functions insert order lines (place_order has three overloads, plus
-- place_takeout_order and place_delivery_order) and two more do it from JS —
-- a trigger is the only place that catches all seven. Freezing the value also
-- means re-tagging a category tomorrow never rewrites yesterday's tickets.

CREATE TYPE public.station_kind AS ENUM ('kitchen', 'bar');

ALTER TABLE public.menu_categories
    ADD COLUMN IF NOT EXISTS station public.station_kind NOT NULL DEFAULT 'kitchen';

-- Nullable on purpose: NULL means "inherit the category", which is different
-- from an explicit 'kitchen' on a drink in the Beverages category.
ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS station public.station_kind;

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS station public.station_kind;

COMMENT ON COLUMN public.menu_categories.station IS
    'Default station for items in this category.';
COMMENT ON COLUMN public.menu_items.station IS
    'Overrides the category station. NULL = inherit.';
COMMENT ON COLUMN public.order_items.station IS
    'Station resolved at insert time and frozen. Never recomputed from the menu.';

CREATE OR REPLACE FUNCTION public.stamp_order_item_station()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.station IS NULL THEN
        SELECT COALESCE(mi.station, mc.station)
          INTO NEW.station
          FROM public.menu_items mi
          LEFT JOIN public.menu_categories mc ON mc.id = mi.category_id
         WHERE mi.id = NEW.menu_item_id;
    END IF;

    -- A deleted menu item, or one with no category, still has to land somewhere.
    NEW.station := COALESCE(NEW.station, 'kitchen');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_order_item_station ON public.order_items;
CREATE TRIGGER stamp_order_item_station
    BEFORE INSERT ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.stamp_order_item_station();

-- Existing lines predate the split, so they resolve to whatever their menu item
-- says today — which is 'kitchen' for every row, since the columns above just
-- defaulted that way. Written generally so a re-run after tagging still works.
UPDATE public.order_items oi
   SET station = COALESCE(mi.station, mc.station, 'kitchen')
  FROM public.menu_items mi
  LEFT JOIN public.menu_categories mc ON mc.id = mi.category_id
 WHERE mi.id = oi.menu_item_id
   AND oi.station IS NULL;

-- Orphaned lines (menu item hard-deleted) never matched the join above.
UPDATE public.order_items SET station = 'kitchen' WHERE station IS NULL;

ALTER TABLE public.order_items ALTER COLUMN station SET NOT NULL;

-- The bar queue asks "which open orders have bar lines". Bar items are the
-- minority of rows, so a partial index stays small and is the one that is read
-- on every /bar poll and realtime refetch.
CREATE INDEX IF NOT EXISTS order_items_bar_station_idx
    ON public.order_items (order_id)
    WHERE station = 'bar';

-- Bartenders work the BOT queue. Reference data, so it ships with the schema
-- rather than with the seed — production has no seed run.
--
-- Insert by NAME with a derived id (mirrors how 'cashier' and the finance roles
-- were added), NOT a hardcoded id 7: on production id 7 already belongs to
-- finance_manager (cashier=6, then finance_manager/accountant/receptionist were
-- added via MAX(id)+1), so `ON CONFLICT (id) DO UPDATE` would silently rename
-- that row and turn every finance manager into a bartender. Guarding on name
-- leaves any existing role untouched and simply skips if 'bartender' exists.
INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'bartender',
       'Views and updates drink preparation status at the bar'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'bartender');
