-- Manager-driven staff invitations. Invitee gets an emailed link
-- (/invite/[token]) that lets them set their own password and creates
-- their auth.users + public.users row on acceptance.
create table if not exists public.invitations (
    id            uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    email         text not null,
    role_id       int  not null references public.roles(id),
    token_hash    text not null,                          -- sha256(token), never the raw token
    status        text not null default 'pending'
                    check (status in ('pending','accepted','revoked','expired')),
    invited_by    uuid references public.users(id) on delete set null,
    expires_at    timestamptz not null,
    accepted_at   timestamptz,
    created_at    timestamptz not null default now()
);

-- One active (pending) invite per email per restaurant — re-inviting updates
-- the existing row instead of creating a duplicate.
create unique index if not exists invitations_restaurant_email_pending_uidx
    on public.invitations (restaurant_id, lower(email))
    where status = 'pending';

create unique index if not exists invitations_token_hash_uidx
    on public.invitations (token_hash);

create index if not exists invitations_restaurant_id_idx on public.invitations (restaurant_id);
create index if not exists invitations_status_idx on public.invitations (status);

alter table public.invitations enable row level security;

-- Same pattern as departments: staff in the restaurant can read invitations,
-- managers/admins manage them. Accept-by-token happens exclusively through
-- the service-role client (createAdminClient) from the /invite/[token]
-- route, since the visitor is unauthenticated and can't satisfy
-- current_restaurant_id().
create policy "staff_read_invitations" on public.invitations
    for select
    using (restaurant_id = current_restaurant_id());

create policy "admin_manage_invitations" on public.invitations
    for all
    using (
        (current_app_role() = any (array['manager','super_admin']))
        and (restaurant_id = current_restaurant_id())
    )
    with check (
        (current_app_role() = any (array['manager','super_admin']))
        and (restaurant_id = current_restaurant_id())
    );
