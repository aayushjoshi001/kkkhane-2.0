-- Add money to a booking's paid_amount in one statement.
--
-- Two call sites read paid_amount into JS, added to it and wrote the sum back
-- (/api/bookings/advance and /api/tables/checkout crediting a linked table bill
-- to the stay). Two advances taken at the same moment, or a table bill settled
-- while the desk takes a deposit, and one of them is lost: its booking_payments
-- row and its ledger posting survive, so the books say the money came in while
-- the guest's balance says it did not.
--
-- Returns the new balance so callers that need it (the advance route reports it
-- back to the screen) do not have to re-read.

CREATE OR REPLACE FUNCTION public.increment_booking_paid_amount(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_new_paid numeric;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'increment_booking_paid_amount: amount must be greater than zero';
    END IF;

    UPDATE public.bookings
    SET paid_amount = COALESCE(paid_amount, 0) + p_amount
    WHERE id = p_booking_id
      AND restaurant_id = p_restaurant_id
    RETURNING paid_amount INTO v_new_paid;

    IF v_new_paid IS NULL THEN
        RAISE EXCEPTION 'increment_booking_paid_amount: booking % not found for this restaurant', p_booking_id;
    END IF;

    RETURN v_new_paid;
END;
$function$;

-- Same lockdown the other settlement functions get: reachable by the server's
-- service role, never by an anon or authenticated caller directly.
REVOKE ALL ON FUNCTION public.increment_booking_paid_amount(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_booking_paid_amount(uuid, uuid, numeric) TO service_role;
