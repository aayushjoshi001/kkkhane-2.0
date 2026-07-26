-- Support splitting one physical table into independently-ordered, independently-paid
-- "seats" (e.g. a shared table where unrelated parties each want their own bill).
--
-- seat_number defaults to 1, so every existing session (and every session created by
-- code that doesn't know about seats yet, e.g. QR self-ordering) is "seat 1" — the
-- table's original, single-session behavior is unchanged. A waiter can open
-- additional seats (2, 3, ...) up to the table's capacity via the waiter panel.
ALTER TABLE "public"."sessions"
    ADD COLUMN IF NOT EXISTS "seat_number" smallint DEFAULT 1 NOT NULL;

ALTER TABLE "public"."sessions"
    ADD CONSTRAINT "sessions_seat_number_check" CHECK ("seat_number" >= 1);

-- Replace the old "one active session per table" index with "one active session per
-- table PER SEAT" so seats 1..N can each carry their own concurrent active session.
DROP INDEX IF EXISTS "public"."idx_sessions_one_active_per_table";

CREATE UNIQUE INDEX "idx_sessions_one_active_per_table_seat"
    ON "public"."sessions" USING "btree" ("table_id", "seat_number")
    WHERE ("status" = 'active'::"text");
