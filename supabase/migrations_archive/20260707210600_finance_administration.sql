-- ============================================================
-- Finance Module — Administration (structure only, Phase 1)
-- Migration: 20260707210600_finance_administration.sql
--
-- Tables: chart_of_accounts, voucher_types, finance_payment_methods,
--         approval_levels, fiscal_years, accounting_periods, finance_settings
--
-- Chart of Accounts is an inert hierarchical master here — no posting
-- or auto-account-mapping logic is attached (that is explicitly out
-- of scope; DOC-005 defines the account structure/mapping rules).
-- finance_payment_methods addresses the fragmented payment-method
-- vocabulary found across orders/bookings/payment_verifications/day_book
-- — this is the shared master those tables can migrate onto later.
-- ============================================================

-- ============================================================
-- 1. CHART OF ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    code          text        NOT NULL CHECK (char_length(code) BETWEEN 1 AND 30),
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    account_type  text        NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
    parent_id     uuid        REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chart_of_accounts_unique_code UNIQUE (restaurant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_restaurant_id ON public.chart_of_accounts (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_parent_id ON public.chart_of_accounts (parent_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type ON public.chart_of_accounts (restaurant_id, account_type);

DROP TRIGGER IF EXISTS trg_chart_of_accounts_updated_at ON public.chart_of_accounts;
CREATE TRIGGER trg_chart_of_accounts_updated_at
    BEFORE UPDATE ON public.chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. VOUCHER TYPES (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voucher_types (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id     uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name              text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    voucher_category  text        NOT NULL CHECK (voucher_category IN ('receipt', 'payment', 'journal', 'contra')),
    prefix            text        NOT NULL CHECK (char_length(prefix) BETWEEN 1 AND 10),
    is_active         boolean     NOT NULL DEFAULT true,
    created_by        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT voucher_types_unique_prefix UNIQUE (restaurant_id, prefix)
);
CREATE INDEX IF NOT EXISTS idx_voucher_types_restaurant_id ON public.voucher_types (restaurant_id);

-- ============================================================
-- 3. FINANCE PAYMENT METHODS (master)
-- The single source of truth other modules can migrate onto —
-- not wired into orders/bookings/day_book in this phase.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_payment_methods (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    category      text        NOT NULL CHECK (category IN ('cash', 'bank', 'wallet')),
    is_active     boolean     NOT NULL DEFAULT true,
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT finance_payment_methods_unique_name UNIQUE (restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_finance_payment_methods_restaurant_id ON public.finance_payment_methods (restaurant_id);

-- ============================================================
-- 4. APPROVAL LEVELS (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.approval_levels (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    level_order   integer     NOT NULL CHECK (level_order > 0),
    min_amount    numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (min_amount >= 0),
    max_amount    numeric(12, 2) CHECK (max_amount IS NULL OR max_amount >= min_amount),
    role_required text        NOT NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT approval_levels_unique_order UNIQUE (restaurant_id, level_order)
);
CREATE INDEX IF NOT EXISTS idx_approval_levels_restaurant_id ON public.approval_levels (restaurant_id);

-- ============================================================
-- 5. FISCAL YEARS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fiscal_years (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    start_date    date        NOT NULL,
    end_date      date        NOT NULL,
    is_current    boolean     NOT NULL DEFAULT false,
    status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fiscal_years_valid_range CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_restaurant_id ON public.fiscal_years (restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_years_one_current
    ON public.fiscal_years (restaurant_id) WHERE is_current = true;

-- ============================================================
-- 6. ACCOUNTING PERIODS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.accounting_periods (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    fiscal_year_id uuid        NOT NULL REFERENCES public.fiscal_years(id) ON DELETE CASCADE,
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    start_date     date        NOT NULL,
    end_date       date        NOT NULL,
    status         text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT accounting_periods_valid_range CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_restaurant_id ON public.accounting_periods (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_fiscal_year_id ON public.accounting_periods (fiscal_year_id);

-- ============================================================
-- 7. FINANCE SETTINGS (one row per restaurant)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_settings (
    restaurant_id           uuid        PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
    base_currency           text        NOT NULL DEFAULT 'NPR',
    default_tax_rate        numeric(5, 2) NOT NULL DEFAULT 0.00 CHECK (default_tax_rate >= 0),
    fiscal_year_start_month integer     NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    rounding_mode           text        NOT NULL DEFAULT 'nearest' CHECK (rounding_mode IN ('nearest', 'up', 'down', 'none')),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_finance_settings_updated_at ON public.finance_settings;
CREATE TRIGGER trg_finance_settings_updated_at
    BEFORE UPDATE ON public.finance_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.chart_of_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_levels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_years           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_settings       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_chart_of_accounts"   ON public.chart_of_accounts;
DROP POLICY IF EXISTS "admin_manage_chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "staff_read_chart_of_accounts" ON public.chart_of_accounts
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_chart_of_accounts" ON public.chart_of_accounts
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_voucher_types"   ON public.voucher_types;
DROP POLICY IF EXISTS "admin_manage_voucher_types" ON public.voucher_types;
CREATE POLICY "staff_read_voucher_types" ON public.voucher_types
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_voucher_types" ON public.voucher_types
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_finance_payment_methods"   ON public.finance_payment_methods;
DROP POLICY IF EXISTS "admin_manage_finance_payment_methods" ON public.finance_payment_methods;
CREATE POLICY "staff_read_finance_payment_methods" ON public.finance_payment_methods
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_finance_payment_methods" ON public.finance_payment_methods
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_approval_levels"   ON public.approval_levels;
DROP POLICY IF EXISTS "admin_manage_approval_levels" ON public.approval_levels;
CREATE POLICY "staff_read_approval_levels" ON public.approval_levels
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_approval_levels" ON public.approval_levels
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_fiscal_years"   ON public.fiscal_years;
DROP POLICY IF EXISTS "admin_manage_fiscal_years" ON public.fiscal_years;
CREATE POLICY "staff_read_fiscal_years" ON public.fiscal_years
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_fiscal_years" ON public.fiscal_years
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_accounting_periods"   ON public.accounting_periods;
DROP POLICY IF EXISTS "admin_manage_accounting_periods" ON public.accounting_periods;
CREATE POLICY "staff_read_accounting_periods" ON public.accounting_periods
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_accounting_periods" ON public.accounting_periods
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_finance_settings"   ON public.finance_settings;
DROP POLICY IF EXISTS "admin_manage_finance_settings" ON public.finance_settings;
CREATE POLICY "staff_read_finance_settings" ON public.finance_settings
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_finance_settings" ON public.finance_settings
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
