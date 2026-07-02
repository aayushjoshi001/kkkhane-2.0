-- Restaurant "type of client" (FastFood/Resort/Hotel/etc.), selected during
-- onboarding but previously collected in the UI and silently discarded —
-- persist it instead of dropping it.
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS business_type text;
