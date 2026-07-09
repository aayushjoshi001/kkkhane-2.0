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

-- bartender (BOT queue) is inserted by NAME at MAX(id)+1, never a hardcoded id —
-- see the note in 20260709180000_bar_order_tickets.sql. The migration already
-- created it on a real reset; this keeps a seed-only run (roles 1-6 above)
-- self-sufficient. Code must look the role up by name, not assume id 7.
INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'bartender',
       'Views and updates drink preparation status at the bar'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'bartender');

-- Demo auth users (demo@srms.app, manager@srms.app, …) are intentionally NOT
-- seeded here: they are provisioned on first login by the login server action
-- (src/app/login/actions.ts -> provisionDemoAccount), which self-heals on any
-- environment without requiring a db reset.
