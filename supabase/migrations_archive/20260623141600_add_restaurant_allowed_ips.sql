-- Add allowed_ips column to restaurants table
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS allowed_ips TEXT DEFAULT NULL;
