-- A manager now names the person they are inviting, and the invitee supplies
-- only their phone number and password. Keep both values in first-class
-- columns so the accepted staff profile is not dependent on mutable auth
-- metadata and old invitation links cannot override the manager's chosen name.
alter table public.invitations
    add column if not exists full_name text;

alter table public.users
    add column if not exists phone text;

comment on column public.invitations.full_name is
    'Staff name chosen by the manager and copied to public.users on acceptance.';

comment on column public.users.phone is
    'Optional staff contact number collected during invitation acceptance.';
