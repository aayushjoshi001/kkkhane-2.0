-- Lets a category be a subcategory of another (e.g. "Grocery" as the main
-- category, with "Vegetables" / "Fruits" / "Dairy & Eggs" as its children) —
-- one level deep, self-referencing on the same shared expense_categories
-- table used by Expenses, Suppliers, and Ingredients/Stock.
ALTER TABLE "public"."expense_categories"
    ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "public"."expense_categories"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_categories_parent_id ON "public"."expense_categories"("parent_id");

NOTIFY pgrst, 'reload schema';
