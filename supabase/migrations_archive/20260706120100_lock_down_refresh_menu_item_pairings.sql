-- refresh_menu_item_pairings is SECURITY DEFINER and does a full delete+recompute
-- over order history; it must only run from the trusted nightly cron (service_role),
-- never be callable by anon/authenticated over PostgREST.
REVOKE EXECUTE ON FUNCTION public.refresh_menu_item_pairings(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_menu_item_pairings(UUID) TO service_role;
