-- Remembers a service charge the cashier typed over at checkout.
--
-- The folio recomputes a stay's service charge from the rules every time it is
-- asked (see computeFolioForStays: 10% of kitchen items, gated on
-- roomServiceChargeEnabled and the per-room allowlist). That is the right
-- behaviour while a guest is in house, but it means a charge the cashier
-- deliberately moved at settlement was forgotten the moment the request ended:
-- the emailed invoice and the guest-facing stay bill both rebuild the folio
-- from the database and would quote the automatic figure, disagreeing with the
-- money actually taken.
--
-- bookings.discount_amount already solves exactly this problem for the other
-- staff-applied adjustment on the same bill; this is its counterpart.
--
-- NULL means "no override" — the folio falls back to computing the charge, as
-- it always has. That is distinct from 0, which is a cashier deliberately
-- waiving the charge, so the column must stay nullable rather than defaulting.
-- No backfill: every stay settled before this column existed was billed at
-- whatever the rules said at the time, which is what a NULL already replays.

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS service_charge_override numeric;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_service_charge_override_non_negative'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_service_charge_override_non_negative
            CHECK (service_charge_override IS NULL OR service_charge_override >= 0);
    END IF;
END $$;

COMMENT ON COLUMN public.bookings.service_charge_override IS
    'Service charge the cashier set at checkout, replacing the figure the folio rules produce. NULL means no override (recompute from the rules); 0 means the charge was deliberately waived. Billed as the difference from the automatic figure, never on top of it.';
