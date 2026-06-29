-- Item-level status for order_items — the foundation for "Select Item(s) / Select All"
-- and partial ready / partial served flows in the kitchen and waiter panels.
--
-- Until now the whole order advanced as one unit (orders.status). Real service
-- prepares and serves items across multiple trips, so each line item now carries
-- its own lifecycle: pending → preparing → ready → served.
--
-- orders.status stays the rolled-up aggregate, but it is recomputed in the server
-- action layer (setOrderItemsStatus) rather than a trigger. That keeps exactly one
-- orders UPDATE — and so one realtime event — per action, and sidesteps the
-- empty-search_path trigger pitfalls this project has been bitten by before.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_item_status') then
    create type order_item_status as enum ('pending', 'preparing', 'ready', 'served', 'cancelled');
  end if;
end$$;

alter table public.order_items
  add column if not exists status order_item_status not null default 'pending';

-- Backfill existing rows from their parent order's status so live orders carry a
-- consistent item state the moment this ships. Only touches rows still at the
-- 'pending' default, so re-running is safe.
update public.order_items oi
set status = case o.status
    when 'delivered' then 'served'::order_item_status
    when 'ready'     then 'ready'::order_item_status
    when 'preparing' then 'preparing'::order_item_status
    when 'cancelled' then 'cancelled'::order_item_status
    else 'pending'::order_item_status
  end
from public.orders o
where oi.order_id = o.id
  and oi.status = 'pending';

-- We filter items by (order_id, status) on every kitchen/waiter recompute.
create index if not exists idx_order_items_order_status
  on public.order_items(order_id, status);
