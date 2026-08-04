-- Second pass of the never-read index cleanup, on every other table that
-- actually sees traffic.
--
-- NOT YET APPLIED TO PROD. 20260804114305 (the four booking/billing tables) is
-- live; this one is staged for `supabase db push`.
--
-- The same planning tax applies everywhere the planner has to cost an index
-- nothing reads. menu_items is the busiest table in the database at 16.4M
-- scans, and planned a 50-row lookup in 15.5ms against 5.6ms to execute it
-- while carrying a full-text index no query has ever used -- there is no
-- textSearch/to_tsquery anywhere in the application and no database function
-- references tsquery or tsvector. The first pass took a comparable bookings
-- query from 23.065ms of planning to 1.263ms.
--
-- Selection is the same and deliberately conservative: idx_scan = 0 across the
-- 77-day pg_stat_user_indexes window, not unique, not primary, not an exclusion
-- constraint, and backing no pg_constraint row. Restricted further to tables
-- with real activity, since dropping an index on a table nothing queries buys
-- nothing. Indexes that silently enforce uniqueness *without* a constraint row
-- -- rooms_restaurant_number_uidx, printers_one_default_per_role,
-- idx_fiscal_years_one_current, idx_financial_events_unique_source -- are
-- deliberately untouched; a backs_constraint = 0 filter alone would drop them
-- and let duplicate room numbers in.
--
-- Re-add any of these when a query pattern and data volume actually justify it,
-- and check idx_scan before assuming one is earning its keep.

-- hottest tables first
drop index if exists public.idx_menu_items_fts;
drop index if exists public.idx_order_item_modifiers_modifier_id;
drop index if exists public.idx_restaurants_linked_restaurant_id;
drop index if exists public.idx_restaurants_linked_hotel_id;
drop index if exists public.idx_expense_categories_parent_id;

-- payments / takeout
drop index if exists public.idx_payment_verifications_takeout_order_id;
drop index if exists public.idx_payment_verifications_pending;
drop index if exists public.idx_takeout_orders_loyalty_member_id;
drop index if exists public.idx_takeout_orders_phone;

-- books
drop index if exists public.idx_expenses_recurring;
drop index if exists public.idx_day_book_entries_bank_deposit;
drop index if exists public.idx_vouchers_status;
drop index if exists public.idx_voucher_attachments_voucher_id;
drop index if exists public.idx_financial_events_status;
drop index if exists public.idx_financial_events_type;
drop index if exists public.idx_financial_transactions_status;
drop index if exists public.idx_financial_transactions_type;
drop index if exists public.idx_financial_transactions_source_module;
drop index if exists public.idx_chart_of_accounts_parent_id;
drop index if exists public.idx_chart_of_accounts_restaurant_id;
drop index if exists public.idx_account_mappings_credit_account;
drop index if exists public.idx_account_mappings_debit_account;
drop index if exists public.idx_account_mappings_lookup;
drop index if exists public.idx_mapped_transactions_account_mapping;
drop index if exists public.idx_accounting_periods_fiscal_year_id;

-- cash
drop index if exists public.idx_cash_counts_drawer_id;
drop index if exists public.idx_cash_transactions_shift_id;
drop index if exists public.idx_cash_transactions_drawer_id;
drop index if exists public.idx_cash_transactions_counterparty_drawer_id;

-- loans / budgets / tax
drop index if exists public.idx_loans_restaurant_id;
drop index if exists public.idx_loan_payments_loan_id;
drop index if exists public.idx_loan_emi_schedule_loan_id;
drop index if exists public.idx_budgets_restaurant_id;
drop index if exists public.idx_budget_lines_budget_id;
drop index if exists public.idx_tax_filings_configuration_id;
drop index if exists public.idx_supplier_payments_bill_id;

-- loyalty / misc
drop index if exists public.idx_loyalty_tx_member;
drop index if exists public.idx_loyalty_members_phone;
drop index if exists public.idx_translations_lookup;
drop index if exists public.idx_translations_restaurant;
drop index if exists public.invitations_status_idx;
drop index if exists public.printers_restaurant_role_idx;
drop index if exists public.idx_phone_otp_active;
