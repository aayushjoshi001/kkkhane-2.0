-- ============================================================
-- Patch: Add missing columns + fix optimized hotel migration
-- 20260707140000_hotel_tables_patch.sql
--
-- Context: The first migration (20260707120000_add_hotel_tables.sql)
-- already created room_types/rooms/bookings without the new columns
-- (is_active, amenities, image_url, updated_at, etc.).
-- This patch safely adds them with ALTER TABLE ... IF NOT EXISTS.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- EXTENSIONS (safe to re-run)
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ────────────────────────────────────────────────────────────
-- PATCH: room_types — add missing columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.room_types
    ADD COLUMN IF NOT EXISTS amenities   text[]      NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS image_url   text,
    ADD COLUMN IF NOT EXISTS is_active   boolean     NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Add unique constraint if not already there
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'room_types_name_per_restaurant'
    ) THEN
        ALTER TABLE public.room_types
            ADD CONSTRAINT room_types_name_per_restaurant UNIQUE (restaurant_id, name);
    END IF;
END$$;

-- ────────────────────────────────────────────────────────────
-- PATCH: rooms — add missing columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.rooms
    ADD COLUMN IF NOT EXISTS notes      text,
    ADD COLUMN IF NOT EXISTS is_active  boolean     NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Extend status check to include 'blocked'
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE public.rooms
    ADD CONSTRAINT rooms_status_check
    CHECK (status IN ('available', 'occupied', 'dirty', 'maintenance', 'blocked'));

-- ────────────────────────────────────────────────────────────
-- PATCH: bookings — add missing columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS guest_id_type   text CHECK (guest_id_type IN ('passport', 'citizenship', 'driving_license', 'voter_id') OR guest_id_type IS NULL),
    ADD COLUMN IF NOT EXISTS guest_id_number text,
    ADD COLUMN IF NOT EXISTS discount_amount numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    ADD COLUMN IF NOT EXISTS payment_status  text NOT NULL DEFAULT 'unpaid'
                                             CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')),
    ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'walk_in'
                                             CHECK (source IN ('walk_in', 'phone', 'online', 'agency')),
    ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

-- Extend status check to include 'confirmed' and 'no_show'
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'));

-- Upgrade numeric precision on monetary columns
ALTER TABLE public.bookings
    ALTER COLUMN total_amount  TYPE numeric(12, 2),
    ALTER COLUMN paid_amount   TYPE numeric(12, 2);

-- ────────────────────────────────────────────────────────────
-- EXCLUSION CONSTRAINT: Prevent double-booking
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_no_overlap;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING GIST (
        room_id WITH =,
        tstzrange(check_in, check_out, '[)') WITH &&
    )
    WHERE (status NOT IN ('cancelled', 'no_show'));

-- ────────────────────────────────────────────────────────────
-- NEW TABLE: room_charges
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.room_charges (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    booking_id      uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    description     text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
    charge_type     text        NOT NULL DEFAULT 'other'
                                CHECK (charge_type IN ('room_service', 'minibar', 'laundry', 'spa', 'parking', 'other')),
    charged_by      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.room_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_room_charges"   ON public.room_charges;
DROP POLICY IF EXISTS "staff_manage_room_charges" ON public.room_charges;

CREATE POLICY "staff_read_room_charges" ON public.room_charges
    FOR SELECT USING (restaurant_id = current_restaurant_id());

CREATE POLICY "staff_manage_room_charges" ON public.room_charges
    FOR ALL
    USING (
        current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND restaurant_id = current_restaurant_id()
    )
    WITH CHECK (
        current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND restaurant_id = current_restaurant_id()
    );

-- ────────────────────────────────────────────────────────────
-- INDEXES (all use IF NOT EXISTS — safe to re-run)
-- ────────────────────────────────────────────────────────────

-- room_types
CREATE INDEX IF NOT EXISTS idx_room_types_restaurant_id
    ON public.room_types (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_room_types_restaurant_active
    ON public.room_types (restaurant_id)
    WHERE is_active = true;

-- rooms
CREATE INDEX IF NOT EXISTS idx_rooms_type_id
    ON public.rooms (type_id);

CREATE INDEX IF NOT EXISTS idx_rooms_available
    ON public.rooms (restaurant_id, type_id)
    WHERE status = 'available' AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_rooms_dirty
    ON public.rooms (restaurant_id)
    WHERE status = 'dirty';

-- bookings
CREATE INDEX IF NOT EXISTS idx_bookings_restaurant_checkin
    ON public.bookings (restaurant_id, check_in);

CREATE INDEX IF NOT EXISTS idx_bookings_restaurant_checkout
    ON public.bookings (restaurant_id, check_out);

CREATE INDEX IF NOT EXISTS idx_bookings_active
    ON public.bookings (restaurant_id, check_in, check_out)
    WHERE status IN ('pending', 'confirmed', 'checked_in');

CREATE INDEX IF NOT EXISTS idx_bookings_unpaid
    ON public.bookings (restaurant_id, status)
    WHERE payment_status IN ('unpaid', 'partial');

CREATE INDEX IF NOT EXISTS idx_bookings_guest_name_trgm
    ON public.bookings USING GIN (guest_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bookings_created_by
    ON public.bookings (created_by);

-- room_charges
CREATE INDEX IF NOT EXISTS idx_room_charges_booking_id
    ON public.room_charges (booking_id);

CREATE INDEX IF NOT EXISTS idx_room_charges_restaurant_id
    ON public.room_charges (restaurant_id);

-- ────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_types_updated_at ON public.room_types;
CREATE TRIGGER trg_room_types_updated_at
    BEFORE UPDATE ON public.room_types
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rooms_updated_at ON public.rooms;
CREATE TRIGGER trg_rooms_updated_at
    BEFORE UPDATE ON public.rooms
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- HELPER VIEWS
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_rooms_with_status AS
SELECT
    r.id,
    r.restaurant_id,
    r.room_number,
    r.floor,
    r.status,
    r.is_active,
    r.notes,
    rt.name        AS type_name,
    rt.base_price,
    rt.capacity,
    rt.amenities,
    b.id           AS current_booking_id,
    b.guest_name   AS current_guest,
    b.check_out    AS current_checkout
FROM public.rooms r
LEFT JOIN public.room_types rt ON rt.id = r.type_id
LEFT JOIN public.bookings b
    ON  b.room_id = r.id
    AND b.status = 'checked_in';

CREATE OR REPLACE VIEW public.v_today_bookings AS
SELECT
    b.id,
    b.restaurant_id,
    b.guest_name,
    b.guest_phone,
    b.check_in,
    b.check_out,
    b.status,
    b.payment_status,
    b.total_amount,
    b.paid_amount,
    r.room_number,
    rt.name AS room_type
FROM public.bookings b
JOIN public.rooms     r  ON r.id  = b.room_id
JOIN public.room_types rt ON rt.id = r.type_id
WHERE b.status NOT IN ('cancelled', 'no_show')
  AND (
      date_trunc('day', b.check_in  AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC')
   OR date_trunc('day', b.check_out AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC')
  );
