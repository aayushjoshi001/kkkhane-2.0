-- Let a guest pay the bill and keep the room.
--
-- Settlement and departure were the same event: the only way to take a guest's
-- money through the folio was to check them out, which closed the stay, closed
-- the room's QR session and sent the room to housekeeping. But guests settle
-- early all the time — the company card is here now, the group is splitting up,
-- the guest is leaving before the desk is staffed — and the room is still
-- theirs until the morning. The desk's workaround was to check them out anyway
-- and re-book the room, which loses the stay's history, or to hold the money
-- off the books until they left, which misdates the revenue.
--
-- So the two events are separated. `p_close_stay` false posts every peso of the
-- settlement exactly as before — ledger, day book, partner split, credit,
-- discounts, orders marked paid and dropped out of the kitchen queue — and then
-- stops: the booking stays `checked_in`, the room stays `occupied`, and the
-- room's QR session stays open so the guest can keep ordering. What they order
-- afterwards lands on the same folio and shows up as a new balance, because
-- `paid_amount` is what settlement recorded and the folio is always recomputed
-- against it.
--
-- Passing `p_close_stay` true — every existing caller, by default — behaves
-- exactly as it did before this migration.

-- When the bill was settled ahead of departure. NULL is the ordinary case:
-- either still unsettled, or settled at checkout in the usual single step.
-- Distinct from payment_status='paid', which a stay also reaches by paying an
-- advance that happens to cover the total.
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS bill_settled_at timestamptz;

COMMENT ON COLUMN public.bookings.bill_settled_at IS
    'When the guest settled the bill without checking out. NULL means no early settlement — the stay is either unsettled or was settled at departure in one step. Anything charged after this timestamp reopens a balance on the same folio.';

CREATE INDEX IF NOT EXISTS bookings_bill_settled_idx
    ON public.bookings USING btree (restaurant_id, status)
    WHERE bill_settled_at IS NOT NULL;

-- Both RPCs gain a trailing parameter, so the old signatures have to go rather
-- than be replaced: a same-named overload would make every named-argument call
-- from the app ambiguous.
DROP FUNCTION IF EXISTS public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric);

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
    p_extra_hour_charge numeric DEFAULT 0,
    -- False settles the money and leaves the guest in the room. See the header.
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
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

    -- 3. Close the stay — skipped when the guest is only settling up.
    IF p_close_stay THEN
        UPDATE public.bookings
        SET status = 'checked_out'
        WHERE id = p_booking_id;
    END IF;

    -- 4. Mark matching order items as served. Runs either way: the guest has
    -- paid for this food, so it leaves the kitchen queue and the billing panels
    -- whether or not they are leaving the building.
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and Close Sessions. Left open on an early settlement — the
    -- guest still has the room, and closing their QR session would take away
    -- the ability to order anything else for the rest of the stay.
    IF p_close_stay THEN
        UPDATE public.sessions
        SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id)
        AND status = 'active';
    END IF;

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

    -- 7. Persist booking financial totals. bill_settled_at is stamped only on an
    -- early settlement, and only the first time: a guest who settles, orders
    -- another round and settles again keeps the timestamp of the first one,
    -- which is the one that tells the desk this room has been paying as it goes.
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
        bill_settled_at = CASE
            WHEN p_close_stay THEN bill_settled_at
            ELSE COALESCE(bill_settled_at, now())
        END
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty — only when the guest has actually left it.
    IF p_close_stay THEN
        UPDATE public.rooms
        SET status = 'dirty'
        WHERE id = p_room_id;
    END IF;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
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
                'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
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

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

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
    p_extra_hour_charge numeric DEFAULT 0,
    -- False settles the money and leaves every room of the reservation
    -- occupied. See the header.
    p_close_stay boolean DEFAULT true
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
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close every member booking — skipped when the guests are only
    -- settling up and keeping their rooms.
    IF p_close_stay THEN
        UPDATE public.bookings
        SET status = 'checked_out'
        WHERE id = ANY(v_booking_ids);
    END IF;

    -- 4. Mark matching order items as served. Runs either way — the food is
    -- paid for whether or not the guests are leaving.
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and close sessions belonging to any room in the group. The
    -- table_id clause is what catches the rooms the caller didn't name. Left
    -- open on an early settlement so the rooms can still order.
    IF p_close_stay THEN
        UPDATE public.sessions
        SET status = 'closed', closed_at = now()
        WHERE (
            id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        )
        AND status = 'active';
    END IF;

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
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids));

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
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = CASE
                WHEN p_close_stay THEN bill_settled_at
                ELSE COALESCE(bill_settled_at, now())
            END
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- 8. Every room in the group goes to housekeeping — only once the guests
    -- have actually left them.
    IF p_close_stay THEN
        UPDATE public.rooms
        SET status = 'dirty'
        WHERE id = ANY(v_room_ids);
    END IF;

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

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Recreating a function resets its ACL to the default, which on this database
-- means EXECUTE for PUBLIC — and both of these move money. Restore the locked
-- grants from 20260728092457: PUBLIC out, service_role (the only role the API
-- calls these as) in.
REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;
