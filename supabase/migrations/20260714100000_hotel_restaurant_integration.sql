-- Migration to support Hotel & Restaurant Integration on the kkkhane platform
-- Adds columns to link a Hotel and Restaurant tenant, and opens up cross-tenant RLS
-- policies so they can verify room bookings and settle bills.

-- 1. Add linkage columns to restaurants table
ALTER TABLE public.restaurants 
    ADD COLUMN IF NOT EXISTS linked_hotel_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS linked_restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.restaurants.linked_hotel_id IS 'If this is a Restaurant, points to its partner Hotel on the platform.';
COMMENT ON COLUMN public.restaurants.linked_restaurant_id IS 'If this is a Hotel, points to its partner Restaurant on the platform.';

-- Create indexes on linkage columns for faster lookups
CREATE INDEX IF NOT EXISTS idx_restaurants_linked_hotel_id ON public.restaurants(linked_hotel_id) WHERE linked_hotel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurants_linked_restaurant_id ON public.restaurants(linked_restaurant_id) WHERE linked_restaurant_id IS NOT NULL;

-- 2. RLS policies for Bookings (Hotel) -> Allow partner Restaurant to read bookings for verification
DROP POLICY IF EXISTS "partner_restaurant_read_bookings" ON public.bookings;
CREATE POLICY "partner_restaurant_read_bookings" ON public.bookings
    FOR SELECT
    TO authenticated
    USING (
        restaurant_id IN (
            SELECT linked_hotel_id FROM public.restaurants WHERE id = public.current_restaurant_id()
        )
    );

-- 3. RLS policies for Rooms (Hotel) -> Allow partner Restaurant to read rooms
DROP POLICY IF EXISTS "partner_restaurant_read_rooms" ON public.rooms;
CREATE POLICY "partner_restaurant_read_rooms" ON public.rooms
    FOR SELECT
    TO authenticated
    USING (
        restaurant_id IN (
            SELECT linked_hotel_id FROM public.restaurants WHERE id = public.current_restaurant_id()
        )
    );

-- 4. RLS policies for Tables (Restaurant) -> Allow partner Hotel to read tables linked to their rooms
DROP POLICY IF EXISTS "partner_hotel_read_tables" ON public.tables;
CREATE POLICY "partner_hotel_read_tables" ON public.tables
    FOR SELECT
    TO authenticated
    USING (
        room_id IN (
            SELECT id FROM public.rooms WHERE restaurant_id = public.current_restaurant_id()
        )
    );

-- 5. RLS policies for Orders (Restaurant) -> Allow partner Hotel to read and update orders linked to their bookings
DROP POLICY IF EXISTS "partner_hotel_read_orders" ON public.orders;
CREATE POLICY "partner_hotel_read_orders" ON public.orders
    FOR SELECT
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );

DROP POLICY IF EXISTS "partner_hotel_update_orders" ON public.orders;
CREATE POLICY "partner_hotel_update_orders" ON public.orders
    FOR UPDATE
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    )
    WITH CHECK (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );

-- 6. RLS policies for Sessions (Restaurant) -> Allow partner Hotel to read and update sessions linked to their bookings
DROP POLICY IF EXISTS "partner_hotel_read_sessions" ON public.sessions;
CREATE POLICY "partner_hotel_read_sessions" ON public.sessions
    FOR SELECT
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );

DROP POLICY IF EXISTS "partner_hotel_update_sessions" ON public.sessions;
CREATE POLICY "partner_hotel_update_sessions" ON public.sessions
    FOR UPDATE
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    )
    WITH CHECK (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );
