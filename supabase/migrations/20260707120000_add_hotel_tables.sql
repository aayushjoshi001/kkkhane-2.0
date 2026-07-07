-- ============================================================
-- Hotel Operations: room_types, rooms, bookings
-- Migration: 20260707120000_add_hotel_tables.sql
-- ============================================================

-- 1. Room Types Table
CREATE TABLE IF NOT EXISTS public.room_types (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name          text NOT NULL,
    description   text,
    base_price    numeric(10, 2) NOT NULL DEFAULT 0.00,
    capacity      integer NOT NULL DEFAULT 2,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Rooms Table
CREATE TABLE IF NOT EXISTS public.rooms (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    room_number   text NOT NULL,
    floor         text,
    status        text NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'occupied', 'dirty', 'maintenance')),
    type_id       uuid REFERENCES public.room_types(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Unique room number per restaurant (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS rooms_restaurant_number_uidx
    ON public.rooms (restaurant_id, lower(room_number));

-- 3. Bookings Table
CREATE TABLE IF NOT EXISTS public.bookings (
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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS rooms_restaurant_id_idx       ON public.rooms (restaurant_id);
CREATE INDEX IF NOT EXISTS room_types_restaurant_id_idx  ON public.room_types (restaurant_id);
CREATE INDEX IF NOT EXISTS bookings_restaurant_id_idx    ON public.bookings (restaurant_id);
CREATE INDEX IF NOT EXISTS bookings_room_id_idx          ON public.bookings (room_id);
CREATE INDEX IF NOT EXISTS bookings_status_idx           ON public.bookings (status);
CREATE INDEX IF NOT EXISTS bookings_check_in_idx         ON public.bookings (check_in);

-- Enable RLS
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings   ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────
-- RLS Policies for room_types
-- ────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_read_room_types" ON public.room_types;
CREATE POLICY "staff_read_room_types" ON public.room_types
    FOR SELECT
    USING (restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "admin_manage_room_types" ON public.room_types;
CREATE POLICY "admin_manage_room_types" ON public.room_types
    FOR ALL
    USING (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin']))
        AND (restaurant_id = current_restaurant_id())
    )
    WITH CHECK (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin']))
        AND (restaurant_id = current_restaurant_id())
    );

-- ────────────────────────────────────────────────
-- RLS Policies for rooms
-- ────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_read_rooms" ON public.rooms;
CREATE POLICY "staff_read_rooms" ON public.rooms
    FOR SELECT
    USING (restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_manage_rooms" ON public.rooms;
CREATE POLICY "staff_manage_rooms" ON public.rooms
    FOR ALL
    USING (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter']))
        AND (restaurant_id = current_restaurant_id())
    )
    WITH CHECK (
        (current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter']))
        AND (restaurant_id = current_restaurant_id())
    );

-- ────────────────────────────────────────────────
-- RLS Policies for bookings
-- ────────────────────────────────────────────────

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
