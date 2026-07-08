-- Mode 2: waiter order confirmation (low-plan flow).
--
-- When the restaurant requires waiter confirmation, a freshly-placed dine-in order
-- waits for a waiter to confirm the customer is really seated before it reaches the
-- kitchen. We flag those orders rather than overloading status, so the kitchen
-- simply hides needs_confirmation = true and Mode 1 (direct-to-kitchen) is
-- completely unchanged. Stock is deducted on confirm, not on placement.
--
-- cancellation_reason records why a waiter rejected an order (e.g. "not at table"),
-- shown back to the customer.

alter table public.orders
  add column if not exists needs_confirmation boolean not null default false,
  add column if not exists cancellation_reason text;

-- Waiters poll/refresh the "to confirm" list filtered by this flag.
create index if not exists idx_orders_needs_confirmation
  on public.orders(restaurant_id) where needs_confirmation = true;
