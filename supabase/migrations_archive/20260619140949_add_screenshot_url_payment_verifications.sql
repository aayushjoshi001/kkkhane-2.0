-- Add screenshot_url column to payment_verifications
-- This was missing from earlier migrations, causing the payment claim insertion to fail
-- when customers uploaded QR payment screenshots.

ALTER TABLE public.payment_verifications
  ADD COLUMN IF NOT EXISTS screenshot_url TEXT;

-- Also create the index from phase 0 just in case it's missing, using IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_payment_verifications_restaurant_created
  ON public.payment_verifications (restaurant_id, created_at DESC);
