-- Self-service ordering: sessions now auto-open when a guest scans the table QR
-- (gated by the WiFi/IP restriction), so there is no waiter to record as the opener.
-- Allow opened_by to be NULL for these guest-initiated sessions.
ALTER TABLE public.sessions ALTER COLUMN opened_by DROP NOT NULL;
