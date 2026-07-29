-- Dine-in equivalent of 20260713150000_booking_discount.sql — lets staff
-- apply a bargained total at table checkout, with a mandatory reason as the
-- audit trail. sessions has no monetary columns today; see
-- src/app/api/tables/checkout/route.ts for where this actually takes effect.
ALTER TABLE "public"."sessions"
    ADD COLUMN IF NOT EXISTS "discount_amount" numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "discount_reason" text,
    ADD COLUMN IF NOT EXISTS "discount_applied_by" uuid REFERENCES "public"."users"("id"),
    ADD COLUMN IF NOT EXISTS "discount_applied_at" timestamptz;

ALTER TABLE "public"."sessions"
    ADD CONSTRAINT "sessions_discount_amount_check" CHECK ("discount_amount" >= 0);

NOTIFY pgrst, 'reload schema';
