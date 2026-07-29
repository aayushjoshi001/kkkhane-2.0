-- One guest, several rooms.
--
-- Until now a stay was one room: `bookings.room_id` is NOT NULL and singular,
-- so a family taking three rooms had to be entered as three unrelated stays.
-- The front desk then had no way to see they belonged together, and the guest
-- got three separate bills at checkout.
--
-- The fix is a reservation header rather than a rewrite of `bookings`.
-- `bookings.room_id` is load-bearing in ~50 call sites — the in-room QR
-- resolver, the room board, the per-room EXCLUDE overlap constraint, the room
-- move history in `booking_room_stays`, and the checkout RPC all key off it.
-- Exploding it into a join table would touch every one of them.
--
-- So each room keeps its own `bookings` row, exactly as before, and a
-- `booking_groups` row ties them together. Every existing reader keeps working
-- untouched; only the places that bill or display a stay learn about groups.
-- A single-room booking has `group_id` NULL and behaves as it always has.

CREATE TABLE IF NOT EXISTS "public"."booking_groups" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" uuid NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    -- The person the whole reservation is under. Copied onto each member
    -- booking too, so anything reading a single booking (the room QR page, the
    -- kitchen ticket) still finds a guest name without joining up to the group.
    "guest_name"    text NOT NULL,
    "guest_phone"   text,
    "guest_email"   text,
    -- The group's shared stay window. Member bookings carry their own copies of
    -- these; these are the values the booking form applied to every room, kept
    -- so the header still reads correctly if one room is later extended.
    "check_in"      timestamptz NOT NULL,
    "check_out"     timestamptz NOT NULL,
    "notes"         text,
    "created_by"    uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "booking_groups_dates_check" CHECK ("check_out" > "check_in"),
    CONSTRAINT "booking_groups_guest_name_check"
        CHECK (char_length("guest_name") >= 1 AND char_length("guest_name") <= 200)
);

CREATE INDEX IF NOT EXISTS "booking_groups_restaurant_idx"
    ON "public"."booking_groups" ("restaurant_id", "check_in");

-- NULL = an ordinary one-room stay, which is every booking that exists today.
-- ON DELETE SET NULL rather than CASCADE: dropping a reservation header must
-- never take real stay records (and their revenue history) with it.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "group_id" uuid
    REFERENCES "public"."booking_groups"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "bookings_group_id_idx"
    ON "public"."bookings" ("group_id")
    WHERE "group_id" IS NOT NULL;

COMMENT ON TABLE "public"."booking_groups" IS
    'A reservation covering several rooms for one guest. Member rooms are ordinary bookings rows with group_id set; they bill as one combined folio and check out together.';
COMMENT ON COLUMN "public"."bookings"."group_id" IS
    'The multi-room reservation this stay belongs to, or NULL for a normal single-room stay.';

ALTER TABLE "public"."booking_groups" ENABLE ROW LEVEL SECURITY;

-- Mirrors the bookings policies exactly: staff of the owning restaurant read
-- and write, anyone in the restaurant reads, and a linked partner restaurant
-- may read (it bills room-service against member stays).
DROP POLICY IF EXISTS "staff_manage_booking_groups" ON "public"."booking_groups";
CREATE POLICY "staff_manage_booking_groups" ON "public"."booking_groups"
    FOR ALL USING (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    ) WITH CHECK (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    );

DROP POLICY IF EXISTS "staff_read_booking_groups" ON "public"."booking_groups";
CREATE POLICY "staff_read_booking_groups" ON "public"."booking_groups"
    FOR SELECT USING ("restaurant_id" = "public"."current_restaurant_id"());

DROP POLICY IF EXISTS "partner_restaurant_read_booking_groups" ON "public"."booking_groups";
CREATE POLICY "partner_restaurant_read_booking_groups" ON "public"."booking_groups"
    FOR SELECT TO "authenticated" USING (
        "restaurant_id" IN (
            SELECT "restaurants"."linked_hotel_id" FROM "public"."restaurants"
            WHERE "restaurants"."id" = "public"."current_restaurant_id"()
        )
    );
