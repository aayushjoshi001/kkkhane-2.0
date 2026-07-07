-- ============================================================
-- Finance Module — Income & Expenses (structure only, Phase 1)
-- Migration: 20260707210200_finance_income_expense.sql
--
-- Tables: income_categories, income_entries, expense_categories,
--         expenses, expense_attachments
-- ============================================================

-- ============================================================
-- 1. INCOME CATEGORIES (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.income_categories (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description    text,
    is_active      boolean     NOT NULL DEFAULT true,
    created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT income_categories_unique_name UNIQUE (restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_income_categories_restaurant_id ON public.income_categories (restaurant_id);

-- ============================================================
-- 2. INCOME ENTRIES
-- Other Income / Interest Income / Service Charge are distinguished
-- via category_id — no separate tables per sub-type.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.income_entries (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    category_id    uuid        NOT NULL REFERENCES public.income_categories(id) ON DELETE RESTRICT,
    amount         numeric(12, 2) NOT NULL CHECK (amount > 0),
    description    text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    bank_account_id uuid,
    cash_drawer_id  uuid,
    status         text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
    created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_income_entries_restaurant_created ON public.income_entries (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_income_entries_category_id ON public.income_entries (category_id);

-- ============================================================
-- 3. EXPENSE CATEGORIES (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expense_categories (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description    text,
    is_active      boolean     NOT NULL DEFAULT true,
    created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT expense_categories_unique_name UNIQUE (restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_expense_categories_restaurant_id ON public.expense_categories (restaurant_id);

-- ============================================================
-- 4. EXPENSES
-- Expense Entry / Approval / Recurring / History all live on one table.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expenses (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    category_id         uuid        NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
    amount              numeric(12, 2) NOT NULL CHECK (amount > 0),
    description         text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    vendor_name         text,
    bank_account_id     uuid,
    cash_drawer_id      uuid,
    is_recurring        boolean     NOT NULL DEFAULT false,
    recurrence_interval text        CHECK (recurrence_interval IN ('weekly', 'monthly', 'quarterly', 'yearly') OR recurrence_interval IS NULL),
    status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    approved_by         uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at         timestamptz,
    created_by          uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_restaurant_created ON public.expenses (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON public.expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses (restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_recurring ON public.expenses (restaurant_id) WHERE is_recurring = true;

-- ============================================================
-- 5. EXPENSE ATTACHMENTS
-- File metadata only — upload handling is out of scope for Phase 1.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expense_attachments (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    expense_id    uuid        NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    file_url      text        NOT NULL,
    file_name     text,
    uploaded_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense_id ON public.expense_attachments (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_restaurant_id ON public.expense_attachments (restaurant_id);

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.income_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_income_categories"   ON public.income_categories;
DROP POLICY IF EXISTS "admin_manage_income_categories" ON public.income_categories;
CREATE POLICY "staff_read_income_categories" ON public.income_categories
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_income_categories" ON public.income_categories
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_income_entries"   ON public.income_entries;
DROP POLICY IF EXISTS "admin_manage_income_entries" ON public.income_entries;
CREATE POLICY "staff_read_income_entries" ON public.income_entries
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_income_entries" ON public.income_entries
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_expense_categories"   ON public.expense_categories;
DROP POLICY IF EXISTS "admin_manage_expense_categories" ON public.expense_categories;
CREATE POLICY "staff_read_expense_categories" ON public.expense_categories
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_expense_categories" ON public.expense_categories
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_expenses"   ON public.expenses;
DROP POLICY IF EXISTS "admin_manage_expenses" ON public.expenses;
CREATE POLICY "staff_read_expenses" ON public.expenses
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_expenses" ON public.expenses
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_expense_attachments"   ON public.expense_attachments;
DROP POLICY IF EXISTS "admin_manage_expense_attachments" ON public.expense_attachments;
CREATE POLICY "staff_read_expense_attachments" ON public.expense_attachments
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_expense_attachments" ON public.expense_attachments
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
