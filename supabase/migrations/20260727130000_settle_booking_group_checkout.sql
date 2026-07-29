-- Settling a multi-room reservation in one transaction.
--
-- settle_booking_checkout_v2 closes exactly one booking and posts one set of
-- ledger entries for it. Calling it once per room in a group would be wrong on
-- both counts: the rooms would check out in separate transactions (so a failure
-- half-way leaves a guest checked out of two rooms and still in the third), and
-- one payment would be posted to the day book several times over.
--
-- This is the group equivalent. It locks every member booking up front, closes
-- them together, and posts the ledger ONCE for the reservation's combined
-- total. Per-room financial figures still land on each booking row — the caller
-- passes an allocation in p_bookings so total_amount/paid_amount/discount stay
-- meaningful per room for revenue reporting, while the guest pays once.
--
-- p_bookings is a jsonb array; one element per room:
--   { "booking_id": uuid, "room_id": uuid, "total_amount": numeric,
--     "paid_amount": numeric, "discount_amount": numeric }

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb,
    p_restaurant_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_label text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_already_out text;
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

    -- The whole reservation settles or none of it does: if any room was already
    -- closed out, abort rather than partially re-settling the rest.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_out
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_out IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already checked out: room ' || v_already_out
        );
    END IF;

    -- 2. Lock orders reachable from any member booking or the active session
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id
        FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = ANY(v_booking_ids)
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close every member booking
    UPDATE public.bookings
    SET status = 'checked_out'
    WHERE id = ANY(v_booking_ids);

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now()
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and close sessions belonging to any room in the group
    UPDATE public.sessions
    SET status = 'closed', closed_at = now()
    WHERE (id = p_session_id OR booking_id = ANY(v_booking_ids))
    AND status = 'active';

    -- 6. Snapshot linked tenant IDs historically
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
    WHERE id = p_session_id OR booking_id = ANY(v_booking_ids);

    -- 7. Persist each room's own share of the settlement. The reservation was
    -- paid once, but splitting the figures back out per room keeps revenue-by-
    -- room reporting truthful instead of dumping the whole bill on one room.
    -- The extra-hour charge rides on the first room only, so summing member
    -- rows still reproduces the reservation total exactly.
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
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0)
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- 8. Every room in the group goes to housekeeping
    UPDATE public.rooms
    SET status = 'dirty'
    WHERE id = ANY(v_room_ids);

    -- 9. Post ledger entries ONCE for the whole reservation, labelled with every
    -- room it covered. Identical in structure to settle_booking_checkout_v2 —
    -- only the amounts are the group's combined figures.
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- Recorded under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
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

    -- 10. Bargain discount expense, once for the reservation
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    -- 11. Extra hour charge income, once for the reservation
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
