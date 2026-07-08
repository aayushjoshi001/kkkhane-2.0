-- 20260707120000_missing_foreign_key_indexes.sql
-- Based on schema analysis for unindexed foreign keys which cause slow JOINs and cascading deletes.

-- Core / Structural
CREATE INDEX IF NOT EXISTS idx_users_restaurant_id ON public.users (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_users_department_id ON public.users (department_id);
CREATE INDEX IF NOT EXISTS idx_departments_restaurant_id ON public.departments (restaurant_id);

-- Menu & Modifiers
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant_id ON public.menu_categories (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON public.menu_items (category_id);
CREATE INDEX IF NOT EXISTS idx_modifier_groups_menu_item_id ON public.modifier_groups (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_modifiers_group_id ON public.modifiers (group_id);

-- Session & Seats
CREATE INDEX IF NOT EXISTS idx_sessions_table_id ON public.sessions (table_id);
CREATE INDEX IF NOT EXISTS idx_session_seats_session_id ON public.session_seats (session_id);

-- Orders & Order Items
CREATE INDEX IF NOT EXISTS idx_orders_promo_code_id ON public.orders (promo_code_id);
CREATE INDEX IF NOT EXISTS idx_orders_loyalty_member_id ON public.orders (loyalty_member_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_staff_id ON public.orders (delivery_staff_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id ON public.order_items (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_order_item_id ON public.order_item_modifiers (order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_modifier_id ON public.order_item_modifiers (modifier_id);

-- Tables
CREATE INDEX IF NOT EXISTS idx_tables_cleaning_claimed_by ON public.tables (cleaning_claimed_by);

-- Billing & Splits
CREATE INDEX IF NOT EXISTS idx_bill_splits_session_id ON public.bill_splits (session_id);
CREATE INDEX IF NOT EXISTS idx_split_payments_bill_split_id ON public.split_payments (bill_split_id);
CREATE INDEX IF NOT EXISTS idx_split_payments_seat_id ON public.split_payments (seat_id);

-- Payment Verifications
CREATE INDEX IF NOT EXISTS idx_payment_verifications_session_id ON public.payment_verifications (session_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_table_id ON public.payment_verifications (table_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_order_id ON public.payment_verifications (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_takeout_order_id ON public.payment_verifications (takeout_order_id);

-- Ingredients & Recipes
CREATE INDEX IF NOT EXISTS idx_ingredients_restaurant_id ON public.ingredients (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_menu_item_id ON public.recipe_ingredients (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_ingredient_id ON public.recipe_ingredients (ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_movements_ingredient_id ON public.ingredient_movements (ingredient_id);

-- Loyalty & Promos
CREATE INDEX IF NOT EXISTS idx_loyalty_members_restaurant_id ON public.loyalty_members (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_member_id ON public.loyalty_points (member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_order_id ON public.loyalty_points (order_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_restaurant_id ON public.promo_codes (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_restaurant_id ON public.pricing_rules (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_applies_to_item_id ON public.pricing_rules (applies_to_item_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_applies_to_category_id ON public.pricing_rules (applies_to_category_id);

-- Staff Shifts
CREATE INDEX IF NOT EXISTS idx_staff_shifts_user_id ON public.staff_shifts (user_id);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_restaurant_id ON public.staff_shifts (restaurant_id);

-- Audit & Metrics
CREATE INDEX IF NOT EXISTS idx_audit_logs_restaurant_id ON public.audit_logs (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_system_metrics_restaurant_id ON public.system_metrics (restaurant_id);

-- Invitations
CREATE INDEX IF NOT EXISTS idx_invitations_role_id ON public.invitations (role_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON public.invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_invitations_department_id ON public.invitations (department_id);

-- Pairings (from recent schema)
CREATE INDEX IF NOT EXISTS idx_menu_item_pairings_restaurant_id ON public.menu_item_pairings (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_pairings_item_id ON public.menu_item_pairings (item_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_pairings_paired_item_id ON public.menu_item_pairings (paired_item_id);
