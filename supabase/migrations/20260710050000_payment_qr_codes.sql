-- A restaurant may run multiple payment QR codes (e.g. one eSewa QR depositing
-- into Bank A, one Fonepay QR depositing into Bank B). The prior single
-- payment_qr_url/payment_qr_label/qr_bank_account_id columns on restaurants
-- could only represent one — this table replaces that with a proper list, one
-- row per QR, each with its own bank account.
CREATE TABLE IF NOT EXISTS "public"."payment_qr_codes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" uuid NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "label" text NOT NULL,
    "image_url" text,
    "bank_account_id" uuid REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_qr_codes_restaurant_id_idx" ON "public"."payment_qr_codes" ("restaurant_id");

ALTER TABLE "public"."payment_qr_codes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_payment_qr_codes" ON "public"."payment_qr_codes"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_payment_qr_codes" ON "public"."payment_qr_codes"
    FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));

-- Backfill: carry forward any restaurant that already had a single QR configured.
INSERT INTO "public"."payment_qr_codes" ("restaurant_id", "label", "image_url", "bank_account_id")
SELECT "id", COALESCE(NULLIF("payment_qr_label", ''), 'Payment QR'), "payment_qr_url", "qr_bank_account_id"
FROM "public"."restaurants"
WHERE "payment_qr_url" IS NOT NULL;
