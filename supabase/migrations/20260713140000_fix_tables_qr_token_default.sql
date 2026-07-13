-- Fix the invalid qr_token default on public.tables.
--
-- The column default was `encode(gen_random_bytes(24), 'base64url')`, but
-- Postgres `encode()` only supports 'base64', 'hex' and 'escape' — 'base64url'
-- raises `ERROR: 22023 unrecognized encoding: "base64url"`. So ANY insert into
-- tables that does not supply qr_token explicitly fails at the DB level (which
-- surfaces client-side as a failed request while creating a table). Callers that
-- generate the token in JS (addTableAction, provisioning, demoHotel, rooms/verify)
-- happened to dodge it, but the default itself is a latent landmine.
--
-- Replace it with a valid, URL-safe expression: base64 of 18 random bytes with
-- the base64 alphabet's non-URL-safe chars translated (+ -> -, / -> _, = removed).
-- 18 bytes -> 24 chars with no padding, so '=' never actually appears; the map is
-- kept for safety. qr_token is used directly in the /t/[qr_token] URL, so it must
-- be URL-safe.

ALTER TABLE public.tables
  ALTER COLUMN qr_token SET DEFAULT translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
