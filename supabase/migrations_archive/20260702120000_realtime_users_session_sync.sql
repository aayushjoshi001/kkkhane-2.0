-- Publish public.users so an already-logged-in staff member's browser can be
-- notified the instant an admin changes their role/status/deletes them.
-- Without this, role/suspension changes are invisible to that user's open
-- session until their JWT naturally expires (~1hr) or they log out/in — the
-- existing user_read_self RLS policy (id = auth.uid()) already scopes
-- delivery to each user's own row, so no new policy is needed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_rel pr
        JOIN pg_class c ON pr.prrelid = c.oid
        JOIN pg_publication p ON pr.prpubid = p.oid
        WHERE c.relname = 'users' AND p.pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
    END IF;
END
$$;

-- FULL replica identity so UPDATE payloads carry old+new values (needed to
-- detect is_active flipping to false vs. an unrelated column changing) and
-- DELETE payloads are unambiguous. users is low-write, so the extra WAL is negligible.
ALTER TABLE public.users REPLICA IDENTITY FULL;
