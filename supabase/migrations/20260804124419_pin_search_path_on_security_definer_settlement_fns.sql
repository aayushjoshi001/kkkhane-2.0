-- Pin search_path on the three SECURITY DEFINER functions that settle money.
--
-- A SECURITY DEFINER function runs with its owner's rights. With no search_path
-- of its own it resolves unqualified names using the *caller's*, and pg_temp is
-- searched FIRST by default -- so a caller able to create a temporary table or
-- function named like one of the tables these read could have it resolved
-- instead, and the substitute would execute as the owner. These three are the
-- checkout and income-posting path, which makes them the worst place in the
-- schema to leave that open. Supabase's own security advisor flags it as
-- function_search_path_mutable; they were the only three left.
--
-- Naming pg_temp explicitly, last, is the fix: it stays reachable but can no
-- longer pre-empt public. Verified safe before applying -- none of the three
-- calls an extension function (pgcrypto and friends live in the `extensions`
-- schema, and public has no copies) or references auth/vault/graphql, so
-- restricting resolution to public changes nothing they can currently see.
--
-- Bodies are untouched: this only fixes how names inside them resolve. Note
-- settle_booking_group_checkout has two lineages in this folder -- see
-- 20260728040000, which supersedes 20260728020000 -- and this alters whichever
-- is live without redefining either.
alter function public.post_payment_income_sql set search_path = public, pg_temp;
alter function public.settle_booking_checkout_v2 set search_path = public, pg_temp;
alter function public.settle_booking_group_checkout set search_path = public, pg_temp;
