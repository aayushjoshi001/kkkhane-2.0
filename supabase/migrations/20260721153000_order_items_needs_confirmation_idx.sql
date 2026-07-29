-- Create a partial index on order_items where needs_confirmation is true
-- to optimize query performance for the waiter/cashier order confirmation flow.
CREATE INDEX IF NOT EXISTS "idx_order_items_needs_confirmation" 
    ON "public"."order_items" ("order_id") 
    WHERE ("needs_confirmation" = true);
