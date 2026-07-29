-- Advanced Tenant Integration Schema
-- Adds advanced ledger split controls, secure invitations, P&L PIN structures,
-- historical snapshots for tax/audit safety, and transaction-locked checkout settlement.

-- 1. Add advanced settings and analytics columns to restaurants table
ALTER TABLE public.restaurants 
    ADD COLUMN IF NOT EXISTS ledger_split_mode text NOT NULL DEFAULT 'direct' CHECK (ledger_split_mode IN ('direct', 'b2b')),
    ADD COLUMN IF NOT EXISTS billing_commission_rate numeric(5,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS analytics_pin_hash text,
    ADD COLUMN IF NOT EXISTS analytics_shared boolean NOT NULL DEFAULT false;

-- 2. Add historical linkage snapshot columns to keep logs pristine if unlinked
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS historical_linked_hotel_id uuid,
    ADD COLUMN IF NOT EXISTS historical_linked_restaurant_id uuid;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS historical_linked_hotel_id uuid,
    ADD COLUMN IF NOT EXISTS historical_linked_restaurant_id uuid;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS historical_linked_hotel_id uuid,
    ADD COLUMN IF NOT EXISTS historical_linked_restaurant_id uuid;

-- 3. Create secure invitation tables
CREATE TABLE IF NOT EXISTS public.tenant_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    recipient_email text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on invitations
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- Invitations RLS Policies
DROP POLICY IF EXISTS "Staff can view invitations sent from their tenant" ON public.tenant_invitations;
CREATE POLICY "Staff can view invitations sent from their tenant" ON public.tenant_invitations
    FOR SELECT TO authenticated
    USING (sender_tenant_id = public.current_restaurant_id());

DROP POLICY IF EXISTS "Staff can manage invitations sent from their tenant" ON public.tenant_invitations;
CREATE POLICY "Staff can manage invitations sent from their tenant" ON public.tenant_invitations
    FOR ALL TO authenticated
    USING (sender_tenant_id = public.current_restaurant_id())
    WITH CHECK (sender_tenant_id = public.current_restaurant_id());

-- 4. Create analytics temporary sessions table (10 minutes)
CREATE TABLE IF NOT EXISTS public.analytics_session_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    viewer_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on session tokens
ALTER TABLE public.analytics_session_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view session tokens" ON public.analytics_session_tokens;
CREATE POLICY "Staff can view session tokens" ON public.analytics_session_tokens
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_restaurant_id() 
        OR 
        viewer_tenant_id = public.current_restaurant_id()
    );

-- 5. Create immutable PIN access audit logs table
CREATE TABLE IF NOT EXISTS public.cross_tenant_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    target_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    action text NOT NULL,
    details text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on audit logs (Only allow reading for own tenant logs)
ALTER TABLE public.cross_tenant_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read cross-tenant logs for their tenant" ON public.cross_tenant_audit_logs;
CREATE POLICY "Staff can read cross-tenant logs for their tenant" ON public.cross_tenant_audit_logs
    FOR SELECT TO authenticated
    USING (
        actor_tenant_id = public.current_restaurant_id() 
        OR 
        target_tenant_id = public.current_restaurant_id()
    );

-- 6. Indexes for database query performance
CREATE INDEX IF NOT EXISTS idx_invitations_sender ON public.tenant_invitations(sender_tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON public.tenant_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_session_tokens_viewer ON public.analytics_session_tokens(viewer_tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.cross_tenant_audit_logs(actor_tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.cross_tenant_audit_logs(target_tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_historical_link ON public.orders(historical_linked_hotel_id, historical_linked_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_historical_link ON public.bookings(historical_linked_hotel_id, historical_linked_restaurant_id);

-- 7. SQL helper functions for ledger entries
CREATE OR REPLACE FUNCTION public.post_payment_income_sql(
    p_restaurant_id uuid,
    p_user_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_category_name text,
    p_day_book_category text,
    p_desc text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_category_id uuid;
    v_bank_id uuid;
    v_session_id uuid;
    v_bank_name text;
    v_day_book_type text;
BEGIN
    IF p_amount <= 0 THEN
        RETURN;
    END IF;

    -- A. Resolve or create income category
    SELECT id INTO v_category_id FROM public.income_categories WHERE restaurant_id = p_restaurant_id AND name = p_category_name LIMIT 1;
    IF v_category_id IS NULL THEN
        INSERT INTO public.income_categories (restaurant_id, name)
        VALUES (p_restaurant_id, p_category_name)
        RETURNING id INTO v_category_id;
    END IF;

    -- B. Resolve default active bank account for digital payment methods
    IF p_payment_method IN ('qr_digital', 'card') THEN
        SELECT id, name INTO v_bank_id, v_bank_name FROM public.bank_accounts WHERE restaurant_id = p_restaurant_id AND is_active = true LIMIT 1;
    END IF;

    -- C. Insert Income Entry
    INSERT INTO public.income_entries (restaurant_id, category_id, amount, description, bank_account_id, status, created_by)
    VALUES (p_restaurant_id, v_category_id, p_amount, p_desc, v_bank_id, 'posted', p_user_id);

    -- D. Resolve or create active Day Book Session
    SELECT id INTO v_session_id FROM public.day_book_sessions WHERE restaurant_id = p_restaurant_id AND status = 'open' LIMIT 1;
    IF v_session_id IS NULL THEN
        INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
        VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
        RETURNING id INTO v_session_id;
    END IF;

    -- E. Insert Day Book Entry
    IF p_payment_method = 'cash' THEN
        v_day_book_type := 'cash_in';
    ELSE
        v_day_book_type := 'bank_in';
    END IF;

    INSERT INTO public.day_book_entries (session_id, restaurant_id, type, amount, description, category, bank_name, created_by)
    VALUES (v_session_id, p_restaurant_id, v_day_book_type, p_amount, p_desc, p_day_book_category, v_bank_name, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_expense_sql(
    p_restaurant_id uuid,
    p_user_id uuid,
    p_amount numeric,
    p_category_name text,
    p_desc text,
    p_status text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_category_id uuid;
BEGIN
    IF p_amount <= 0 THEN
        RETURN;
    END IF;

    -- Resolve or create expense category
    SELECT id INTO v_category_id FROM public.expense_categories WHERE restaurant_id = p_restaurant_id AND name = p_category_name LIMIT 1;
    IF v_category_id IS NULL THEN
        INSERT INTO public.expense_categories (restaurant_id, name)
        VALUES (p_restaurant_id, p_category_name)
        RETURNING id INTO v_category_id;
    END IF;

    -- Insert Expense
    INSERT INTO public.expenses (restaurant_id, category_id, amount, description, status, created_by)
    VALUES (p_restaurant_id, v_category_id, p_amount, p_desc, p_status, p_user_id);
END;
$$;

-- 8. Main transaction-locked settlement RPC
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
    p_session_id uuid,
    -- split amounts
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
    -- config options
    p_ledger_split_mode text,
    p_commission_rate numeric
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_sid uuid;
    v_rest_method text;
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
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty
    UPDATE public.rooms 
    SET status = 'dirty' 
    WHERE id = p_room_id;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        -- Post Hotel stays directly
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Post Restaurant Portion directly under Restaurant's Ledger
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            IF p_rest_qr > 0 THEN
                v_rest_method := 'qr_digital';
            ELSE
                v_rest_method := 'cash';
            END IF;
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, v_rest_method, 'Food Revenue', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order payment (' || p_guest_name || ')');
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

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    -- PL/pgSQL automatically rolls back the transaction on exception
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
