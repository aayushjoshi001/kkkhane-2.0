-- Drop old bookings table if it exists to cleanly recreate it with all columns
DROP TABLE IF EXISTS public.bookings CASCADE;

-- Recreate bookings table with correct columns (notes, adults, children, etc.)
CREATE TABLE public.bookings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    room_id       uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
    guest_name    text NOT NULL,
    guest_phone   text,
    guest_email   text,
    check_in      timestamptz NOT NULL,
    check_out     timestamptz NOT NULL,
    adults        integer NOT NULL DEFAULT 1,
    children      integer NOT NULL DEFAULT 0,
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'checked_in', 'checked_out', 'cancelled')),
    total_amount  numeric(10, 2) NOT NULL DEFAULT 0.00,
    paid_amount   numeric(10, 2) NOT NULL DEFAULT 0.00,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bookings_dates_check CHECK (check_out > check_in)
);

-- Re-enable RLS on the new table
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Re-create bookings policies
DROP POLICY IF EXISTS "staff_read_bookings" ON public.bookings;
CREATE POLICY "staff_read_bookings" ON public.bookings
    FOR SELECT
    USING (restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_manage_bookings" ON public.bookings;
CREATE POLICY "staff_manage_bookings" ON public.bookings
    FOR ALL
    USING (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter']))
        AND (restaurant_id = current_restaurant_id())
    )
    WITH CHECK (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter']))
        AND (restaurant_id = current_restaurant_id())
    );

-- Re-create performance indexes
CREATE INDEX IF NOT EXISTS bookings_restaurant_id_idx    ON public.bookings (restaurant_id);
CREATE INDEX IF NOT EXISTS bookings_room_id_idx          ON public.bookings (room_id);
CREATE INDEX IF NOT EXISTS bookings_status_idx           ON public.bookings (status);
CREATE INDEX IF NOT EXISTS bookings_check_in_idx         ON public.bookings (check_in);

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
