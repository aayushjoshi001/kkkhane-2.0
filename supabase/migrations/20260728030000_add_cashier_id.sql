-- Stamps the bill itself with the staff member who settled it.
--
-- Until now a checkout's operator only survived on the rows it happened to
-- write on the side — payment_verifications.staff_verified_by, the day book /
-- income entry's created_by, the audit log — so "who billed this order?" could
-- only be answered by joining back through those. orders already names the
-- waiter and the chef; this gives it the cashier too, and gives bookings the
-- same for a room settlement.
--
-- Deliberately nullable with no backfill: every pre-existing paid row was
-- settled by someone unknown to the schema, and inventing an id for them would
-- be worse than an honest NULL.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cashier_id uuid;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS cashier_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_cashier_id_fkey') THEN
        ALTER TABLE public.orders
            ADD CONSTRAINT orders_cashier_id_fkey FOREIGN KEY (cashier_id)
            REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cashier_id_fkey') THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_cashier_id_fkey FOREIGN KEY (cashier_id)
            REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Partial: the vast majority of rows are unsettled or legacy, and every query
-- that reaches for this column ("what did cashier X bill today?") filters on a
-- non-null value.
CREATE INDEX IF NOT EXISTS orders_cashier_id_idx
    ON public.orders USING btree (cashier_id) WHERE cashier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_cashier_id_idx
    ON public.bookings USING btree (cashier_id) WHERE cashier_id IS NOT NULL;

COMMENT ON COLUMN public.orders.cashier_id IS
    'Staff member who settled this order at checkout. NULL for unsettled orders and for anything paid before this column existed.';

COMMENT ON COLUMN public.bookings.cashier_id IS
    'Staff member who settled this stay at checkout. NULL while in house, and for anything checked out before this column existed.';
