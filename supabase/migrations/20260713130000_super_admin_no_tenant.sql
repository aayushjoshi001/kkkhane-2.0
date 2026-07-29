-- Let a platform super_admin exist without a restaurant.
--
-- The custom_access_token_hook injected app_role='unauthenticated' whenever a
-- user had no restaurant_id. That is correct for a mid-onboarding user, but a
-- platform super_admin legitimately owns no tenant (it runs the cross-tenant
-- /admin/super-admin console). With app_role='unauthenticated' the app bounced it
-- to /onboarding and it could never reach its dashboard. Now, when a user with no
-- restaurant carries the super_admin role, we inject app_role='super_admin' (with
-- a null restaurant_id) so auth.ts recognises it as the elevated platform role.
--
-- Preserves the production hardening on this function: SET search_path TO '' and
-- fully-qualified public.* references.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    claims          JSONB;
    v_user_id       UUID;
    v_restaurant_id UUID;
    v_role_name     TEXT;
BEGIN
    v_user_id := (event->>'user_id')::UUID;
    claims    := event->'claims';

    SELECT u.restaurant_id, r.name
    INTO   v_restaurant_id, v_role_name
    FROM   public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE  u.id = v_user_id AND u.is_active = true
    LIMIT  1;

    IF v_restaurant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_role}',      to_jsonb(v_role_name));
        claims := jsonb_set(claims, '{restaurant_id}', to_jsonb(v_restaurant_id::TEXT));
    ELSIF v_role_name = 'super_admin' THEN
        -- Platform super admin: no tenant, but a real elevated role.
        claims := jsonb_set(claims, '{app_role}',      '"super_admin"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    ELSE
        claims := jsonb_set(claims, '{app_role}',      '"unauthenticated"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    END IF;

    RETURN jsonb_build_object('claims', claims);
END;
$function$;
