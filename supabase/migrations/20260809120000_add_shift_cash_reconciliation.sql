-- Lets a manager reconcile the cash+QR a staff member should have collected
-- during one clock-in/clock-out shift against what's physically counted, so
-- a shortfall becomes an automatic deduction on that staff member's ledger
-- instead of being tracked by hand. One row per shift, since staff_shifts
-- already creates a separate row per login/logout even for the same person
-- on the same day.
ALTER TABLE "public"."staff_shifts"
    ADD COLUMN IF NOT EXISTS "expected_cash_amount" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "counted_cash_amount" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "cash_variance" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "cash_reconciled_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "cash_reconciled_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "deduction_ledger_id" uuid REFERENCES "public"."staff_ledger"("id") ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
