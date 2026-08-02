-- Fix PostgreSQL error: "FOR UPDATE is not allowed with aggregate functions"
-- Separates row locking (PERFORM ... FOR UPDATE) from aggregate functions (string_agg, array_agg)
-- in settle_booking_checkout_v2 and settle_booking_group_checkout.

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
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
        SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
    AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        PERFORM 1 FROM public.orders WHERE id = ANY(v_order_ids) FOR UPDATE;
    END IF;

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
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
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
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
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

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, p_new_paid_amount - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Room ' || p_room_number || ')',
            'refund', p_user_id
        );
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
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
    v_sum_group_paid numeric := 0;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((value->>'booking_id')::uuid), array_agg((value->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings);

    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    SELECT string_agg(b.id::text, ', ') INTO v_already_settled
    FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more bookings are already checked out: ' || v_already_settled);
    END IF;

    SELECT COALESCE(array_agg(room_id), ARRAY[]::uuid[]) INTO v_open_room_ids
    FROM public.bookings
    WHERE id = ANY(v_booking_ids) AND status != 'checked_out';

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE (booking_id = ANY(v_booking_ids)
        OR session_id = p_session_id
        OR session_id IN (SELECT id FROM public.sessions WHERE booking_id = ANY(v_booking_ids)))
    AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        PERFORM 1 FROM public.orders WHERE id = ANY(v_order_ids) FOR UPDATE;
    END IF;

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
        v_sum_group_paid := v_sum_group_paid + COALESCE((v_alloc->>'paid_amount')::numeric, 0);

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

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
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
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
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
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, v_sum_group_paid - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Rooms ' || p_room_label || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

-- Clean up any rooms currently stuck in 'occupied' whose stays are already checked out
UPDATE public.rooms
SET status = 'dirty'
WHERE status = 'occupied'
  AND id NOT IN (
      SELECT room_id FROM public.bookings WHERE status IN ('checked_in', 'pending')
  );
