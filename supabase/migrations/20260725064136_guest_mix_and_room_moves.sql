-- Two related additions to a stay: who is in the room, and which rooms the
-- stay has occupied over time.

-- ── 1. Guest mix ────────────────────────────────────────────────────────────
-- `adults` held a single head count, so a booking could not record that a party
-- of four is two men and two women — which front desks need for room allocation
-- and which Nepali hotels record for the police/tourist register.
--
-- `adults` is kept as the adult total rather than replaced: it is NOT NULL, it
-- is read elsewhere, and existing rows have no split to derive. The API writes
-- adults = adult_male + adult_female from here on. Legacy rows keep their total
-- with a 0/0 split, and the UI shows a plain "N adults" for those rather than
-- inventing a breakdown.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "adult_male"   integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "adult_female" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."bookings"
    DROP CONSTRAINT IF EXISTS "bookings_guest_mix_non_negative";
ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_guest_mix_non_negative"
    CHECK ("adult_male" >= 0 AND "adult_female" >= 0 AND "children" >= 0);

COMMENT ON COLUMN "public"."bookings"."adult_male" IS
    'Adult male guests. 0 on bookings made before the split existed — read `adults` for the total.';
COMMENT ON COLUMN "public"."bookings"."adult_female" IS
    'Adult female guests. 0 on bookings made before the split existed — read `adults` for the total.';

-- ── 2. Room move history ────────────────────────────────────────────────────
-- A stay could only ever name one room (bookings.room_id), so moving a guest
-- meant overwriting it and losing the fact they had been anywhere else. The
-- folio reads the nightly rate live from whatever room the booking currently
-- points at, so an overwrite silently re-priced every night of the stay —
-- including nights already spent in the cheaper room.
--
-- One row per room the stay has occupied. `to_ts` NULL marks the room the guest
-- is in now; bookings.room_id still points at that same room, so every existing
-- reader (the room QR resolver, the room board, checkout) keeps working
-- unchanged and this table is consulted only where per-night rates are built.
CREATE TABLE IF NOT EXISTS "public"."booking_room_stays" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" uuid NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "booking_id"    uuid NOT NULL REFERENCES "public"."bookings"("id")    ON DELETE CASCADE,
    "room_id"       uuid NOT NULL REFERENCES "public"."rooms"("id")       ON DELETE RESTRICT,
    -- When the guest entered this room. The first segment starts at check-in.
    "from_ts"       timestamptz NOT NULL,
    -- When they left it. NULL means "still here".
    "to_ts"         timestamptz,
    "moved_by"      uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "reason"        text,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "booking_room_stays_period_valid" CHECK ("to_ts" IS NULL OR "to_ts" > "from_ts")
);

CREATE INDEX IF NOT EXISTS "booking_room_stays_booking_idx"
    ON "public"."booking_room_stays" ("booking_id", "from_ts");

-- A stay is in exactly one room at a time, so at most one open segment.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_room_stays_one_open_per_booking"
    ON "public"."booking_room_stays" ("booking_id")
    WHERE "to_ts" IS NULL;

-- Backfill: every stay that exists today has occupied exactly its current room,
-- from check-in until now. Without this the folio would find no segment for
-- older bookings and fall back to the whole-stay rate.
INSERT INTO "public"."booking_room_stays" ("restaurant_id", "booking_id", "room_id", "from_ts", "to_ts")
SELECT b."restaurant_id", b."id", b."room_id", b."check_in", NULL
FROM "public"."bookings" b
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."booking_room_stays" s WHERE s."booking_id" = b."id"
);

ALTER TABLE "public"."booking_room_stays" ENABLE ROW LEVEL SECURITY;

-- Mirrors the bookings policies: staff of the owning restaurant read and write,
-- and a linked partner restaurant may read (it bills room-service to the stay).
DROP POLICY IF EXISTS "staff_manage_booking_room_stays" ON "public"."booking_room_stays";
CREATE POLICY "staff_manage_booking_room_stays" ON "public"."booking_room_stays"
    FOR ALL USING (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    );

DROP POLICY IF EXISTS "staff_read_booking_room_stays" ON "public"."booking_room_stays";
CREATE POLICY "staff_read_booking_room_stays" ON "public"."booking_room_stays"
    FOR SELECT USING ("restaurant_id" = "public"."current_restaurant_id"());

DROP POLICY IF EXISTS "partner_restaurant_read_booking_room_stays" ON "public"."booking_room_stays";
CREATE POLICY "partner_restaurant_read_booking_room_stays" ON "public"."booking_room_stays"
    FOR SELECT TO "authenticated" USING (
        "restaurant_id" IN (
            SELECT "restaurants"."linked_hotel_id" FROM "public"."restaurants"
            WHERE "restaurants"."id" = "public"."current_restaurant_id"()
        )
    );

COMMENT ON TABLE "public"."booking_room_stays" IS
    'One row per room a stay has occupied. to_ts NULL = current room. Drives per-night rates when a guest is moved mid-stay.';
