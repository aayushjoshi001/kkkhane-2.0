-- Add IRD API credentials columns to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS ird_api_url text,
ADD COLUMN IF NOT EXISTS ird_api_user text,
ADD COLUMN IF NOT EXISTS ird_api_password text;
