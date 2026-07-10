-- Lets a restaurant designate which bank account their displayed payment QR
-- (payment_qr_url) actually deposits into, so QR payments post income/bank-in
-- against the right account instead of an arbitrarily picked "first active" one.
ALTER TABLE "public"."restaurants"
    ADD COLUMN IF NOT EXISTS "qr_bank_account_id" uuid REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;
