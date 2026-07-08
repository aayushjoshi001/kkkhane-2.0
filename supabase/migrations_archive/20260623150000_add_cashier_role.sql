-- Add the `cashier` role.
-- The cashier portal (/cashier) and CashierClient UI already existed, but no
-- `cashier` role was ever defined — so the route was only reachable by waiters.
-- This seeds the role so dedicated cashier staff can be invited and land on
-- /cashier. custom_access_token_hook derives app_role from roles.name, so the
-- JWT claim is wired automatically once this row exists.
INSERT INTO public.roles (id, name, description)
VALUES (6, 'cashier', 'Payment collection and bill settlement at the counter')
ON CONFLICT (name) DO NOTHING;

-- Grant the cashier read access to the rows the cashier portal renders.
-- The CashierClient loads its initial data server-side via the service-role
-- client (bypasses RLS), but its realtime subscription and in-handler refetches
-- run on the browser client as the signed-in cashier — so these SELECT policies
-- must include 'cashier' or live updates silently never arrive.
-- All cashier writes go through server actions on the service-role client, so no
-- write policies are needed here.
ALTER POLICY kitchen_read_orders ON public.orders
USING ((current_app_role() = ANY (ARRAY['kitchen','manager','super_admin','waiter','cashier'])) AND (restaurant_id = current_restaurant_id()));

ALTER POLICY staff_read_sessions ON public.sessions
USING ((current_app_role() = ANY (ARRAY['waiter','manager','super_admin','kitchen','cashier'])) AND (restaurant_id = current_restaurant_id()));

ALTER POLICY staff_read_tables ON public.tables
USING ((current_app_role() = ANY (ARRAY['super_admin','manager','waiter','cashier'])) AND (restaurant_id = current_restaurant_id()));
