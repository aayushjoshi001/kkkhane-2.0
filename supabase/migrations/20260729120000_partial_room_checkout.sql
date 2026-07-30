-- Let one room leave a shared bill without settling it.
--
-- A combined bill settles and closes as one unit, which is right when everyone
-- leaves together and wrong the moment they don't. Two colleagues share a bill;
-- one flies out Wednesday, the other stays to Friday. Until now the desk had to
-- either separate Wednesday's room onto its own bill — defeating the point of
-- combining them — or leave a departed guest checked in for two days, holding a
-- room that housekeeping could not turn over and reception could not re-let.
--
-- So a room can now depart on its own while staying on the bill. Its status
-- goes to 'checked_out' (which is what frees the room to be re-let — see the
-- active-booking guard in /api/bookings) and `checked_out_at` freezes its
-- nights, but its `group_id` is untouched, so its stay cost, its orders and its
-- charges all stay on the combined folio and settle with everyone else at the
-- end. No money moves at departure.
--
-- Two consequences fall out of a room being releasable mid-reservation, both
-- handled below:
--
--   * That room may have a NEW guest in it by the time the bill settles. The
--     group RPC used to send every room of the reservation to housekeeping and
--     close every session on those rooms' tables — which would now evict a
--     stranger. Both are re-scoped to the rooms this reservation still occupies.
--   * 'checked_out' can no longer mean "already settled". The RPC's re-settle
--     guard read it that way and would refuse to close the remaining rooms, so
--     it now reads an explicit settlement stamp instead.

-- Widened from "settled early and kept the room" to "this stay's bill was
-- closed out", and now stamped by every settlement path rather than only the
-- early ones. That is what makes it a trustworthy re-settle guard: departure
-- and settlement are no longer the same event, so only an explicit mark can
-- tell them apart.
COMMENT ON COLUMN public.bookings.bill_settled_at IS
    'When this stay''s bill was closed out. Stamped by every settlement, and kept at the FIRST one if a stay settles more than once. NULL means never settled — including a room that departed early and is still riding on a shared bill. "Settled but still in the room" is this being set while status is still checked_in.';

-- Every stay closed before this column existed was settled at checkout, because
-- checking out was the only way to close one. Without this they would read as
-- unsettled and the guard below would happily re-settle them.
UPDATE public.bookings
SET bill_settled_at = COALESCE(checked_out_at, check_out)
WHERE status = 'checked_out'
  AND bill_settled_at IS NULL;

DROP FUNCTION IF EXISTS public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean);
DROP FUNCTION IF EXISTS public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean);

-- Single-room settlement. Unchanged but for stamping bill_settled_at on every
-- settlement rather than only early ones; a lone room has no partial departure
-- to worry about, so its guard still reads status.
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid, p_restaurant_id uuid, p_room_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_number text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_settled_now numeric, p_new_paid_amount numeric, p_payment_status text,
    p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text,
    p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = p_booking_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id) AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = COALESCE(bill_settled_at, now())
    WHERE id = p_booking_id;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = p_room_id;
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb, p_restaurant_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_label text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_payment_status text, p_authoritative_total numeric, p_orders_total numeric,
    p_ledger_split_mode text, p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    -- The rooms this reservation is STILL in. A room that departed early may
    -- already have a different guest in it, so anything that closes a room or
    -- its sessions must work from this list, never from every room the bill
    -- happens to cover.
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    -- 1. Lock every member booking before touching anything, so two cashiers
    -- settling the same reservation serialize instead of double-posting.
    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    -- The whole reservation settles or none of it does. This reads the
    -- settlement stamp rather than 'checked_out', which since partial departure
    -- exists no longer means "already paid for": a room that left early is
    -- checked out precisely so it can be re-let, and its share of this bill is
    -- still owed.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_settled
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.bill_settled_at IS NOT NULL;

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already settled: room ' || v_already_settled
        );
    END IF;

    SELECT COALESCE(array_agg(b.room_id), ARRAY[]::uuid[])
    INTO v_open_room_ids
    FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids) AND b.status <> 'checked_out';

    -- 2. Lock orders reachable from any member booking or the active session.
    -- The room-table clause is scoped to rooms still held: a departed room's own
    -- orders are already reachable through booking_id, whereas sweeping by room
    -- would drag in whatever the next guest has since ordered there.
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids))))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = ANY(v_booking_ids);
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids)))
        AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = COALESCE(bill_settled_at, now())
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- Only the rooms this reservation still occupies go to housekeeping. One
    -- that departed earlier was handed over then, and may be someone else's now.
    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_open_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

-- Recreating a function resets its ACL to PUBLIC EXECUTE, and both of these
-- move money. Restore the lockdown from 20260728092457.
REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;
