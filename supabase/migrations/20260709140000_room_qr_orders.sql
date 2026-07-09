-- Room QR ordering: key the room↔order relationship instead of matching strings.
--
-- Until now a hotel room reached the kitchen only because someone happened to
-- create a dining `table` whose `label` equalled the room number, and the folio
-- re-discovered those orders in the browser with
-- `table.label === room.room_number`. Rename a table, add a duplicate, or type
-- "Rm 203" and the guest's orders silently detached from their folio — they
-- checked out unbilled and nothing errored.
--
-- Two columns fix that:
--   • tables.room_id   — the room's QR *is* that table's qr_token, now joined by key.
--   • orders.booking_id — an in-room order belongs to the stay, durably, so the
--     folio survives the session closing or expiring.

-- ── The room ↔ table bridge ──────────────────────────────────────────────────
ALTER TABLE public.tables
    ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL;

-- A room has at most one QR/table. Partial so ordinary dining tables (room_id
-- NULL) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS tables_room_id_uniq
    ON public.tables (room_id)
    WHERE room_id IS NOT NULL;

-- ── The session ↔ stay link ──────────────────────────────────────────────────
-- The application already reads and writes this column — linkSessionToBooking()
-- in waiter/actions.ts, the `sessions ( id, booking_id, … )` selects on the
-- cashier page, and /api/bookings/linked-orders — but it was never created (the
-- baseline is a dump of the public schema and this column went missing with it).
-- Every one of those queries errors with "column booking_id does not exist"
-- today, which is why linking a dining session to a guest's room does nothing.
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_booking_id_idx
    ON public.sessions (booking_id)
    WHERE booking_id IS NOT NULL;

-- ── The order ↔ stay (folio) link ────────────────────────────────────────────
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_booking_id_idx
    ON public.orders (booking_id)
    WHERE booking_id IS NOT NULL;

-- ── Backfill the bridge from the old label convention ────────────────────────
-- DISTINCT ON keeps the oldest matching table per room so the unique index can
-- never be violated by a duplicate/stray table sharing the room's label.
WITH pick AS (
    SELECT DISTINCT ON (r.id)
           r.id AS room_id,
           t.id AS table_id
    FROM public.rooms r
    JOIN public.tables t
      ON t.restaurant_id = r.restaurant_id
     AND (t.label = r.room_number OR t.label = 'Room ' || r.room_number)
    WHERE t.room_id IS NULL
    ORDER BY r.id, t.created_at
)
UPDATE public.tables t
SET room_id = p.room_id
FROM pick p
WHERE t.id = p.table_id;

-- ── Backfill the session ↔ stay link for open room sessions ──────────────────
UPDATE public.sessions s
SET booking_id = b.id
FROM public.tables t
JOIN public.bookings b ON b.room_id = t.room_id AND b.status = 'checked_in'
WHERE s.table_id = t.id
  AND t.room_id IS NOT NULL
  AND s.booking_id IS NULL
  AND s.status = 'active';

-- ── Backfill booking_id for orders already placed from a room ────────────────
-- Attribute each existing in-room order to the booking that was checked in when
-- it was placed (falling back to the stay that covers its timestamp).
UPDATE public.orders o
SET booking_id = b.id
FROM public.sessions s
JOIN public.tables t ON t.id = s.table_id AND t.room_id IS NOT NULL
JOIN public.bookings b ON b.room_id = t.room_id
WHERE o.session_id = s.id
  AND o.booking_id IS NULL
  AND o.placed_at >= b.check_in
  AND (b.status = 'checked_in' OR o.placed_at <= b.check_out);

COMMENT ON COLUMN public.tables.room_id IS
    'Hotel room this table is the in-room QR for. NULL for ordinary dining tables.';
COMMENT ON COLUMN public.orders.booking_id IS
    'Stay this order is billed to. Set at placement for in-room (room QR) orders.';
