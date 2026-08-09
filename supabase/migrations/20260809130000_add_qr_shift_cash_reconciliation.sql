-- Add expected_qr_amount and counted_qr_amount to staff_shifts for split Cash vs QR shift reconciliation
ALTER TABLE "public"."staff_shifts"
    ADD COLUMN IF NOT EXISTS "expected_qr_amount" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "counted_qr_amount" numeric(12,2);

NOTIFY pgrst, 'reload schema';
