-- Allow advance payments to be recorded as a cash+QR split, so cashiers can
-- record advances collected across two payment methods (previously only a
-- single method could be stored, causing split advances to under-report in
-- income and cash-in-bank).
ALTER TABLE "public"."bookings" DROP CONSTRAINT IF EXISTS "bookings_advance_payment_method_check";
ALTER TABLE "public"."bookings" ADD CONSTRAINT "bookings_advance_payment_method_check"
    CHECK (("advance_payment_method" = ANY (ARRAY['cash'::"text", 'qr_digital'::"text", 'split'::"text", 'none'::"text"])));
