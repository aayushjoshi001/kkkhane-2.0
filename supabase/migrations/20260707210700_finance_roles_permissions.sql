-- ============================================================
-- Finance Module — Roles & Permissions structure (Phase 1)
-- Migration: 20260707210700_finance_roles_permissions.sql
--
-- Adds Finance Manager / Accountant / Receptionist as real roles
-- (public.roles is a plain FK-backed table — no schema change
-- needed, mirrors how 'cashier' was added in
-- 20260623150000_add_cashier_role.sql). IDs are derived from the
-- current max so this never collides with existing rows.
--
-- finance_role_permissions is an INERT role x module permission
-- matrix — populated via the Administration UI, not enforced
-- anywhere yet. Route access to /admin/finance/* is unchanged
-- (still gated to super_admin/manager by the existing admin layout).
-- ============================================================

INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'finance_manager',
       'Manages all Finance module records, categories, and configuration'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'finance_manager');

INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'accountant',
       'Records day-to-day Finance entries (cash, bank, income, expenses)'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'accountant');

INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'receptionist',
       'Front-desk role with view access to Finance records'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'receptionist');

-- ============================================================
-- FINANCE ROLE PERMISSIONS (inert matrix)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_role_permissions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    role_name     text        NOT NULL,
    module        text        NOT NULL,
    can_view      boolean     NOT NULL DEFAULT false,
    can_create    boolean     NOT NULL DEFAULT false,
    can_edit      boolean     NOT NULL DEFAULT false,
    can_delete    boolean     NOT NULL DEFAULT false,
    can_approve   boolean     NOT NULL DEFAULT false,
    created_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT finance_role_permissions_unique UNIQUE (restaurant_id, role_name, module)
);
CREATE INDEX IF NOT EXISTS idx_finance_role_permissions_restaurant_id ON public.finance_role_permissions (restaurant_id);

ALTER TABLE public.finance_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_finance_role_permissions"   ON public.finance_role_permissions;
DROP POLICY IF EXISTS "admin_manage_finance_role_permissions" ON public.finance_role_permissions;
CREATE POLICY "staff_read_finance_role_permissions" ON public.finance_role_permissions
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_finance_role_permissions" ON public.finance_role_permissions
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
