-- Per-dish chef ownership for the kitchen board.
--
-- Each order_item can be claimed by the chef who starts cooking it (clicks Cook).
-- Only that chef may later mark the dish ready — enforced in the server action
-- layer (setOrderItemsStatus) via these columns. Additive and nullable, so
-- existing rows and in-flight orders keep working with no backfill needed.

alter table public.order_items
  add column if not exists claimed_by uuid references public.users(id),
  add column if not exists claimed_at timestamptz;

-- Cooking views filter/group by the owning chef.
create index if not exists idx_order_items_claimed_by
  on public.order_items(claimed_by);
