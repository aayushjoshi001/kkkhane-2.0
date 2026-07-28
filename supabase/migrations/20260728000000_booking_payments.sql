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
    "created_by" UUID REFERENCES "auth"."users"("id") ON DELETE SET NULL
);

-- Index for fast lookup by booking_id and restaurant_id
CREATE INDEX IF NOT EXISTS "idx_booking_payments_booking_id" ON "public"."booking_payments"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_booking_payments_restaurant_id" ON "public"."booking_payments"("restaurant_id");

-- Enable RLS
ALTER TABLE "public"."booking_payments" ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view booking payments for their restaurant" ON "public"."booking_payments"
    FOR SELECT USING (
        "restaurant_id" IN (
            SELECT "restaurant_id" FROM "public"."profiles" WHERE "id" = auth.uid()
        )
    );

CREATE POLICY "Users can insert booking payments for their restaurant" ON "public"."booking_payments"
    FOR INSERT WITH CHECK (
        "restaurant_id" IN (
            SELECT "restaurant_id" FROM "public"."profiles" WHERE "id" = auth.uid()
        )
    );
