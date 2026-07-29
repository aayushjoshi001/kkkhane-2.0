-- post_payment_income_sql opens a day-book session when none is currently open,
-- and inserted `CURRENT_DATE::text` into day_book_sessions.date, which is a
-- `date` column. Postgres does not implicitly cast text to date on INSERT, so
-- that statement raises:
--
--     column "date" is of type date but expression is of type text
--
-- The function is called by every checkout path (settle_booking_checkout_v2,
-- settle_booking_group_checkout, table settlement), each of which wraps it in
-- `EXCEPTION WHEN OTHERS` — so the failure surfaced as a generic "Checkout
-- transaction failed" rather than pointing at the cast. It only bites when
-- there is no open session to reuse, which is why it survived: in day-to-day
-- use a session is almost always already open.
--
-- Introduced in 20260714110000_advanced_tenant_integration.sql. Only the cast
-- changes here; the rest of the body is reproduced verbatim.

CREATE OR REPLACE FUNCTION public.post_payment_income_sql(
    p_restaurant_id uuid,
    p_user_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_category_name text,
    p_day_book_category text,
    p_desc text
) RETURNS void
SECURITY DEFINER
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
        VALUES (p_restaurant_id, CURRENT_DATE, 0.00, 0.00, 'open', p_user_id)
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
