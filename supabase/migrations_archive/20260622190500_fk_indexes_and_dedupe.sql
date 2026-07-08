-- PERFORMANCE: add covering indexes for foreign keys that lacked them
-- (slow joins / slow cascading deletes), and drop a duplicate unique index.

CREATE INDEX IF NOT EXISTS idx_combo_items_item_id            ON public.combo_items (item_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_auth_user_id   ON public.loyalty_members (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_variations_menu_item ON public.menu_item_variations (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_staff    ON public.payment_verifications (staff_verified_by);
CREATE INDEX IF NOT EXISTS idx_restaurants_owner_id           ON public.restaurants (owner_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_table_id      ON public.service_requests (table_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_recorded ON public.subscription_payments (recorded_by);
CREATE INDEX IF NOT EXISTS idx_users_role_id                  ON public.users (role_id);

-- staff_shifts had two identical UNIQUE partial indexes on (user_id) WHERE
-- clock_out IS NULL. Keep staff_shifts_one_open_per_user (the named invariant),
-- drop the redundant one.
DROP INDEX IF EXISTS public.idx_staff_shifts_active;
