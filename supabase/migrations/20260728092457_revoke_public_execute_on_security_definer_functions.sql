-- Close the anon-executable SECURITY DEFINER surface.
--
-- SECURITY DEFINER runs as the owner and so bypasses RLS entirely. Every one of
-- these functions took the tenant id as a plain argument and checked nothing
-- about the caller, so anyone holding the public anon key could enumerate the
-- restaurants table and then read or write against any tenant they liked --
-- search_guest_history alone returned guest name, phone, email and KYC.
--
-- Most of them were never granted to anon at all: they simply had no ACL, and
-- Postgres grants EXECUTE to PUBLIC by default. Revoking from anon and
-- authenticated therefore does nothing on its own; PUBLIC is what has to go.
-- But dropping PUBLIC from a NULL acl materialises it as owner-only, which
-- would strip service_role too and take every server route down with it, so
-- each function is re-granted to service_role in the same breath.
--
-- Every caller of these runs server-side through createAdminClient(), i.e. as
-- service_role, which is unaffected. The only RPCs the browser makes are
-- claim_order_items_for_printing and release_order_item_print_claim (kitchen
-- and cashier ticket printing); those already carry explicit ACLs granting
-- authenticated, are not part of this set, and are named below so a future
-- re-run cannot sweep them up. custom_access_token_hook is excluded for the
-- same reason -- revoking it would break login for every tenant.
DO $$
DECLARE
    v_targets oid[];
    v_oid     oid;
    v_sig     text;
BEGIN
    SELECT array_agg(p.oid)
    INTO   v_targets
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.prosecdef
      AND  has_function_privilege('anon', p.oid, 'EXECUTE')
      AND  p.proname NOT IN (
               'claim_order_items_for_printing',
               'release_order_item_print_claim',
               'custom_access_token_hook'
           );

    IF v_targets IS NULL THEN
        RAISE NOTICE 'nothing to revoke';
        RETURN;
    END IF;

    FOREACH v_oid IN ARRAY v_targets LOOP
        v_sig := v_oid::regprocedure::text;
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', v_sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    END LOOP;

    RAISE NOTICE 'revoked PUBLIC/anon/authenticated EXECUTE on % functions', array_length(v_targets, 1);
END $$;

-- New functions default to EXECUTE for PUBLIC, which is how this happened. Stop
-- the next one from landing open.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
