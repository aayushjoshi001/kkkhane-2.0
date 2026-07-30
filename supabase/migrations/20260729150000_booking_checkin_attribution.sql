-- Who checked the guest in, and when — the counterpart to cashier_id /
-- checked_out_at (20260728030000, 20260727150000) on the other end of the
-- stay. `check_in` is the scheduled/booked date, not the moment the front
-- desk actually handed over the room, and nothing recorded who did it — so
-- the Bookings & Stays History detail card could show a checkout operator
-- but not a check-in one.
--
-- Deliberately nullable with no backfill, same reasoning as cashier_id: every
-- pre-existing stay was checked in by someone unknown to the schema.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "checked_in_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "checked_in_by" uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_checked_in_by_fkey') THEN
        ALTER TABLE "public"."bookings"
            ADD CONSTRAINT "bookings_checked_in_by_fkey" FOREIGN KEY ("checked_in_by")
            REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_checked_in_by_idx"
    ON "public"."bookings" USING btree ("checked_in_by") WHERE "checked_in_by" IS NOT NULL;

COMMENT ON COLUMN "public"."bookings"."checked_in_at" IS
    'When the guest actually checked in (room handover), stamped automatically the moment status first becomes checked_in. NULL for a still-pending reservation and for stays checked in before this column existed.';

COMMENT ON COLUMN "public"."bookings"."checked_in_by" IS
    'Staff member who checked the guest in — the walk-in creator (bookings insert) or whoever clicked Check In (bookings/status). NULL for anything checked in before this column existed.';

-- Stamped by a trigger rather than by each caller, mirroring
-- stamp_booking_checked_out_at: a walk-in booking is inserted already
-- checked_in (POST /api/bookings), while a reserved one flips pending ->
-- checked_in later (POST /api/bookings/status) — both paths must not be able
-- to skip the stamp. The NULL guard makes it idempotent and one-shot: once
-- set, it is never overwritten by a later unrelated update.
CREATE OR REPLACE FUNCTION "public"."stamp_booking_checked_in_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'checked_in' AND NEW."checked_in_at" IS NULL THEN
        NEW."checked_in_at" := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_stamp_checked_in_at" ON "public"."bookings";
CREATE TRIGGER "bookings_stamp_checked_in_at"
    BEFORE INSERT OR UPDATE ON "public"."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."stamp_booking_checked_in_at"();
