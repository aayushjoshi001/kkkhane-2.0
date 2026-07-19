-- 1. Add extra_hour_charge column to bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS extra_hour_charge NUMERIC NOT NULL DEFAULT 0;

-- 2. Drop the old settle_booking_checkout_v2 function to avoid overloading
DROP FUNCTION IF EXISTS public.settle_booking_checkout_v2(
    uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric
);

-- 3. Create updated settle_booking_checkout_v2 function supporting extra_hour_charge
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
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
    p_room_number text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_settled_now numeric,
    p_new_paid_amount numeric,
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
    v_booking_status text;
    v_order_ids uuid[];
    v_sid uuid;
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    -- 1. Row Locking for serialization
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- 2. Lock orders matching booking or session to prevent race conditions
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids 
    FROM (
        SELECT id 
        FROM public.orders 
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Update Bookings Status
    UPDATE public.bookings 
    SET status = 'checked_out' 
    WHERE id = p_booking_id;

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

    -- 5. Settle and Close Sessions
    UPDATE public.sessions 
    SET status = 'closed', closed_at = now() 
    WHERE (id = p_session_id OR booking_id = p_booking_id) 
    AND status = 'active';

    -- 6. Snapshot Linked Tenant IDs historically on Invoices/Orders/Sessions
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

    -- 7. Persist booking financial totals
    UPDATE public.bookings 
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0)
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty
    UPDATE public.rooms 
    SET status = 'dirty' 
    WHERE id = p_room_id;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        -- Post Hotel stays directly under Hotel books
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Post Restaurant Portion under Restaurant's Ledger.
        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- We record it under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id, 
                NULL, 
                v_total_rest_paid, 
                'cash', -- Cash ledger entry so it does NOT affect restaurant bank account statements
                'Accounts Receivable from Hotel', 
                'order_payment', 
                'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Create B2B Entries if partner restaurant is linked and there are orders
        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            -- Commissions calculations
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            -- A. Hotel Side: Record Accounts Payable (liability expense) to Restaurant
            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');
            
            -- If commission is earned, Hotel records commission income
            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            -- B. Restaurant Side: Record Accounts Receivable from Hotel
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain Discounts Expense (If applied)
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    -- 11. Extra Hour Charge Income (If applied)
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
