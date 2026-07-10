-- Manager-editable join date, separate from created_at (account creation time),
-- used to prorate salary accrual for a staff member's actual start date.
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "join_date" date;

-- Backfill existing staff with their account creation date as a sensible default
UPDATE "public"."users" SET "join_date" = "created_at"::date WHERE "join_date" IS NULL;
