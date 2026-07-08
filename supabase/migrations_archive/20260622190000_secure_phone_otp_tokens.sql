-- SECURITY FIX: phone_otp_tokens was readable/writable by the public (anon) role
-- via an RLS policy `Service role manages OTP` (cmd=ALL, roles=public, USING=true)
-- plus an anon SELECT grant — i.e. anyone with the anon key could read OTP codes
-- (account-takeover / OTP-bypass risk). Service role bypasses RLS, so the OTP
-- server logic needs no policy at all. Remove the over-permissive policy and the
-- anon/authenticated grants so the table is default-deny except for service_role.

DROP POLICY IF EXISTS "Service role manages OTP" ON public.phone_otp_tokens;

REVOKE ALL ON public.phone_otp_tokens FROM anon;
REVOKE ALL ON public.phone_otp_tokens FROM authenticated;

ALTER TABLE public.phone_otp_tokens ENABLE ROW LEVEL SECURITY;
