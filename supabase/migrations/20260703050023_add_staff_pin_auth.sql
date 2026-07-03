-- PIN-based login for POS staff (waiter/kitchen/cashier). The PIN is never
-- stored in plaintext — only a bcrypt hash via pgcrypto, verified through
-- verify_staff_pin() so the comparison always happens inside Postgres.
alter table public.users add column if not exists pin_hash text;

create or replace function public.hash_staff_pin(p_pin text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 8));
$$;

create or replace function public.verify_staff_pin(p_user_id uuid, p_pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.users
    where id = p_user_id
      and pin_hash is not null
      and pin_hash = extensions.crypt(p_pin, pin_hash)
  );
$$;

-- Both functions are only ever called from server-side code via the
-- service-role client, so no execute grants to anon/authenticated are needed.
revoke execute on function public.hash_staff_pin(text) from public, anon, authenticated;
revoke execute on function public.verify_staff_pin(uuid, text) from public, anon, authenticated;
