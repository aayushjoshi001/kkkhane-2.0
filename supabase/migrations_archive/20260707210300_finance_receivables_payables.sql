-- ============================================================
-- Finance Module — Receivables & Payables (structure only, Phase 1)
-- Migration: 20260707210300_finance_receivables_payables.sql
--
-- Tables: customer_credit_accounts, receivable_transactions,
--         suppliers, supplier_bills, supplier_payments
-- `suppliers` is a genuine new master entity — today only
-- ingredients.supplier exists as free text.
-- ============================================================

-- ============================================================
-- 1. CUSTOMER CREDIT ACCOUNTS
-- Optionally linked to an existing loyalty_members row; otherwise
-- a free-text customer name (mirrors how bookings/takeout already
-- handle guests without a unified customer master).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_credit_accounts (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id     uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    loyalty_member_id uuid        REFERENCES public.loyalty_members(id) ON DELETE SET NULL,
    customer_name     text        NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 160),
    customer_phone    text,
    credit_limit      numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (credit_limit >= 0),
    is_active         boolean     NOT NULL DEFAULT true,
    created_by        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_credit_accounts_restaurant_id ON public.customer_credit_accounts (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_accounts_loyalty_member_id ON public.customer_credit_accounts (loyalty_member_id);

-- ============================================================
-- 2. RECEIVABLE TRANSACTIONS
-- Charge (increases outstanding) / Payment (collection) on one table.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.receivable_transactions (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id             uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    customer_credit_account_id uuid       NOT NULL REFERENCES public.customer_credit_accounts(id) ON DELETE CASCADE,
    type                      text        NOT NULL CHECK (type IN ('charge', 'payment')),
    amount                    numeric(12, 2) NOT NULL CHECK (amount > 0),
    description               text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    status                    text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
    created_by                uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receivable_transactions_restaurant_created ON public.receivable_transactions (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receivable_transactions_account_id ON public.receivable_transactions (customer_credit_account_id);

-- ============================================================
-- 3. SUPPLIERS (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    contact_person text,
    phone          text,
    email          text,
    address        text,
    is_active      boolean     NOT NULL DEFAULT true,
    created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT suppliers_unique_name UNIQUE (restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_suppliers_restaurant_id ON public.suppliers (restaurant_id);

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. SUPPLIER BILLS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_bills (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    supplier_id   uuid        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    bill_number   text,
    amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
    description   text,
    due_date      date,
    status        text        NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid')),
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_restaurant_created ON public.supplier_bills (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier_id ON public.supplier_bills (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_status ON public.supplier_bills (restaurant_id, status);

-- ============================================================
-- 5. SUPPLIER PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    supplier_id    uuid        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    bill_id        uuid        REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
    amount         numeric(12, 2) NOT NULL CHECK (amount > 0),
    description    text,
    status         text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
    created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_restaurant_created ON public.supplier_payments (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON public.supplier_payments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill_id ON public.supplier_payments (bill_id);

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.customer_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bills           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_customer_credit_accounts"   ON public.customer_credit_accounts;
DROP POLICY IF EXISTS "admin_manage_customer_credit_accounts" ON public.customer_credit_accounts;
CREATE POLICY "staff_read_customer_credit_accounts" ON public.customer_credit_accounts
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_customer_credit_accounts" ON public.customer_credit_accounts
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_receivable_transactions"   ON public.receivable_transactions;
DROP POLICY IF EXISTS "admin_manage_receivable_transactions" ON public.receivable_transactions;
CREATE POLICY "staff_read_receivable_transactions" ON public.receivable_transactions
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_receivable_transactions" ON public.receivable_transactions
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_suppliers"   ON public.suppliers;
DROP POLICY IF EXISTS "admin_manage_suppliers" ON public.suppliers;
CREATE POLICY "staff_read_suppliers" ON public.suppliers
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_suppliers" ON public.suppliers
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_supplier_bills"   ON public.supplier_bills;
DROP POLICY IF EXISTS "admin_manage_supplier_bills" ON public.supplier_bills;
CREATE POLICY "staff_read_supplier_bills" ON public.supplier_bills
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_supplier_bills" ON public.supplier_bills
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_supplier_payments"   ON public.supplier_payments;
DROP POLICY IF EXISTS "admin_manage_supplier_payments" ON public.supplier_payments;
CREATE POLICY "staff_read_supplier_payments" ON public.supplier_payments
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_supplier_payments" ON public.supplier_payments
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
