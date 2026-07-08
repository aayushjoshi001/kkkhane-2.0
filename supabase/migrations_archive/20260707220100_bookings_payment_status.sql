-- ============================================================
-- Fix: bookings.payment_status column missing
-- Migration: 20260707220100_bookings_payment_status.sql
--
-- /api/bookings/checkout (this PR) writes `payment_status` on checkout and
-- `types/database.ts` already declares it on the Booking interface, but no
-- migration ever added the column — every hotel checkout would 500 on the
-- `bookings.update()` call. This adds the column the app code already
-- expects, matching the TS union: 'unpaid' | 'partial' | 'paid' | 'refunded'.
-- ============================================================

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_bookings_restaurant_payment_status
    ON public.bookings (restaurant_id, payment_status);
