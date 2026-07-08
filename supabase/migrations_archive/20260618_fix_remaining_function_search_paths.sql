-- Follow-up to 20260617_fix_function_search_paths.sql, which missed these.
-- Each function below was created with SET search_path TO '' but references
-- public tables/types unqualified (recipes, ingredients, orders, order_items,
-- menu_items, restaurants, subscription_plans, users, tables, eod_reports,
-- order_promos, invoice_sequences). Under an empty search path every call
-- fails with `relation "x" does not exist` (or `type "x" does not exist`).
-- Confirmed broken at runtime. Fix: SET search_path TO 'public' (auth.* refs
-- are already schema-qualified, so 'public' alone is sufficient).

CREATE OR REPLACE FUNCTION public.calculate_cogs(p_menu_item_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ROUND(SUM(r.quantity_needed * i.cost_per_unit), 2), 0)
  FROM recipes r
  JOIN ingredients i ON i.id = r.ingredient_id
  WHERE r.menu_item_id = p_menu_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_dynamic_eta(p_restaurant_id uuid, p_new_items jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_queue_minutes INTEGER := 0;
  v_new_item_minutes INTEGER := 0;
  v_kitchen_parallelism INTEGER := 3;  -- assume 3 concurrent prep stations
BEGIN
  -- Sum preparation_min for all currently active orders in the queue
  SELECT COALESCE(SUM(
    mi.preparation_min * oi.quantity
  ), 0) INTO v_queue_minutes
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN menu_items mi ON mi.id = oi.menu_item_id
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status IN ('pending', 'confirmed', 'preparing');

  -- Add the new items' prep time if provided
  IF p_new_items IS NOT NULL THEN
    SELECT COALESCE(SUM(
      mi.preparation_min * (item->>'quantity')::INTEGER
    ), 0) INTO v_new_item_minutes
    FROM jsonb_array_elements(p_new_items) AS item
    JOIN menu_items mi ON mi.id = (item->>'menu_item_id')::UUID;
  END IF;

  -- Divide by parallelism factor and add buffer
  RETURN CEIL((v_queue_minutes + v_new_item_minutes)::NUMERIC / v_kitchen_parallelism) + 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_plan_limit(p_restaurant_id uuid, p_resource text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier TEXT;
  v_plan subscription_plans;
  v_current_count INTEGER;
  v_max_allowed INTEGER;
BEGIN
  SELECT subscription_tier INTO v_tier FROM restaurants WHERE id = p_restaurant_id;
  SELECT * INTO v_plan FROM subscription_plans WHERE id = v_tier;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'no plan restrictions');
  END IF;

  CASE p_resource
    WHEN 'menu_items' THEN
      SELECT COUNT(*) INTO v_current_count FROM menu_items WHERE restaurant_id = p_restaurant_id;
      v_max_allowed := v_plan.max_menu_items;
    WHEN 'staff' THEN
      SELECT COUNT(*) INTO v_current_count FROM users WHERE restaurant_id = p_restaurant_id;
      v_max_allowed := v_plan.max_staff;
    WHEN 'tables' THEN
      SELECT COUNT(*) INTO v_current_count FROM tables WHERE restaurant_id = p_restaurant_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_restaurant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix TEXT;
  v_fy TEXT;
  v_num BIGINT;
BEGIN
  UPDATE invoice_sequences
  SET current_number = current_number + 1,
      updated_at = NOW()
  WHERE restaurant_id = p_restaurant_id
  RETURNING prefix, fiscal_year, current_number
  INTO v_prefix, v_fy, v_num;

  -- Auto-create sequence if not exists
  IF NOT FOUND THEN
    INSERT INTO invoice_sequences (restaurant_id) VALUES (p_restaurant_id)
    ON CONFLICT (restaurant_id) DO UPDATE SET current_number = invoice_sequences.current_number + 1
    RETURNING prefix, fiscal_year, current_number
    INTO v_prefix, v_fy, v_num;
  END IF;

  RETURN v_prefix || '-' || v_fy || '-' || LPAD(v_num::TEXT, 6, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_eod_report(p_restaurant_id uuid, p_report_date date)
 RETURNS eod_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_start              TIMESTAMPTZ := p_report_date::TIMESTAMPTZ AT TIME ZONE 'Asia/Kathmandu';
    v_end                TIMESTAMPTZ := (p_report_date + INTERVAL '1 day')::TIMESTAMPTZ AT TIME ZONE 'Asia/Kathmandu';
    v_total_orders       INTEGER;
    v_gross              NUMERIC := 0;
    v_tax                NUMERIC := 0;
    v_discounts          NUMERIC := 0;
    v_cash               NUMERIC := 0;
    v_cancelled          INTEGER := 0;
    v_unverified         INTEGER := 0;
    v_net                NUMERIC;
    v_avg                NUMERIC := 0;
    v_result             eod_reports;
BEGIN
    SELECT COUNT(*) INTO v_total_orders
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND placed_at >= v_start AND placed_at < v_end
      AND payment_status = 'paid';

    SELECT
        COALESCE(SUM(total_amount),    0),
        COALESCE(SUM(tax_amount),      0),
        COALESCE(SUM(discount_amount), 0)
    INTO v_gross, v_tax, v_discounts
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND placed_at >= v_start AND placed_at < v_end
      AND payment_status = 'paid';

    -- Cash total via payment_verifications
    SELECT COALESCE(SUM(o.total_amount), 0)
    INTO v_cash
    FROM orders o
    JOIN payment_verifications pv ON pv.order_id = o.id AND pv.staff_verified = TRUE
    WHERE o.restaurant_id = p_restaurant_id
      AND o.placed_at >= v_start AND o.placed_at < v_end
      AND o.payment_status = 'paid'
      AND pv.payment_method = 'cash';

    SELECT COUNT(*) INTO v_cancelled
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND placed_at >= v_start AND placed_at < v_end
      AND status = 'cancelled';

    -- Reconciliation: paid orders with no verified payment_verification
    SELECT COUNT(*) INTO v_unverified
    FROM orders o
    WHERE o.restaurant_id = p_restaurant_id
      AND o.placed_at >= v_start AND o.placed_at < v_end
      AND o.payment_status = 'paid'
      AND NOT EXISTS (
          SELECT 1 FROM payment_verifications pv
          WHERE pv.order_id = o.id AND pv.staff_verified = TRUE
      );

    v_net := v_gross - v_tax;
    v_avg := CASE WHEN v_total_orders > 0 THEN v_gross / v_total_orders ELSE 0 END;

    INSERT INTO eod_reports (
        restaurant_id, report_date,
        total_orders, total_revenue, total_tax, total_tips, total_discounts,
        net_revenue, cash_total, card_total,
        total_voids, total_refunds, total_cancelled,
        avg_order_value, total_cogs, gross_profit, unverified_orders
    ) VALUES (
        p_restaurant_id, p_report_date,
        v_total_orders, v_gross, v_tax, 0, v_discounts,
        v_net, v_cash, (v_gross - v_cash),
        0, 0, v_cancelled,
        v_avg, 0, v_net, v_unverified
    )
    ON CONFLICT (restaurant_id, report_date) DO UPDATE SET
        total_orders      = EXCLUDED.total_orders,
        total_revenue     = EXCLUDED.total_revenue,
        total_tax         = EXCLUDED.total_tax,
        total_discounts   = EXCLUDED.total_discounts,
        net_revenue       = EXCLUDED.net_revenue,
        cash_total        = EXCLUDED.cash_total,
        card_total        = EXCLUDED.card_total,
        total_cancelled   = EXCLUDED.total_cancelled,
        avg_order_value   = EXCLUDED.avg_order_value,
        gross_profit      = EXCLUDED.gross_profit,
        unverified_orders = EXCLUDED.unverified_orders,
        created_at        = NOW()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_eod_report(p_restaurant_id uuid, p_date date, p_closed_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_report_id UUID;
  v_stats RECORD;
BEGIN
  -- Aggregate the day's orders
  SELECT
    COUNT(*) FILTER (WHERE status != 'cancelled') AS total_orders,
    COALESCE(SUM(total_amount) FILTER (WHERE status != 'cancelled'), 0) AS total_revenue,
    COALESCE(SUM(tax_amount) FILTER (WHERE status != 'cancelled'), 0) AS total_tax,
    COALESCE(SUM(tip_amount) FILTER (WHERE status != 'cancelled'), 0) AS total_tips,
    COUNT(*) FILTER (WHERE status = 'cancelled') AS total_cancelled,
    COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'refunded'), 0) AS total_refunds,
    COALESCE(AVG(total_amount) FILTER (WHERE status != 'cancelled'), 0) AS avg_order_value
  INTO v_stats
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND placed_at::DATE = p_date;

  -- Calculate total discounts from promo usage
  -- Calculate COGS from ingredient recipes
  INSERT INTO eod_reports (
    restaurant_id, report_date,
    total_orders, total_revenue, total_tax, total_tips,
    total_cancelled, total_refunds, avg_order_value,
    total_discounts, net_revenue, total_cogs, gross_profit,
    closed_by
  ) VALUES (
    p_restaurant_id, p_date,
    v_stats.total_orders, v_stats.total_revenue, v_stats.total_tax, v_stats.total_tips,
    v_stats.total_cancelled, v_stats.total_refunds, ROUND(v_stats.avg_order_value, 2),
    -- Discounts
    COALESCE((
      SELECT SUM(op.discount_amount)
      FROM order_promos op
      JOIN orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND o.placed_at::DATE = p_date
    ), 0),
    -- Net revenue = revenue - tax - discounts
    v_stats.total_revenue - v_stats.total_tax - COALESCE((
      SELECT SUM(op.discount_amount)
      FROM order_promos op
      JOIN orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND o.placed_at::DATE = p_date
    ), 0),
    -- COGS: sum recipe costs * quantities sold
    COALESCE((
      SELECT ROUND(SUM(r.quantity_needed * ing.cost_per_unit * oi.quantity), 2)
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN recipes r ON r.menu_item_id = oi.menu_item_id
      JOIN ingredients ing ON ing.id = r.ingredient_id
      WHERE o.restaurant_id = p_restaurant_id
        AND o.placed_at::DATE = p_date
        AND o.status != 'cancelled'
    ), 0),
    -- Gross profit = net_revenue - COGS
    v_stats.total_revenue - v_stats.total_tax - COALESCE((
      SELECT SUM(op.discount_amount)
      FROM order_promos op
      JOIN orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND o.placed_at::DATE = p_date
    ), 0) - COALESCE((
      SELECT ROUND(SUM(r.quantity_needed * ing.cost_per_unit * oi.quantity), 2)
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN recipes r ON r.menu_item_id = oi.menu_item_id
      JOIN ingredients ing ON ing.id = r.ingredient_id
      WHERE o.restaurant_id = p_restaurant_id
        AND o.placed_at::DATE = p_date
        AND o.status != 'cancelled'
    ), 0),
    p_closed_by
  )
  ON CONFLICT (restaurant_id, report_date)
  DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_revenue = EXCLUDED.total_revenue,
    total_tax = EXCLUDED.total_tax,
    total_tips = EXCLUDED.total_tips,
    total_cancelled = EXCLUDED.total_cancelled,
    total_refunds = EXCLUDED.total_refunds,
    avg_order_value = EXCLUDED.avg_order_value,
    total_discounts = EXCLUDED.total_discounts,
    net_revenue = EXCLUDED.net_revenue,
    total_cogs = EXCLUDED.total_cogs,
    gross_profit = EXCLUDED.gross_profit,
    closed_by = EXCLUDED.closed_by,
    created_at = NOW()
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$function$;
