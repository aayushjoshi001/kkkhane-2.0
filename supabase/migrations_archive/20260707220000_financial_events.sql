-- ============================================================
-- Finance Module — Financial Event Engine infrastructure (Phase 2, Step 1)
-- Migration: 20260707220000_financial_events.sql
--
-- Tables: financial_event_sequences, financial_events
-- Function: generate_financial_event_code(p_restaurant_id uuid)
--
-- This is infrastructure ONLY — no vouchers, journals, balances, or
-- reports are created or updated by anything in this migration.
-- Nothing writes to this table yet; it is wired up in a later step.
--
-- `company_id`/`branch_id` from the spec: this app's tenant boundary is
-- `restaurant_id` everywhere (RLS, every other table) — used here as the
-- required tenant column instead of a redundant `company_id`. `branch_id`
-- is kept as a nullable, unenforced column for forward compatibility
-- since no branches table exists yet (matches Phase 1's posture).
-- ============================================================

-- ============================================================
-- 1. FINANCIAL EVENT SEQUENCES
-- Mirrors invoice_sequences / generate_invoice_number() exactly —
-- one atomic per-restaurant counter per calendar year.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_event_sequences (
    restaurant_id  uuid        PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
    year           text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'YYYY'),
    current_number integer     NOT NULL DEFAULT 0,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.generate_financial_event_code(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_seq  INTEGER;
    v_year TEXT := to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
BEGIN
    INSERT INTO financial_event_sequences (restaurant_id, year, current_number)
    VALUES (p_restaurant_id, v_year, 1)
    ON CONFLICT (restaurant_id) DO UPDATE
        SET current_number = CASE
                WHEN financial_event_sequences.year = v_year THEN financial_event_sequences.current_number + 1
                ELSE 1
            END,
            year = v_year,
            updated_at = now()
    RETURNING current_number INTO v_seq;

    RETURN 'FE-' || v_year || '-' || lpad(v_seq::TEXT, 6, '0');
END;
$$;

-- ============================================================
-- 2. FINANCIAL EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_events (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_code         text        NOT NULL,
    event_type         text        NOT NULL CHECK (event_type IN (
                                       'RESTAURANT_SALE', 'HOTEL_CHECKOUT', 'BOOKING_ADVANCE',
                                       'INVENTORY_PURCHASE', 'SUPPLIER_PAYMENT', 'SALARY_PAYMENT',
                                       'CASH_DEPOSIT', 'CASH_WITHDRAWAL', 'BANK_TRANSFER',
                                       'EXPENSE_PAYMENT', 'OTHER_INCOME', 'LOAN_RECEIVED',
                                       'LOAN_REPAYMENT', 'OWNER_INVESTMENT', 'OWNER_WITHDRAWAL',
                                       'REFUND', 'ADJUSTMENT'
                                   )),
    source_module      text        NOT NULL,
    source_id          text,
    restaurant_id      uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    branch_id          uuid,
    business_date      date        NOT NULL,
    accounting_date    date        NOT NULL,
    amount             numeric(18, 2) NOT NULL CHECK (amount >= 0),
    currency           text        NOT NULL DEFAULT 'NPR',
    payment_method_id  uuid        REFERENCES public.finance_payment_methods(id) ON DELETE SET NULL,
    customer_id        uuid,
    supplier_id        uuid        REFERENCES public.suppliers(id) ON DELETE SET NULL,
    employee_id        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    reference_number   text,
    description        text,
    metadata           jsonb,
    status             text        NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                                       'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVERSED'
                                   )),
    retry_count        integer     NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    created_by         uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    processed_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT financial_events_unique_code UNIQUE (restaurant_id, event_code)
);

-- One financial event per business action (DOC-004 Rule 1) — an
-- integrity guard, not accounting logic. Partial: only enforced when
-- the source module actually supplies a source_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_events_unique_source
    ON public.financial_events (restaurant_id, source_module, source_id, event_type)
    WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_events_restaurant_created
    ON public.financial_events (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_events_status
    ON public.financial_events (restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_events_type
    ON public.financial_events (restaurant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_financial_events_business_date
    ON public.financial_events (restaurant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_events_payment_method_id
    ON public.financial_events (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_supplier_id
    ON public.financial_events (supplier_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_employee_id
    ON public.financial_events (employee_id);

DROP TRIGGER IF EXISTS trg_financial_events_updated_at ON public.financial_events;
CREATE TRIGGER trg_financial_events_updated_at
    BEFORE UPDATE ON public.financial_events
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.financial_event_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_events           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_financial_event_sequences" ON public.financial_event_sequences;
CREATE POLICY "staff_read_financial_event_sequences" ON public.financial_event_sequences
    FOR SELECT USING (restaurant_id = current_restaurant_id());
-- No direct write policy — only the SECURITY DEFINER function above writes to this table.

DROP POLICY IF EXISTS "staff_read_financial_events"   ON public.financial_events;
DROP POLICY IF EXISTS "admin_manage_financial_events" ON public.financial_events;
CREATE POLICY "staff_read_financial_events" ON public.financial_events
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_financial_events" ON public.financial_events
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
