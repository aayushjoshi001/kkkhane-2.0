-- ============================================================
-- Day Book: day_book_sessions, day_book_entries
-- Migration: 20260707150000_day_book.sql
--
-- Best Practices Applied:
--   ✅ Composite indexes for FK + filter query patterns
--   ✅ Partial index for hot path: open sessions
--   ✅ CHECK constraints on all enum-like columns
--   ✅ timestamptz everywhere (timezone-aware)
--   ✅ numeric(12,2) for monetary values
--   ✅ UNIQUE constraint: one session per restaurant per date
--   ✅ updated_at trigger via existing public.set_updated_at()
--   ✅ Row Level Security matching existing system patterns
--   ✅ RLS: staff (all roles) can SELECT; manager/super_admin/cashier can ALL
-- ============================================================


-- ============================================================
-- 1. DAY BOOK SESSIONS TABLE
-- One session per restaurant per calendar day
-- ============================================================
CREATE TABLE IF NOT EXISTS public.day_book_sessions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    date             date        NOT NULL,
    opening_balance  numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (opening_balance >= 0),
    status           text        NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open', 'closed')),
    closed_at        timestamptz,
    closed_by        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    notes            text,
    created_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT day_book_sessions_unique_date UNIQUE (restaurant_id, date)
);

-- ────────────────────────────────────────────────────────────
-- INDEXES: day_book_sessions
-- ────────────────────────────────────────────────────────────

-- Composite index: primary lookup pattern (restaurant + date range queries)
CREATE INDEX IF NOT EXISTS idx_day_book_sessions_restaurant_date
    ON public.day_book_sessions (restaurant_id, date DESC);

-- Partial index: hot path — "what's today's open session?" is the most
-- common query; only a tiny fraction of rows are ever 'open' at once
CREATE INDEX IF NOT EXISTS idx_day_book_sessions_open
    ON public.day_book_sessions (restaurant_id, date)
    WHERE status = 'open';


-- ============================================================
-- 2. DAY BOOK ENTRIES TABLE
-- Individual cash in / cash out transactions for a session
-- ============================================================
CREATE TABLE IF NOT EXISTS public.day_book_entries (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    uuid        NOT NULL REFERENCES public.day_book_sessions(id) ON DELETE CASCADE,
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    type          text        NOT NULL CHECK (type IN ('cash_in', 'cash_out')),
    amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
    description   text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
    category      text        NOT NULL DEFAULT 'other'
                              CHECK (category IN (
                                  'order_payment', 'room_deposit', 'booking_payment',
                                  'expense', 'refund', 'salary', 'advance', 'other'
                              )),
    reference_id  uuid,       -- optional link to order / booking
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- INDEXES: day_book_entries
-- ────────────────────────────────────────────────────────────

-- Primary lookup: all entries for a session (used on every session detail load)
CREATE INDEX IF NOT EXISTS idx_day_book_entries_session_id
    ON public.day_book_entries (session_id);

-- Reporting / audit: all entries for a restaurant ordered by time
CREATE INDEX IF NOT EXISTS idx_day_book_entries_restaurant_created
    ON public.day_book_entries (restaurant_id, created_at DESC);

-- FK safety index on session_id → restaurant_id for multi-tenant isolation
CREATE INDEX IF NOT EXISTS idx_day_book_entries_restaurant_id
    ON public.day_book_entries (restaurant_id);


-- ============================================================
-- 3. UPDATED_AT AUTO-TRIGGER
-- Reuses the existing public.set_updated_at() function
-- ============================================================
DROP TRIGGER IF EXISTS trg_day_book_sessions_updated_at ON public.day_book_sessions;
CREATE TRIGGER trg_day_book_sessions_updated_at
    BEFORE UPDATE ON public.day_book_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 4. ROW LEVEL SECURITY
-- Follows the EXACT same pattern as the existing system
-- ============================================================
ALTER TABLE public.day_book_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_book_entries  ENABLE ROW LEVEL SECURITY;

-- ── day_book_sessions ─────────────────────────────────────────
DROP POLICY IF EXISTS "staff_read_day_book_sessions"   ON public.day_book_sessions;
DROP POLICY IF EXISTS "admin_manage_day_book_sessions" ON public.day_book_sessions;

-- All staff roles can read their restaurant's sessions
CREATE POLICY "staff_read_day_book_sessions" ON public.day_book_sessions
    FOR SELECT
    USING (restaurant_id = current_restaurant_id());

-- Manager, super_admin, and cashier can INSERT / UPDATE / DELETE
CREATE POLICY "admin_manage_day_book_sessions" ON public.day_book_sessions
    FOR ALL
    USING (
        current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier'])
        AND restaurant_id = current_restaurant_id()
    )
    WITH CHECK (
        current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier'])
        AND restaurant_id = current_restaurant_id()
    );

-- ── day_book_entries ──────────────────────────────────────────
DROP POLICY IF EXISTS "staff_read_day_book_entries"   ON public.day_book_entries;
DROP POLICY IF EXISTS "admin_manage_day_book_entries" ON public.day_book_entries;

-- All staff roles can read their restaurant's entries
CREATE POLICY "staff_read_day_book_entries" ON public.day_book_entries
    FOR SELECT
    USING (restaurant_id = current_restaurant_id());

-- Manager, super_admin, and cashier can INSERT / UPDATE / DELETE
CREATE POLICY "admin_manage_day_book_entries" ON public.day_book_entries
    FOR ALL
    USING (
        current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier'])
        AND restaurant_id = current_restaurant_id()
    )
    WITH CHECK (
        current_app_role() = ANY (ARRAY['manager', 'super_admin', 'cashier'])
        AND restaurant_id = current_restaurant_id()
    );
