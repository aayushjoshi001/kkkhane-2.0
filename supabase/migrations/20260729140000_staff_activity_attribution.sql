-- Who actually did the work.
--
-- `orders.waiter_id`, `orders.chef_id` and `order_items.chef_id` have existed
-- since the baseline and have never been written: 0 rows of 297 orders and 634
-- items carried any of them. Only `cashier_id` is populated, and only since it
-- was added a day ago. So "which waiter took this order" and "who cooked this
-- dish" were questions the schema looked able to answer and the data could not.
--
-- This migration does the history; the writes that keep it true from here on
-- are in the order and kitchen paths.
--
-- On the kitchen side the attribution was not merely missing, it was being
-- destroyed: setOrderItemsStatus() sets `claimed_by` when a chef starts a dish
-- and CLEARS it again when they mark it ready. That is correct for what
-- claimed_by is — a lock, so two cooks can't start the same dish — but it means
-- the finished dish remembers nobody. `chef_id` is the durable counterpart, and
-- is now written alongside the lock.

-- A backfilled waiter is a reasonable guess, not a record, and the report must
-- be able to say so. The guess is "whoever opened the table served it", which
-- is usually right and occasionally not — a second waiter covering a section,
-- or a QR self-order the guest placed themselves on a staff-opened table.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS waiter_id_inferred boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.waiter_id_inferred IS
    'True when waiter_id was reconstructed from sessions.opened_by rather than recorded at the time the order was placed. Reports must label these as inferred — the table''s opener is not always who took the order.';

-- Recover what can be recovered. Only session-linked orders with a known
-- opener, and only where nothing was recorded — a real attribution is never
-- overwritten by a guess.
UPDATE public.orders o
SET waiter_id = s.opened_by,
    waiter_id_inferred = true
FROM public.sessions s
WHERE o.session_id = s.id
  AND o.waiter_id IS NULL
  AND s.opened_by IS NOT NULL;

-- Reporting reads these three ways and no other: one restaurant's orders for a
-- date range, narrowed to one member of staff. Partial, because the columns are
-- null on every guest-placed order and always will be.
CREATE INDEX IF NOT EXISTS orders_waiter_activity_idx
    ON public.orders USING btree (restaurant_id, waiter_id, placed_at)
    WHERE waiter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_cashier_activity_idx
    ON public.orders USING btree (restaurant_id, cashier_id, paid_at)
    WHERE cashier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_items_chef_activity_idx
    ON public.order_items USING btree (chef_id, created_at)
    WHERE chef_id IS NOT NULL;

-- The oversight half of the report — discounts and voids — reads audit_logs by
-- actor over a date range, which nothing indexed for.
CREATE INDEX IF NOT EXISTS audit_logs_actor_activity_idx
    ON public.audit_logs USING btree (restaurant_id, user_id, created_at);
