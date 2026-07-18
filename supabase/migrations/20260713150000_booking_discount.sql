-- Lets staff apply a bargained room rate at checkout, with a mandatory
-- reason as the audit trail (no separate manager-approval step — a guest is
-- standing there waiting to pay, per the same-day product decision). See
-- src/lib/folio.ts::computeFolioTotal, which is the single place this
-- discount actually takes effect on the bill.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "discount_amount" numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "discount_reason" text,
    ADD COLUMN IF NOT EXISTS "discount_applied_by" uuid REFERENCES "public"."users"("id"),
    ADD COLUMN IF NOT EXISTS "discount_applied_at" timestamptz;

ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_discount_amount_check" CHECK ("discount_amount" >= 0);

NOTIFY pgrst, 'reload schema';
