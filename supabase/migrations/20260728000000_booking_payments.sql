-- Migration to track individual advance payment transactions with cashier notes and timestamps
CREATE TABLE IF NOT EXISTS "public"."booking_payments" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "booking_id" UUID NOT NULL REFERENCES "public"."bookings"("id") ON DELETE CASCADE,
    "amount" NUMERIC(12, 2) NOT NULL CHECK ("amount" > 0),
    "payment_method" TEXT NOT NULL DEFAULT 'cash',
    "cash_amount" NUMERIC(12, 2) DEFAULT 0,
    "qr_amount" NUMERIC(12, 2) DEFAULT 0,
    "note" TEXT DEFAULT 'Advance',
    "created_at" TIMESTAMPTZ DEFAULT now(),
    -- public.users, not auth.users: every route writing this passes
    -- currentUser.id, which is the app user row (same id as the auth user, but
    -- this is the table the rest of the schema points at — see
    -- bookings_cashier_id_fkey).
    "created_by" UUID REFERENCES "public"."users"("id") ON DELETE SET NULL
);

-- Index for fast lookup by booking_id and restaurant_id
CREATE INDEX IF NOT EXISTS "idx_booking_payments_booking_id" ON "public"."booking_payments"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_booking_payments_restaurant_id" ON "public"."booking_payments"("restaurant_id");

-- Enable RLS
ALTER TABLE "public"."booking_payments" ENABLE ROW LEVEL SECURITY;

-- RLS policies.
--
-- These read the caller's tenant from current_restaurant_id()/current_app_role(),
-- the helpers every other table in this schema uses. The original pair selected
-- from a `public.profiles` table that does not exist here — that made the whole
-- migration unapplyable, which is why this table was missing from production
-- while the routes writing to it silently swallowed the failed inserts.
DROP POLICY IF EXISTS "staff_manage_booking_payments" ON "public"."booking_payments";
CREATE POLICY "staff_manage_booking_payments" ON "public"."booking_payments"
    FOR ALL USING (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    ) WITH CHECK (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    );

DROP POLICY IF EXISTS "staff_read_booking_payments" ON "public"."booking_payments";
CREATE POLICY "staff_read_booking_payments" ON "public"."booking_payments"
    FOR SELECT USING ("restaurant_id" = "public"."current_restaurant_id"());
