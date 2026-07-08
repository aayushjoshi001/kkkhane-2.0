-- ============================================================
-- Finance Module — Loans & Budget (structure only, Phase 1)
-- Migration: 20260707210400_finance_loans_budget.sql
--
-- Tables: loans, loan_payments, loan_emi_schedule,
--         budget_categories, budgets, budget_lines
-- No EMI auto-generation, no actual-vs-budget calculation.
-- ============================================================

-- ============================================================
-- 1. LOANS (Loan Accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loans (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    lender_name     text        NOT NULL CHECK (char_length(lender_name) BETWEEN 1 AND 160),
    principal_amount numeric(12, 2) NOT NULL CHECK (principal_amount > 0),
    interest_rate   numeric(5, 2) CHECK (interest_rate >= 0),
    start_date      date        NOT NULL,
    tenure_months   integer     CHECK (tenure_months > 0),
    notes           text,
    status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_by      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loans_restaurant_id ON public.loans (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON public.loans (restaurant_id, status);

DROP TRIGGER IF EXISTS trg_loans_updated_at ON public.loans;
CREATE TRIGGER trg_loans_updated_at
    BEFORE UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. LOAN PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loan_payments (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    loan_id             uuid        NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    amount              numeric(12, 2) NOT NULL CHECK (amount > 0),
    principal_component numeric(12, 2),
    interest_component  numeric(12, 2),
    payment_date        date        NOT NULL DEFAULT current_date,
    status              text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
    created_by          uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_payments_restaurant_created ON public.loan_payments (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON public.loan_payments (loan_id);

-- ============================================================
-- 3. LOAN EMI SCHEDULE
-- Manually entered/edited rows — no auto-generation in Phase 1.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loan_emi_schedule (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    loan_id         uuid        NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    installment_no  integer     NOT NULL CHECK (installment_no > 0),
    due_date        date        NOT NULL,
    amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT loan_emi_schedule_unique_installment UNIQUE (loan_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_loan_emi_schedule_loan_id ON public.loan_emi_schedule (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_emi_schedule_restaurant_id ON public.loan_emi_schedule (restaurant_id);

-- ============================================================
-- 4. BUDGET CATEGORIES (master)
-- Optionally links an existing income/expense category so budgets
-- can eventually compare against real transactions.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.budget_categories (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    linked_expense_category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    linked_income_category_id  uuid REFERENCES public.income_categories(id) ON DELETE SET NULL,
    is_active           boolean     NOT NULL DEFAULT true,
    created_by          uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT budget_categories_unique_name UNIQUE (restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_budget_categories_restaurant_id ON public.budget_categories (restaurant_id);

-- ============================================================
-- 5. BUDGETS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.budgets (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    period_type   text        NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('monthly', 'quarterly', 'yearly')),
    start_date    date        NOT NULL,
    end_date      date        NOT NULL,
    status        text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT budgets_valid_range CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_budgets_restaurant_id ON public.budgets (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_budgets_status ON public.budgets (restaurant_id, status);

-- ============================================================
-- 6. BUDGET LINES
-- Planned amount only — actual/variance computed in a later phase.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.budget_lines (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    budget_id       uuid        NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
    category_id     uuid        NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
    planned_amount  numeric(12, 2) NOT NULL CHECK (planned_amount >= 0),
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT budget_lines_unique_category UNIQUE (budget_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget_id ON public.budget_lines (budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_restaurant_id ON public.budget_lines (restaurant_id);

-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.loans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_emi_schedule  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_loans"   ON public.loans;
DROP POLICY IF EXISTS "admin_manage_loans" ON public.loans;
CREATE POLICY "staff_read_loans" ON public.loans
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_loans" ON public.loans
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_loan_payments"   ON public.loan_payments;
DROP POLICY IF EXISTS "admin_manage_loan_payments" ON public.loan_payments;
CREATE POLICY "staff_read_loan_payments" ON public.loan_payments
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_loan_payments" ON public.loan_payments
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_loan_emi_schedule"   ON public.loan_emi_schedule;
DROP POLICY IF EXISTS "admin_manage_loan_emi_schedule" ON public.loan_emi_schedule;
CREATE POLICY "staff_read_loan_emi_schedule" ON public.loan_emi_schedule
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_loan_emi_schedule" ON public.loan_emi_schedule
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_budget_categories"   ON public.budget_categories;
DROP POLICY IF EXISTS "admin_manage_budget_categories" ON public.budget_categories;
CREATE POLICY "staff_read_budget_categories" ON public.budget_categories
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_budget_categories" ON public.budget_categories
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_budgets"   ON public.budgets;
DROP POLICY IF EXISTS "admin_manage_budgets" ON public.budgets;
CREATE POLICY "staff_read_budgets" ON public.budgets
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_budgets" ON public.budgets
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_budget_lines"   ON public.budget_lines;
DROP POLICY IF EXISTS "admin_manage_budget_lines" ON public.budget_lines;
CREATE POLICY "staff_read_budget_lines" ON public.budget_lines
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_budget_lines" ON public.budget_lines
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
