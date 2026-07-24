-- Repair bookings whose check-in/check-out were stored 5h45m late.
--
-- src/app/api/bookings/route.ts used to do `new Date(check_in).toISOString()`
-- on a naive `YYYY-MM-DDTHH:mm` value coming from an <input type="datetime-local">.
-- A string with no zone resolves against the *runtime's* zone, and that route
-- executes on Vercel in UTC - so the Kathmandu wall-clock time the staff member
-- typed was stored as though it were UTC, i.e. exactly +05:45 too late. A stay
-- booked at 2:42 PM was recorded, and displayed back, as 8:27 PM.
--
-- The route now anchors the offset (see nepalInputToISO in src/lib/utils.ts).
-- This migration corrects the rows already written by the broken path.
--
-- Scope is deliberately narrow. Only rows created from 2026-07-20 onwards whose
-- check_in sits 5.6-5.8h after their own created_at are touched: those are the
-- "book now" defaults, where the shift provably reconciles check_in back to the
-- moment the booking was actually created. Earlier bookings predate the
-- regression and several of them are already correct, so shifting those would
-- introduce the very error this fixes.
--
-- check_in and check_out move together, so stay length - and therefore every
-- nightly charge derived from it - is unchanged.
--
-- Idempotent: after the shift the drift is ~0, so the predicate no longer
-- matches and a re-run is a no-op.

UPDATE "public"."bookings"
SET "check_in"  = "check_in"  - interval '5 hours 45 minutes',
    "check_out" = "check_out" - interval '5 hours 45 minutes'
WHERE "created_at" >= '2026-07-20'::timestamptz
  AND extract(epoch FROM ("check_in" - "created_at")) / 3600 BETWEEN 5.6 AND 5.8;
