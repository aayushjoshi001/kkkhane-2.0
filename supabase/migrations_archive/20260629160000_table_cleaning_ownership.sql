-- Cleaning ownership for the waiter "Space" section.
--
-- When a session is paid/closed the table is set to 'dirty'. A waiter then claims
-- the cleaning ("I am going") and only that waiter may mark it clean — the same
-- single-owner pattern used for order claims and per-dish cooking. Additive and
-- nullable, so existing rows keep working with no backfill.

alter table public.tables
  add column if not exists cleaning_claimed_by uuid references public.users(id),
  add column if not exists cleaning_claimed_at timestamptz;
