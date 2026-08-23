-- Record what a booking payment IS, instead of inferring it from its note text.
--
-- An advance and a settlement are different things -- one reduces what the guest
-- still owes, the other IS the payment of it -- and the only thing separating
-- them was the literal note 'Settlement' written by the checkout route. `note`
-- is user-editable free text on the advance form, so a clerk typing "Settlement"
-- into it reclassified their own deposit: bookingBill dropped it from
-- advanceTotal and the guest was asked for the full bill again. shiftCash and
-- the customer statement key off the same string.
--
-- Backfilled from the note so existing rows carry the same meaning they had.
-- Readers keep a note-based fallback for NULL, which is what rows written by the
-- previous release during a rollout will have.

ALTER TABLE public.booking_payments
    ADD COLUMN IF NOT EXISTS payment_kind text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_payment_kind_check'
    ) THEN
        ALTER TABLE public.booking_payments
            ADD CONSTRAINT booking_payments_payment_kind_check
            CHECK (payment_kind IS NULL OR payment_kind IN ('advance', 'settlement'));
    END IF;
END $$;

UPDATE public.booking_payments
SET payment_kind = CASE WHEN note = 'Settlement' THEN 'settlement' ELSE 'advance' END
WHERE payment_kind IS NULL;

COMMENT ON COLUMN public.booking_payments.payment_kind IS
    'advance = money taken before settlement; settlement = the payment of the bill itself. NULL only for rows written by a release that predates this column - readers fall back to note = ''Settlement''.';
