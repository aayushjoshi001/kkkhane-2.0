-- Migration: Add missing signup fields to restaurants table
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS slogan      text,
  ADD COLUMN IF NOT EXISTS vat_number  text,
  ADD COLUMN IF NOT EXISTS telephone   text,
  ADD COLUMN IF NOT EXISTS latitude    double precision,
  ADD COLUMN IF NOT EXISTS longitude   double precision,
  ADD COLUMN IF NOT EXISTS logo_url    text;   -- already in schema but may be missing in some envs

-- Validation: VAT number format for Nepal (9 digits, same as PAN but different register)
COMMENT ON COLUMN restaurants.slogan     IS 'Optional restaurant tagline shown on menus and homepage';
COMMENT ON COLUMN restaurants.vat_number IS 'Nepal VAT registration number (9 digits)';
COMMENT ON COLUMN restaurants.telephone  IS 'Landline/telephone number separate from mobile contact_phone';
COMMENT ON COLUMN restaurants.latitude   IS 'GPS latitude captured at signup via browser geolocation';
COMMENT ON COLUMN restaurants.longitude  IS 'GPS longitude captured at signup via browser geolocation';
