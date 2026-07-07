-- ============================================================
-- Migration: Add Bank Ledger support to Day Book
-- 20260707170000_day_book_bank_ledger.sql
-- ============================================================

-- 1. Add opening_bank_balance column to day_book_sessions
ALTER TABLE public.day_book_sessions
    ADD COLUMN IF NOT EXISTS opening_bank_balance numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (opening_bank_balance >= 0);

-- 2. Update type CHECK constraint in day_book_entries
ALTER TABLE public.day_book_entries
    DROP CONSTRAINT IF EXISTS day_book_entries_type_check;

ALTER TABLE public.day_book_entries
    ADD CONSTRAINT day_book_entries_type_check
    CHECK (type IN ('cash_in', 'cash_out', 'bank_in', 'bank_out'));

-- 3. Update category CHECK constraint in day_book_entries to support Bank categories
ALTER TABLE public.day_book_entries
    DROP CONSTRAINT IF EXISTS day_book_entries_category_check;

ALTER TABLE public.day_book_entries
    ADD CONSTRAINT day_book_entries_category_check
    CHECK (category IN (
        -- Cash categories
        'order_payment',
        'room_deposit',
        'booking_payment',
        'expense',
        'refund',
        'salary',
        'advance',
        'bank_deposit',
        'other',
        -- Bank categories
        'qr_payment',
        'card',
        'transfer',
        'deposit',
        'withdrawal',
        'bank_charges',
        'transfer_out'
    ));
