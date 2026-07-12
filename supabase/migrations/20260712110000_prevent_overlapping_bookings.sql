-- Pre-launch audit fix (§02): "Creating a new booking can silently erase a
-- real guest's stay". The application layer now rejects a new booking
-- attempt on a room that already has an active (pending/checked_in) stay
-- instead of silently auto-cancelling it (see src/app/api/bookings/route.ts).
--
-- This is the database-level backstop for that same rule: an EXCLUDE
-- constraint, using the already-installed btree_gist extension, makes two
-- overlapping active bookings on the same room impossible at the schema
-- level - regardless of whether every application code path remembers to
-- check first. Checked_out/cancelled bookings are excluded via the WHERE
-- clause so historical stays never block a new one.

ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_no_overlapping_active_stays"
    EXCLUDE USING gist (
        "room_id" WITH =,
        "tstzrange"("check_in", "check_out") WITH &&
    )
    WHERE ("status" = ANY (ARRAY['pending'::"text", 'checked_in'::"text"]));
