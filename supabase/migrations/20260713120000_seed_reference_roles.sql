-- Seed the reference roles the application assumes exist.
--
-- The baseline (20260708150000_baseline.sql) is a schema-only dump, so it ships
-- an empty roles table. The seed that fills it (supabase/seed.sql) only runs on
-- a local `supabase db reset`, never on a remote `db push`/deploy. As a result a
-- remote project can end up with zero roles, and since public.users.role_id has a
-- NOT-VALID... FK to roles(id), every write that sets a non-null role_id
-- (onboarding sets role_id = 2, staff create, customer signup, invite accept)
-- fails with: insert or update on table "users" violates foreign key constraint
-- "users_role_id_fkey". This migration guarantees the roles exist on every
-- environment the migrations run against.
--
-- Ids are assigned explicitly and must stay stable: they are referenced directly
-- in code (src/lib/provisioning.ts MANAGER_ROLE_ID = 2, src/lib/demoAccounts.ts,
-- src/app/login/actions.ts DEMO_ROLES). roles.id is a plain smallint PK with no
-- sequence, so there is nothing to re-sync. Idempotent and safe to re-run.

INSERT INTO public.roles (id, name, description) VALUES
    (1, 'super_admin', 'Full access to all restaurant operations and settings'),
    (2, 'manager',     'Manages daily operations, staff, and menu'),
    (3, 'kitchen',     'Views and updates order preparation status'),
    (4, 'waiter',      'Takes and serves orders on the floor'),
    (5, 'customer',    'Places orders via the QR menu'),
    (6, 'cashier',     'Payment collection and bill settlement at the counter')
ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description;

-- bartender (BOT queue) is inserted by NAME at MAX(id)+1, never a hardcoded id --
-- see 20260709180000_bar_order_tickets.sql. Code looks it up by name, not id.
INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'bartender',
       'Views and updates drink preparation status at the bar'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'bartender');
