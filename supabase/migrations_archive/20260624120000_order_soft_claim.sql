-- Soft-claim ownership for dine-in orders.
--
-- With several waiters working one shared "ready" queue, two of them routinely
-- walk to the same order. A soft claim lets the first waiter tap "On my way";
-- the others then see "<name> is on the way" and the card greys out.
--
-- The claim is advisory (it doesn't hard-block delivery), so no new RLS write
-- policy is required: claims are written by service-role server actions, and
-- the existing staff SELECT policies already expose these rows for realtime.

alter table public.orders
    add column if not exists claimed_by uuid references public.users(id) on delete set null,
    add column if not exists claimed_at timestamptz;

-- Partial index: we only ever filter on currently-claimed orders.
create index if not exists idx_orders_claimed_by
    on public.orders(claimed_by)
    where claimed_by is not null;
