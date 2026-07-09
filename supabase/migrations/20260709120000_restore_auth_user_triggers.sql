-- Restore the auth.users triggers dropped by the baseline squash.
--
-- The baseline (20260708150000_baseline.sql) is a schema dump of the `public`
-- schema, which excludes objects living in the `auth` schema. The two triggers
-- that wire auth.users -> public.users therefore went missing, even though the
-- functions they call (public.handle_new_user, public.sync_user_email) are still
-- defined. Without them a fresh database creates auth users with no matching
-- public.users row, breaking signup, staff creation, and demo login.
--
-- Idempotent and safe to run against production (which already has these
-- triggers): DROP IF EXISTS then CREATE.

-- Create the public.users row for every new auth user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Keep public.users.email in sync when the auth email changes.
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_user_email();

-- Backfill public.users rows for any auth users that were created while the
-- triggers were missing (e.g. a fresh local stack seeded before this migration).
INSERT INTO public.users (id, full_name, email, restaurant_id, role_id)
SELECT au.id,
       COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1), 'New User'),
       au.email,
       NULL,
       NULL
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;
