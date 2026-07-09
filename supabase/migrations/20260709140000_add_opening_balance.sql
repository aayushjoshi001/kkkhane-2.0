-- Add opening_balance to users table (amount owed to staff before this system was used)
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "opening_balance" numeric(12,2) DEFAULT 0.00 NOT NULL;
