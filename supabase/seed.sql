-- Seed data loaded after migrations on `supabase db reset`
-- (config.toml -> [db.seed] sql_paths = ["./seed.sql"]).
--
-- Reference roles the application assumes exist. The baseline migration ships
-- schema only, so without this a fresh local stack has an empty roles table and
-- every role-based feature (including demo login) breaks. Keep ids stable — they
-- are referenced directly in code (see src/lib/demoAccounts.ts,
-- src/lib/provisioning.ts).
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

-- Demo auth users (demo@srms.app, manager@srms.app, …) are intentionally NOT
-- seeded here: they are provisioned on first login by the login server action
-- (src/app/login/actions.ts -> provisionDemoAccount), which self-heals on any
-- environment without requiring a db reset.
