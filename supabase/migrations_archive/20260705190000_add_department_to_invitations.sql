-- Manager-picked department at invite-time, mirroring public.users.department_id,
-- so invited staff land in the right department immediately on acceptance
-- instead of requiring a manual edit afterward.
alter table public.invitations
    add column if not exists department_id uuid references public.departments(id) on delete set null;
