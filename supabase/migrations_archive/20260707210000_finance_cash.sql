-- ============================================================
-- Finance Module — Cash Management (structure only, Phase 1)
-- Migration: 20260707210000_finance_cash.sql
--
-- Tables: cash_drawers, cash_transactions, cash_counts
-- No posting/balance-calculation logic — amounts are recorded as-entered.
-- Follows the exact conventions established in 20260707150000_day_book.sql.
-- ============================================================

-- ============================================================
-- 1. CASH DRAWERS (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_drawers (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    location         text,
    opening_balance  numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (opening_balance >= 0),
    is_active        boolean     NOT NULL DEFAULT true,
    created_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cash_drawers_unique_name UNIQUE (restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cash_drawers_restaurant_id ON public.cash_drawers (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawers_active ON public.cash_drawers (restaurant_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_cash_drawers_updated_at ON public.cash_drawers;
CREATE TRIGGER trg_cash_drawers_updated_at
    BEFORE UPDATE ON public.cash_drawers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. CASH TRANSACTIONS
-- Cash In / Cash Out / Opening / Closing / Transfer / Adjustment
-- are all `type` values on this one table (see FinanceNav tabs).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_transactions (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id          uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    drawer_id              uuid        NOT NULL REFERENCES public.cash_drawers(id) ON DELETE CASCADE,
    type                   text        NOT NULL CHECK (type IN (
                                           'cash_in', 'cash_out', 'opening', 'closing',
                                           'transfer_in', 'transfer_out', 'adjustment'
                                       )),
    amount                 numeric(12, 2) NOT NULL CHECK (amount > 0),
    description            text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    counterparty_drawer_id uuid        REFERENCES public.cash_drawers(id) ON DELETE SET NULL,
    shift_id               uuid        REFERENCES public.staff_shifts(id) ON DELETE SET NULL,
    status                 text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
    created_by             uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_restaurant_created
    ON public.cash_transactions (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_drawer_id ON public.cash_transactions (drawer_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_counterparty_drawer_id ON public.cash_transactions (counterparty_drawer_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_shift_id ON public.cash_transactions (shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_type ON public.cash_transactions (restaurant_id, type);

-- ============================================================
-- 3. CASH COUNTS (Cash Counting / Reconciliation)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_counts (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    drawer_id      uuid        NOT NULL REFERENCES public.cash_drawers(id) ON DELETE CASCADE,
    counted_total  numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (counted_total >= 0),
    expected_total numeric(12, 2),
    variance       numeric(12, 2),
    denominations  jsonb,
    notes          text,
    status         text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reconciled', 'flagged')),
    counted_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_counts_restaurant_created
    ON public.cash_counts (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_counts_drawer_id ON public.cash_counts (drawer_id);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- Same staff-read / manager+super_admin-manage pattern as day_book.
-- (No cashier — Finance lives under /admin/finance, which already
-- gates to super_admin/manager at the layout level.)
-- ============================================================
ALTER TABLE public.cash_drawers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_counts       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_cash_drawers"   ON public.cash_drawers;
DROP POLICY IF EXISTS "admin_manage_cash_drawers" ON public.cash_drawers;
CREATE POLICY "staff_read_cash_drawers" ON public.cash_drawers
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_cash_drawers" ON public.cash_drawers
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_cash_transactions"   ON public.cash_transactions;
DROP POLICY IF EXISTS "admin_manage_cash_transactions" ON public.cash_transactions;
CREATE POLICY "staff_read_cash_transactions" ON public.cash_transactions
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_cash_transactions" ON public.cash_transactions
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_cash_counts"   ON public.cash_counts;
DROP POLICY IF EXISTS "admin_manage_cash_counts" ON public.cash_counts;
CREATE POLICY "staff_read_cash_counts" ON public.cash_counts
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_cash_counts" ON public.cash_counts
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
