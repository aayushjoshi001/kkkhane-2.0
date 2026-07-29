-- When the guest actually left, as opposed to when they were due to.
--
-- `check_out` is the scheduled departure agreed at booking. Nothing recorded
-- the real one, so an overstay was invisible to billing — the folio priced the
-- stay from the scheduled window no matter how long past it the guest stayed,
-- and the only recourse was a manual "extra hour charge" the cashier typed in
-- from memory.
--
-- Billing a late departure needs the actual moment, and it has to be stored
-- rather than read from the clock: the folio is recomputed after checkout (the
-- receipt email does exactly this), so a now()-based overstay would keep
-- growing and the emailed bill would disagree with the amount charged.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "checked_out_at" timestamptz;

COMMENT ON COLUMN "public"."bookings"."checked_out_at" IS
    'When the guest actually departed (settlement time). NULL while in house, and on stays checked out before this column existed — the folio treats that NULL as "left on time" so historical bills never re-price.';

-- Stamped by a trigger rather than by each caller. Three separate paths close a
-- booking today — settle_booking_checkout_v2, settle_booking_group_checkout,
-- and the non-invoice branch of /api/bookings/checkout — and a fourth would be
-- easy to add without noticing this column. Missing the stamp is silent and
-- expensive: the folio would fall back to reading the clock and re-price a
-- settled stay every time the receipt was regenerated.
--
-- An explicit value always wins, so a caller that wants to record a departure
-- other than "now" (a correction, an import) still can.
CREATE OR REPLACE FUNCTION "public"."stamp_booking_checked_out_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'checked_out'
       AND OLD."status" IS DISTINCT FROM 'checked_out'
       AND NEW."checked_out_at" IS NULL
    THEN
        NEW."checked_out_at" := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_stamp_checked_out_at" ON "public"."bookings";
CREATE TRIGGER "bookings_stamp_checked_out_at"
    BEFORE UPDATE ON "public"."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."stamp_booking_checked_out_at"();
