-- ============================================================
-- Patch: Add bank_deposit support to day_book_entries
-- 20260707160000_day_book_bank_deposit.sql
-- ============================================================

-- 1. Add bank_name column (nullable - only used for bank_deposit entries)
ALTER TABLE public.day_book_entries
    ADD COLUMN IF NOT EXISTS bank_name text CHECK (char_length(bank_name) <= 100);

-- 2. Extend category CHECK constraint to include 'bank_deposit'
ALTER TABLE public.day_book_entries
    DROP CONSTRAINT IF EXISTS day_book_entries_category_check;

ALTER TABLE public.day_book_entries
    ADD CONSTRAINT day_book_entries_category_check
    CHECK (category IN (
        'order_payment',
        'room_deposit',
        'booking_payment',
        'expense',
        'refund',
        'salary',
        'advance',
        'bank_deposit',
        'other'
    ));

-- 3. Index for fast bank deposit queries (manager report)
CREATE INDEX IF NOT EXISTS idx_day_book_entries_bank_deposit
    ON public.day_book_entries (restaurant_id, bank_name)
    WHERE category = 'bank_deposit';
