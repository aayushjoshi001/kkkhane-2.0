-- Lets an admin set a manual estimated ingredient cost per unit for a menu item
-- that has no recipe configured, so COGS/gross-profit reporting isn't stuck at
-- zero for items a restaurant doesn't want to track stock for (e.g. food items
-- at a hotel that only wants automatic deduction on beverages).
ALTER TABLE "public"."menu_items" ADD COLUMN IF NOT EXISTS "estimated_cost_price" numeric(10,2);
ALTER TABLE "public"."menu_items" DROP CONSTRAINT IF EXISTS "menu_items_estimated_cost_price_check";
ALTER TABLE "public"."menu_items" ADD CONSTRAINT "menu_items_estimated_cost_price_check" CHECK ("estimated_cost_price" IS NULL OR "estimated_cost_price" >= 0);
