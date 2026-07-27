-- Restores the service_charge_amount column on orders, which the app code
-- (and the 20260708150000 baseline schema) already assumes exists but was
-- never applied here — the original addition lived only in
-- migrations_archive/20260704120000_add_service_charge.sql.
ALTER TABLE "public"."orders"
    ADD COLUMN IF NOT EXISTS "service_charge_amount" numeric(15,2) DEFAULT 0.00 NOT NULL;
