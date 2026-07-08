-- Fix: "permission denied for function replace_combo_items".
-- The function was created with its default PUBLIC EXECUTE grant stripped
-- (acl was {postgres=X/postgres}), so the service_role used by the admin client
-- in updateComboAction could not call it. Grant EXECUTE to the Supabase roles
-- that need it. The function is SECURITY INVOKER and combo_items has RLS
-- (admin_write_combo_items: manager/super_admin only), so granting to
-- authenticated stays safe — non-privileged callers are still blocked by RLS.
GRANT EXECUTE ON FUNCTION public.replace_combo_items(uuid, jsonb) TO service_role, authenticated;
