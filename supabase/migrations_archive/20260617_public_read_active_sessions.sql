-- Allow unauthenticated (customer) users to read active sessions.
-- session_token is already public — it's embedded in the QR code handed to
-- customers. Without this policy, Supabase Realtime never delivers the
-- postgres_changes INSERT event to the customer page and the one-shot DB
-- fetch in the SUBSCRIBED callback returns nothing, leaving customers
-- permanently stuck on the "Waiting for session" spinner.
--
-- The staff_read_sessions policy (which requires app_role) still applies for
-- closed/expired sessions — this policy only surfaces what is already visible.
CREATE POLICY "public_read_active_sessions" ON public.sessions
  FOR SELECT
  USING (status = 'active' AND expires_at > NOW());
