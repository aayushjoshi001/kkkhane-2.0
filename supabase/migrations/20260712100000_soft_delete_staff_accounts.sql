-- Soft-delete for staff accounts.
--
-- Deleting a staff account used to hard-delete the public.users row (and the
-- auth.users row, which cascades into public.users via users_id_fkey). Because
-- staff_ledger, staff_attendance and staff_salary_history all declare
-- user_id REFERENCES users(id) ON DELETE CASCADE, that one click silently
-- wiped the staff member's entire payroll and attendance history — financial
-- records that must survive the person leaving.
--
-- The fix is app-level soft delete: deleteStaffAction now stamps deleted_at
-- (and is_active = false) instead of deleting the row, and soft-deletes the
-- auth account so the person can no longer log in. The CASCADE constraints
-- stay as they are — they are correct for genuine hard deletes (e.g. deleting
-- a whole restaurant, where mixed CASCADE/RESTRICT paths from restaurants
-- through users into the history tables would deadlock a RESTRICT approach) —
-- they just never fire for staff removal anymore.

ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- Soft-deleted staff must not consume a plan seat. Table names are schema-
-- qualified (the previous definition set an empty search_path but referenced
-- unqualified names, which fails at runtime).
CREATE OR REPLACE FUNCTION "public"."check_plan_limit"("p_restaurant_id" "uuid", "p_resource" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
  v_tier TEXT;
  v_plan public.subscription_plans;
  v_current_count INTEGER;
  v_max_allowed INTEGER;
BEGIN
  SELECT subscription_tier INTO v_tier FROM public.restaurants WHERE id = p_restaurant_id;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_tier;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'no plan restrictions');
  END IF;

  CASE p_resource
    WHEN 'menu_items' THEN
      SELECT COUNT(*) INTO v_current_count FROM public.menu_items WHERE restaurant_id = p_restaurant_id;
      v_max_allowed := v_plan.max_menu_items;
    WHEN 'staff' THEN
      SELECT COUNT(*) INTO v_current_count FROM public.users WHERE restaurant_id = p_restaurant_id AND deleted_at IS NULL;
      v_max_allowed := v_plan.max_staff;
    WHEN 'tables' THEN
      SELECT COUNT(*) INTO v_current_count FROM public.tables WHERE restaurant_id = p_restaurant_id;
      v_max_allowed := v_plan.max_tables;
    ELSE
      RETURN jsonb_build_object('allowed', true, 'reason', 'unknown resource');
  END CASE;

  IF v_current_count >= v_max_allowed THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'current', v_current_count,
      'max', v_max_allowed,
      'tier', v_tier,
      'reason', format('Your %s plan allows up to %s %s. Please upgrade.', v_tier, v_max_allowed, p_resource)
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_current_count, 'max', v_max_allowed, 'tier', v_tier);
END;
$$;
