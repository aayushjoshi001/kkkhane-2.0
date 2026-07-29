-- Enable Realtime replication for `rooms` and `bookings`.
--
-- CashierClient and CashierRoomManager have always carried working
-- subscriptions for these two tables - patching room status, appending new
-- bookings, syncing the open billing stay. Neither table was ever added to the
-- `supabase_realtime` publication, so those handlers could never receive a
-- payload: the hotel side of the app looked live but was static until a manual
-- refresh. Two cashiers could each see the same room as vacant and both try to
-- book it, with the bookings_no_overlapping_active_stays constraint surfacing
-- as a raw error at submit instead of the room greying out on the second
-- terminal.
--
-- REPLICA IDENTITY FULL matches every other table the app subscribes to
-- (orders, sessions, tables, service_requests, users). It is what puts the
-- pre-image in the WAL, so DELETE events can be matched against the
-- `restaurant_id=eq.<id>` filter the shared channel applies, and so handlers
-- can read `payload.old`. Both tables are low-write - a room's status changes a
-- handful of times a day - so the extra WAL volume is negligible.
--
-- RLS needs no change: staff_read_rooms / staff_read_bookings already gate on
-- `restaurant_id = current_restaurant_id()`, and both that and current_app_role
-- are STABLE wrappers over auth.jwt(), which Realtime evaluates per subscriber.

ALTER TABLE ONLY "public"."rooms" REPLICA IDENTITY FULL;
ALTER TABLE ONLY "public"."bookings" REPLICA IDENTITY FULL;

-- Idempotent: ALTER PUBLICATION ... ADD TABLE errors if the table is already a
-- member, which would break a replay onto an environment that has them.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'
    ) THEN
        ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."rooms";
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings'
    ) THEN
        ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bookings";
    END IF;
END
$$;
