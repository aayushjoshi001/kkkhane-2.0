-- Drop the old policy that breaks Supabase Realtime
DROP POLICY IF EXISTS "public_read_active_sessions" ON public.sessions;

-- Recreate policy without NOW() to allow Supabase Realtime to broadcast INSERT events to the customer UI
CREATE POLICY "public_read_active_sessions" ON public.sessions
  FOR SELECT
  USING (status = 'active');
