-- Give the backup password a home that anon cannot read.
--
-- settings.features_v2 is the wrong place for a credential: settings carries
-- `public_read_settings` (SELECT USING (true) for {public}) and anon holds
-- SELECT on the table, because the customer QR menu reads currency and feature
-- flags without logging in. RLS is row-level, so that policy hands over every
-- column of every row -- verified with the anon key: a plain REST call returns
-- full features_v2 for any restaurant. restaurants is no better; it has
-- anyone_can_read_restaurants USING (is_active = true).
--
-- Nothing has leaked. The profile page's write to that field never actually
-- landed until it was repaired earlier today, so no tenant has a stored
-- password yet -- but the next manager to open their profile would have
-- published one, and /api/backup/export grants a full dump of a restaurant's
-- orders, bookings and books to whoever presents it.
--
-- RLS is enabled with no policies at all, which denies anon and authenticated
-- outright. Both sides of this feature already go through createAdminClient()
-- (service_role), which bypasses RLS, so neither needs a grant.
create table if not exists public.restaurant_backup_secrets (
    restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
    backup_password text not null,
    created_at timestamptz not null default now()
);

alter table public.restaurant_backup_secrets enable row level security;

-- Explicitly take away the blanket grants Supabase hands these roles on new
-- public tables. Without this the table is reachable the moment someone adds a
-- permissive policy by habit.
revoke all on public.restaurant_backup_secrets from anon, authenticated;

comment on table public.restaurant_backup_secrets is
    'Backup/export password per restaurant. Deliberately outside settings.features_v2, which is world-readable via public_read_settings. RLS on with no policies: service_role only.';
