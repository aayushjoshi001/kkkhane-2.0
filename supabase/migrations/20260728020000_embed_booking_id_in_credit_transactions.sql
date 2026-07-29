-- Migration: Embed booking_id in receivable_transactions description JSON on room checkout

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_restaurant_id UUID,
    p_session_id UUID,
    p_hotel_cash NUMERIC,
    p_hotel_qr NUMERIC,
    p_hotel_credit NUMERIC,
    p_rest_cash NUMERIC,
    p_rest_qr NUMERIC,
    p_rest_credit NUMERIC,
    p_discount_amount NUMERIC,
    p_discount_reason TEXT,
    p_hotel_credit_account_id UUID,
    p_guest_name TEXT,
    p_user_id UUID,
    p_partner_restaurant_id UUID DEFAULT NULL,
    p_payment_status TEXT DEFAULT 'paid',
    p_authoritative_total NUMERIC DEFAULT 0,
    p_orders_total NUMERIC DEFAULT 0,
    p_ledger_split_mode TEXT DEFAULT 'direct',
    p_commission_rate NUMERIC DEFAULT 0,
    p_extra_hour_charge NUMERIC DEFAULT 0,
    p_room_label TEXT DEFAULT '',
    p_bookings JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_booking_ids UUID[];
    v_room_ids UUID[];
    v_order_ids UUID[];
    v_already_out TEXT;
    v_alloc JSONB;
    v_total_rest_paid NUMERIC;
    v_commission_amount NUMERIC;
    v_net_to_restaurant NUMERIC;
BEGIN
    SELECT array_agg((elem->>'id')::uuid)
    INTO v_booking_ids
    FROM jsonb_array_elements(p_bookings) elem;

    IF v_booking_ids IS NULL OR array_length(v_booking_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings provided for checkout');
    END IF;

    SELECT array_agg(DISTINCT room_id)
    INTO v_room_ids
    FROM public.bookings
    WHERE id = ANY(v_booking_ids) AND room_id IS NOT NULL;

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

    SELECT array_agg(DISTINCT id)
    INTO v_order_ids
    FROM public.orders
    WHERE (
        booking_id = ANY(v_booking_ids)
        OR session_id = p_session_id
        OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        )
    )
    AND status != 'cancelled';

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

    UPDATE public.sessions
    SET status = 'closed', closed_at = now()
    WHERE (
        id = p_session_id
        OR booking_id = ANY(v_booking_ids)
        OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
    )
    AND status = 'active';

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
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids));

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
            status = 'checked_out',
            checked_out_at = now()
        WHERE id = (v_alloc->>'id')::uuid;
    END LOOP;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id,
                p_hotel_credit_account_id,
                'charge',
                p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', v_booking_ids,
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted',
                p_user_id
            );
        END IF;

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
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id,
                p_hotel_credit_account_id,
                'charge',
                p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', v_booking_ids,
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted',
                p_user_id
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
        PERFORM public.post_expense_sql(
            p_restaurant_id,
            p_user_id,
            p_discount_amount,
            'Bargain Discount Expense',
            'Staff Bargain Discount: Guest ' || p_guest_name || ' (Rooms ' || p_room_label || ') - Reason: ' || COALESCE(NULLIF(p_discount_reason, ''), 'Unspecified'),
            'posted'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_ids', v_booking_ids,
        'order_ids', v_order_ids
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;
