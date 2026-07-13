-- ============================================================
-- JWT Custom Claims Hook
-- Injects app_role and restaurant_id into the Supabase JWT
-- so auth.ts can read them without a DB roundtrip.
--
-- SETUP (one-time, after running this script):
--   Supabase Dashboard → Authentication → Hooks
--   → "Custom Access Token" hook
--   → Set function to: public.custom_access_token_hook
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    claims       JSONB;
    v_user_id    UUID;
    v_restaurant_id UUID;
    v_role_name  TEXT;
BEGIN
    v_user_id := (event->>'user_id')::UUID;
    claims     := event->'claims';

    -- Look up the user's restaurant and role in one query
    SELECT
        u.restaurant_id,
        r.name
    INTO v_restaurant_id, v_role_name
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = v_user_id
      AND u.is_active = true
    LIMIT 1;

    -- Inject custom claims; if user not found, set safe defaults
    IF v_restaurant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_role}',      to_jsonb(v_role_name));
        claims := jsonb_set(claims, '{restaurant_id}', to_jsonb(v_restaurant_id::TEXT));
    ELSIF v_role_name = 'super_admin' THEN
        -- Platform super admin has no tenant, but is a real elevated role.
        claims := jsonb_set(claims, '{app_role}',      '"super_admin"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    ELSE
        claims := jsonb_set(claims, '{app_role}',      '"unauthenticated"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    END IF;

    RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Grant the hook permission to read the users and roles tables
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON public.users TO supabase_auth_admin;
GRANT SELECT ON public.roles TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from authenticated/anon so it can only be invoked by Supabase Auth
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;

-- ============================================================
-- AFTER RUNNING THIS SCRIPT:
-- 1. Go to Supabase Dashboard
-- 2. Authentication → Hooks
-- 3. Enable "Custom Access Token" hook
-- 4. Select function: public.custom_access_token_hook
-- 5. Ask all users to sign out and back in (or wait for token refresh)
-- ============================================================
