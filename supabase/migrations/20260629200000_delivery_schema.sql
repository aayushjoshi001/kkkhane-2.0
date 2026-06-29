-- Online delivery — schema foundation (idempotent).
--
-- These objects already exist on the hosted DB (added out-of-band during the
-- takeout-unify work); this migration records them in the repo so a fresh
-- environment matches. Kept separate from the place_delivery_order function
-- because ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- references the new value.

ALTER TYPE public.order_type ADD VALUE IF NOT EXISTS 'delivery';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_staff_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delivery_verification_code text;
