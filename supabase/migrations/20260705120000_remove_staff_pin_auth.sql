-- Reverses 20260703050023_add_staff_pin_auth.sql — the PIN/terminal-link
-- staff login flow has been replaced by email-invite based onboarding
-- (see 20260705120500_add_invitations.sql). Drop the bcrypt-hash column and
-- both security-definer helper functions; nothing else in the app reads them.
drop function if exists public.verify_staff_pin(uuid, text);
drop function if exists public.hash_staff_pin(text);
alter table public.users drop column if exists pin_hash;
