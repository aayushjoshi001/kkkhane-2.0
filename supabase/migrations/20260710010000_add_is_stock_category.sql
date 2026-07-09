-- expense_categories is shared across Expenses, Suppliers, and Ingredients
-- (Stock). Without a way to tell "this category is relevant to stock" apart
-- from general-purpose expense categories (Electricity, Rent, etc.), the
-- Stock module's category picker showed every expense category in the
-- restaurant, most of which will never have a stock item or supplier.
ALTER TABLE "public"."expense_categories" ADD COLUMN IF NOT EXISTS "is_stock_category" boolean DEFAULT false NOT NULL;

-- Backfill: any category already referenced by an ingredient or supplier is
-- clearly a stock-relevant category, so keep it visible after this change.
UPDATE "public"."expense_categories" ec
SET "is_stock_category" = true
WHERE EXISTS (SELECT 1 FROM "public"."ingredients" i WHERE i.category_id = ec.id)
   OR EXISTS (SELECT 1 FROM "public"."suppliers" s WHERE s.category_id = ec.id);

NOTIFY pgrst, 'reload schema';
