-- The "Add on Stock Item" restock flow now defaults an item's Category to
-- "Others" instead of leaving it blank when the item has none. Backfill the
-- same default onto ingredients that were already sitting uncategorized
-- before this change, so they aren't stuck without one just because they
-- predate it. Per-restaurant: creates that tenant's own "Others" stock
-- category first if it doesn't already have one, then assigns it.

INSERT INTO "public"."expense_categories" (restaurant_id, name, is_stock_category)
SELECT DISTINCT i.restaurant_id, 'Others', true
FROM "public"."ingredients" i
WHERE i.category_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "public"."expense_categories" ec
      WHERE ec.restaurant_id = i.restaurant_id
        AND ec.is_stock_category = true
        AND lower(trim(ec.name)) = 'others'
  );

UPDATE "public"."ingredients" i
SET category_id = ec.id
FROM "public"."expense_categories" ec
WHERE i.category_id IS NULL
  AND ec.restaurant_id = i.restaurant_id
  AND ec.is_stock_category = true
  AND lower(trim(ec.name)) = 'others';
