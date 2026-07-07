-- Add advance payment tracking to bookings
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS advance_payment_method text
        CHECK (advance_payment_method IN ('cash', 'qr_digital', 'none'));

-- Ensure paid_amount is present (it already is, but safety net)
ALTER TABLE public.bookings
    ALTER COLUMN paid_amount SET DEFAULT 0.00;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
