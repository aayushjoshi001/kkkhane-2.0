-- The verify_session_restaurant_id() BEFORE INSERT trigger on sessions was
-- created with SET search_path TO '' but its body references `tables`
-- unqualified. With an empty search path that reference fails immediately:
--   ERROR: relation "tables" does not exist
-- Because the trigger fires on every session insert, NO session could ever be
-- created: waiters' "Open Session" silently failed, tables never flipped to
-- active, and customers stayed stuck in view-only mode.
-- This function was missed by 20260617_fix_function_search_paths.sql.
-- Fix: set search_path to 'public' so unqualified names resolve correctly.
CREATE OR REPLACE FUNCTION public.verify_session_restaurant_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_table_restaurant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_table_restaurant_id
  FROM tables
  WHERE id = NEW.table_id;

  IF v_table_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TABLE: Table % does not exist', NEW.table_id;
  END IF;

  IF NEW.restaurant_id IS DISTINCT FROM v_table_restaurant_id THEN
    RAISE EXCEPTION 'RESTAURANT_MISMATCH: Table % belongs to restaurant %, not %',
      NEW.table_id, v_table_restaurant_id, NEW.restaurant_id;
  END IF;

  RETURN NEW;
END;
$$;
