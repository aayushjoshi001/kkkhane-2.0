-- ============================================================
-- Finance Module — Bank Management (structure only, Phase 1)
-- Migration: 20260707210100_finance_bank.sql
--
-- Tables: bank_accounts, bank_transactions, bank_reconciliations
-- Covers both real bank accounts and digital wallets (eSewa, Khalti,
-- Fonepay, ConnectIPS) via bank_accounts.type/wallet_provider.
-- ============================================================

-- ============================================================
-- 1. BANK ACCOUNTS / WALLETS (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    account_type     text        NOT NULL DEFAULT 'bank' CHECK (account_type IN ('bank', 'wallet')),
    wallet_provider  text        CHECK (wallet_provider IN ('esewa', 'khalti', 'fonepay', 'connectips') OR wallet_provider IS NULL),
    bank_name        text,
    account_number   text,
    opening_balance  numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (opening_balance >= 0),
    is_active        boolean     NOT NULL DEFAULT true,
    created_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT bank_accounts_unique_name UNIQUE (restaurant_id, name),
    CONSTRAINT bank_accounts_wallet_provider_requires_wallet_type
        CHECK (account_type = 'wallet' OR wallet_provider IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_restaurant_id ON public.bank_accounts (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_active ON public.bank_accounts (restaurant_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
    BEFORE UPDATE ON public.bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. BANK TRANSACTIONS
-- Deposits / Withdrawals / Transfers are `type` values on one table.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_transactions (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id           uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    bank_account_id         uuid        NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
    type                    text        NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out')),
    amount                  numeric(12, 2) NOT NULL CHECK (amount > 0),
    description             text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    counterparty_account_id uuid        REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
    status                  text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
    created_by              uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_restaurant_created
    ON public.bank_transactions (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_account_id ON public.bank_transactions (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_counterparty_account_id ON public.bank_transactions (counterparty_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_type ON public.bank_transactions (restaurant_id, type);

-- ============================================================
-- 3. BANK RECONCILIATIONS (Reconciliation / Statement)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id     uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    bank_account_id   uuid        NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
    statement_date    date        NOT NULL,
    statement_balance numeric(12, 2) NOT NULL,
    book_balance      numeric(12, 2),
    variance          numeric(12, 2),
    notes             text,
    status            text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reconciled', 'flagged')),
    reconciled_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_restaurant_created
    ON public.bank_reconciliations (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_bank_account_id ON public.bank_reconciliations (bank_account_id);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.bank_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_bank_accounts"   ON public.bank_accounts;
DROP POLICY IF EXISTS "admin_manage_bank_accounts" ON public.bank_accounts;
CREATE POLICY "staff_read_bank_accounts" ON public.bank_accounts
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_bank_accounts" ON public.bank_accounts
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_bank_transactions"   ON public.bank_transactions;
DROP POLICY IF EXISTS "admin_manage_bank_transactions" ON public.bank_transactions;
CREATE POLICY "staff_read_bank_transactions" ON public.bank_transactions
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_bank_transactions" ON public.bank_transactions
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_bank_reconciliations"   ON public.bank_reconciliations;
DROP POLICY IF EXISTS "admin_manage_bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "staff_read_bank_reconciliations" ON public.bank_reconciliations
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_bank_reconciliations" ON public.bank_reconciliations
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
