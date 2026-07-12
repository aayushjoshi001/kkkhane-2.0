-- Pre-launch security audit fixes (P0 items 1-3):
--
-- 1. Drop the 3 public RLS policies that let anyone read every active guest
--    session (including its bearer session_token), order, and service request
--    across every restaurant on the platform, with no authentication at all.
--    The secure replacement (/api/session/active) already exists and uses the
--    admin client + its own qr_token gate, so it does not depend on these
--    policies and continues to work unaffected. Legitimate customer access to
--    orders/requests continues via the already-correct, token-scoped
--    customer_read_own_orders / customer_read_own_requests policies.
--
-- 2. Tighten the menu_item_variations write policy so any authenticated user
--    can no longer edit or delete another restaurant's menu prices — it now
--    requires manager/super_admin AND ownership of the parent menu_item,
--    matching the existing manager_write_menu_items / manager_manage_recipes
--    pattern used for every other menu-management table.
--
-- 3. Add a CHECK constraint so order_items.unit_price can never be negative,
--    as a database-level backstop independent of the application code.

DROP POLICY IF EXISTS "public_read_active_sessions" ON "public"."sessions";
DROP POLICY IF EXISTS "public_read_active_session_orders" ON "public"."orders";
DROP POLICY IF EXISTS "public_read_active_session_requests" ON "public"."service_requests";

DROP POLICY IF EXISTS "Allow authenticated users to manage variations" ON "public"."menu_item_variations";

CREATE POLICY "manager_write_variations" ON "public"."menu_item_variations"
    USING (
        ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"]))
        AND ("menu_item_id" IN (
            SELECT "menu_items"."id" FROM "public"."menu_items"
            WHERE ("menu_items"."restaurant_id" = "public"."current_restaurant_id"())
        ))
    );

ALTER TABLE "public"."order_items"
    ADD CONSTRAINT "order_items_unit_price_check" CHECK ("unit_price" >= 0);
