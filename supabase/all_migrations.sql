


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;




ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."order_item_status" AS ENUM (
    'pending',
    'preparing',
    'ready',
    'served',
    'cancelled'
);


ALTER TYPE "public"."order_item_status" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'delivered',
    'cancelled'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."order_type" AS ENUM (
    'dine_in',
    'takeout',
    'delivery'
);


ALTER TYPE "public"."order_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'unpaid',
    'pending',
    'paid',
    'refunded',
    'failed'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."pricing_rule_type" AS ENUM (
    'percentage_off',
    'fixed_price',
    'amount_off'
);


ALTER TYPE "public"."pricing_rule_type" OWNER TO "postgres";


CREATE TYPE "public"."promo_type" AS ENUM (
    'percentage_off',
    'amount_off',
    'free_item',
    'bogo'
);


ALTER TYPE "public"."promo_type" OWNER TO "postgres";


CREATE TYPE "public"."service_request_status" AS ENUM (
    'pending',
    'acknowledged',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."service_request_status" OWNER TO "postgres";


CREATE TYPE "public"."split_type" AS ENUM (
    'by_seat',
    'even',
    'custom',
    'full'
);


ALTER TYPE "public"."split_type" OWNER TO "postgres";


CREATE TYPE "public"."takeout_status" AS ENUM (
    'placed',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'picked_up',
    'cancelled'
);


ALTER TYPE "public"."takeout_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'user',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_pricing_rules_to_order"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_restaurant_id UUID;
    v_now           TIMESTAMPTZ := now();
    v_dow           INT         := EXTRACT(DOW FROM v_now)::INT;
    v_time          TIME        := v_now::TIME;
    v_date          DATE        := v_now::DATE;
    v_item          RECORD;
    v_rule          RECORD;
    v_new_price     NUMERIC;
    v_new_subtotal  NUMERIC := 0;
    v_var_name      TEXT;
    v_item_base_price NUMERIC;
BEGIN
    SELECT restaurant_id INTO v_restaurant_id
    FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN RETURN; END IF;
    FOR v_item IN
        SELECT
            oi.id          AS oi_id,
            oi.quantity,
            oi.unit_price,
            mi.price       AS base_price,
            mi.id          AS menu_item_id,
            mi.category_id AS category_id,
            oi.special_request
        FROM order_items oi
        JOIN menu_items  mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = p_order_id
    LOOP
        -- Determine the base price of the item before discount.
        -- If it's a variation item, extract the variation name from the special_request column
        -- (e.g. '[large cheese pizza] ...') and look up its price in menu_item_variations.
        v_item_base_price := v_item.base_price;
        
        IF v_item.special_request IS NOT NULL THEN
            v_var_name := substring(v_item.special_request from '^\[([^\]]+)\]');
            IF v_var_name IS NOT NULL THEN
                SELECT price INTO v_item_base_price
                FROM menu_item_variations
                WHERE menu_item_id = v_item.menu_item_id
                  AND name = v_var_name
                LIMIT 1;
                
                IF NOT FOUND THEN
                    v_item_base_price := v_item.base_price;
                END IF;
            END IF;
        END IF;
        
        -- Safe fallback: if the base price resolved to 0 but unit_price was already set to a non-zero value,
        -- use the current unit_price as the base price.
        IF v_item_base_price = 0 AND v_item.unit_price > 0 THEN
            v_item_base_price := v_item.unit_price;
        END IF;
        SELECT *
        INTO   v_rule
        FROM   pricing_rules
        WHERE  restaurant_id = v_restaurant_id
          AND  is_active = true
          AND  v_dow = ANY(days_of_week)
          AND  v_time BETWEEN start_time::TIME AND end_time::TIME
          AND  (valid_from  IS NULL OR valid_from::DATE  <= v_date)
          AND  (valid_until IS NULL OR valid_until::DATE >= v_date)
          AND  (
                   applies_to_item_id     = v_item.menu_item_id
                OR applies_to_category_id = v_item.category_id
                OR applies_to_all         = true
               )
        ORDER BY
            CASE
                WHEN applies_to_item_id     IS NOT NULL THEN 1
                WHEN applies_to_category_id IS NOT NULL THEN 2
                ELSE                                         3
            END,
            priority DESC
        LIMIT 1;
        IF FOUND THEN
            v_new_price := CASE v_rule.rule_type
                WHEN 'percentage_off' THEN GREATEST(0, v_item_base_price * (1 - v_rule.value / 100.0))
                WHEN 'amount_off'     THEN GREATEST(0, v_item_base_price - v_rule.value)
                WHEN 'fixed_price'    THEN v_rule.value
                ELSE                       v_item.unit_price
            END;
            UPDATE order_items SET unit_price = v_new_price WHERE id = v_item.oi_id;
        ELSE
            v_new_price := v_item.unit_price;
        END IF;
        v_new_subtotal := v_new_subtotal + (v_new_price * v_item.quantity);
    END LOOP;
    UPDATE orders
    SET
        subtotal_amount = v_new_subtotal,
        total_amount    = v_new_subtotal
                          - COALESCE(discount_amount, 0)
                          + COALESCE(tax_amount, 0)
    WHERE id = p_order_id;
END;
$$;


ALTER FUNCTION "public"."apply_pricing_rules_to_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_invoice_on_paid"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND (OLD.payment_status IS DISTINCT FROM 'paid')
     AND NEW.invoice_number IS NULL
  THEN
    NEW.invoice_number := public.generate_invoice_number(NEW.restaurant_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assign_invoice_on_paid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_suspend_expired_subscriptions"() RETURNS TABLE("suspended_id" "uuid", "suspended_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    RETURN QUERY
    UPDATE public.restaurants
    SET
        subscription_status = 'suspended',
        is_suspended        = true
    WHERE
        subscription_expires_at IS NOT NULL
        AND subscription_expires_at < NOW()
        AND subscription_status NOT IN ('suspended', 'cancelled')
        AND is_suspended = false
    RETURNING id, name;
END;
$$;


ALTER FUNCTION "public"."auto_suspend_expired_subscriptions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_cogs"("p_menu_item_id" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(ROUND(SUM(r.quantity_needed * i.cost_per_unit), 2), 0)
  FROM recipes r
  JOIN ingredients i ON i.id = r.ingredient_id
  WHERE r.menu_item_id = p_menu_item_id;
$$;


ALTER FUNCTION "public"."calculate_cogs"("p_menu_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_dynamic_eta"("p_restaurant_id" "uuid", "p_new_items" "jsonb" DEFAULT NULL::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."calculate_dynamic_eta"("p_restaurant_id" "uuid", "p_new_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_plan_limit"("p_restaurant_id" "uuid", "p_resource" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."check_plan_limit"("p_restaurant_id" "uuid", "p_resource" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_app_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT auth.jwt() ->> 'app_role'
$$;


ALTER FUNCTION "public"."current_app_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_restaurant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT (auth.jwt() ->> 'restaurant_id')::UUID
$$;


ALTER FUNCTION "public"."current_restaurant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    claims          JSONB;
    v_user_id       UUID;
    v_restaurant_id UUID;
    v_role_name     TEXT;
BEGIN
    v_user_id := (event->>'user_id')::UUID;
    claims    := event->'claims';

    SELECT u.restaurant_id, r.name
    INTO   v_restaurant_id, v_role_name
    FROM   public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE  u.id = v_user_id AND u.is_active = true
    LIMIT  1;

    IF v_restaurant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_role}',      to_jsonb(v_role_name));
        claims := jsonb_set(claims, '{restaurant_id}', to_jsonb(v_restaurant_id::TEXT));
    ELSE
        claims := jsonb_set(claims, '{app_role}',      '"unauthenticated"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    END IF;

    RETURN jsonb_build_object('claims', claims);
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_ingredients_for_order"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_item     RECORD;
    v_recipe   RECORD;
    v_consumed NUMERIC;
BEGIN
    FOR v_item IN
        SELECT menu_item_id, quantity
        FROM   order_items
        WHERE  order_id = p_order_id
    LOOP
        FOR v_recipe IN
            SELECT ingredient_id, quantity_needed
            FROM   recipes
            WHERE  menu_item_id = v_item.menu_item_id
        LOOP
            v_consumed := v_recipe.quantity_needed * v_item.quantity;

            UPDATE ingredients
            SET    stock_quantity = GREATEST(0, stock_quantity - v_consumed),
                   updated_at    = now()
            WHERE  id = v_recipe.ingredient_id;

            INSERT INTO ingredient_movements
                (ingredient_id, movement_type, quantity, reference_id, performed_by)
            VALUES
                (v_recipe.ingredient_id, 'usage', v_consumed, p_order_id, NULL);
        END LOOP;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."deduct_ingredients_for_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."erp_prevent_audit_modification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RAISE EXCEPTION 'Nepal IRD Compliance Error: Posted financial entries, invoices, and audit-logged ledgers cannot be updated or deleted.';
END;
$$;


ALTER FUNCTION "public"."erp_prevent_audit_modification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."erp_update_account_balances"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        -- Debit updates
        IF NEW.debit > 0 THEN
            UPDATE public.erp_accounts 
            SET balance = CASE 
                WHEN type IN ('asset', 'expense') THEN balance + NEW.debit
                ELSE balance - NEW.debit
            END
            WHERE id = NEW.account_id;
        END IF;
        -- Credit updates
        IF NEW.credit > 0 THEN
            UPDATE public.erp_accounts 
            SET balance = CASE 
                WHEN type IN ('liability', 'equity', 'revenue') THEN balance + NEW.credit
                ELSE balance - NEW.credit
            END
            WHERE id = NEW.account_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."erp_update_account_balances"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."eod_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "report_date" "date" NOT NULL,
    "total_orders" integer DEFAULT 0 NOT NULL,
    "total_revenue" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_tips" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_discounts" numeric(12,2) DEFAULT 0 NOT NULL,
    "net_revenue" numeric(12,2) DEFAULT 0 NOT NULL,
    "cash_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "card_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_voids" integer DEFAULT 0 NOT NULL,
    "total_refunds" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_cancelled" integer DEFAULT 0 NOT NULL,
    "avg_order_value" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_cogs" numeric(12,2) DEFAULT 0 NOT NULL,
    "gross_profit" numeric(12,2) DEFAULT 0 NOT NULL,
    "closed_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "report_date_bs" "text",
    "unverified_orders" integer DEFAULT 0 NOT NULL,
    "actual_cash_counted" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "cash_variance" numeric(15,2) DEFAULT 0.00 NOT NULL
);


ALTER TABLE "public"."eod_reports" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_eod_report"("p_restaurant_id" "uuid", "p_report_date" "date") RETURNS "public"."eod_reports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."generate_eod_report"("p_restaurant_id" "uuid", "p_report_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_eod_report"("p_restaurant_id" "uuid", "p_date" "date", "p_closed_by" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."generate_eod_report"("p_restaurant_id" "uuid", "p_date" "date", "p_closed_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_financial_event_code"("p_restaurant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_seq  INTEGER;
    v_year TEXT := to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
BEGIN
    INSERT INTO financial_event_sequences (restaurant_id, year, current_number)
    VALUES (p_restaurant_id, v_year, 1)
    ON CONFLICT (restaurant_id) DO UPDATE
        SET current_number = CASE
                WHEN financial_event_sequences.year = v_year THEN financial_event_sequences.current_number + 1
                ELSE 1
            END,
            year = v_year,
            updated_at = now()
    RETURNING current_number INTO v_seq;

    RETURN 'FE-' || v_year || '-' || lpad(v_seq::TEXT, 6, '0');
END;
$$;


ALTER FUNCTION "public"."generate_financial_event_code"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_financial_transaction_code"("p_restaurant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_seq  INTEGER;
    v_year TEXT := to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
BEGIN
    INSERT INTO financial_transaction_sequences (restaurant_id, year, current_number)
    VALUES (p_restaurant_id, v_year, 1)
    ON CONFLICT (restaurant_id) DO UPDATE
        SET current_number = CASE
                WHEN financial_transaction_sequences.year = v_year THEN financial_transaction_sequences.current_number + 1
                ELSE 1
            END,
            year = v_year,
            updated_at = now()
    RETURNING current_number INTO v_seq;

    RETURN 'FTX-' || v_year || '-' || lpad(v_seq::TEXT, 6, '0');
END;
$$;


ALTER FUNCTION "public"."generate_financial_transaction_code"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invoice_number"("p_restaurant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_seq  INTEGER;
  v_year TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
BEGIN
  INSERT INTO invoice_sequences (restaurant_id, current_number)
  VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET current_number = invoice_sequences.current_number + 1
  RETURNING current_number INTO v_seq;

  RETURN 'INV-' || v_year || '-' || lpad(v_seq::TEXT, 5, '0');
END;
$$;


ALTER FUNCTION "public"."generate_invoice_number"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_voucher_number"("p_restaurant_id" "uuid", "p_voucher_type_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_seq    INTEGER;
    v_year   TEXT := to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
    v_prefix TEXT;
BEGIN
    SELECT prefix INTO v_prefix FROM voucher_types WHERE id = p_voucher_type_id AND restaurant_id = p_restaurant_id;
    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'Voucher type % not found for restaurant %', p_voucher_type_id, p_restaurant_id;
    END IF;

    INSERT INTO voucher_sequences (restaurant_id, voucher_type_id, year, current_number)
    VALUES (p_restaurant_id, p_voucher_type_id, v_year, 1)
    ON CONFLICT (restaurant_id, voucher_type_id) DO UPDATE
        SET current_number = CASE
                WHEN voucher_sequences.year = v_year THEN voucher_sequences.current_number + 1
                ELSE 1
            END,
            year = v_year,
            updated_at = now()
    RETURNING current_number INTO v_seq;

    RETURN v_prefix || '-' || v_year || '-' || lpad(v_seq::TEXT, 6, '0');
END;
$$;


ALTER FUNCTION "public"."generate_voucher_number"("p_restaurant_id" "uuid", "p_voucher_type_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_effective_price"("p_menu_item_id" "uuid", "p_at" timestamp with time zone DEFAULT "now"()) RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_base_price     NUMERIC(10,2);
  v_category_id    UUID;
  v_restaurant_id  UUID;
  v_rule           RECORD;
  v_effective_price NUMERIC(10,2);
  v_day            SMALLINT;
  v_time           TIME;
BEGIN
  SELECT price, category_id, restaurant_id
  INTO v_base_price, v_category_id, v_restaurant_id
  FROM menu_items WHERE id = p_menu_item_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_effective_price := v_base_price;
  v_day  := EXTRACT(DOW FROM p_at)::SMALLINT;
  v_time := p_at::TIME;

  SELECT * INTO v_rule
  FROM pricing_rules
  WHERE restaurant_id = v_restaurant_id
    AND is_active = TRUE
    AND (valid_from  IS NULL OR valid_from  <= p_at::DATE)
    AND (valid_until IS NULL OR valid_until >= p_at::DATE)
    AND v_day = ANY(days_of_week)
    AND v_time BETWEEN start_time AND end_time
    AND (
      applies_to_item_id     = p_menu_item_id
      OR applies_to_category_id = v_category_id
      OR applies_to_all = TRUE
    )
  ORDER BY priority DESC, created_at DESC
  LIMIT 1;

  IF FOUND THEN
    CASE v_rule.rule_type
      WHEN 'percentage_off' THEN v_effective_price := v_base_price * (1 - v_rule.value / 100);
      WHEN 'fixed_price'    THEN v_effective_price := v_rule.value;
      WHEN 'amount_off'     THEN v_effective_price := GREATEST(v_base_price - v_rule.value, 0);
    END CASE;
  END IF;

  RETURN ROUND(v_effective_price, 2);
END;
$$;


ALTER FUNCTION "public"."get_effective_price"("p_menu_item_id" "uuid", "p_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.users (id, full_name, email, restaurant_id, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'New User'),
    NEW.email,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_erp_invoice_number"("p_restaurant_id" "uuid", "p_fy_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_fy_name TEXT;
  v_num INTEGER;
BEGIN
  -- Fetch the fiscal year name
  SELECT name INTO v_fy_name FROM erp_fiscal_years WHERE id = p_fy_id;

  -- Upsert sequence tracking
  INSERT INTO erp_invoice_sequences (restaurant_id, fiscal_year_id, last_sequence)
  VALUES (p_restaurant_id, p_fy_id, 1)
  ON CONFLICT (restaurant_id, fiscal_year_id) DO UPDATE
  SET last_sequence = erp_invoice_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_num;

  RETURN 'INV-' || v_fy_name || '-' || LPAD(v_num::TEXT, 6, '0');
END;
$$;


ALTER FUNCTION "public"."next_erp_invoice_number"("p_restaurant_id" "uuid", "p_fy_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_invoice_number"("p_restaurant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."next_invoice_number"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_delivery_order"("p_restaurant_id" "uuid", "p_items" "jsonb", "p_customer_name" "text", "p_customer_phone" "text", "p_delivery_address" "text", "p_customer_email" "text" DEFAULT NULL::"text", "p_customer_note" "text" DEFAULT NULL::"text", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_recipe RECORD;
  v_existing RECORD;
  v_restaurant_active BOOLEAN;
  v_code TEXT := lpad((floor(random() * 10000))::int::text, 4, '0');
BEGIN
  SELECT (is_active AND NOT COALESCE(is_suspended, false)) INTO v_restaurant_active
  FROM restaurants WHERE id = p_restaurant_id;

  IF NOT FOUND OR NOT v_restaurant_active THEN
    RAISE EXCEPTION 'INVALID_RESTAURANT: Restaurant % is not available', p_restaurant_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, total_amount, delivery_verification_code INTO v_existing
    FROM orders WHERE client_request_id = p_client_request_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('order_id', v_existing.id, 'total', COALESCE(v_existing.total_amount, 0),
        'code', v_existing.delivery_verification_code, 'duplicate', true);
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = p_restaurant_id;

  INSERT INTO orders (
    session_id, restaurant_id, order_type, customer_note,
    customer_name, customer_phone, customer_email,
    delivery_address, delivery_verification_code,
    loyalty_member_id, client_request_id
  ) VALUES (
    NULL, p_restaurant_id, 'delivery', p_customer_note,
    p_customer_name, p_customer_phone, p_customer_email,
    p_delivery_address, v_code,
    p_loyalty_member_id, p_client_request_id
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID AND restaurant_id = p_restaurant_id AND is_available = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    v_effective_price := public.get_effective_price(v_menu_item.id);

    IF v_menu_item.stock_count IS NOT NULL THEN
      IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
      END IF;
      UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
    END IF;

    FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_menu_item.id LOOP
      UPDATE ingredients
      SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
      WHERE id = v_recipe.ingredient_id;
      INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
      VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
    END LOOP;

    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;

    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;

    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);
        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo FROM promo_codes
    WHERE restaurant_id = p_restaurant_id AND code = UPPER(TRIM(p_promo_code)) AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;
      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;

  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);

  UPDATE orders
  SET subtotal_amount = v_subtotal, discount_amount = v_discount, promo_code_id = v_promo_id,
      tax_amount = v_tax, total_amount = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'tax', v_tax, 'total', v_subtotal - v_discount + v_tax, 'code', v_code
  );
END;
$$;


ALTER FUNCTION "public"."place_delivery_order"("p_restaurant_id" "uuid", "p_items" "jsonb", "p_customer_name" "text", "p_customer_phone" "text", "p_delivery_address" "text", "p_customer_email" "text", "p_customer_note" "text", "p_promo_code" "text", "p_loyalty_member_id" "uuid", "p_client_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_total NUMERIC(10,2) := 0;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;

  INSERT INTO orders (session_id, restaurant_id, customer_note)
  VALUES (p_session_id, v_restaurant_id, p_customer_note)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = TRUE
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable or locked', v_item->>'menu_item_id';
    END IF;

    IF v_menu_item.stock_count IS NOT NULL THEN
      IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
      END IF;
      UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
    END IF;

    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, (v_item->>'quantity')::SMALLINT, v_menu_item.price, v_item->>'special_request');

    v_total := v_total + (v_menu_item.price * (v_item->>'quantity')::SMALLINT);
  END LOOP;

  UPDATE orders SET total_amount = v_total WHERE id = v_order_id;
  RETURN v_order_id;
END;
$$;


ALTER FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text", "p_seat_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;

  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    IF v_menu_item.stock_count IS NOT NULL THEN
      IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
      END IF;
      UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
    END IF;

    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, (v_item->>'quantity')::SMALLINT, v_menu_item.price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;

    v_item_total := v_menu_item.price * (v_item->>'quantity')::SMALLINT;

    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;

        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);

        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  UPDATE orders SET subtotal_amount = v_subtotal, total_amount = v_subtotal WHERE id = v_order_id;
  RETURN v_order_id;
END;
$$;


ALTER FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text", "p_seat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text", "p_seat_id" "uuid" DEFAULT NULL::"uuid", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;
  
  -- Combo-specific variables
  v_combo_part RECORD;
  v_constituent_item menu_items%ROWTYPE;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;
  -- Idempotency guard: we now hold the session lock, so any concurrent duplicate
  -- call is serialized behind us. If an order for this request id already exists,
  -- return it instead of placing a second one.
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;
  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = v_restaurant_id;
  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id, loyalty_member_id, client_request_id)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id, p_loyalty_member_id, p_client_request_id)
  RETURNING id INTO v_order_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;
    v_effective_price := public.get_effective_price(v_menu_item.id);
    -- Stock and Recipe Deduction
    IF v_menu_item.is_combo THEN
      -- Loop through constituent items of the combo
      FOR v_combo_part IN 
        SELECT item_id, quantity FROM public.combo_items WHERE combo_id = v_menu_item.id
      LOOP
        -- Check and update stock of constituent item
        SELECT * INTO v_constituent_item FROM public.menu_items WHERE id = v_combo_part.item_id FOR UPDATE;
        
        IF v_constituent_item.stock_count IS NOT NULL THEN
          IF v_constituent_item.stock_count < (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT) THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item % in combo %', v_constituent_item.name, v_menu_item.name;
          END IF;
          UPDATE public.menu_items 
          SET stock_count = stock_count - (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT) 
          WHERE id = v_constituent_item.id;
        END IF;
        -- Deduct ingredients of constituent item
        FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_constituent_item.id LOOP
          UPDATE ingredients
          SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
          WHERE id = v_recipe.ingredient_id;
          
          INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
          VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), v_order_id);
        END LOOP;
      END LOOP;
    ELSE
      -- Standard non-combo item logic
      IF v_menu_item.stock_count IS NOT NULL THEN
        IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
          RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
        END IF;
        UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
      END IF;
      FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_menu_item.id LOOP
        UPDATE ingredients
        SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
        WHERE id = v_recipe.ingredient_id;
        INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
        VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
      END LOOP;
    END IF;
    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;
    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;
    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);
        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;
    v_subtotal := v_subtotal + v_item_total;
  END LOOP;
  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE restaurant_id = v_restaurant_id
      AND code = UPPER(TRIM(p_promo_code))
      AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;
      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;
  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      promo_code_id   = v_promo_id,
      tax_amount      = v_tax,
      total_amount    = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;
  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config FROM loyalty_config WHERE restaurant_id = v_restaurant_id AND is_active = TRUE;
    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_dollar);
      UPDATE loyalty_members
      SET points_balance  = points_balance + v_points_earned,
          lifetime_points = lifetime_points + v_points_earned,
          lifetime_spend  = lifetime_spend + (v_subtotal - v_discount + v_tax),
          visit_count     = visit_count + 1,
          last_visit_at   = NOW(),
          tier = CASE
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.platinum_threshold THEN 'platinum'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.gold_threshold     THEN 'gold'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.silver_threshold   THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      WHERE id = p_loyalty_member_id;
      INSERT INTO loyalty_transactions (member_id, order_id, type, points, description)
      VALUES (p_loyalty_member_id, v_order_id, 'earn', v_points_earned,
        'Earned ' || v_points_earned || ' points on order ' || v_order_id::TEXT);
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         v_subtotal - v_discount + v_tax,
    'points_earned', v_points_earned
  );
END;
$$;


ALTER FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text", "p_seat_id" "uuid", "p_promo_code" "text", "p_loyalty_member_id" "uuid", "p_client_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_takeout_order"("p_restaurant_id" "uuid", "p_items" "jsonb", "p_customer_name" "text", "p_customer_phone" "text", "p_customer_email" "text" DEFAULT NULL::"text", "p_pickup_time" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_customer_note" "text" DEFAULT NULL::"text", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;
  v_restaurant_active BOOLEAN;
BEGIN
  SELECT (is_active AND NOT COALESCE(is_suspended, false)) INTO v_restaurant_active
  FROM restaurants WHERE id = p_restaurant_id;

  IF NOT FOUND OR NOT v_restaurant_active THEN
    RAISE EXCEPTION 'INVALID_RESTAURANT: Restaurant % is not available', p_restaurant_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = p_restaurant_id;

  INSERT INTO orders (
    session_id, restaurant_id, order_type, customer_note,
    customer_name, customer_phone, customer_email, pickup_time,
    loyalty_member_id, client_request_id
  )
  VALUES (
    NULL, p_restaurant_id, 'takeout', p_customer_note,
    p_customer_name, p_customer_phone, p_customer_email, p_pickup_time,
    p_loyalty_member_id, p_client_request_id
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = p_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    v_effective_price := public.get_effective_price(v_menu_item.id);

    IF v_menu_item.stock_count IS NOT NULL THEN
      IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
      END IF;
      UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
    END IF;

    FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_menu_item.id LOOP
      UPDATE ingredients
      SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
      WHERE id = v_recipe.ingredient_id;
      INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
      VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
    END LOOP;

    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;

    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;

    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;

        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);

        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE restaurant_id = p_restaurant_id
      AND code = UPPER(TRIM(p_promo_code))
      AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;

    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;

      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;

  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);

  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      promo_code_id   = v_promo_id,
      tax_amount      = v_tax,
      total_amount    = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;

  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config FROM loyalty_config WHERE restaurant_id = p_restaurant_id AND is_active = TRUE;
    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_dollar);
      UPDATE loyalty_members
      SET points_balance  = points_balance + v_points_earned,
          lifetime_points = lifetime_points + v_points_earned,
          lifetime_spend  = lifetime_spend + (v_subtotal - v_discount + v_tax),
          visit_count     = visit_count + 1,
          last_visit_at   = NOW(),
          tier = CASE
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.platinum_threshold THEN 'platinum'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.gold_threshold     THEN 'gold'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.silver_threshold   THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      WHERE id = p_loyalty_member_id;
      INSERT INTO loyalty_transactions (member_id, order_id, type, points, description)
      VALUES (p_loyalty_member_id, v_order_id, 'earn', v_points_earned,
        'Earned ' || v_points_earned || ' points on order ' || v_order_id::TEXT);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         v_subtotal - v_discount + v_tax,
    'points_earned', v_points_earned
  );
END;
$$;


ALTER FUNCTION "public"."place_takeout_order"("p_restaurant_id" "uuid", "p_items" "jsonb", "p_customer_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_pickup_time" timestamp with time zone, "p_customer_note" "text", "p_promo_code" "text", "p_loyalty_member_id" "uuid", "p_client_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_menu_item_pairings"("p_restaurant_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM menu_item_pairings
    WHERE p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id;

    INSERT INTO menu_item_pairings (restaurant_id, item_id, paired_item_id, co_order_count)
    SELECT restaurant_id, item_id, paired_item_id, co_order_count
    FROM (
        SELECT
            o.restaurant_id,
            a.menu_item_id AS item_id,
            b.menu_item_id AS paired_item_id,
            count(*) AS co_order_count,
            row_number() OVER (
                PARTITION BY o.restaurant_id, a.menu_item_id
                ORDER BY count(*) DESC
            ) AS rn
        FROM order_items a
        JOIN order_items b
            ON a.order_id = b.order_id
            AND a.menu_item_id <> b.menu_item_id
        JOIN orders o
            ON o.id = a.order_id
        WHERE o.status <> 'cancelled'
            AND (p_restaurant_id IS NULL OR o.restaurant_id = p_restaurant_id)
        GROUP BY o.restaurant_id, a.menu_item_id, b.menu_item_id
        HAVING count(*) >= 2
    ) ranked
    WHERE rn <= 5;
END;
$$;


ALTER FUNCTION "public"."refresh_menu_item_pairings"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_combo_items"("p_combo_id" "uuid", "p_items" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- Runs in a single transaction, so the combo is never left without items.
  delete from combo_items where combo_id = p_combo_id;
  insert into combo_items (combo_id, item_id, quantity)
  select p_combo_id, (e->>'item_id')::uuid, (e->>'quantity')::int
  from jsonb_array_elements(p_items) e;
end;
$$;


ALTER FUNCTION "public"."replace_combo_items"("p_combo_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staff_clock_in"("p_user_id" "uuid", "p_restaurant_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  -- Check not already clocked in
  IF EXISTS (
    SELECT 1 FROM staff_shifts
    WHERE user_id = p_user_id AND clock_out IS NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_CLOCKED_IN: User % is already clocked in', p_user_id;
  END IF;

  INSERT INTO staff_shifts (user_id, restaurant_id)
  VALUES (p_user_id, p_restaurant_id)
  RETURNING id INTO v_shift_id;

  RETURN v_shift_id;
END;
$$;


ALTER FUNCTION "public"."staff_clock_in"("p_user_id" "uuid", "p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staff_clock_out"("p_user_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_hours NUMERIC(6,2);
BEGIN
  UPDATE staff_shifts
  SET clock_out = NOW(),
      hours_worked = ROUND(
        EXTRACT(EPOCH FROM (NOW() - clock_in)) / 3600.0 - COALESCE(break_minutes, 0) / 60.0,
        2
      )
  WHERE user_id = p_user_id AND clock_out IS NULL
  RETURNING hours_worked INTO v_hours;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_CLOCKED_IN: User % is not currently clocked in', p_user_id;
  END IF;

  RETURN v_hours;
END;
$$;


ALTER FUNCTION "public"."staff_clock_out"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    UPDATE public.users SET email = NEW.email WHERE id = NEW.id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_promo_min_order"("p_promo_id" "uuid", "p_subtotal" numeric) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_min NUMERIC;
BEGIN
    SELECT COALESCE(min_order_amount, 0)
    INTO   v_min
    FROM   public.promo_codes
    WHERE  id = p_promo_id;

    RETURN p_subtotal >= v_min;
END;
$$;


ALTER FUNCTION "public"."validate_promo_min_order"("p_promo_id" "uuid", "p_subtotal" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_session_restaurant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."verify_session_restaurant_id"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "payment_method_id" "uuid",
    "debit_account_id" "uuid" NOT NULL,
    "credit_account_id" "uuid" NOT NULL,
    "description" "text",
    "priority" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_mappings_distinct_accounts" CHECK (("debit_account_id" <> "credit_account_id")),
    CONSTRAINT "account_mappings_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['SALE'::"text", 'PURCHASE'::"text", 'INCOME'::"text", 'EXPENSE'::"text", 'PAYMENT'::"text", 'RECEIPT'::"text", 'TRANSFER'::"text", 'REFUND'::"text", 'ADJUSTMENT'::"text", 'LOAN'::"text", 'TAX'::"text", 'OPENING_BALANCE'::"text", 'CLOSING_BALANCE'::"text"])))
);


ALTER TABLE "public"."account_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "fiscal_year_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "accounting_periods_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 60))),
    CONSTRAINT "accounting_periods_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"]))),
    CONSTRAINT "accounting_periods_valid_range" CHECK (("end_date" > "start_date"))
);


ALTER TABLE "public"."accounting_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."approval_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "level_order" integer NOT NULL,
    "min_amount" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "max_amount" numeric(12,2),
    "role_required" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "approval_levels_check" CHECK ((("max_amount" IS NULL) OR ("max_amount" >= "min_amount"))),
    CONSTRAINT "approval_levels_level_order_check" CHECK (("level_order" > 0)),
    CONSTRAINT "approval_levels_min_amount_check" CHECK (("min_amount" >= (0)::numeric)),
    CONSTRAINT "approval_levels_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)))
);


ALTER TABLE "public"."approval_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid",
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "account_type" "text" DEFAULT 'bank'::"text" NOT NULL,
    "wallet_provider" "text",
    "bank_name" "text",
    "account_number" "text",
    "opening_balance" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_accounts_account_type_check" CHECK (("account_type" = ANY (ARRAY['bank'::"text", 'wallet'::"text"]))),
    CONSTRAINT "bank_accounts_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "bank_accounts_opening_balance_check" CHECK (("opening_balance" >= (0)::numeric)),
    CONSTRAINT "bank_accounts_wallet_provider_check" CHECK ((("wallet_provider" = ANY (ARRAY['esewa'::"text", 'khalti'::"text", 'fonepay'::"text", 'connectips'::"text"])) OR ("wallet_provider" IS NULL))),
    CONSTRAINT "bank_accounts_wallet_provider_requires_wallet_type" CHECK ((("account_type" = 'wallet'::"text") OR ("wallet_provider" IS NULL)))
);


ALTER TABLE "public"."bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_reconciliations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "statement_date" "date" NOT NULL,
    "statement_balance" numeric(12,2) NOT NULL,
    "book_balance" numeric(12,2),
    "variance" numeric(12,2),
    "notes" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "reconciled_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_reconciliations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'reconciled'::"text", 'flagged'::"text"])))
);


ALTER TABLE "public"."bank_reconciliations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "counterparty_account_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "bank_transactions_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "bank_transactions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'void'::"text"]))),
    CONSTRAINT "bank_transactions_type_check" CHECK (("type" = ANY (ARRAY['deposit'::"text", 'withdrawal'::"text", 'transfer_in'::"text", 'transfer_out'::"text"])))
);


ALTER TABLE "public"."bank_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_split_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_split_id" "uuid" NOT NULL,
    "seat_id" "uuid",
    "label" "text",
    "amount" numeric(10,2) NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "tip_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(10,2) NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'unpaid'::"public"."payment_status" NOT NULL,
    "stripe_payment_intent_id" "text",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bill_split_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_splits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "split_type" "public"."split_type" DEFAULT 'full'::"public"."split_type" NOT NULL,
    "total_amount" numeric(10,2) NOT NULL,
    "split_count" smallint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bill_splits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "room_id" "uuid" NOT NULL,
    "guest_name" "text" NOT NULL,
    "guest_phone" "text",
    "guest_email" "text",
    "check_in" timestamp with time zone NOT NULL,
    "check_out" timestamp with time zone NOT NULL,
    "adults" integer DEFAULT 1 NOT NULL,
    "children" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "total_amount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "paid_amount" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "advance_payment_method" "text",
    "payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    CONSTRAINT "bookings_advance_payment_method_check" CHECK (("advance_payment_method" = ANY (ARRAY['cash'::"text", 'qr_digital'::"text", 'none'::"text"]))),
    CONSTRAINT "bookings_dates_check" CHECK (("check_out" > "check_in")),
    CONSTRAINT "bookings_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'partial'::"text", 'paid'::"text", 'refunded'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'checked_in'::"text", 'checked_out'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "linked_expense_category_id" "uuid",
    "linked_income_category_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "budget_categories_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)))
);


ALTER TABLE "public"."budget_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "budget_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "planned_amount" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "budget_lines_planned_amount_check" CHECK (("planned_amount" >= (0)::numeric))
);


ALTER TABLE "public"."budget_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "period_type" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "budgets_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 160))),
    CONSTRAINT "budgets_period_type_check" CHECK (("period_type" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "budgets_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'closed'::"text"]))),
    CONSTRAINT "budgets_valid_range" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_counts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "drawer_id" "uuid" NOT NULL,
    "counted_total" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "expected_total" numeric(12,2),
    "variance" numeric(12,2),
    "denominations" "jsonb",
    "notes" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "counted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_counts_counted_total_check" CHECK (("counted_total" >= (0)::numeric)),
    CONSTRAINT "cash_counts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'reconciled'::"text", 'flagged'::"text"])))
);


ALTER TABLE "public"."cash_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_drawers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "location" "text",
    "opening_balance" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_drawers_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "cash_drawers_opening_balance_check" CHECK (("opening_balance" >= (0)::numeric))
);


ALTER TABLE "public"."cash_drawers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "drawer_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "counterparty_drawer_id" "uuid",
    "shift_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "cash_transactions_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "cash_transactions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'void'::"text"]))),
    CONSTRAINT "cash_transactions_type_check" CHECK (("type" = ANY (ARRAY['cash_in'::"text", 'cash_out'::"text", 'opening'::"text", 'closing'::"text", 'transfer_in'::"text", 'transfer_out'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."cash_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chart_of_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "account_type" "text" NOT NULL,
    "parent_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chart_of_accounts_account_type_check" CHECK (("account_type" = ANY (ARRAY['asset'::"text", 'liability'::"text", 'equity'::"text", 'income'::"text", 'expense'::"text"]))),
    CONSTRAINT "chart_of_accounts_code_check" CHECK ((("char_length"("code") >= 1) AND ("char_length"("code") <= 30))),
    CONSTRAINT "chart_of_accounts_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 160)))
);


ALTER TABLE "public"."chart_of_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."combo_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "combo_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "combo_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."combo_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_credit_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "loyalty_member_id" "uuid",
    "customer_name" "text" NOT NULL,
    "customer_phone" "text",
    "credit_limit" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_credit_accounts_credit_limit_check" CHECK (("credit_limit" >= (0)::numeric)),
    CONSTRAINT "customer_credit_accounts_customer_name_check" CHECK ((("char_length"("customer_name") >= 1) AND ("char_length"("customer_name") <= 160)))
);


ALTER TABLE "public"."customer_credit_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."day_book_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "reference_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bank_name" "text",
    CONSTRAINT "day_book_entries_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "day_book_entries_bank_name_check" CHECK (("char_length"("bank_name") <= 100)),
    CONSTRAINT "day_book_entries_category_check" CHECK (("category" = ANY (ARRAY['order_payment'::"text", 'room_deposit'::"text", 'booking_payment'::"text", 'expense'::"text", 'refund'::"text", 'salary'::"text", 'advance'::"text", 'bank_deposit'::"text", 'other'::"text", 'qr_payment'::"text", 'card'::"text", 'transfer'::"text", 'deposit'::"text", 'withdrawal'::"text", 'bank_charges'::"text", 'transfer_out'::"text"]))),
    CONSTRAINT "day_book_entries_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "day_book_entries_type_check" CHECK (("type" = ANY (ARRAY['cash_in'::"text", 'cash_out'::"text", 'bank_in'::"text", 'bank_out'::"text"])))
);


ALTER TABLE "public"."day_book_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."day_book_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "opening_balance" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "closed_at" timestamp with time zone,
    "closed_by" "uuid",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opening_bank_balance" numeric(12,2) DEFAULT 0.00 NOT NULL,
    CONSTRAINT "day_book_sessions_opening_balance_check" CHECK (("opening_balance" >= (0)::numeric)),
    CONSTRAINT "day_book_sessions_opening_bank_balance_check" CHECK (("opening_bank_balance" >= (0)::numeric)),
    CONSTRAINT "day_book_sessions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."day_book_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "balance" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_accounts_type_check" CHECK (("type" = ANY (ARRAY['asset'::"text", 'liability'::"text", 'equity'::"text", 'revenue'::"text", 'expense'::"text"])))
);


ALTER TABLE "public"."erp_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_ap_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "bill_number" "text" NOT NULL,
    "expense_category" "text" NOT NULL,
    "amount_due" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "amount_paid" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "due_date" "date" NOT NULL,
    "status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "receipt_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_ap_bills_amount_due_check" CHECK (("amount_due" >= (0)::numeric)),
    CONSTRAINT "erp_ap_bills_amount_paid_check" CHECK (("amount_paid" >= (0)::numeric)),
    CONSTRAINT "erp_ap_bills_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "erp_ap_bills_status_check" CHECK (("status" = ANY (ARRAY['unpaid'::"text", 'partial'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."erp_ap_bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_ar_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "amount_due" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "amount_paid" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "due_date" "date" NOT NULL,
    "status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_ar_invoices_amount_due_check" CHECK (("amount_due" >= (0)::numeric)),
    CONSTRAINT "erp_ar_invoices_amount_paid_check" CHECK (("amount_paid" >= (0)::numeric)),
    CONSTRAINT "erp_ar_invoices_status_check" CHECK (("status" = ANY (ARRAY['unpaid'::"text", 'partial'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."erp_ar_invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "asset_category" "text" NOT NULL,
    "purchase_price" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "purchase_date" "date" NOT NULL,
    "depreciation_rate_annual" numeric(5,2) DEFAULT 0.00 NOT NULL,
    "accumulated_depreciation" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "current_value" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_assets_accumulated_depreciation_check" CHECK (("accumulated_depreciation" >= (0)::numeric)),
    CONSTRAINT "erp_assets_asset_category_check" CHECK (("asset_category" = ANY (ARRAY['building'::"text", 'furniture'::"text", 'kitchen_equipment'::"text", 'vehicles'::"text", 'electronics'::"text"]))),
    CONSTRAINT "erp_assets_current_value_check" CHECK (("current_value" >= (0)::numeric)),
    CONSTRAINT "erp_assets_depreciation_rate_annual_check" CHECK (("depreciation_rate_annual" >= (0)::numeric)),
    CONSTRAINT "erp_assets_purchase_price_check" CHECK (("purchase_price" >= (0)::numeric))
);


ALTER TABLE "public"."erp_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "room_id" "uuid" NOT NULL,
    "guest_name" "text" NOT NULL,
    "guest_phone" "text",
    "guest_email" "text",
    "check_in_date" timestamp with time zone NOT NULL,
    "check_out_date" timestamp with time zone,
    "status" "text" DEFAULT 'booked'::"text" NOT NULL,
    "total_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_bookings_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'paid'::"text"]))),
    CONSTRAINT "erp_bookings_status_check" CHECK (("status" = ANY (ARRAY['booked'::"text", 'checked_in'::"text", 'checked_out'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."erp_bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "fiscal_year_id" "uuid" NOT NULL,
    "department" "text" NOT NULL,
    "budgeted_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "actual_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_budgets_actual_amount_check" CHECK (("actual_amount" >= (0)::numeric)),
    CONSTRAINT "erp_budgets_budgeted_amount_check" CHECK (("budgeted_amount" >= (0)::numeric))
);


ALTER TABLE "public"."erp_budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "company_registration" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "credit_limit" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "outstanding_balance" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_clients_credit_limit_check" CHECK (("credit_limit" >= (0)::numeric))
);


ALTER TABLE "public"."erp_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_crm_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid",
    "loyalty_member_id" "uuid",
    "interaction_type" character varying(50) DEFAULT 'note'::character varying NOT NULL,
    "notes" "text" NOT NULL,
    "performed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."erp_crm_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_edit_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "field_name" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."erp_edit_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_fiscal_years" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."erp_fiscal_years" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_invoice_sequences" (
    "restaurant_id" "uuid" NOT NULL,
    "fiscal_year_id" "uuid" NOT NULL,
    "last_sequence" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."erp_invoice_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "order_id" "uuid",
    "booking_id" "uuid",
    "fiscal_year_id" "uuid" NOT NULL,
    "subtotal_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "service_charge_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "tax_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "total_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "customer_name" "text",
    "customer_pan" "text",
    "payment_method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."erp_invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_journal_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "fiscal_year_id" "uuid",
    "entry_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" NOT NULL,
    "reference_source" "text" NOT NULL,
    "reference_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."erp_journal_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_journal_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journal_entry_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "debit" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "credit" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_debit_credit" CHECK (((("debit" > (0)::numeric) AND ("credit" = (0)::numeric)) OR (("credit" > (0)::numeric) AND ("debit" = (0)::numeric)))),
    CONSTRAINT "erp_journal_lines_credit_check" CHECK (("credit" >= (0)::numeric)),
    CONSTRAINT "erp_journal_lines_debit_check" CHECK (("debit" >= (0)::numeric))
);


ALTER TABLE "public"."erp_journal_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "module_name" "text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."erp_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_payroll" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "pay_period_start" "date" NOT NULL,
    "pay_period_end" "date" NOT NULL,
    "hours_worked" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "hourly_rate" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "bonus" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "deductions" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "net_salary" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_payroll_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."erp_payroll" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."erp_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_purchase_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "quantity" numeric(15,4) NOT NULL,
    "unit_price" numeric(15,2) NOT NULL,
    "total_price" numeric(15,2) GENERATED ALWAYS AS (("quantity" * "unit_price")) STORED NOT NULL,
    CONSTRAINT "erp_purchase_order_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "erp_purchase_order_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."erp_purchase_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "order_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "total_amount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "received_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_purchase_orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'paid'::"text"]))),
    CONSTRAINT "erp_purchase_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'ordered'::"text", 'received'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."erp_purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_role_permissions" (
    "role_id" bigint NOT NULL,
    "permission_id" "uuid" NOT NULL
);


ALTER TABLE "public"."erp_role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "room_number" "text" NOT NULL,
    "room_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "rate_per_night" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_rooms_status_check" CHECK (("status" = ANY (ARRAY['available'::"text", 'occupied'::"text", 'dirty'::"text", 'maintenance'::"text"])))
);


ALTER TABLE "public"."erp_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "contact_person" "text",
    "phone" "text",
    "email" "text",
    "pan_number" "text",
    "address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."erp_suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "expense_id" "uuid" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_name" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."expense_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expense_categories_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)))
);


ALTER TABLE "public"."expense_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "vendor_name" "text",
    "bank_account_id" "uuid",
    "cash_drawer_id" "uuid",
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurrence_interval" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expenses_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "expenses_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "expenses_recurrence_interval_check" CHECK ((("recurrence_interval" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'yearly'::"text"])) OR ("recurrence_interval" IS NULL))),
    CONSTRAINT "expenses_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "rating" smallint NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "feedback_comment_check" CHECK (("char_length"("comment") <= 500)),
    CONSTRAINT "feedback_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."finance_payment_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "finance_payment_methods_category_check" CHECK (("category" = ANY (ARRAY['cash'::"text", 'bank'::"text", 'wallet'::"text"]))),
    CONSTRAINT "finance_payment_methods_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)))
);


ALTER TABLE "public"."finance_payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."finance_role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "role_name" "text" NOT NULL,
    "module" "text" NOT NULL,
    "can_view" boolean DEFAULT false NOT NULL,
    "can_create" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_delete" boolean DEFAULT false NOT NULL,
    "can_approve" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."finance_role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."finance_settings" (
    "restaurant_id" "uuid" NOT NULL,
    "base_currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "default_tax_rate" numeric(5,2) DEFAULT 0.00 NOT NULL,
    "fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
    "rounding_mode" "text" DEFAULT 'nearest'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "finance_settings_default_tax_rate_check" CHECK (("default_tax_rate" >= (0)::numeric)),
    CONSTRAINT "finance_settings_fiscal_year_start_month_check" CHECK ((("fiscal_year_start_month" >= 1) AND ("fiscal_year_start_month" <= 12))),
    CONSTRAINT "finance_settings_rounding_mode_check" CHECK (("rounding_mode" = ANY (ARRAY['nearest'::"text", 'up'::"text", 'down'::"text", 'none'::"text"])))
);


ALTER TABLE "public"."finance_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_event_sequences" (
    "restaurant_id" "uuid" NOT NULL,
    "year" "text" DEFAULT "to_char"(("now"() AT TIME ZONE 'Asia/Kathmandu'::"text"), 'YYYY'::"text") NOT NULL,
    "current_number" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_event_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_code" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "source_module" "text" NOT NULL,
    "source_id" "text",
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "business_date" "date" NOT NULL,
    "accounting_date" "date" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "payment_method_id" "uuid",
    "customer_id" "uuid",
    "supplier_id" "uuid",
    "employee_id" "uuid",
    "reference_number" "text",
    "description" "text",
    "metadata" "jsonb",
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_events_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "financial_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['RESTAURANT_SALE'::"text", 'HOTEL_CHECKOUT'::"text", 'BOOKING_ADVANCE'::"text", 'INVENTORY_PURCHASE'::"text", 'SUPPLIER_PAYMENT'::"text", 'SALARY_PAYMENT'::"text", 'CASH_DEPOSIT'::"text", 'CASH_WITHDRAWAL'::"text", 'BANK_TRANSFER'::"text", 'EXPENSE_PAYMENT'::"text", 'OTHER_INCOME'::"text", 'LOAN_RECEIVED'::"text", 'LOAN_REPAYMENT'::"text", 'OWNER_INVESTMENT'::"text", 'OWNER_WITHDRAWAL'::"text", 'REFUND'::"text", 'ADJUSTMENT'::"text"]))),
    CONSTRAINT "financial_events_retry_count_check" CHECK (("retry_count" >= 0)),
    CONSTRAINT "financial_events_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'PROCESSING'::"text", 'PROCESSED'::"text", 'FAILED'::"text", 'REVERSED'::"text"])))
);


ALTER TABLE "public"."financial_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_transaction_sequences" (
    "restaurant_id" "uuid" NOT NULL,
    "year" "text" DEFAULT "to_char"(("now"() AT TIME ZONE 'Asia/Kathmandu'::"text"), 'YYYY'::"text") NOT NULL,
    "current_number" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_transaction_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_code" "text" NOT NULL,
    "financial_event_id" "uuid" NOT NULL,
    "transaction_type" "text" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "business_date" "date" NOT NULL,
    "accounting_date" "date" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "payment_method_id" "uuid",
    "customer_id" "uuid",
    "supplier_id" "uuid",
    "employee_id" "uuid",
    "source_module" "text" NOT NULL,
    "source_reference" "text",
    "description" "text",
    "metadata" "jsonb",
    "status" "text" DEFAULT 'NEW'::"text" NOT NULL,
    "created_by" "uuid",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "financial_transactions_status_check" CHECK (("status" = ANY (ARRAY['NEW'::"text", 'VALIDATED'::"text", 'READY_FOR_MAPPING'::"text", 'FAILED'::"text", 'CANCELLED'::"text"]))),
    CONSTRAINT "financial_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['SALE'::"text", 'PURCHASE'::"text", 'INCOME'::"text", 'EXPENSE'::"text", 'PAYMENT'::"text", 'RECEIPT'::"text", 'TRANSFER'::"text", 'REFUND'::"text", 'ADJUSTMENT'::"text", 'LOAN'::"text", 'TAX'::"text", 'OPENING_BALANCE'::"text", 'CLOSING_BALANCE'::"text"])))
);


ALTER TABLE "public"."financial_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_years" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_years_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 60))),
    CONSTRAINT "fiscal_years_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"]))),
    CONSTRAINT "fiscal_years_valid_range" CHECK (("end_date" > "start_date"))
);


ALTER TABLE "public"."fiscal_years" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."homepage_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "template" "text" DEFAULT 'modern'::"text" NOT NULL,
    "about" "jsonb" DEFAULT '{"title": "About Us", "enabled": true, "image_url": "", "description": "Quality food and excellent service since day one."}'::"jsonb" NOT NULL,
    "features" "jsonb" DEFAULT '[{"title": "Fresh Ingredients", "description": "Sourced daily"}, {"title": "Expert Chefs", "description": "Years of experience"}, {"title": "24/7 Service", "description": "Always available"}]'::"jsonb" NOT NULL,
    "cta" "jsonb" DEFAULT '{"enabled": true, "headline": "Order Now", "button_text": "Start Ordering", "description": "Get your favorite meal delivered"}'::"jsonb" NOT NULL,
    "footer" "jsonb" DEFAULT '{"enabled": true, "copyright": "Â© 2024 Your Restaurant", "social_links": []}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "hero_title" "text" DEFAULT 'Welcome to Our Restaurant'::"text" NOT NULL,
    "hero_subtitle" "text" DEFAULT 'Experience authentic flavors'::"text" NOT NULL,
    "hero_image_url" "text",
    "hero_video_url" "text",
    "hero_cta_text" "text" DEFAULT 'View Menu'::"text" NOT NULL,
    "theme_primary" "text" DEFAULT '#E85D04'::"text" NOT NULL,
    "theme_secondary" "text" DEFAULT '#1B263B'::"text" NOT NULL,
    "theme_accent" "text" DEFAULT '#EC4899'::"text" NOT NULL,
    "logo_url" "text",
    "gallery" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "social" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "contact" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "homepage_configs_template_check" CHECK (("template" = ANY (ARRAY['modern'::"text", 'elegant'::"text", 'vibrant'::"text", 'minimal'::"text", 'classic'::"text"])))
);


ALTER TABLE "public"."homepage_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "income_categories_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)))
);


ALTER TABLE "public"."income_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "bank_account_id" "uuid",
    "cash_drawer_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "income_entries_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "income_entries_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "income_entries_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."income_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingredient_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric(12,4) NOT NULL,
    "reference_id" "uuid",
    "notes" "text",
    "performed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ingredient_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['purchase'::"text", 'usage'::"text", 'waste'::"text", 'adjustment'::"text", 'transfer'::"text"])))
);


ALTER TABLE "public"."ingredient_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "stock_quantity" numeric(12,4) DEFAULT 0 NOT NULL,
    "reorder_level" numeric(12,4),
    "cost_per_unit" numeric(10,4) DEFAULT 0 NOT NULL,
    "supplier" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ingredients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role_id" integer NOT NULL,
    "token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department_id" "uuid",
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_sequences" (
    "restaurant_id" "uuid" NOT NULL,
    "current_number" bigint DEFAULT 0 NOT NULL,
    "prefix" "text" DEFAULT 'INV'::"text" NOT NULL,
    "fiscal_year" "text" DEFAULT '2082/83'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoice_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loan_emi_schedule" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "loan_id" "uuid" NOT NULL,
    "installment_no" integer NOT NULL,
    "due_date" "date" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loan_emi_schedule_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "loan_emi_schedule_installment_no_check" CHECK (("installment_no" > 0)),
    CONSTRAINT "loan_emi_schedule_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."loan_emi_schedule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loan_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "loan_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "principal_component" numeric(12,2),
    "interest_component" numeric(12,2),
    "payment_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loan_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "loan_payments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."loan_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "lender_name" "text" NOT NULL,
    "principal_amount" numeric(12,2) NOT NULL,
    "interest_rate" numeric(5,2),
    "start_date" "date" NOT NULL,
    "tenure_months" integer,
    "notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loans_interest_rate_check" CHECK (("interest_rate" >= (0)::numeric)),
    CONSTRAINT "loans_lender_name_check" CHECK ((("char_length"("lender_name") >= 1) AND ("char_length"("lender_name") <= 160))),
    CONSTRAINT "loans_principal_amount_check" CHECK (("principal_amount" > (0)::numeric)),
    CONSTRAINT "loans_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text"]))),
    CONSTRAINT "loans_tenure_months_check" CHECK (("tenure_months" > 0))
);


ALTER TABLE "public"."loans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "points_per_dollar" numeric(6,2) DEFAULT 10 NOT NULL,
    "redemption_threshold" integer DEFAULT 1000 NOT NULL,
    "redemption_value" numeric(10,2) DEFAULT 5.00 NOT NULL,
    "silver_threshold" integer DEFAULT 5000 NOT NULL,
    "gold_threshold" integer DEFAULT 15000 NOT NULL,
    "platinum_threshold" integer DEFAULT 50000 NOT NULL,
    "birthday_bonus_points" integer DEFAULT 500,
    "signup_bonus_points" integer DEFAULT 100,
    "is_active" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "auth_user_id" "uuid",
    "phone" "text",
    "email" "text",
    "display_name" "text",
    "points_balance" integer DEFAULT 0 NOT NULL,
    "lifetime_points" integer DEFAULT 0 NOT NULL,
    "lifetime_spend" numeric(12,2) DEFAULT 0 NOT NULL,
    "tier" "text" DEFAULT 'bronze'::"text" NOT NULL,
    "visit_count" integer DEFAULT 0 NOT NULL,
    "last_visit_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_members_tier_check" CHECK (("tier" = ANY (ARRAY['bronze'::"text", 'silver'::"text", 'gold'::"text", 'platinum'::"text"])))
);


ALTER TABLE "public"."loyalty_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "type" "text" NOT NULL,
    "points" integer NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_transactions_type_check" CHECK (("type" = ANY (ARRAY['earn'::"text", 'redeem'::"text", 'bonus'::"text", 'adjustment'::"text", 'expire'::"text"])))
);


ALTER TABLE "public"."loyalty_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mapped_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "financial_transaction_id" "uuid" NOT NULL,
    "account_mapping_id" "uuid",
    "debit_account_id" "uuid",
    "credit_account_id" "uuid",
    "amount" numeric(18,2) NOT NULL,
    "currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "mapping_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mapped_transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "mapped_transactions_mapping_status_check" CHECK (("mapping_status" = ANY (ARRAY['PENDING'::"text", 'MAPPED'::"text", 'FAILED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."mapped_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "image_url" "text"
);


ALTER TABLE "public"."menu_categories" OWNER TO "postgres";


COMMENT ON COLUMN "public"."menu_categories"."image_url" IS 'Optional image URL representing this category (shown in admin and customer menu).';



CREATE TABLE IF NOT EXISTS "public"."menu_item_modifier_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "menu_item_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "min_selections" smallint DEFAULT 0 NOT NULL,
    "max_selections" smallint DEFAULT 1 NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_selection_range" CHECK ((("min_selections" >= 0) AND ("max_selections" >= "min_selections")))
);


ALTER TABLE "public"."menu_item_modifier_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_item_modifiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price_adjustment" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."menu_item_modifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_item_pairings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "paired_item_id" "uuid" NOT NULL,
    "co_order_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."menu_item_pairings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_item_variations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "menu_item_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "is_available" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "image_url" "text"
);


ALTER TABLE "public"."menu_item_variations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."menu_item_variations"."image_url" IS 'Optional image URL for this specific variation (e.g. different sizes/flavors).';



CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "price" numeric(10,2) NOT NULL,
    "image_url" "text",
    "is_available" boolean DEFAULT true NOT NULL,
    "stock_count" integer,
    "preparation_min" smallint DEFAULT 10,
    "allergens" "text"[],
    "tags" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_combo" boolean DEFAULT false NOT NULL,
    CONSTRAINT "menu_items_price_check" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."menu_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_item_modifiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "modifier_id" "uuid" NOT NULL,
    "modifier_name" "text" NOT NULL,
    "price_adjustment" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_item_modifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "menu_item_id" "uuid" NOT NULL,
    "quantity" smallint NOT NULL,
    "unit_price" numeric(10,2) NOT NULL,
    "special_request" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."order_item_status" DEFAULT 'pending'::"public"."order_item_status" NOT NULL,
    "chef_id" "uuid",
    "queued_at" timestamp with time zone,
    "claimed_by" "uuid",
    "claimed_at" timestamp with time zone,
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_promos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "promo_code_id" "uuid" NOT NULL,
    "code_used" "text" NOT NULL,
    "discount_amount" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_promos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid",
    "restaurant_id" "uuid" NOT NULL,
    "customer_note" "text",
    "status" "public"."order_status" DEFAULT 'pending'::"public"."order_status" NOT NULL,
    "total_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "placed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "subtotal_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "tip_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'unpaid'::"public"."payment_status" NOT NULL,
    "stripe_payment_intent_id" "text",
    "paid_at" timestamp with time zone,
    "seat_id" "uuid",
    "loyalty_member_id" "uuid",
    "discount_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "promo_code_id" "uuid",
    "payment_method" "text",
    "invoice_number" "text",
    "pan_number" "text",
    "vat_amount" numeric(10,2) DEFAULT 0,
    "order_date_bs" "text",
    "refunded_amount" numeric(10,2) DEFAULT 0,
    "client_request_id" "text",
    "order_type" "public"."order_type" DEFAULT 'dine_in'::"public"."order_type" NOT NULL,
    "customer_name" "text",
    "customer_phone" "text",
    "customer_email" "text",
    "pickup_time" timestamp with time zone,
    "legacy_takeout_id" "uuid",
    "claimed_by" "uuid",
    "claimed_at" timestamp with time zone,
    "chef_id" "uuid",
    "waiter_id" "uuid",
    "delivery_staff_id" "uuid",
    "delivery_address" "text",
    "delivery_verification_code" "text",
    "needs_confirmation" boolean DEFAULT false NOT NULL,
    "cancellation_reason" "text",
    CONSTRAINT "orders_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'card'::"text", 'mobile'::"text", 'split'::"text"]))),
    CONSTRAINT "orders_session_per_type_chk" CHECK (((("order_type" = 'dine_in'::"public"."order_type") AND ("session_id" IS NOT NULL)) OR (("order_type" = ANY (ARRAY['takeout'::"public"."order_type", 'delivery'::"public"."order_type"])) AND ("session_id" IS NULL))))
);

ALTER TABLE ONLY "public"."orders" REPLICA IDENTITY FULL;


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "takeout_order_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "payment_method" "text" DEFAULT 'qr_scan'::"text" NOT NULL,
    "customer_claimed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "staff_verified" boolean DEFAULT false NOT NULL,
    "staff_verified_by" "uuid",
    "staff_verified_at" timestamp with time zone,
    "staff_rejected" boolean DEFAULT false NOT NULL,
    "rejection_reason" "text",
    "reference_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "screenshot_url" "text",
    "claimed_by" "uuid",
    "claimed_at" timestamp with time zone,
    CONSTRAINT "payment_verifications_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['qr_scan'::"text", 'esewa'::"text", 'khalti'::"text", 'fonepay'::"text", 'cash'::"text", 'card'::"text", 'stripe'::"text"])))
);


ALTER TABLE "public"."payment_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phone_otp_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "otp_code" "text" NOT NULL,
    "purpose" "text" DEFAULT 'login'::"text" NOT NULL,
    "restaurant_id" "uuid",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "phone_otp_tokens_purpose_check" CHECK (("purpose" = ANY (ARRAY['login'::"text", 'verify'::"text", 'loyalty_signup'::"text"])))
);


ALTER TABLE "public"."phone_otp_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pricing_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "rule_type" "public"."pricing_rule_type" NOT NULL,
    "value" numeric(10,2) NOT NULL,
    "applies_to_item_id" "uuid",
    "applies_to_category_id" "uuid",
    "applies_to_all" boolean DEFAULT false NOT NULL,
    "days_of_week" smallint[] DEFAULT '{0,1,2,3,4,5,6}'::smallint[] NOT NULL,
    "start_time" time without time zone DEFAULT '00:00:00'::time without time zone NOT NULL,
    "end_time" time without time zone DEFAULT '23:59:00'::time without time zone NOT NULL,
    "valid_from" "date",
    "valid_until" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "priority" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_scope" CHECK ((("applies_to_item_id" IS NOT NULL) OR ("applies_to_category_id" IS NOT NULL) OR ("applies_to_all" = true))),
    CONSTRAINT "valid_value" CHECK (("value" >= (0)::numeric))
);


ALTER TABLE "public"."pricing_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "promo_type" "public"."promo_type" NOT NULL,
    "value" numeric(10,2) DEFAULT 0 NOT NULL,
    "free_item_id" "uuid",
    "bogo_buy_item_id" "uuid",
    "bogo_get_item_id" "uuid",
    "min_order_amount" numeric(10,2) DEFAULT 0,
    "max_discount_amount" numeric(10,2),
    "max_uses" integer,
    "max_uses_per_customer" integer DEFAULT 1,
    "current_uses" integer DEFAULT 0 NOT NULL,
    "valid_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valid_until" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_promo_value" CHECK (("value" >= (0)::numeric))
);


ALTER TABLE "public"."promo_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "video_url" "text" NOT NULL,
    "title" "text" DEFAULT ''::"text",
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."promo_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receivable_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "customer_credit_account_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "receivable_transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "receivable_transactions_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "receivable_transactions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'void'::"text"]))),
    CONSTRAINT "receivable_transactions_type_check" CHECK (("type" = ANY (ARRAY['charge'::"text", 'payment'::"text"])))
);


ALTER TABLE "public"."receivable_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "menu_item_id" "uuid" NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "quantity_needed" numeric(12,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid",
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "logo_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contact_phone" "text",
    "contact_email" "text",
    "address" "text",
    "pan_number" "text",
    "vat_registered" boolean DEFAULT false NOT NULL,
    "payment_qr_url" "text",
    "payment_qr_label" "text" DEFAULT 'Scan to Pay'::"text",
    "custom_domain" "text",
    "subscription_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "subscription_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "subscription_expires_at" timestamp with time zone,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "max_staff" integer DEFAULT 10,
    "max_menu_items" integer DEFAULT 100,
    "is_suspended" boolean DEFAULT false,
    "max_tables" integer DEFAULT 20 NOT NULL,
    "low_stock_alerted_at" timestamp with time zone,
    "slogan" "text",
    "vat_number" "text",
    "telephone" "text",
    "latitude" double precision,
    "longitude" double precision,
    "physical_menu_urls" "text"[] DEFAULT ARRAY[]::"text"[],
    "allowed_ips" "text",
    "business_type" "text",
    CONSTRAINT "restaurants_subscription_status_check" CHECK (("subscription_status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'suspended'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "restaurants_subscription_tier_check" CHECK (("subscription_tier" = ANY (ARRAY['free'::"text", 'basic'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."restaurants"."slogan" IS 'Optional restaurant tagline shown on menus and homepage';



COMMENT ON COLUMN "public"."restaurants"."vat_number" IS 'Nepal VAT registration number (9 digits)';



COMMENT ON COLUMN "public"."restaurants"."telephone" IS 'Landline/telephone number separate from mobile contact_phone';



COMMENT ON COLUMN "public"."restaurants"."latitude" IS 'GPS latitude captured at signup via browser geolocation';



COMMENT ON COLUMN "public"."restaurants"."longitude" IS 'GPS longitude captured at signup via browser geolocation';



CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" smallint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_charges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "charge_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "charged_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "room_charges_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "room_charges_charge_type_check" CHECK (("charge_type" = ANY (ARRAY['room_service'::"text", 'minibar'::"text", 'laundry'::"text", 'spa'::"text", 'parking'::"text", 'other'::"text"]))),
    CONSTRAINT "room_charges_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500)))
);


ALTER TABLE "public"."room_charges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "base_price" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "capacity" integer DEFAULT 2 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amenities" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "image_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."room_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "room_number" "text" NOT NULL,
    "floor" "text",
    "status" "text" DEFAULT 'available'::"text" NOT NULL,
    "type_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rooms_status_check" CHECK (("status" = ANY (ARRAY['available'::"text", 'occupied'::"text", 'dirty'::"text", 'maintenance'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid",
    "restaurant_id" "uuid" NOT NULL,
    "request_type" "text" NOT NULL,
    "message" "text",
    "status" "public"."service_request_status" DEFAULT 'pending'::"public"."service_request_status" NOT NULL,
    "acknowledged_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "table_id" "uuid",
    CONSTRAINT "service_requests_request_type_check" CHECK (("request_type" = ANY (ARRAY['call_waiter'::"text", 'request_bill'::"text", 'need_water'::"text", 'clean_table'::"text", 'other'::"text", 'open_session'::"text"])))
);

ALTER TABLE ONLY "public"."service_requests" REPLICA IDENTITY FULL;


ALTER TABLE "public"."service_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_seats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "seat_number" smallint NOT NULL,
    "label" "text",
    "device_fingerprint" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_seat_number" CHECK (("seat_number" > 0))
);


ALTER TABLE "public"."session_seats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "opened_by" "uuid",
    "session_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'base64url'::"text") NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '04:00:00'::interval) NOT NULL,
    "guest_count" smallint,
    "notes" "text",
    "max_seats" smallint DEFAULT 4 NOT NULL,
    CONSTRAINT "sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text", 'expired'::"text"])))
);

ALTER TABLE ONLY "public"."sessions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "theme" "jsonb" DEFAULT '{"fontFamily": "Inter", "menuLayout": "grid", "borderRadius": "lg", "primaryColor": "#FB6303", "secondaryColor": "#1B263B"}'::"jsonb" NOT NULL,
    "features" "jsonb" DEFAULT '{"tipsEnabled": true, "feedbackEnabled": true, "geofenceEnabled": false, "geofenceRadiusMeters": 100}'::"jsonb" NOT NULL,
    "business_hours" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "features_v2" "jsonb" DEFAULT '{"currency": "USD", "currencySymbol": "$", "defaultTaxRate": 13.0, "loyaltyEnabled": false, "takeoutEnabled": false, "staffShiftsEnabled": false, "splitBillingEnabled": true, "multiLanguageEnabled": false, "dynamicPricingEnabled": false, "serviceRequestsEnabled": true, "ingredientTrackingEnabled": false}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "clock_in" timestamp with time zone DEFAULT "now"() NOT NULL,
    "clock_out" timestamp with time zone,
    "hours_worked" numeric(6,2),
    "break_start" timestamp with time zone,
    "break_end" timestamp with time zone,
    "break_minutes" smallint DEFAULT 0,
    "notes" "text",
    "approved_by" "uuid",
    "is_approved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "payment_method" "text" NOT NULL,
    "reference_code" "text",
    "notes" "text",
    "recorded_by" "uuid",
    "paid_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price_monthly" numeric(10,2) DEFAULT 0 NOT NULL,
    "price_yearly" numeric(10,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "max_menu_items" integer DEFAULT 50 NOT NULL,
    "max_staff" integer DEFAULT 5 NOT NULL,
    "max_tables" integer DEFAULT 10 NOT NULL,
    "max_orders_per_month" integer,
    "features_included" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "bill_number" "text",
    "amount" numeric(12,2) NOT NULL,
    "description" "text",
    "due_date" "date",
    "status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_bills_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "supplier_bills_status_check" CHECK (("status" = ANY (ARRAY['unpaid'::"text", 'partial'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."supplier_bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "bill_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "supplier_payments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."supplier_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "contact_person" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "suppliers_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 160)))
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supported_languages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "language_code" "text" NOT NULL,
    "language_name" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supported_languages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "qr_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(24), 'base64url'::"text") NOT NULL,
    "nfc_uid" "text",
    "capacity" smallint,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "table_status" "text" DEFAULT 'available'::"text" NOT NULL,
    "cleaning_claimed_by" "uuid",
    "cleaning_claimed_at" timestamp with time zone,
    CONSTRAINT "tables_table_status_check" CHECK (("table_status" = ANY (ARRAY['available'::"text", 'dirty'::"text", 'reserved'::"text"])))
);

ALTER TABLE ONLY "public"."tables" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."takeout_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "loyalty_member_id" "uuid",
    "customer_name" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "customer_email" "text",
    "pickup_time" timestamp with time zone NOT NULL,
    "estimated_prep_minutes" smallint,
    "status" "public"."takeout_status" DEFAULT 'placed'::"public"."takeout_status" NOT NULL,
    "items" "jsonb" NOT NULL,
    "subtotal_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'unpaid'::"public"."payment_status" NOT NULL,
    "stripe_payment_intent_id" "text",
    "promo_code_id" "uuid",
    "discount_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "customer_note" "text",
    "kitchen_note" "text",
    "placed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "picked_up_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone
);


ALTER TABLE "public"."takeout_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_configurations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "tax_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "rate_percent" numeric(5,2),
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tax_configurations_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "tax_configurations_rate_percent_check" CHECK (("rate_percent" >= (0)::numeric)),
    CONSTRAINT "tax_configurations_tax_type_check" CHECK (("tax_type" = ANY (ARRAY['vat'::"text", 'pan'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."tax_configurations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_filings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "tax_configuration_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "ird_reference" "text",
    "notes" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "filed_by" "uuid",
    "filed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tax_filings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'filed'::"text"]))),
    CONSTRAINT "tax_filings_valid_range" CHECK (("period_end" >= "period_start"))
);


ALTER TABLE "public"."tax_filings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."translations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "language_code" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "translated_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "translations_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['menu_item_name'::"text", 'menu_item_description'::"text", 'category_name'::"text", 'modifier_group_name'::"text", 'modifier_name'::"text", 'restaurant_name'::"text"])))
);


ALTER TABLE "public"."translations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "restaurant_id" "uuid",
    "full_name" "text" NOT NULL,
    "avatar_url" "text",
    "role_id" smallint,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    "department_id" "uuid",
    "hourly_rate" numeric(10,2) DEFAULT 0.00 NOT NULL
);

ALTER TABLE ONLY "public"."users" REPLICA IDENTITY FULL;


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voucher_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "voucher_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "attachment_type" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_name" "text",
    "file_size" integer,
    "mime_type" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "voucher_attachments_attachment_type_check" CHECK (("attachment_type" = ANY (ARRAY['pdf'::"text", 'image'::"text", 'invoice'::"text", 'receipt'::"text", 'document'::"text"])))
);


ALTER TABLE "public"."voucher_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voucher_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "voucher_id" "uuid" NOT NULL,
    "mapped_transaction_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "line_type" "text" NOT NULL,
    "line_number" integer NOT NULL,
    "description" "text",
    "amount" numeric(18,2) NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "voucher_lines_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "voucher_lines_line_type_check" CHECK (("line_type" = ANY (ARRAY['debit'::"text", 'credit'::"text"])))
);


ALTER TABLE "public"."voucher_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voucher_sequences" (
    "restaurant_id" "uuid" NOT NULL,
    "voucher_type_id" "uuid" NOT NULL,
    "year" "text" DEFAULT "to_char"(("now"() AT TIME ZONE 'Asia/Kathmandu'::"text"), 'YYYY'::"text") NOT NULL,
    "current_number" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."voucher_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voucher_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "voucher_category" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "voucher_types_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "voucher_types_prefix_check" CHECK ((("char_length"("prefix") >= 1) AND ("char_length"("prefix") <= 10))),
    CONSTRAINT "voucher_types_voucher_category_check" CHECK (("voucher_category" = ANY (ARRAY['receipt'::"text", 'payment'::"text", 'journal'::"text", 'contra'::"text"])))
);


ALTER TABLE "public"."voucher_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vouchers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "voucher_number" "text" NOT NULL,
    "financial_transaction_id" "uuid" NOT NULL,
    "voucher_type_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "business_date" "date" NOT NULL,
    "accounting_date" "date" NOT NULL,
    "total_amount" numeric(18,2) NOT NULL,
    "currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "status" "text" DEFAULT 'DRAFT'::"text" NOT NULL,
    "reference_number" "text",
    "description" "text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vouchers_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'GENERATED'::"text", 'PENDING_APPROVAL'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'CANCELLED'::"text", 'REVERSED'::"text"]))),
    CONSTRAINT "vouchers_total_amount_check" CHECK (("total_amount" > (0)::numeric))
);


ALTER TABLE "public"."vouchers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_periods"
    ADD CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."approval_levels"
    ADD CONSTRAINT "approval_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."approval_levels"
    ADD CONSTRAINT "approval_levels_unique_order" UNIQUE ("restaurant_id", "level_order");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."bank_reconciliations"
    ADD CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bill_split_items"
    ADD CONSTRAINT "bill_split_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bill_splits"
    ADD CONSTRAINT "bill_splits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."budget_lines"
    ADD CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_lines"
    ADD CONSTRAINT "budget_lines_unique_category" UNIQUE ("budget_id", "category_id");



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_drawers"
    ADD CONSTRAINT "cash_drawers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_drawers"
    ADD CONSTRAINT "cash_drawers_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_unique_code" UNIQUE ("restaurant_id", "code");



ALTER TABLE ONLY "public"."combo_items"
    ADD CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_credit_accounts"
    ADD CONSTRAINT "customer_credit_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."day_book_entries"
    ADD CONSTRAINT "day_book_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."day_book_sessions"
    ADD CONSTRAINT "day_book_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."day_book_sessions"
    ADD CONSTRAINT "day_book_sessions_unique_date" UNIQUE ("restaurant_id", "date");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eod_reports"
    ADD CONSTRAINT "eod_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_accounts"
    ADD CONSTRAINT "erp_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_ap_bills"
    ADD CONSTRAINT "erp_ap_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_ar_invoices"
    ADD CONSTRAINT "erp_ar_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_assets"
    ADD CONSTRAINT "erp_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_bookings"
    ADD CONSTRAINT "erp_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_budgets"
    ADD CONSTRAINT "erp_budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_clients"
    ADD CONSTRAINT "erp_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_crm_interactions"
    ADD CONSTRAINT "erp_crm_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_edit_history"
    ADD CONSTRAINT "erp_edit_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_fiscal_years"
    ADD CONSTRAINT "erp_fiscal_years_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_invoice_sequences"
    ADD CONSTRAINT "erp_invoice_sequences_pkey" PRIMARY KEY ("restaurant_id", "fiscal_year_id");



ALTER TABLE ONLY "public"."erp_invoices"
    ADD CONSTRAINT "erp_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_journal_entries"
    ADD CONSTRAINT "erp_journal_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_journal_lines"
    ADD CONSTRAINT "erp_journal_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_modules"
    ADD CONSTRAINT "erp_modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_payroll"
    ADD CONSTRAINT "erp_payroll_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_permissions"
    ADD CONSTRAINT "erp_permissions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."erp_permissions"
    ADD CONSTRAINT "erp_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_purchase_order_items"
    ADD CONSTRAINT "erp_purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_purchase_orders"
    ADD CONSTRAINT "erp_purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_role_permissions"
    ADD CONSTRAINT "erp_role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."erp_rooms"
    ADD CONSTRAINT "erp_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_suppliers"
    ADD CONSTRAINT "erp_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_attachments"
    ADD CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finance_payment_methods"
    ADD CONSTRAINT "finance_payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finance_payment_methods"
    ADD CONSTRAINT "finance_payment_methods_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."finance_role_permissions"
    ADD CONSTRAINT "finance_role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finance_role_permissions"
    ADD CONSTRAINT "finance_role_permissions_unique" UNIQUE ("restaurant_id", "role_name", "module");



ALTER TABLE ONLY "public"."finance_settings"
    ADD CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("restaurant_id");



ALTER TABLE ONLY "public"."financial_event_sequences"
    ADD CONSTRAINT "financial_event_sequences_pkey" PRIMARY KEY ("restaurant_id");



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_unique_code" UNIQUE ("restaurant_id", "event_code");



ALTER TABLE ONLY "public"."financial_transaction_sequences"
    ADD CONSTRAINT "financial_transaction_sequences_pkey" PRIMARY KEY ("restaurant_id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_unique_code" UNIQUE ("restaurant_id", "transaction_code");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_unique_event" UNIQUE ("financial_event_id");



ALTER TABLE ONLY "public"."fiscal_years"
    ADD CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."homepage_configs"
    ADD CONSTRAINT "homepage_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."homepage_configs"
    ADD CONSTRAINT "homepage_configs_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."income_categories"
    ADD CONSTRAINT "income_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_categories"
    ADD CONSTRAINT "income_categories_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."income_entries"
    ADD CONSTRAINT "income_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingredient_movements"
    ADD CONSTRAINT "ingredient_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("restaurant_id");



ALTER TABLE ONLY "public"."loan_emi_schedule"
    ADD CONSTRAINT "loan_emi_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loan_emi_schedule"
    ADD CONSTRAINT "loan_emi_schedule_unique_installment" UNIQUE ("loan_id", "installment_no");



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_config"
    ADD CONSTRAINT "loyalty_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_config"
    ADD CONSTRAINT "loyalty_config_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_transactions"
    ADD CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_unique_financial_transaction" UNIQUE ("financial_transaction_id");



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_item_modifier_groups"
    ADD CONSTRAINT "menu_item_modifier_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_item_modifiers"
    ADD CONSTRAINT "menu_item_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_item_pairings"
    ADD CONSTRAINT "menu_item_pairings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_item_variations"
    ADD CONSTRAINT "menu_item_variations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_promos"
    ADD CONSTRAINT "order_promos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_verifications"
    ADD CONSTRAINT "payment_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phone_otp_tokens"
    ADD CONSTRAINT "phone_otp_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pricing_rules"
    ADD CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_videos"
    ADD CONSTRAINT "promo_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receivable_transactions"
    ADD CONSTRAINT "receivable_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_custom_domain_key" UNIQUE ("custom_domain");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."room_charges"
    ADD CONSTRAINT "room_charges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."room_types"
    ADD CONSTRAINT "room_types_name_per_restaurant" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."room_types"
    ADD CONSTRAINT "room_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_seats"
    ADD CONSTRAINT "session_seats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_session_token_key" UNIQUE ("session_token");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_payments"
    ADD CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_bills"
    ADD CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."supported_languages"
    ADD CONSTRAINT "supported_languages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supported_languages"
    ADD CONSTRAINT "supported_languages_restaurant_lang_key" UNIQUE ("restaurant_id", "language_code");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_nfc_uid_key" UNIQUE ("nfc_uid");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_qr_token_key" UNIQUE ("qr_token");



ALTER TABLE ONLY "public"."takeout_orders"
    ADD CONSTRAINT "takeout_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_configurations"
    ADD CONSTRAINT "tax_configurations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_configurations"
    ADD CONSTRAINT "tax_configurations_unique_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."tax_filings"
    ADD CONSTRAINT "tax_filings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translations"
    ADD CONSTRAINT "translations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translations"
    ADD CONSTRAINT "translations_restaurant_lang_type_entity_key" UNIQUE ("restaurant_id", "language_code", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "unique_auth_per_restaurant" UNIQUE ("restaurant_id", "auth_user_id");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "unique_code_per_restaurant" UNIQUE ("restaurant_id", "code");



ALTER TABLE ONLY "public"."combo_items"
    ADD CONSTRAINT "unique_combo_item" UNIQUE ("combo_id", "item_id");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "unique_email_per_restaurant" UNIQUE ("restaurant_id", "email");



ALTER TABLE ONLY "public"."eod_reports"
    ADD CONSTRAINT "unique_eod_per_day" UNIQUE ("restaurant_id", "report_date");



ALTER TABLE ONLY "public"."menu_item_pairings"
    ADD CONSTRAINT "unique_menu_item_pairing" UNIQUE ("restaurant_id", "item_id", "paired_item_id");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "unique_phone_per_restaurant" UNIQUE ("restaurant_id", "phone");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "unique_recipe_ingredient" UNIQUE ("menu_item_id", "ingredient_id");



ALTER TABLE ONLY "public"."session_seats"
    ADD CONSTRAINT "unique_seat_per_session" UNIQUE ("session_id", "seat_number");



ALTER TABLE ONLY "public"."erp_accounts"
    ADD CONSTRAINT "uq_restaurant_account_code" UNIQUE ("restaurant_id", "code");



ALTER TABLE ONLY "public"."erp_clients"
    ADD CONSTRAINT "uq_restaurant_client_name" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."erp_budgets"
    ADD CONSTRAINT "uq_restaurant_fy_dept_budget" UNIQUE ("restaurant_id", "fiscal_year_id", "department");



ALTER TABLE ONLY "public"."erp_invoices"
    ADD CONSTRAINT "uq_restaurant_invoice" UNIQUE ("restaurant_id", "invoice_number");



ALTER TABLE ONLY "public"."erp_modules"
    ADD CONSTRAINT "uq_restaurant_module" UNIQUE ("restaurant_id", "module_name");



ALTER TABLE ONLY "public"."erp_rooms"
    ADD CONSTRAINT "uq_restaurant_room" UNIQUE ("restaurant_id", "room_number");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voucher_attachments"
    ADD CONSTRAINT "voucher_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voucher_lines"
    ADD CONSTRAINT "voucher_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voucher_lines"
    ADD CONSTRAINT "voucher_lines_unique_line" UNIQUE ("voucher_id", "line_number");



ALTER TABLE ONLY "public"."voucher_sequences"
    ADD CONSTRAINT "voucher_sequences_pkey" PRIMARY KEY ("restaurant_id", "voucher_type_id");



ALTER TABLE ONLY "public"."voucher_types"
    ADD CONSTRAINT "voucher_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voucher_types"
    ADD CONSTRAINT "voucher_types_unique_prefix" UNIQUE ("restaurant_id", "prefix");



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_unique_financial_transaction" UNIQUE ("financial_transaction_id");



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_unique_number" UNIQUE ("restaurant_id", "voucher_number");



CREATE INDEX "audit_logs_restaurant_created" ON "public"."audit_logs" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "bookings_check_in_idx" ON "public"."bookings" USING "btree" ("check_in");



CREATE INDEX "bookings_restaurant_id_idx" ON "public"."bookings" USING "btree" ("restaurant_id");



CREATE INDEX "bookings_room_id_idx" ON "public"."bookings" USING "btree" ("room_id");



CREATE INDEX "bookings_status_idx" ON "public"."bookings" USING "btree" ("status");



CREATE INDEX "eod_reports_restaurant_date" ON "public"."eod_reports" USING "btree" ("restaurant_id", "report_date" DESC);



CREATE INDEX "idx_account_mappings_credit_account" ON "public"."account_mappings" USING "btree" ("credit_account_id");



CREATE INDEX "idx_account_mappings_debit_account" ON "public"."account_mappings" USING "btree" ("debit_account_id");



CREATE INDEX "idx_account_mappings_lookup" ON "public"."account_mappings" USING "btree" ("restaurant_id", "transaction_type", "branch_id", "payment_method_id") WHERE ("is_active" = true);



CREATE INDEX "idx_account_mappings_restaurant" ON "public"."account_mappings" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_accounting_periods_fiscal_year_id" ON "public"."accounting_periods" USING "btree" ("fiscal_year_id");



CREATE INDEX "idx_accounting_periods_restaurant_id" ON "public"."accounting_periods" USING "btree" ("restaurant_id");



CREATE INDEX "idx_approval_levels_restaurant_id" ON "public"."approval_levels" USING "btree" ("restaurant_id");



CREATE INDEX "idx_bank_accounts_active" ON "public"."bank_accounts" USING "btree" ("restaurant_id") WHERE ("is_active" = true);



CREATE INDEX "idx_bank_accounts_restaurant_id" ON "public"."bank_accounts" USING "btree" ("restaurant_id");



CREATE INDEX "idx_bank_reconciliations_bank_account_id" ON "public"."bank_reconciliations" USING "btree" ("bank_account_id");



CREATE INDEX "idx_bank_reconciliations_restaurant_created" ON "public"."bank_reconciliations" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_bank_transactions_bank_account_id" ON "public"."bank_transactions" USING "btree" ("bank_account_id");



CREATE INDEX "idx_bank_transactions_counterparty_account_id" ON "public"."bank_transactions" USING "btree" ("counterparty_account_id");



CREATE INDEX "idx_bank_transactions_restaurant_created" ON "public"."bank_transactions" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_bank_transactions_type" ON "public"."bank_transactions" USING "btree" ("restaurant_id", "type");



CREATE INDEX "idx_bill_split_items_seat_id" ON "public"."bill_split_items" USING "btree" ("seat_id");



CREATE INDEX "idx_bill_split_items_split" ON "public"."bill_split_items" USING "btree" ("bill_split_id");



CREATE INDEX "idx_bill_splits_session_id" ON "public"."bill_splits" USING "btree" ("session_id");



CREATE INDEX "idx_bookings_restaurant_payment_status" ON "public"."bookings" USING "btree" ("restaurant_id", "payment_status");



CREATE INDEX "idx_budget_categories_restaurant_id" ON "public"."budget_categories" USING "btree" ("restaurant_id");



CREATE INDEX "idx_budget_lines_budget_id" ON "public"."budget_lines" USING "btree" ("budget_id");



CREATE INDEX "idx_budget_lines_restaurant_id" ON "public"."budget_lines" USING "btree" ("restaurant_id");



CREATE INDEX "idx_budgets_restaurant_id" ON "public"."budgets" USING "btree" ("restaurant_id");



CREATE INDEX "idx_budgets_status" ON "public"."budgets" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_cash_counts_drawer_id" ON "public"."cash_counts" USING "btree" ("drawer_id");



CREATE INDEX "idx_cash_counts_restaurant_created" ON "public"."cash_counts" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_cash_drawers_active" ON "public"."cash_drawers" USING "btree" ("restaurant_id") WHERE ("is_active" = true);



CREATE INDEX "idx_cash_drawers_restaurant_id" ON "public"."cash_drawers" USING "btree" ("restaurant_id");



CREATE INDEX "idx_cash_transactions_counterparty_drawer_id" ON "public"."cash_transactions" USING "btree" ("counterparty_drawer_id");



CREATE INDEX "idx_cash_transactions_drawer_id" ON "public"."cash_transactions" USING "btree" ("drawer_id");



CREATE INDEX "idx_cash_transactions_restaurant_created" ON "public"."cash_transactions" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_cash_transactions_shift_id" ON "public"."cash_transactions" USING "btree" ("shift_id");



CREATE INDEX "idx_cash_transactions_type" ON "public"."cash_transactions" USING "btree" ("restaurant_id", "type");



CREATE INDEX "idx_chart_of_accounts_parent_id" ON "public"."chart_of_accounts" USING "btree" ("parent_id");



CREATE INDEX "idx_chart_of_accounts_restaurant_id" ON "public"."chart_of_accounts" USING "btree" ("restaurant_id");



CREATE INDEX "idx_chart_of_accounts_type" ON "public"."chart_of_accounts" USING "btree" ("restaurant_id", "account_type");



CREATE INDEX "idx_combo_items_item_id" ON "public"."combo_items" USING "btree" ("item_id");



CREATE INDEX "idx_customer_credit_accounts_loyalty_member_id" ON "public"."customer_credit_accounts" USING "btree" ("loyalty_member_id");



CREATE INDEX "idx_customer_credit_accounts_restaurant_id" ON "public"."customer_credit_accounts" USING "btree" ("restaurant_id");



CREATE INDEX "idx_day_book_entries_bank_deposit" ON "public"."day_book_entries" USING "btree" ("restaurant_id", "bank_name") WHERE ("category" = 'bank_deposit'::"text");



CREATE INDEX "idx_day_book_entries_restaurant_created" ON "public"."day_book_entries" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_day_book_entries_restaurant_id" ON "public"."day_book_entries" USING "btree" ("restaurant_id");



CREATE INDEX "idx_day_book_entries_session_id" ON "public"."day_book_entries" USING "btree" ("session_id");



CREATE INDEX "idx_day_book_sessions_open" ON "public"."day_book_sessions" USING "btree" ("restaurant_id", "date") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_day_book_sessions_restaurant_date" ON "public"."day_book_sessions" USING "btree" ("restaurant_id", "date" DESC);



CREATE INDEX "idx_eod_reports_closed_by" ON "public"."eod_reports" USING "btree" ("closed_by");



CREATE INDEX "idx_expense_attachments_expense_id" ON "public"."expense_attachments" USING "btree" ("expense_id");



CREATE INDEX "idx_expense_attachments_restaurant_id" ON "public"."expense_attachments" USING "btree" ("restaurant_id");



CREATE INDEX "idx_expense_categories_restaurant_id" ON "public"."expense_categories" USING "btree" ("restaurant_id");



CREATE INDEX "idx_expenses_category_id" ON "public"."expenses" USING "btree" ("category_id");



CREATE INDEX "idx_expenses_recurring" ON "public"."expenses" USING "btree" ("restaurant_id") WHERE ("is_recurring" = true);



CREATE INDEX "idx_expenses_restaurant_created" ON "public"."expenses" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_expenses_status" ON "public"."expenses" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_feedback_order_id" ON "public"."feedback" USING "btree" ("order_id");



CREATE INDEX "idx_feedback_restaurant_created" ON "public"."feedback" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_finance_payment_methods_restaurant_id" ON "public"."finance_payment_methods" USING "btree" ("restaurant_id");



CREATE INDEX "idx_finance_role_permissions_restaurant_id" ON "public"."finance_role_permissions" USING "btree" ("restaurant_id");



CREATE INDEX "idx_financial_events_business_date" ON "public"."financial_events" USING "btree" ("restaurant_id", "business_date" DESC);



CREATE INDEX "idx_financial_events_employee_id" ON "public"."financial_events" USING "btree" ("employee_id");



CREATE INDEX "idx_financial_events_payment_method_id" ON "public"."financial_events" USING "btree" ("payment_method_id");



CREATE INDEX "idx_financial_events_restaurant_created" ON "public"."financial_events" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_financial_events_status" ON "public"."financial_events" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_financial_events_supplier_id" ON "public"."financial_events" USING "btree" ("supplier_id");



CREATE INDEX "idx_financial_events_type" ON "public"."financial_events" USING "btree" ("restaurant_id", "event_type");



CREATE UNIQUE INDEX "idx_financial_events_unique_source" ON "public"."financial_events" USING "btree" ("restaurant_id", "source_module", "source_id", "event_type") WHERE ("source_id" IS NOT NULL);



CREATE INDEX "idx_financial_transactions_business_date" ON "public"."financial_transactions" USING "btree" ("restaurant_id", "business_date" DESC);



CREATE INDEX "idx_financial_transactions_employee_id" ON "public"."financial_transactions" USING "btree" ("employee_id");



CREATE INDEX "idx_financial_transactions_payment_method_id" ON "public"."financial_transactions" USING "btree" ("payment_method_id");



CREATE INDEX "idx_financial_transactions_restaurant_created" ON "public"."financial_transactions" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_financial_transactions_source_module" ON "public"."financial_transactions" USING "btree" ("restaurant_id", "source_module");



CREATE INDEX "idx_financial_transactions_status" ON "public"."financial_transactions" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_financial_transactions_supplier_id" ON "public"."financial_transactions" USING "btree" ("supplier_id");



CREATE INDEX "idx_financial_transactions_type" ON "public"."financial_transactions" USING "btree" ("restaurant_id", "transaction_type");



CREATE UNIQUE INDEX "idx_fiscal_years_one_current" ON "public"."fiscal_years" USING "btree" ("restaurant_id") WHERE ("is_current" = true);



CREATE INDEX "idx_fiscal_years_restaurant_id" ON "public"."fiscal_years" USING "btree" ("restaurant_id");



CREATE INDEX "idx_homepage_configs_restaurant_id" ON "public"."homepage_configs" USING "btree" ("restaurant_id");



CREATE INDEX "idx_income_categories_restaurant_id" ON "public"."income_categories" USING "btree" ("restaurant_id");



CREATE INDEX "idx_income_entries_category_id" ON "public"."income_entries" USING "btree" ("category_id");



CREATE INDEX "idx_income_entries_restaurant_created" ON "public"."income_entries" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_ingredient_movements" ON "public"."ingredient_movements" USING "btree" ("ingredient_id", "created_at" DESC);



CREATE INDEX "idx_ingredient_movements_performed_by" ON "public"."ingredient_movements" USING "btree" ("performed_by");



CREATE INDEX "idx_ingredients_restaurant" ON "public"."ingredients" USING "btree" ("restaurant_id");



CREATE INDEX "idx_loan_emi_schedule_loan_id" ON "public"."loan_emi_schedule" USING "btree" ("loan_id");



CREATE INDEX "idx_loan_emi_schedule_restaurant_id" ON "public"."loan_emi_schedule" USING "btree" ("restaurant_id");



CREATE INDEX "idx_loan_payments_loan_id" ON "public"."loan_payments" USING "btree" ("loan_id");



CREATE INDEX "idx_loan_payments_restaurant_created" ON "public"."loan_payments" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_loans_restaurant_id" ON "public"."loans" USING "btree" ("restaurant_id");



CREATE INDEX "idx_loans_status" ON "public"."loans" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_loyalty_members_auth_user_id" ON "public"."loyalty_members" USING "btree" ("auth_user_id");



CREATE INDEX "idx_loyalty_members_phone" ON "public"."loyalty_members" USING "btree" ("phone");



CREATE INDEX "idx_loyalty_members_restaurant" ON "public"."loyalty_members" USING "btree" ("restaurant_id");



CREATE INDEX "idx_loyalty_transactions_order_id" ON "public"."loyalty_transactions" USING "btree" ("order_id");



CREATE INDEX "idx_loyalty_tx_member" ON "public"."loyalty_transactions" USING "btree" ("member_id", "created_at" DESC);



CREATE INDEX "idx_mapped_transactions_account_mapping" ON "public"."mapped_transactions" USING "btree" ("account_mapping_id");



CREATE INDEX "idx_mapped_transactions_restaurant_created" ON "public"."mapped_transactions" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_mapped_transactions_status" ON "public"."mapped_transactions" USING "btree" ("restaurant_id", "mapping_status");



CREATE INDEX "idx_menu_categories_restaurant_id" ON "public"."menu_categories" USING "btree" ("restaurant_id");



CREATE INDEX "idx_menu_item_pairings_lookup" ON "public"."menu_item_pairings" USING "btree" ("restaurant_id", "item_id", "co_order_count" DESC);



CREATE INDEX "idx_menu_item_variations_menu_item" ON "public"."menu_item_variations" USING "btree" ("menu_item_id");



CREATE INDEX "idx_menu_items_available" ON "public"."menu_items" USING "btree" ("is_available") WHERE ("is_available" = true);



CREATE INDEX "idx_menu_items_category" ON "public"."menu_items" USING "btree" ("category_id");



CREATE INDEX "idx_menu_items_covering" ON "public"."menu_items" USING "btree" ("restaurant_id", "category_id") INCLUDE ("name", "price", "image_url", "is_available", "tags");



CREATE INDEX "idx_menu_items_fts" ON "public"."menu_items" USING "gin" ("to_tsvector"('"english"'::"regconfig", (("name" || ' '::"text") || COALESCE("description", ''::"text"))));



CREATE INDEX "idx_menu_items_restaurant" ON "public"."menu_items" USING "btree" ("restaurant_id");



CREATE INDEX "idx_menu_items_restaurant_available" ON "public"."menu_items" USING "btree" ("restaurant_id", "is_available");



CREATE INDEX "idx_modifier_groups_menu_item" ON "public"."menu_item_modifier_groups" USING "btree" ("menu_item_id");



CREATE INDEX "idx_modifiers_group" ON "public"."menu_item_modifiers" USING "btree" ("group_id");



CREATE INDEX "idx_order_item_modifiers_item" ON "public"."order_item_modifiers" USING "btree" ("order_item_id");



CREATE INDEX "idx_order_item_modifiers_modifier_id" ON "public"."order_item_modifiers" USING "btree" ("modifier_id");



CREATE INDEX "idx_order_items_chef_id" ON "public"."order_items" USING "btree" ("chef_id");



CREATE INDEX "idx_order_items_claimed_by" ON "public"."order_items" USING "btree" ("claimed_by");



CREATE INDEX "idx_order_items_menu_item_id" ON "public"."order_items" USING "btree" ("menu_item_id");



CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_items_order_status" ON "public"."order_items" USING "btree" ("order_id", "status");



CREATE INDEX "idx_order_promos_order" ON "public"."order_promos" USING "btree" ("order_id");



CREATE INDEX "idx_order_promos_promo_code_id" ON "public"."order_promos" USING "btree" ("promo_code_id");



CREATE INDEX "idx_orders_active" ON "public"."orders" USING "btree" ("restaurant_id", "placed_at" DESC) WHERE ("status" = ANY (ARRAY['pending'::"public"."order_status", 'confirmed'::"public"."order_status", 'preparing'::"public"."order_status"]));



CREATE INDEX "idx_orders_analytics" ON "public"."orders" USING "btree" ("restaurant_id", "date_trunc"('day'::"text", ("placed_at" AT TIME ZONE 'UTC'::"text")), "status") INCLUDE ("total_amount");



CREATE INDEX "idx_orders_claimed_by" ON "public"."orders" USING "btree" ("claimed_by") WHERE ("claimed_by" IS NOT NULL);



CREATE INDEX "idx_orders_legacy_takeout_id" ON "public"."orders" USING "btree" ("legacy_takeout_id");



CREATE INDEX "idx_orders_loyalty_member_id" ON "public"."orders" USING "btree" ("loyalty_member_id");



CREATE INDEX "idx_orders_needs_confirmation" ON "public"."orders" USING "btree" ("restaurant_id") WHERE ("needs_confirmation" = true);



CREATE INDEX "idx_orders_placed_at" ON "public"."orders" USING "btree" ("placed_at" DESC);



CREATE INDEX "idx_orders_promo_code_id" ON "public"."orders" USING "btree" ("promo_code_id");



CREATE INDEX "idx_orders_restaurant_payment" ON "public"."orders" USING "btree" ("restaurant_id", "payment_status");



CREATE INDEX "idx_orders_restaurant_status" ON "public"."orders" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_orders_seat_id" ON "public"."orders" USING "btree" ("seat_id");



CREATE INDEX "idx_orders_session" ON "public"."orders" USING "btree" ("session_id");



CREATE INDEX "idx_orders_stripe_pi" ON "public"."orders" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_orders_type_restaurant" ON "public"."orders" USING "btree" ("restaurant_id", "order_type");



CREATE INDEX "idx_payment_verifications_order_id" ON "public"."payment_verifications" USING "btree" ("order_id");



CREATE INDEX "idx_payment_verifications_pending" ON "public"."payment_verifications" USING "btree" ("restaurant_id", "staff_verified") WHERE (("staff_verified" = false) AND ("staff_rejected" = false));



CREATE INDEX "idx_payment_verifications_restaurant_created" ON "public"."payment_verifications" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_payment_verifications_staff" ON "public"."payment_verifications" USING "btree" ("staff_verified_by");



CREATE INDEX "idx_payment_verifications_takeout_order_id" ON "public"."payment_verifications" USING "btree" ("takeout_order_id");



CREATE INDEX "idx_phone_otp_active" ON "public"."phone_otp_tokens" USING "btree" ("phone", "purpose") WHERE ("used" = false);



CREATE INDEX "idx_phone_otp_tokens_restaurant_id" ON "public"."phone_otp_tokens" USING "btree" ("restaurant_id");



CREATE INDEX "idx_pricing_rules_category" ON "public"."pricing_rules" USING "btree" ("applies_to_category_id") WHERE ("applies_to_category_id" IS NOT NULL);



CREATE INDEX "idx_pricing_rules_item" ON "public"."pricing_rules" USING "btree" ("applies_to_item_id") WHERE ("applies_to_item_id" IS NOT NULL);



CREATE INDEX "idx_pricing_rules_restaurant" ON "public"."pricing_rules" USING "btree" ("restaurant_id", "is_active");



CREATE INDEX "idx_promo_codes_bogo_buy_item_id" ON "public"."promo_codes" USING "btree" ("bogo_buy_item_id");



CREATE INDEX "idx_promo_codes_bogo_get_item_id" ON "public"."promo_codes" USING "btree" ("bogo_get_item_id");



CREATE INDEX "idx_promo_codes_free_item_id" ON "public"."promo_codes" USING "btree" ("free_item_id");



CREATE INDEX "idx_promo_codes_lookup" ON "public"."promo_codes" USING "btree" ("restaurant_id", "code", "is_active");



CREATE INDEX "idx_promo_videos_restaurant" ON "public"."promo_videos" USING "btree" ("restaurant_id", "display_order");



CREATE INDEX "idx_receivable_transactions_account_id" ON "public"."receivable_transactions" USING "btree" ("customer_credit_account_id");



CREATE INDEX "idx_receivable_transactions_restaurant_created" ON "public"."receivable_transactions" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_recipes_ingredient" ON "public"."recipes" USING "btree" ("ingredient_id");



CREATE INDEX "idx_recipes_menu_item" ON "public"."recipes" USING "btree" ("menu_item_id");



CREATE UNIQUE INDEX "idx_restaurants_custom_domain" ON "public"."restaurants" USING "btree" ("custom_domain") WHERE ("custom_domain" IS NOT NULL);



CREATE INDEX "idx_restaurants_owner_id" ON "public"."restaurants" USING "btree" ("owner_id");



CREATE INDEX "idx_room_charges_booking_id" ON "public"."room_charges" USING "btree" ("booking_id");



CREATE INDEX "idx_room_charges_restaurant_id" ON "public"."room_charges" USING "btree" ("restaurant_id");



CREATE INDEX "idx_room_types_restaurant_active" ON "public"."room_types" USING "btree" ("restaurant_id") WHERE ("is_active" = true);



CREATE INDEX "idx_room_types_restaurant_id" ON "public"."room_types" USING "btree" ("restaurant_id");



CREATE INDEX "idx_rooms_available" ON "public"."rooms" USING "btree" ("restaurant_id", "type_id") WHERE (("status" = 'available'::"text") AND ("is_active" = true));



CREATE INDEX "idx_rooms_dirty" ON "public"."rooms" USING "btree" ("restaurant_id") WHERE ("status" = 'dirty'::"text");



CREATE INDEX "idx_rooms_type_id" ON "public"."rooms" USING "btree" ("type_id");



CREATE INDEX "idx_service_requests_acknowledged_by" ON "public"."service_requests" USING "btree" ("acknowledged_by");



CREATE INDEX "idx_service_requests_restaurant" ON "public"."service_requests" USING "btree" ("restaurant_id", "status", "created_at" DESC);



CREATE INDEX "idx_service_requests_session" ON "public"."service_requests" USING "btree" ("session_id");



CREATE INDEX "idx_service_requests_table_id" ON "public"."service_requests" USING "btree" ("table_id");



CREATE INDEX "idx_session_seats_session" ON "public"."session_seats" USING "btree" ("session_id");



CREATE UNIQUE INDEX "idx_sessions_one_active_per_table" ON "public"."sessions" USING "btree" ("table_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_sessions_opened_by" ON "public"."sessions" USING "btree" ("opened_by");



CREATE INDEX "idx_sessions_restaurant_id" ON "public"."sessions" USING "btree" ("restaurant_id");



CREATE INDEX "idx_sessions_restaurant_status_table" ON "public"."sessions" USING "btree" ("restaurant_id", "status", "table_id");



CREATE INDEX "idx_sessions_table_active" ON "public"."sessions" USING "btree" ("table_id", "status") WHERE ("status" = 'active'::"text");



CREATE UNIQUE INDEX "idx_sessions_token_active" ON "public"."sessions" USING "btree" ("session_token") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_staff_shifts_approved_by" ON "public"."staff_shifts" USING "btree" ("approved_by");



CREATE INDEX "idx_staff_shifts_restaurant" ON "public"."staff_shifts" USING "btree" ("restaurant_id", "clock_in" DESC);



CREATE INDEX "idx_staff_shifts_user" ON "public"."staff_shifts" USING "btree" ("user_id", "clock_in" DESC);



CREATE INDEX "idx_subscription_payments_recorded" ON "public"."subscription_payments" USING "btree" ("recorded_by");



CREATE INDEX "idx_subscription_payments_restaurant" ON "public"."subscription_payments" USING "btree" ("restaurant_id", "paid_at" DESC);



CREATE INDEX "idx_supplier_bills_restaurant_created" ON "public"."supplier_bills" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_supplier_bills_status" ON "public"."supplier_bills" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_supplier_bills_supplier_id" ON "public"."supplier_bills" USING "btree" ("supplier_id");



CREATE INDEX "idx_supplier_payments_bill_id" ON "public"."supplier_payments" USING "btree" ("bill_id");



CREATE INDEX "idx_supplier_payments_restaurant_created" ON "public"."supplier_payments" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_supplier_payments_supplier_id" ON "public"."supplier_payments" USING "btree" ("supplier_id");



CREATE INDEX "idx_suppliers_restaurant_id" ON "public"."suppliers" USING "btree" ("restaurant_id");



CREATE INDEX "idx_tables_qr_token" ON "public"."tables" USING "btree" ("qr_token");



CREATE INDEX "idx_tables_restaurant" ON "public"."tables" USING "btree" ("restaurant_id");



CREATE INDEX "idx_tables_restaurant_active" ON "public"."tables" USING "btree" ("restaurant_id", "is_active");



CREATE INDEX "idx_takeout_orders_loyalty_member_id" ON "public"."takeout_orders" USING "btree" ("loyalty_member_id");



CREATE INDEX "idx_takeout_orders_phone" ON "public"."takeout_orders" USING "btree" ("customer_phone");



CREATE INDEX "idx_takeout_orders_pickup" ON "public"."takeout_orders" USING "btree" ("restaurant_id", "pickup_time");



CREATE INDEX "idx_takeout_orders_promo_code_id" ON "public"."takeout_orders" USING "btree" ("promo_code_id");



CREATE INDEX "idx_takeout_orders_restaurant" ON "public"."takeout_orders" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_tax_configurations_restaurant_id" ON "public"."tax_configurations" USING "btree" ("restaurant_id");



CREATE INDEX "idx_tax_filings_configuration_id" ON "public"."tax_filings" USING "btree" ("tax_configuration_id");



CREATE INDEX "idx_tax_filings_restaurant_created" ON "public"."tax_filings" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_translations_lookup" ON "public"."translations" USING "btree" ("entity_type", "entity_id", "language_code");



CREATE INDEX "idx_translations_restaurant" ON "public"."translations" USING "btree" ("restaurant_id");



CREATE INDEX "idx_users_restaurant_role" ON "public"."users" USING "btree" ("restaurant_id", "role_id");



CREATE INDEX "idx_users_role_id" ON "public"."users" USING "btree" ("role_id");



CREATE INDEX "idx_voucher_attachments_restaurant_id" ON "public"."voucher_attachments" USING "btree" ("restaurant_id");



CREATE INDEX "idx_voucher_attachments_voucher_id" ON "public"."voucher_attachments" USING "btree" ("voucher_id");



CREATE INDEX "idx_voucher_lines_account_id" ON "public"."voucher_lines" USING "btree" ("account_id");



CREATE INDEX "idx_voucher_lines_mapped_transaction_id" ON "public"."voucher_lines" USING "btree" ("mapped_transaction_id");



CREATE INDEX "idx_voucher_lines_voucher_id" ON "public"."voucher_lines" USING "btree" ("voucher_id");



CREATE INDEX "idx_voucher_types_restaurant_id" ON "public"."voucher_types" USING "btree" ("restaurant_id");



CREATE INDEX "idx_vouchers_business_date" ON "public"."vouchers" USING "btree" ("restaurant_id", "business_date" DESC);



CREATE INDEX "idx_vouchers_created_by" ON "public"."vouchers" USING "btree" ("created_by");



CREATE INDEX "idx_vouchers_restaurant_created" ON "public"."vouchers" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_vouchers_status" ON "public"."vouchers" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_vouchers_voucher_type" ON "public"."vouchers" USING "btree" ("voucher_type_id");



CREATE UNIQUE INDEX "invitations_restaurant_email_pending_uidx" ON "public"."invitations" USING "btree" ("restaurant_id", "lower"("email")) WHERE ("status" = 'pending'::"text");



CREATE INDEX "invitations_restaurant_id_idx" ON "public"."invitations" USING "btree" ("restaurant_id");



CREATE INDEX "invitations_status_idx" ON "public"."invitations" USING "btree" ("status");



CREATE UNIQUE INDEX "invitations_token_hash_uidx" ON "public"."invitations" USING "btree" ("token_hash");



CREATE UNIQUE INDEX "orders_client_request_id_key" ON "public"."orders" USING "btree" ("client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "orders_invoice_number_idx" ON "public"."orders" USING "btree" ("invoice_number") WHERE ("invoice_number" IS NOT NULL);



CREATE INDEX "room_types_restaurant_id_idx" ON "public"."room_types" USING "btree" ("restaurant_id");



CREATE INDEX "rooms_restaurant_id_idx" ON "public"."rooms" USING "btree" ("restaurant_id");



CREATE UNIQUE INDEX "rooms_restaurant_number_uidx" ON "public"."rooms" USING "btree" ("restaurant_id", "lower"("room_number"));



CREATE UNIQUE INDEX "staff_shifts_one_open_per_user" ON "public"."staff_shifts" USING "btree" ("user_id") WHERE ("clock_out" IS NULL);



CREATE OR REPLACE TRIGGER "trg_account_mappings_updated_at" BEFORE UPDATE ON "public"."account_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_assign_invoice" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."assign_invoice_on_paid"();



CREATE OR REPLACE TRIGGER "trg_bank_accounts_updated_at" BEFORE UPDATE ON "public"."bank_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cash_drawers_updated_at" BEFORE UPDATE ON "public"."cash_drawers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_chart_of_accounts_updated_at" BEFORE UPDATE ON "public"."chart_of_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_day_book_sessions_updated_at" BEFORE UPDATE ON "public"."day_book_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_erp_update_balances" AFTER INSERT ON "public"."erp_journal_lines" FOR EACH ROW EXECUTE FUNCTION "public"."erp_update_account_balances"();



CREATE OR REPLACE TRIGGER "trg_finance_settings_updated_at" BEFORE UPDATE ON "public"."finance_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_financial_events_updated_at" BEFORE UPDATE ON "public"."financial_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_financial_transactions_updated_at" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_loans_updated_at" BEFORE UPDATE ON "public"."loans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_mapped_transactions_updated_at" BEFORE UPDATE ON "public"."mapped_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_menu_items_updated_at" BEFORE UPDATE ON "public"."menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prevent_invoices_update_delete" BEFORE DELETE OR UPDATE ON "public"."erp_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."erp_prevent_audit_modification"();



CREATE OR REPLACE TRIGGER "trg_prevent_journal_lines_update_delete" BEFORE DELETE OR UPDATE ON "public"."erp_journal_lines" FOR EACH ROW EXECUTE FUNCTION "public"."erp_prevent_audit_modification"();



CREATE OR REPLACE TRIGGER "trg_prevent_journal_update_delete" BEFORE DELETE OR UPDATE ON "public"."erp_journal_entries" FOR EACH ROW EXECUTE FUNCTION "public"."erp_prevent_audit_modification"();



CREATE OR REPLACE TRIGGER "trg_restaurants_updated_at" BEFORE UPDATE ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_room_types_updated_at" BEFORE UPDATE ON "public"."room_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_rooms_updated_at" BEFORE UPDATE ON "public"."rooms" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_suppliers_updated_at" BEFORE UPDATE ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_verify_session_restaurant" BEFORE INSERT OR UPDATE OF "table_id", "restaurant_id" ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."verify_session_restaurant_id"();



CREATE OR REPLACE TRIGGER "trg_vouchers_updated_at" BEFORE UPDATE ON "public"."vouchers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."finance_payment_methods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_periods"
    ADD CONSTRAINT "accounting_periods_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_periods"
    ADD CONSTRAINT "accounting_periods_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."approval_levels"
    ADD CONSTRAINT "approval_levels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."approval_levels"
    ADD CONSTRAINT "approval_levels_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_reconciliations"
    ADD CONSTRAINT "bank_reconciliations_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_reconciliations"
    ADD CONSTRAINT "bank_reconciliations_reconciled_by_fkey" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_reconciliations"
    ADD CONSTRAINT "bank_reconciliations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_counterparty_account_id_fkey" FOREIGN KEY ("counterparty_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bill_split_items"
    ADD CONSTRAINT "bill_split_items_bill_split_id_fkey" FOREIGN KEY ("bill_split_id") REFERENCES "public"."bill_splits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bill_split_items"
    ADD CONSTRAINT "bill_split_items_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "public"."session_seats"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bill_splits"
    ADD CONSTRAINT "bill_splits_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_linked_expense_category_id_fkey" FOREIGN KEY ("linked_expense_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_linked_income_category_id_fkey" FOREIGN KEY ("linked_income_category_id") REFERENCES "public"."income_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_lines"
    ADD CONSTRAINT "budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_lines"
    ADD CONSTRAINT "budget_lines_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."budget_lines"
    ADD CONSTRAINT "budget_lines_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_drawer_id_fkey" FOREIGN KEY ("drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawers"
    ADD CONSTRAINT "cash_drawers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_drawers"
    ADD CONSTRAINT "cash_drawers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_counterparty_drawer_id_fkey" FOREIGN KEY ("counterparty_drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_drawer_id_fkey" FOREIGN KEY ("drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."staff_shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."combo_items"
    ADD CONSTRAINT "combo_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."combo_items"
    ADD CONSTRAINT "combo_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_credit_accounts"
    ADD CONSTRAINT "customer_credit_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_credit_accounts"
    ADD CONSTRAINT "customer_credit_accounts_loyalty_member_id_fkey" FOREIGN KEY ("loyalty_member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_credit_accounts"
    ADD CONSTRAINT "customer_credit_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."day_book_entries"
    ADD CONSTRAINT "day_book_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."day_book_entries"
    ADD CONSTRAINT "day_book_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."day_book_entries"
    ADD CONSTRAINT "day_book_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."day_book_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."day_book_sessions"
    ADD CONSTRAINT "day_book_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."day_book_sessions"
    ADD CONSTRAINT "day_book_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."day_book_sessions"
    ADD CONSTRAINT "day_book_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eod_reports"
    ADD CONSTRAINT "eod_reports_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."eod_reports"
    ADD CONSTRAINT "eod_reports_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_accounts"
    ADD CONSTRAINT "erp_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_ap_bills"
    ADD CONSTRAINT "erp_ap_bills_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."erp_ap_bills"
    ADD CONSTRAINT "erp_ap_bills_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_ap_bills"
    ADD CONSTRAINT "erp_ap_bills_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."erp_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."erp_ar_invoices"
    ADD CONSTRAINT "erp_ar_invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."erp_clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."erp_ar_invoices"
    ADD CONSTRAINT "erp_ar_invoices_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_assets"
    ADD CONSTRAINT "erp_assets_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_bookings"
    ADD CONSTRAINT "erp_bookings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_bookings"
    ADD CONSTRAINT "erp_bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."erp_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_budgets"
    ADD CONSTRAINT "erp_budgets_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."erp_fiscal_years"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_budgets"
    ADD CONSTRAINT "erp_budgets_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_clients"
    ADD CONSTRAINT "erp_clients_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_crm_interactions"
    ADD CONSTRAINT "erp_crm_interactions_loyalty_member_id_fkey" FOREIGN KEY ("loyalty_member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_crm_interactions"
    ADD CONSTRAINT "erp_crm_interactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_crm_interactions"
    ADD CONSTRAINT "erp_crm_interactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_edit_history"
    ADD CONSTRAINT "erp_edit_history_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_edit_history"
    ADD CONSTRAINT "erp_edit_history_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."erp_fiscal_years"
    ADD CONSTRAINT "erp_fiscal_years_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_invoice_sequences"
    ADD CONSTRAINT "erp_invoice_sequences_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."erp_fiscal_years"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_invoice_sequences"
    ADD CONSTRAINT "erp_invoice_sequences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_invoices"
    ADD CONSTRAINT "erp_invoices_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."erp_fiscal_years"("id");



ALTER TABLE ONLY "public"."erp_invoices"
    ADD CONSTRAINT "erp_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_invoices"
    ADD CONSTRAINT "erp_invoices_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_journal_entries"
    ADD CONSTRAINT "erp_journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_journal_entries"
    ADD CONSTRAINT "erp_journal_entries_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."erp_fiscal_years"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_journal_entries"
    ADD CONSTRAINT "erp_journal_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_journal_lines"
    ADD CONSTRAINT "erp_journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."erp_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."erp_journal_lines"
    ADD CONSTRAINT "erp_journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."erp_journal_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_modules"
    ADD CONSTRAINT "erp_modules_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_payroll"
    ADD CONSTRAINT "erp_payroll_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_payroll"
    ADD CONSTRAINT "erp_payroll_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_purchase_order_items"
    ADD CONSTRAINT "erp_purchase_order_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."erp_purchase_order_items"
    ADD CONSTRAINT "erp_purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."erp_purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_purchase_orders"
    ADD CONSTRAINT "erp_purchase_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_purchase_orders"
    ADD CONSTRAINT "erp_purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."erp_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."erp_role_permissions"
    ADD CONSTRAINT "erp_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."erp_permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_role_permissions"
    ADD CONSTRAINT "erp_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_rooms"
    ADD CONSTRAINT "erp_rooms_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_suppliers"
    ADD CONSTRAINT "erp_suppliers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_attachments"
    ADD CONSTRAINT "expense_attachments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_attachments"
    ADD CONSTRAINT "expense_attachments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_attachments"
    ADD CONSTRAINT "expense_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_payment_methods"
    ADD CONSTRAINT "finance_payment_methods_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finance_payment_methods"
    ADD CONSTRAINT "finance_payment_methods_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_role_permissions"
    ADD CONSTRAINT "finance_role_permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finance_role_permissions"
    ADD CONSTRAINT "finance_role_permissions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_settings"
    ADD CONSTRAINT "finance_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_event_sequences"
    ADD CONSTRAINT "financial_event_sequences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."finance_payment_methods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_events"
    ADD CONSTRAINT "financial_events_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_transaction_sequences"
    ADD CONSTRAINT "financial_transaction_sequences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_financial_event_id_fkey" FOREIGN KEY ("financial_event_id") REFERENCES "public"."financial_events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."finance_payment_methods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fiscal_years"
    ADD CONSTRAINT "fiscal_years_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."homepage_configs"
    ADD CONSTRAINT "homepage_configs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."income_categories"
    ADD CONSTRAINT "income_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."income_categories"
    ADD CONSTRAINT "income_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."income_entries"
    ADD CONSTRAINT "income_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."income_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."income_entries"
    ADD CONSTRAINT "income_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."income_entries"
    ADD CONSTRAINT "income_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingredient_movements"
    ADD CONSTRAINT "ingredient_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingredient_movements"
    ADD CONSTRAINT "ingredient_movements_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loan_emi_schedule"
    ADD CONSTRAINT "loan_emi_schedule_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loan_emi_schedule"
    ADD CONSTRAINT "loan_emi_schedule_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_config"
    ADD CONSTRAINT "loyalty_config_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_transactions"
    ADD CONSTRAINT "loyalty_transactions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_transactions"
    ADD CONSTRAINT "loyalty_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_account_mapping_id_fkey" FOREIGN KEY ("account_mapping_id") REFERENCES "public"."account_mappings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_financial_transaction_id_fkey" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mapped_transactions"
    ADD CONSTRAINT "mapped_transactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_modifier_groups"
    ADD CONSTRAINT "menu_item_modifier_groups_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_modifiers"
    ADD CONSTRAINT "menu_item_modifiers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."menu_item_modifier_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_pairings"
    ADD CONSTRAINT "menu_item_pairings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_pairings"
    ADD CONSTRAINT "menu_item_pairings_paired_item_id_fkey" FOREIGN KEY ("paired_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_pairings"
    ADD CONSTRAINT "menu_item_pairings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_variations"
    ADD CONSTRAINT "menu_item_variations_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_modifier_id_fkey" FOREIGN KEY ("modifier_id") REFERENCES "public"."menu_item_modifiers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_chef_id_fkey" FOREIGN KEY ("chef_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_promos"
    ADD CONSTRAINT "order_promos_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_promos"
    ADD CONSTRAINT "order_promos_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_chef_id_fkey" FOREIGN KEY ("chef_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_delivery_staff_id_fkey" FOREIGN KEY ("delivery_staff_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_loyalty_member_id_fkey" FOREIGN KEY ("loyalty_member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "public"."session_seats"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_waiter_id_fkey" FOREIGN KEY ("waiter_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_verifications"
    ADD CONSTRAINT "payment_verifications_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_verifications"
    ADD CONSTRAINT "payment_verifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_verifications"
    ADD CONSTRAINT "payment_verifications_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_verifications"
    ADD CONSTRAINT "payment_verifications_staff_verified_by_fkey" FOREIGN KEY ("staff_verified_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payment_verifications"
    ADD CONSTRAINT "payment_verifications_takeout_order_id_fkey" FOREIGN KEY ("takeout_order_id") REFERENCES "public"."takeout_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."phone_otp_tokens"
    ADD CONSTRAINT "phone_otp_tokens_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."pricing_rules"
    ADD CONSTRAINT "pricing_rules_applies_to_category_id_fkey" FOREIGN KEY ("applies_to_category_id") REFERENCES "public"."menu_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pricing_rules"
    ADD CONSTRAINT "pricing_rules_applies_to_item_id_fkey" FOREIGN KEY ("applies_to_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pricing_rules"
    ADD CONSTRAINT "pricing_rules_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_bogo_buy_item_id_fkey" FOREIGN KEY ("bogo_buy_item_id") REFERENCES "public"."menu_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_bogo_get_item_id_fkey" FOREIGN KEY ("bogo_get_item_id") REFERENCES "public"."menu_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_free_item_id_fkey" FOREIGN KEY ("free_item_id") REFERENCES "public"."menu_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_videos"
    ADD CONSTRAINT "promo_videos_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receivable_transactions"
    ADD CONSTRAINT "receivable_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."receivable_transactions"
    ADD CONSTRAINT "receivable_transactions_customer_credit_account_id_fkey" FOREIGN KEY ("customer_credit_account_id") REFERENCES "public"."customer_credit_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receivable_transactions"
    ADD CONSTRAINT "receivable_transactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."room_charges"
    ADD CONSTRAINT "room_charges_charged_by_fkey" FOREIGN KEY ("charged_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_charges"
    ADD CONSTRAINT "room_charges_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_types"
    ADD CONSTRAINT "room_types_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."room_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_seats"
    ADD CONSTRAINT "session_seats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_payments"
    ADD CONSTRAINT "subscription_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subscription_payments"
    ADD CONSTRAINT "subscription_payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_bills"
    ADD CONSTRAINT "supplier_bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_bills"
    ADD CONSTRAINT "supplier_bills_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_bills"
    ADD CONSTRAINT "supplier_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."supplier_bills"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supported_languages"
    ADD CONSTRAINT "supported_languages_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_cleaning_claimed_by_fkey" FOREIGN KEY ("cleaning_claimed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."takeout_orders"
    ADD CONSTRAINT "takeout_orders_loyalty_member_id_fkey" FOREIGN KEY ("loyalty_member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."takeout_orders"
    ADD CONSTRAINT "takeout_orders_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."takeout_orders"
    ADD CONSTRAINT "takeout_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_configurations"
    ADD CONSTRAINT "tax_configurations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_configurations"
    ADD CONSTRAINT "tax_configurations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_filings"
    ADD CONSTRAINT "tax_filings_filed_by_fkey" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_filings"
    ADD CONSTRAINT "tax_filings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_filings"
    ADD CONSTRAINT "tax_filings_tax_configuration_id_fkey" FOREIGN KEY ("tax_configuration_id") REFERENCES "public"."tax_configurations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."translations"
    ADD CONSTRAINT "translations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."voucher_attachments"
    ADD CONSTRAINT "voucher_attachments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voucher_attachments"
    ADD CONSTRAINT "voucher_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."voucher_attachments"
    ADD CONSTRAINT "voucher_attachments_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voucher_lines"
    ADD CONSTRAINT "voucher_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."voucher_lines"
    ADD CONSTRAINT "voucher_lines_mapped_transaction_id_fkey" FOREIGN KEY ("mapped_transaction_id") REFERENCES "public"."mapped_transactions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."voucher_lines"
    ADD CONSTRAINT "voucher_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voucher_sequences"
    ADD CONSTRAINT "voucher_sequences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voucher_sequences"
    ADD CONSTRAINT "voucher_sequences_voucher_type_id_fkey" FOREIGN KEY ("voucher_type_id") REFERENCES "public"."voucher_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voucher_types"
    ADD CONSTRAINT "voucher_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."voucher_types"
    ADD CONSTRAINT "voucher_types_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_financial_transaction_id_fkey" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vouchers"
    ADD CONSTRAINT "vouchers_voucher_type_id_fkey" FOREIGN KEY ("voucher_type_id") REFERENCES "public"."voucher_types"("id") ON DELETE RESTRICT;



CREATE POLICY "Admin can manage invoice sequences" ON "public"."invoice_sequences" USING ((("restaurant_id" = "public"."current_restaurant_id"()) AND ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"]))));



CREATE POLICY "Allow authenticated users to manage variations" ON "public"."menu_item_variations" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow public read access to variations" ON "public"."menu_item_variations" FOR SELECT USING (true);



CREATE POLICY "Anyone can create payment verification" ON "public"."payment_verifications" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert feedback" ON "public"."feedback" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read subscription plans" ON "public"."subscription_plans" FOR SELECT USING (true);



CREATE POLICY "Owner can view own subscription_payments" ON "public"."subscription_payments" FOR SELECT USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Public read homepage_configs" ON "public"."homepage_configs" FOR SELECT USING (true);



CREATE POLICY "Public read promo_videos" ON "public"."promo_videos" FOR SELECT USING (true);



CREATE POLICY "Public read supported_languages" ON "public"."supported_languages" FOR SELECT USING (true);



CREATE POLICY "Public read translations" ON "public"."translations" FOR SELECT USING (true);



CREATE POLICY "Service role write supported_languages" ON "public"."supported_languages" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role write translations" ON "public"."translations" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Staff can delete own restaurant promo_videos" ON "public"."promo_videos" FOR DELETE USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Staff can insert own restaurant promo_videos" ON "public"."promo_videos" FOR INSERT WITH CHECK (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Staff can read their restaurant EOD reports" ON "public"."eod_reports" FOR SELECT TO "authenticated" USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Staff can update own restaurant promo_videos" ON "public"."promo_videos" FOR UPDATE USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Staff can update payment verifications" ON "public"."payment_verifications" FOR UPDATE USING ((("restaurant_id" = "public"."current_restaurant_id"()) AND ("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"]))));



CREATE POLICY "Staff can view payment verifications" ON "public"."payment_verifications" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "Staff can view their restaurant audit logs" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Staff read own restaurant feedback" ON "public"."feedback" FOR SELECT TO "authenticated" USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Super admin full access subscription_payments" ON "public"."subscription_payments" USING ((EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."roles" "r" ON (("r"."id" = "u"."role_id")))
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Super admin manages subscription plans" ON "public"."subscription_plans" USING (("public"."current_app_role"() = 'super_admin'::"text"));



CREATE POLICY "Users can insert homepage config for own restaurant" ON "public"."homepage_configs" FOR INSERT WITH CHECK (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can update own restaurant homepage config" ON "public"."homepage_configs" FOR UPDATE USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can view own restaurant homepage config" ON "public"."homepage_configs" FOR SELECT USING (("restaurant_id" IN ( SELECT "users"."restaurant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."account_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_manage_account_mappings" ON "public"."account_mappings" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_accounting_periods" ON "public"."accounting_periods" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_accounts" ON "public"."erp_accounts" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_ap_bills" ON "public"."erp_ap_bills" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_approval_levels" ON "public"."approval_levels" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_ar_invoices" ON "public"."erp_ar_invoices" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_assets" ON "public"."erp_assets" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_bank_accounts" ON "public"."bank_accounts" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_bank_reconciliations" ON "public"."bank_reconciliations" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_bank_transactions" ON "public"."bank_transactions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_budget_categories" ON "public"."budget_categories" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_budget_lines" ON "public"."budget_lines" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_budgets" ON "public"."budgets" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_budgets" ON "public"."erp_budgets" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_cash_counts" ON "public"."cash_counts" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_cash_drawers" ON "public"."cash_drawers" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_cash_transactions" ON "public"."cash_transactions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_chart_of_accounts" ON "public"."chart_of_accounts" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_clients" ON "public"."erp_clients" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_customer_credit_accounts" ON "public"."customer_credit_accounts" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_day_book_entries" ON "public"."day_book_entries" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_day_book_sessions" ON "public"."day_book_sessions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_departments" ON "public"."departments" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_edit_history" ON "public"."erp_edit_history" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_erp_modules" ON "public"."erp_modules" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_expense_attachments" ON "public"."expense_attachments" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_expense_categories" ON "public"."expense_categories" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_expenses" ON "public"."expenses" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_finance_payment_methods" ON "public"."finance_payment_methods" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_finance_role_permissions" ON "public"."finance_role_permissions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_finance_settings" ON "public"."finance_settings" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_financial_events" ON "public"."financial_events" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_financial_transactions" ON "public"."financial_transactions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_fiscal_years" ON "public"."erp_fiscal_years" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_fiscal_years" ON "public"."fiscal_years" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_income_categories" ON "public"."income_categories" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_income_entries" ON "public"."income_entries" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_invitations" ON "public"."invitations" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_invoice_sequences" ON "public"."erp_invoice_sequences" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_invoices" ON "public"."erp_invoices" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_journal_entries" ON "public"."erp_journal_entries" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_journal_lines" ON "public"."erp_journal_lines" USING ((EXISTS ( SELECT 1
   FROM "public"."erp_journal_entries" "je"
  WHERE (("je"."id" = "erp_journal_lines"."journal_entry_id") AND ("je"."restaurant_id" = "public"."current_restaurant_id"()) AND ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"]))))));



CREATE POLICY "admin_manage_loan_emi_schedule" ON "public"."loan_emi_schedule" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_loan_payments" ON "public"."loan_payments" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_loans" ON "public"."loans" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_mapped_transactions" ON "public"."mapped_transactions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_payroll" ON "public"."erp_payroll" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_receivable_transactions" ON "public"."receivable_transactions" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_room_types" ON "public"."room_types" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_supplier_bills" ON "public"."supplier_bills" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_supplier_payments" ON "public"."supplier_payments" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_suppliers" ON "public"."suppliers" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_tables" ON "public"."tables" USING ((("public"."current_app_role"() = ANY (ARRAY['super_admin'::"text", 'manager'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_tax_configurations" ON "public"."tax_configurations" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_tax_filings" ON "public"."tax_filings" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_users" ON "public"."users" USING ((("public"."current_app_role"() = ANY (ARRAY['super_admin'::"text", 'manager'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_voucher_attachments" ON "public"."voucher_attachments" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_voucher_lines" ON "public"."voucher_lines" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("voucher_id" IN ( SELECT "vouchers"."id"
   FROM "public"."vouchers"
  WHERE ("vouchers"."restaurant_id" = "public"."current_restaurant_id"()))))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("voucher_id" IN ( SELECT "vouchers"."id"
   FROM "public"."vouchers"
  WHERE ("vouchers"."restaurant_id" = "public"."current_restaurant_id"())))));



CREATE POLICY "admin_manage_voucher_types" ON "public"."voucher_types" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_manage_vouchers" ON "public"."vouchers" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "admin_write_combo_items" ON "public"."combo_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."roles" "r" ON (("u"."role_id" = "r"."id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."roles" "r" ON (("u"."role_id" = "r"."id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "anyone_can_read_restaurants" ON "public"."restaurants" FOR SELECT USING (("is_active" = true));



CREATE POLICY "anyone_read_permissions" ON "public"."erp_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "anyone_read_role_permissions" ON "public"."erp_role_permissions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."approval_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_reconciliations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bill_split_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bill_splits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budgets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_drawers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chart_of_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."combo_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crm_policy" ON "public"."erp_crm_interactions" USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "customer_create_service_request" ON "public"."service_requests" FOR INSERT WITH CHECK (("public"."current_app_role"() = 'customer'::"text"));



ALTER TABLE "public"."customer_credit_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_insert_order" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_app_role"() = 'customer'::"text") AND ("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE (("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")) AND ("sessions"."status" = 'active'::"text") AND ("sessions"."expires_at" > "now"()))))));



CREATE POLICY "customer_insert_order_item_modifiers" ON "public"."order_item_modifiers" FOR INSERT TO "authenticated" WITH CHECK (("order_item_id" IN ( SELECT "oi"."id"
   FROM (("public"."order_items" "oi"
     JOIN "public"."orders" "o" ON (("o"."id" = "oi"."order_id")))
     JOIN "public"."sessions" "s" ON (("s"."id" = "o"."session_id")))
  WHERE (("s"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")) AND ("s"."status" = 'active'::"text") AND ("s"."expires_at" > "now"())))));



CREATE POLICY "customer_insert_order_items" ON "public"."order_items" FOR INSERT TO "authenticated" WITH CHECK (("order_id" IN ( SELECT "o"."id"
   FROM ("public"."orders" "o"
     JOIN "public"."sessions" "s" ON (("s"."id" = "o"."session_id")))
  WHERE (("s"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")) AND ("s"."status" = 'active'::"text") AND ("s"."expires_at" > "now"())))));



CREATE POLICY "customer_read_own_order_item_modifiers" ON "public"."order_item_modifiers" FOR SELECT TO "authenticated" USING (("order_item_id" IN ( SELECT "oi"."id"
   FROM (("public"."order_items" "oi"
     JOIN "public"."orders" "o" ON (("o"."id" = "oi"."order_id")))
     JOIN "public"."sessions" "s" ON (("s"."id" = "o"."session_id")))
  WHERE ("s"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")))));



CREATE POLICY "customer_read_own_order_items" ON "public"."order_items" FOR SELECT USING (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."session_id" IN ( SELECT "sessions"."id"
           FROM "public"."sessions"
          WHERE ("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")))))));



CREATE POLICY "customer_read_own_orders" ON "public"."orders" FOR SELECT USING ((("public"."current_app_role"() = 'customer'::"text") AND ("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE ("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text"))))));



CREATE POLICY "customer_read_own_requests" ON "public"."service_requests" FOR SELECT TO "authenticated" USING (((("session_id" IS NOT NULL) AND ("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE ("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text"))))) OR (("request_type" = 'open_session'::"text") AND ("table_id" IN ( SELECT "t"."id"
   FROM "public"."tables" "t"
  WHERE ("t"."qr_token" = ("auth"."jwt"() ->> 'qr_token'::"text")))))));



CREATE POLICY "customer_read_own_takeout" ON "public"."takeout_orders" FOR SELECT USING (("loyalty_member_id" IN ( SELECT "loyalty_members"."id"
   FROM "public"."loyalty_members"
  WHERE ("loyalty_members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "customer_read_session_seats" ON "public"."session_seats" FOR SELECT USING (("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE ("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")))));



CREATE POLICY "customer_validate_promo" ON "public"."promo_codes" FOR SELECT USING ((("is_active" = true) AND (("valid_until" IS NULL) OR ("valid_until" > "now"()))));



ALTER TABLE "public"."day_book_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."day_book_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eod_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_ap_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_ar_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_budgets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_crm_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_edit_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_fiscal_years" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_invoice_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_journal_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_journal_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_modules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_payroll" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finance_payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finance_role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finance_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_event_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_transaction_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_years" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."homepage_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."income_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."income_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingredient_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingredients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_sequences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kitchen_read_orders" ON "public"."orders" FOR SELECT USING ((("public"."current_app_role"() = ANY (ARRAY['kitchen'::"text", 'manager'::"text", 'super_admin'::"text", 'waiter'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



ALTER TABLE "public"."loan_emi_schedule" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manager_manage_eod" ON "public"."eod_reports" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_manage_ingredients" ON "public"."ingredients" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_manage_loyalty" ON "public"."loyalty_members" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_manage_promos" ON "public"."promo_codes" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_manage_recipes" ON "public"."recipes" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("menu_item_id" IN ( SELECT "menu_items"."id"
   FROM "public"."menu_items"
  WHERE ("menu_items"."restaurant_id" = "public"."current_restaurant_id"())))));



CREATE POLICY "manager_manage_shifts" ON "public"."staff_shifts" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_write_languages" ON "public"."supported_languages" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_write_loyalty_config" ON "public"."loyalty_config" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_write_menu_categories" ON "public"."menu_categories" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_write_menu_items" ON "public"."menu_items" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_write_modifier_groups" ON "public"."menu_item_modifier_groups" USING (("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])));



CREATE POLICY "manager_write_modifiers" ON "public"."menu_item_modifiers" USING (("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])));



CREATE POLICY "manager_write_pricing_rules" ON "public"."pricing_rules" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "manager_write_translations" ON "public"."translations" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



ALTER TABLE "public"."mapped_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_read_own_tx" ON "public"."loyalty_transactions" FOR SELECT USING (("member_id" IN ( SELECT "loyalty_members"."id"
   FROM "public"."loyalty_members"
  WHERE ("loyalty_members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "member_read_self" ON "public"."loyalty_members" FOR SELECT USING (("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."menu_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_item_modifier_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_item_modifiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_item_pairings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_item_variations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_item_modifiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_promos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phone_otp_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pricing_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_videos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_active_session_orders" ON "public"."orders" FOR SELECT USING (("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE ("sessions"."status" = 'active'::"text"))));



CREATE POLICY "public_read_active_session_requests" ON "public"."service_requests" FOR SELECT USING (("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE ("sessions"."status" = 'active'::"text"))));



CREATE POLICY "public_read_active_sessions" ON "public"."sessions" FOR SELECT USING (("status" = 'active'::"text"));



CREATE POLICY "public_read_combo_items" ON "public"."combo_items" FOR SELECT USING (true);



CREATE POLICY "public_read_languages" ON "public"."supported_languages" FOR SELECT USING (("is_active" = true));



CREATE POLICY "public_read_loyalty_config" ON "public"."loyalty_config" FOR SELECT USING (("is_active" = true));



CREATE POLICY "public_read_menu_categories" ON "public"."menu_categories" FOR SELECT USING (("is_visible" = true));



CREATE POLICY "public_read_menu_item_pairings" ON "public"."menu_item_pairings" FOR SELECT USING (true);



CREATE POLICY "public_read_menu_items" ON "public"."menu_items" FOR SELECT USING (("is_available" = true));



CREATE POLICY "public_read_modifier_groups" ON "public"."menu_item_modifier_groups" FOR SELECT USING (true);



CREATE POLICY "public_read_modifiers" ON "public"."menu_item_modifiers" FOR SELECT USING (("is_available" = true));



CREATE POLICY "public_read_pricing_rules" ON "public"."pricing_rules" FOR SELECT USING (("is_active" = true));



CREATE POLICY "public_read_settings" ON "public"."settings" FOR SELECT USING (true);



CREATE POLICY "public_read_translations" ON "public"."translations" FOR SELECT USING (true);



CREATE POLICY "read_bill_split_items" ON "public"."bill_split_items" FOR SELECT USING ((("bill_split_id" IN ( SELECT "bill_splits"."id"
   FROM "public"."bill_splits"
  WHERE ("bill_splits"."session_id" IN ( SELECT "sessions"."id"
           FROM "public"."sessions"
          WHERE ("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")))))) OR ("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"]))));



ALTER TABLE "public"."receivable_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_read_all" ON "public"."roles" FOR SELECT USING (true);



CREATE POLICY "roles_super_admin_write" ON "public"."roles" USING (("public"."current_app_role"() = 'super_admin'::"text"));



ALTER TABLE "public"."room_charges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "session_read_bill_splits" ON "public"."bill_splits" FOR SELECT USING ((("session_id" IN ( SELECT "sessions"."id"
   FROM "public"."sessions"
  WHERE ("sessions"."session_token" = ("auth"."jwt"() ->> 'session_token'::"text")))) OR ("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"]))));



ALTER TABLE "public"."session_seats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_manage_bill_splits" ON "public"."bill_splits" USING (("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"])));



CREATE POLICY "staff_manage_bookings" ON "public"."bookings" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text", 'waiter'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text", 'waiter'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_bookings" ON "public"."erp_bookings" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'waiter'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_movements" ON "public"."ingredient_movements" USING ((("ingredient_id" IN ( SELECT "ingredients"."id"
   FROM "public"."ingredients"
  WHERE ("ingredients"."restaurant_id" = "public"."current_restaurant_id"()))) AND ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'kitchen'::"text"]))));



CREATE POLICY "staff_manage_purchase_order_items" ON "public"."erp_purchase_order_items" USING ((EXISTS ( SELECT 1
   FROM "public"."erp_purchase_orders" "po"
  WHERE (("po"."id" = "erp_purchase_order_items"."purchase_order_id") AND ("po"."restaurant_id" = "public"."current_restaurant_id"()) AND ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"]))))));



CREATE POLICY "staff_manage_purchase_orders" ON "public"."erp_purchase_orders" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_room_charges" ON "public"."room_charges" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text", 'waiter'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text", 'waiter'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_rooms" ON "public"."erp_rooms" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'waiter'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_rooms" ON "public"."rooms" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text", 'waiter'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"()))) WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text", 'cashier'::"text", 'waiter'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_service_requests" ON "public"."service_requests" USING ((("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_session_seats" ON "public"."session_seats" USING (("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"])));



CREATE POLICY "staff_manage_split_items" ON "public"."bill_split_items" USING (("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"])));



CREATE POLICY "staff_manage_suppliers" ON "public"."erp_suppliers" USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_manage_takeout" ON "public"."takeout_orders" USING ((("public"."current_app_role"() = ANY (ARRAY['kitchen'::"text", 'waiter'::"text", 'manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_read_account_mappings" ON "public"."account_mappings" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_accounting_periods" ON "public"."accounting_periods" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_accounts" ON "public"."erp_accounts" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_ap_bills" ON "public"."erp_ap_bills" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_approval_levels" ON "public"."approval_levels" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_ar_invoices" ON "public"."erp_ar_invoices" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_assets" ON "public"."erp_assets" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_bank_accounts" ON "public"."bank_accounts" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_bank_reconciliations" ON "public"."bank_reconciliations" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_bank_transactions" ON "public"."bank_transactions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_bookings" ON "public"."bookings" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_bookings" ON "public"."erp_bookings" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_budget_categories" ON "public"."budget_categories" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_budget_lines" ON "public"."budget_lines" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_budgets" ON "public"."budgets" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_budgets" ON "public"."erp_budgets" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_cash_counts" ON "public"."cash_counts" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_cash_drawers" ON "public"."cash_drawers" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_cash_transactions" ON "public"."cash_transactions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_chart_of_accounts" ON "public"."chart_of_accounts" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_clients" ON "public"."erp_clients" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_customer_credit_accounts" ON "public"."customer_credit_accounts" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_day_book_entries" ON "public"."day_book_entries" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_day_book_sessions" ON "public"."day_book_sessions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_departments" ON "public"."departments" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_edit_history" ON "public"."erp_edit_history" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_erp_modules" ON "public"."erp_modules" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_expense_attachments" ON "public"."expense_attachments" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_expense_categories" ON "public"."expense_categories" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_expenses" ON "public"."expenses" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_finance_payment_methods" ON "public"."finance_payment_methods" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_finance_role_permissions" ON "public"."finance_role_permissions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_finance_settings" ON "public"."finance_settings" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_financial_event_sequences" ON "public"."financial_event_sequences" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_financial_events" ON "public"."financial_events" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_financial_transaction_sequences" ON "public"."financial_transaction_sequences" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_financial_transactions" ON "public"."financial_transactions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_fiscal_years" ON "public"."erp_fiscal_years" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_fiscal_years" ON "public"."fiscal_years" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_income_categories" ON "public"."income_categories" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_income_entries" ON "public"."income_entries" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_invitations" ON "public"."invitations" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_invoice_sequences" ON "public"."erp_invoice_sequences" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_invoices" ON "public"."erp_invoices" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_journal_entries" ON "public"."erp_journal_entries" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_journal_lines" ON "public"."erp_journal_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."erp_journal_entries" "je"
  WHERE (("je"."id" = "erp_journal_lines"."journal_entry_id") AND ("je"."restaurant_id" = "public"."current_restaurant_id"())))));



CREATE POLICY "staff_read_loan_emi_schedule" ON "public"."loan_emi_schedule" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_loan_payments" ON "public"."loan_payments" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_loans" ON "public"."loans" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_loyalty_tx" ON "public"."loyalty_transactions" FOR SELECT USING ((("member_id" IN ( SELECT "loyalty_members"."id"
   FROM "public"."loyalty_members"
  WHERE ("loyalty_members"."restaurant_id" = "public"."current_restaurant_id"()))) AND ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"]))));



CREATE POLICY "staff_read_mapped_transactions" ON "public"."mapped_transactions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_order_item_modifiers" ON "public"."order_item_modifiers" FOR SELECT USING (("order_item_id" IN ( SELECT "order_items"."id"
   FROM "public"."order_items"
  WHERE ("order_items"."order_id" IN ( SELECT "orders"."id"
           FROM "public"."orders"
          WHERE ("orders"."restaurant_id" = "public"."current_restaurant_id"()))))));



CREATE POLICY "staff_read_order_items" ON "public"."order_items" FOR SELECT USING (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."restaurant_id" = "public"."current_restaurant_id"()))));



CREATE POLICY "staff_read_order_promos" ON "public"."order_promos" FOR SELECT USING (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."restaurant_id" = "public"."current_restaurant_id"()))));



CREATE POLICY "staff_read_own_payroll" ON "public"."erp_payroll" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_read_own_shifts" ON "public"."staff_shifts" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "staff_read_purchase_order_items" ON "public"."erp_purchase_order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."erp_purchase_orders" "po"
  WHERE (("po"."id" = "erp_purchase_order_items"."purchase_order_id") AND ("po"."restaurant_id" = "public"."current_restaurant_id"())))));



CREATE POLICY "staff_read_purchase_orders" ON "public"."erp_purchase_orders" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_receivable_transactions" ON "public"."receivable_transactions" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_room_charges" ON "public"."room_charges" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_room_types" ON "public"."room_types" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_rooms" ON "public"."erp_rooms" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_rooms" ON "public"."rooms" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_sessions" ON "public"."sessions" FOR SELECT USING ((("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text", 'kitchen'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_read_supplier_bills" ON "public"."supplier_bills" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_supplier_payments" ON "public"."supplier_payments" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_suppliers" ON "public"."erp_suppliers" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_suppliers" ON "public"."suppliers" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_tables" ON "public"."tables" FOR SELECT USING ((("public"."current_app_role"() = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'waiter'::"text", 'cashier'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_read_tax_configurations" ON "public"."tax_configurations" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_tax_filings" ON "public"."tax_filings" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_users" ON "public"."users" FOR SELECT USING ((("public"."current_app_role"() = ANY (ARRAY['super_admin'::"text", 'manager'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "staff_read_voucher_attachments" ON "public"."voucher_attachments" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_voucher_lines" ON "public"."voucher_lines" FOR SELECT USING (("voucher_id" IN ( SELECT "vouchers"."id"
   FROM "public"."vouchers"
  WHERE ("vouchers"."restaurant_id" = "public"."current_restaurant_id"()))));



CREATE POLICY "staff_read_voucher_sequences" ON "public"."voucher_sequences" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_voucher_types" ON "public"."voucher_types" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



CREATE POLICY "staff_read_vouchers" ON "public"."vouchers" FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));



ALTER TABLE "public"."staff_shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_update_order_status" ON "public"."orders" FOR UPDATE USING ((("public"."current_app_role"() = ANY (ARRAY['kitchen'::"text", 'manager'::"text", 'waiter'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



ALTER TABLE "public"."subscription_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "super_admin_manage_restaurants" ON "public"."restaurants" USING (("public"."current_app_role"() = 'super_admin'::"text"));



CREATE POLICY "super_admin_settings" ON "public"."settings" USING ((("public"."current_app_role"() = 'super_admin'::"text") OR (("public"."current_app_role"() = 'manager'::"text") AND ("restaurant_id" = "public"."current_restaurant_id"()))));



ALTER TABLE "public"."supplier_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supported_languages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."takeout_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_configurations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_filings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."translations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_read_self" ON "public"."users" FOR SELECT USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voucher_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voucher_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voucher_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voucher_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vouchers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waiter_insert_session" ON "public"."sessions" FOR INSERT WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));



CREATE POLICY "waiter_update_session" ON "public"."sessions" FOR UPDATE USING ((("public"."current_app_role"() = ANY (ARRAY['waiter'::"text", 'manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."menu_item_variations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."payment_verifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."service_requests";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tables";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."takeout_orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."users";



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";




























































































































































GRANT ALL ON FUNCTION "public"."apply_pricing_rules_to_order"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_suspend_expired_subscriptions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_suspend_expired_subscriptions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."deduct_ingredients_for_order"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."eod_reports" TO "anon";
GRANT ALL ON TABLE "public"."eod_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."eod_reports" TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_menu_item_pairings"("p_restaurant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_menu_item_pairings"("p_restaurant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_combo_items"("p_combo_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_combo_items"("p_combo_id" "uuid", "p_items" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."replace_combo_items"("p_combo_id" "uuid", "p_items" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."staff_clock_in"("p_user_id" "uuid", "p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."staff_clock_out"("p_user_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."account_mappings" TO "anon";
GRANT ALL ON TABLE "public"."account_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."account_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_periods" TO "anon";
GRANT ALL ON TABLE "public"."accounting_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_periods" TO "service_role";



GRANT ALL ON TABLE "public"."approval_levels" TO "anon";
GRANT ALL ON TABLE "public"."approval_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."approval_levels" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."bank_reconciliations" TO "anon";
GRANT ALL ON TABLE "public"."bank_reconciliations" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_reconciliations" TO "service_role";



GRANT ALL ON TABLE "public"."bank_transactions" TO "anon";
GRANT ALL ON TABLE "public"."bank_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."bill_split_items" TO "anon";
GRANT ALL ON TABLE "public"."bill_split_items" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_split_items" TO "service_role";



GRANT ALL ON TABLE "public"."bill_splits" TO "anon";
GRANT ALL ON TABLE "public"."bill_splits" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_splits" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."budget_categories" TO "anon";
GRANT ALL ON TABLE "public"."budget_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_categories" TO "service_role";



GRANT ALL ON TABLE "public"."budget_lines" TO "anon";
GRANT ALL ON TABLE "public"."budget_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_lines" TO "service_role";



GRANT ALL ON TABLE "public"."budgets" TO "anon";
GRANT ALL ON TABLE "public"."budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."budgets" TO "service_role";



GRANT ALL ON TABLE "public"."cash_counts" TO "anon";
GRANT ALL ON TABLE "public"."cash_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_counts" TO "service_role";



GRANT ALL ON TABLE "public"."cash_drawers" TO "anon";
GRANT ALL ON TABLE "public"."cash_drawers" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_drawers" TO "service_role";



GRANT ALL ON TABLE "public"."cash_transactions" TO "anon";
GRANT ALL ON TABLE "public"."cash_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."chart_of_accounts" TO "anon";
GRANT ALL ON TABLE "public"."chart_of_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."chart_of_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."combo_items" TO "anon";
GRANT ALL ON TABLE "public"."combo_items" TO "authenticated";
GRANT ALL ON TABLE "public"."combo_items" TO "service_role";



GRANT ALL ON TABLE "public"."customer_credit_accounts" TO "anon";
GRANT ALL ON TABLE "public"."customer_credit_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_credit_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."day_book_entries" TO "anon";
GRANT ALL ON TABLE "public"."day_book_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."day_book_entries" TO "service_role";



GRANT ALL ON TABLE "public"."day_book_sessions" TO "anon";
GRANT ALL ON TABLE "public"."day_book_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."day_book_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."erp_accounts" TO "anon";
GRANT ALL ON TABLE "public"."erp_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."erp_ap_bills" TO "anon";
GRANT ALL ON TABLE "public"."erp_ap_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_ap_bills" TO "service_role";



GRANT ALL ON TABLE "public"."erp_ar_invoices" TO "anon";
GRANT ALL ON TABLE "public"."erp_ar_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_ar_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."erp_assets" TO "anon";
GRANT ALL ON TABLE "public"."erp_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_assets" TO "service_role";



GRANT ALL ON TABLE "public"."erp_bookings" TO "anon";
GRANT ALL ON TABLE "public"."erp_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."erp_budgets" TO "anon";
GRANT ALL ON TABLE "public"."erp_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_budgets" TO "service_role";



GRANT ALL ON TABLE "public"."erp_clients" TO "anon";
GRANT ALL ON TABLE "public"."erp_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_clients" TO "service_role";



GRANT ALL ON TABLE "public"."erp_crm_interactions" TO "anon";
GRANT ALL ON TABLE "public"."erp_crm_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_crm_interactions" TO "service_role";



GRANT ALL ON TABLE "public"."erp_edit_history" TO "anon";
GRANT ALL ON TABLE "public"."erp_edit_history" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_edit_history" TO "service_role";



GRANT ALL ON TABLE "public"."erp_fiscal_years" TO "anon";
GRANT ALL ON TABLE "public"."erp_fiscal_years" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_fiscal_years" TO "service_role";



GRANT ALL ON TABLE "public"."erp_invoice_sequences" TO "anon";
GRANT ALL ON TABLE "public"."erp_invoice_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_invoice_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."erp_invoices" TO "anon";
GRANT ALL ON TABLE "public"."erp_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."erp_journal_entries" TO "anon";
GRANT ALL ON TABLE "public"."erp_journal_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_journal_entries" TO "service_role";



GRANT ALL ON TABLE "public"."erp_journal_lines" TO "anon";
GRANT ALL ON TABLE "public"."erp_journal_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_journal_lines" TO "service_role";



GRANT ALL ON TABLE "public"."erp_modules" TO "anon";
GRANT ALL ON TABLE "public"."erp_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_modules" TO "service_role";



GRANT ALL ON TABLE "public"."erp_payroll" TO "anon";
GRANT ALL ON TABLE "public"."erp_payroll" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_payroll" TO "service_role";



GRANT ALL ON TABLE "public"."erp_permissions" TO "anon";
GRANT ALL ON TABLE "public"."erp_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."erp_purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."erp_purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_purchase_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."erp_purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."erp_purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_purchase_orders" TO "service_role";



GRANT ALL ON TABLE "public"."erp_role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."erp_role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."erp_rooms" TO "anon";
GRANT ALL ON TABLE "public"."erp_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."erp_suppliers" TO "anon";
GRANT ALL ON TABLE "public"."erp_suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."expense_attachments" TO "anon";
GRANT ALL ON TABLE "public"."expense_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."expense_categories" TO "anon";
GRANT ALL ON TABLE "public"."expense_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_categories" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."finance_payment_methods" TO "anon";
GRANT ALL ON TABLE "public"."finance_payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."finance_payment_methods" TO "service_role";



GRANT ALL ON TABLE "public"."finance_role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."finance_role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."finance_role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."finance_settings" TO "anon";
GRANT ALL ON TABLE "public"."finance_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."finance_settings" TO "service_role";



GRANT ALL ON TABLE "public"."financial_event_sequences" TO "anon";
GRANT ALL ON TABLE "public"."financial_event_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_event_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."financial_events" TO "anon";
GRANT ALL ON TABLE "public"."financial_events" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_events" TO "service_role";



GRANT ALL ON TABLE "public"."financial_transaction_sequences" TO "anon";
GRANT ALL ON TABLE "public"."financial_transaction_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_transaction_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."financial_transactions" TO "anon";
GRANT ALL ON TABLE "public"."financial_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_years" TO "anon";
GRANT ALL ON TABLE "public"."fiscal_years" TO "authenticated";
GRANT ALL ON TABLE "public"."fiscal_years" TO "service_role";



GRANT ALL ON TABLE "public"."homepage_configs" TO "anon";
GRANT ALL ON TABLE "public"."homepage_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."homepage_configs" TO "service_role";



GRANT ALL ON TABLE "public"."income_categories" TO "anon";
GRANT ALL ON TABLE "public"."income_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."income_categories" TO "service_role";



GRANT ALL ON TABLE "public"."income_entries" TO "anon";
GRANT ALL ON TABLE "public"."income_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."income_entries" TO "service_role";



GRANT ALL ON TABLE "public"."ingredient_movements" TO "anon";
GRANT ALL ON TABLE "public"."ingredient_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."ingredient_movements" TO "service_role";



GRANT ALL ON TABLE "public"."ingredients" TO "anon";
GRANT ALL ON TABLE "public"."ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."ingredients" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_sequences" TO "anon";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."loan_emi_schedule" TO "anon";
GRANT ALL ON TABLE "public"."loan_emi_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."loan_emi_schedule" TO "service_role";



GRANT ALL ON TABLE "public"."loan_payments" TO "anon";
GRANT ALL ON TABLE "public"."loan_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."loan_payments" TO "service_role";



GRANT ALL ON TABLE "public"."loans" TO "anon";
GRANT ALL ON TABLE "public"."loans" TO "authenticated";
GRANT ALL ON TABLE "public"."loans" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_config" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_config" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_config" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_members" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_members" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_members" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_transactions" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."mapped_transactions" TO "anon";
GRANT ALL ON TABLE "public"."mapped_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."mapped_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."menu_categories" TO "anon";
GRANT ALL ON TABLE "public"."menu_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_categories" TO "service_role";



GRANT ALL ON TABLE "public"."menu_item_modifier_groups" TO "anon";
GRANT ALL ON TABLE "public"."menu_item_modifier_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_item_modifier_groups" TO "service_role";



GRANT ALL ON TABLE "public"."menu_item_modifiers" TO "anon";
GRANT ALL ON TABLE "public"."menu_item_modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_item_modifiers" TO "service_role";



GRANT ALL ON TABLE "public"."menu_item_pairings" TO "anon";
GRANT ALL ON TABLE "public"."menu_item_pairings" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_item_pairings" TO "service_role";



GRANT ALL ON TABLE "public"."menu_item_variations" TO "anon";
GRANT ALL ON TABLE "public"."menu_item_variations" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_item_variations" TO "service_role";



GRANT ALL ON TABLE "public"."menu_items" TO "anon";
GRANT ALL ON TABLE "public"."menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_item_modifiers" TO "anon";
GRANT ALL ON TABLE "public"."order_item_modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."order_item_modifiers" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_promos" TO "anon";
GRANT ALL ON TABLE "public"."order_promos" TO "authenticated";
GRANT ALL ON TABLE "public"."order_promos" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("session_id") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("restaurant_id") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("status") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("total_amount") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("placed_at") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("confirmed_at") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("ready_at") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("delivered_at") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("subtotal_amount") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("tax_amount") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("tip_amount") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("payment_status") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("discount_amount") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("order_type") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("needs_confirmation") ON TABLE "public"."orders" TO "anon";



GRANT SELECT("cancellation_reason") ON TABLE "public"."orders" TO "anon";



GRANT ALL ON TABLE "public"."payment_verifications" TO "anon";
GRANT ALL ON TABLE "public"."payment_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."phone_otp_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."pricing_rules" TO "anon";
GRANT ALL ON TABLE "public"."pricing_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."pricing_rules" TO "service_role";



GRANT ALL ON TABLE "public"."promo_codes" TO "anon";
GRANT ALL ON TABLE "public"."promo_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_codes" TO "service_role";



GRANT ALL ON TABLE "public"."promo_videos" TO "anon";
GRANT ALL ON TABLE "public"."promo_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_videos" TO "service_role";



GRANT ALL ON TABLE "public"."receivable_transactions" TO "anon";
GRANT ALL ON TABLE "public"."receivable_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."receivable_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."recipes" TO "anon";
GRANT ALL ON TABLE "public"."recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipes" TO "service_role";



GRANT ALL ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";
GRANT SELECT ON TABLE "public"."roles" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."room_charges" TO "anon";
GRANT ALL ON TABLE "public"."room_charges" TO "authenticated";
GRANT ALL ON TABLE "public"."room_charges" TO "service_role";



GRANT ALL ON TABLE "public"."room_types" TO "anon";
GRANT ALL ON TABLE "public"."room_types" TO "authenticated";
GRANT ALL ON TABLE "public"."room_types" TO "service_role";



GRANT ALL ON TABLE "public"."rooms" TO "anon";
GRANT ALL ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT ALL ON TABLE "public"."service_requests" TO "anon";
GRANT ALL ON TABLE "public"."service_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."service_requests" TO "service_role";



GRANT ALL ON TABLE "public"."session_seats" TO "anon";
GRANT ALL ON TABLE "public"."session_seats" TO "authenticated";
GRANT ALL ON TABLE "public"."session_seats" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."sessions" TO "anon";



GRANT SELECT("table_id") ON TABLE "public"."sessions" TO "anon";



GRANT SELECT("status") ON TABLE "public"."sessions" TO "anon";



GRANT SELECT("opened_at") ON TABLE "public"."sessions" TO "anon";



GRANT SELECT("expires_at") ON TABLE "public"."sessions" TO "anon";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."staff_shifts" TO "anon";
GRANT ALL ON TABLE "public"."staff_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_shifts" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_payments" TO "anon";
GRANT ALL ON TABLE "public"."subscription_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_payments" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_bills" TO "anon";
GRANT ALL ON TABLE "public"."supplier_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_bills" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_payments" TO "anon";
GRANT ALL ON TABLE "public"."supplier_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_payments" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."supported_languages" TO "anon";
GRANT ALL ON TABLE "public"."supported_languages" TO "authenticated";
GRANT ALL ON TABLE "public"."supported_languages" TO "service_role";



GRANT ALL ON TABLE "public"."tables" TO "anon";
GRANT ALL ON TABLE "public"."tables" TO "authenticated";
GRANT ALL ON TABLE "public"."tables" TO "service_role";



GRANT ALL ON TABLE "public"."takeout_orders" TO "anon";
GRANT ALL ON TABLE "public"."takeout_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."takeout_orders" TO "service_role";



GRANT ALL ON TABLE "public"."tax_configurations" TO "anon";
GRANT ALL ON TABLE "public"."tax_configurations" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_configurations" TO "service_role";



GRANT ALL ON TABLE "public"."tax_filings" TO "anon";
GRANT ALL ON TABLE "public"."tax_filings" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_filings" TO "service_role";



GRANT ALL ON TABLE "public"."translations" TO "anon";
GRANT ALL ON TABLE "public"."translations" TO "authenticated";
GRANT ALL ON TABLE "public"."translations" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT SELECT ON TABLE "public"."users" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."voucher_attachments" TO "anon";
GRANT ALL ON TABLE "public"."voucher_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."voucher_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."voucher_lines" TO "anon";
GRANT ALL ON TABLE "public"."voucher_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."voucher_lines" TO "service_role";



GRANT ALL ON TABLE "public"."voucher_sequences" TO "anon";
GRANT ALL ON TABLE "public"."voucher_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."voucher_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."voucher_types" TO "anon";
GRANT ALL ON TABLE "public"."voucher_types" TO "authenticated";
GRANT ALL ON TABLE "public"."voucher_types" TO "service_role";



GRANT ALL ON TABLE "public"."vouchers" TO "anon";
GRANT ALL ON TABLE "public"."vouchers" TO "authenticated";
GRANT ALL ON TABLE "public"."vouchers" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




























-- Add booking_id to public.sessions to associate dining sessions with hotel bookings
ALTER TABLE public.sessions
ADD COLUMN booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL;

-- Add index on booking_id for search optimization
CREATE INDEX IF NOT EXISTS idx_sessions_booking_id ON public.sessions(booking_id);
-- Restore the auth.users triggers dropped by the baseline squash.
--
-- The baseline (20260708150000_baseline.sql) is a schema dump of the `public`
-- schema, which excludes objects living in the `auth` schema. The two triggers
-- that wire auth.users -> public.users therefore went missing, even though the
-- functions they call (public.handle_new_user, public.sync_user_email) are still
-- defined. Without them a fresh database creates auth users with no matching
-- public.users row, breaking signup, staff creation, and demo login.
--
-- Idempotent and safe to run against production (which already has these
-- triggers): DROP IF EXISTS then CREATE.

-- Create the public.users row for every new auth user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Keep public.users.email in sync when the auth email changes.
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_user_email();

-- Backfill public.users rows for any auth users that were created while the
-- triggers were missing (e.g. a fresh local stack seeded before this migration).
INSERT INTO public.users (id, full_name, email, restaurant_id, role_id)
SELECT au.id,
       COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1), 'New User'),
       au.email,
       NULL,
       NULL
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;
-- Add monthly_salary to users table
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "monthly_salary" numeric(12,2) DEFAULT 0.00 NOT NULL;

-- Create staff_ledger table
CREATE TABLE IF NOT EXISTS "public"."staff_ledger" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "entry_type" text NOT NULL, -- 'salary_payout', 'advance_payment', 'bonus', 'deduction', 'accrual'
    "payment_method" text, -- 'cash', 'bank_transfer', 'qr_digital'
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,
    CONSTRAINT "staff_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_ledger_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['salary_payout'::text, 'advance_payment'::text, 'bonus'::text, 'deduction'::text, 'accrual'::text]))),
    CONSTRAINT "staff_ledger_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'qr_digital'::text])))
);

ALTER TABLE "public"."staff_ledger" OWNER TO "postgres";

-- Add foreign key constraints
ALTER TABLE ONLY "public"."staff_ledger"
    ADD CONSTRAINT "staff_ledger_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_ledger"
    ADD CONSTRAINT "staff_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_ledger"
    ADD CONSTRAINT "staff_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

-- Enable Row Level Security (RLS)
ALTER TABLE "public"."staff_ledger" ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
CREATE POLICY "manager_manage_staff_ledger" ON "public"."staff_ledger"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_own_ledger" ON "public"."staff_ledger"
    FOR SELECT
    USING (("user_id" = auth.uid()));
-- Add opening_balance to users table (amount owed to staff before this system was used)
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "opening_balance" numeric(12,2) DEFAULT 0.00 NOT NULL;
-- Room QR ordering: key the roomâ†”order relationship instead of matching strings.
--
-- Until now a hotel room reached the kitchen only because someone happened to
-- create a dining `table` whose `label` equalled the room number, and the folio
-- re-discovered those orders in the browser with
-- `table.label === room.room_number`. Rename a table, add a duplicate, or type
-- "Rm 203" and the guest's orders silently detached from their folio â€” they
-- checked out unbilled and nothing errored.
--
-- Two columns fix that:
--   â€¢ tables.room_id   â€” the room's QR *is* that table's qr_token, now joined by key.
--   â€¢ orders.booking_id â€” an in-room order belongs to the stay, durably, so the
--     folio survives the session closing or expiring.

-- â”€â”€ The room â†” table bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE public.tables
    ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL;

-- A room has at most one QR/table. Partial so ordinary dining tables (room_id
-- NULL) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS tables_room_id_uniq
    ON public.tables (room_id)
    WHERE room_id IS NOT NULL;

-- â”€â”€ The session â†” stay link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The application already reads and writes this column â€” linkSessionToBooking()
-- in waiter/actions.ts, the `sessions ( id, booking_id, â€¦ )` selects on the
-- cashier page, and /api/bookings/linked-orders â€” but it was never created (the
-- baseline is a dump of the public schema and this column went missing with it).
-- Every one of those queries errors with "column booking_id does not exist"
-- today, which is why linking a dining session to a guest's room does nothing.
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_booking_id_idx
    ON public.sessions (booking_id)
    WHERE booking_id IS NOT NULL;

-- â”€â”€ The order â†” stay (folio) link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_booking_id_idx
    ON public.orders (booking_id)
    WHERE booking_id IS NOT NULL;

-- â”€â”€ Backfill the bridge from the old label convention â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- DISTINCT ON keeps the oldest matching table per room so the unique index can
-- never be violated by a duplicate/stray table sharing the room's label.
WITH pick AS (
    SELECT DISTINCT ON (r.id)
           r.id AS room_id,
           t.id AS table_id
    FROM public.rooms r
    JOIN public.tables t
      ON t.restaurant_id = r.restaurant_id
     AND (t.label = r.room_number OR t.label = 'Room ' || r.room_number)
    WHERE t.room_id IS NULL
    ORDER BY r.id, t.created_at
)
UPDATE public.tables t
SET room_id = p.room_id
FROM pick p
WHERE t.id = p.table_id;

-- â”€â”€ Backfill the session â†” stay link for open room sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
UPDATE public.sessions s
SET booking_id = b.id
FROM public.tables t
JOIN public.bookings b ON b.room_id = t.room_id AND b.status = 'checked_in'
WHERE s.table_id = t.id
  AND t.room_id IS NOT NULL
  AND s.booking_id IS NULL
  AND s.status = 'active';

-- â”€â”€ Backfill booking_id for orders already placed from a room â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Attribute each existing in-room order to the booking that was checked in when
-- it was placed (falling back to the stay that covers its timestamp).
UPDATE public.orders o
SET booking_id = b.id
FROM public.sessions s
JOIN public.tables t ON t.id = s.table_id AND t.room_id IS NOT NULL
JOIN public.bookings b ON b.room_id = t.room_id
WHERE o.session_id = s.id
  AND o.booking_id IS NULL
  AND o.placed_at >= b.check_in
  AND (b.status = 'checked_in' OR o.placed_at <= b.check_out);

COMMENT ON COLUMN public.tables.room_id IS
    'Hotel room this table is the in-room QR for. NULL for ordinary dining tables.';
COMMENT ON COLUMN public.orders.booking_id IS
    'Stay this order is billed to. Set at placement for in-room (room QR) orders.';
-- Daily staff attendance: one row per (user, date). Marking "In" sets status
-- to 'present'; marking "Out" sets status to 'absent' with an optional reason.
-- Re-marking the same day updates the existing row (upsert on user_id+date).
CREATE TABLE IF NOT EXISTS "public"."staff_attendance" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "date" date NOT NULL,
    "status" text NOT NULL, -- 'present', 'absent'
    "reason" text,
    "marked_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::text, 'absent'::text]))),
    CONSTRAINT "staff_attendance_user_date_unique" UNIQUE ("user_id", "date")
);

ALTER TABLE "public"."staff_attendance" OWNER TO "postgres";

ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "staff_attendance_restaurant_date_idx" ON "public"."staff_attendance" ("restaurant_id", "date");

-- Enable Row Level Security (RLS)
ALTER TABLE "public"."staff_attendance" ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies (mirrors staff_ledger's access model)
CREATE POLICY "manager_manage_staff_attendance" ON "public"."staff_attendance"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_own_attendance" ON "public"."staff_attendance"
    FOR SELECT
    USING (("user_id" = auth.uid()));
-- 1. Add menu_item_variation_id to recipes
ALTER TABLE "public"."recipes" ADD COLUMN IF NOT EXISTS "menu_item_variation_id" uuid;
ALTER TABLE "public"."recipes" DROP CONSTRAINT IF EXISTS "recipes_menu_item_variation_id_fkey";
ALTER TABLE "public"."recipes" ADD CONSTRAINT "recipes_menu_item_variation_id_fkey" FOREIGN KEY ("menu_item_variation_id") REFERENCES "public"."menu_item_variations"("id") ON DELETE CASCADE;

-- Allow menu_item_id to be nullable
ALTER TABLE "public"."recipes" ALTER COLUMN "menu_item_id" DROP NOT NULL;

-- 2. Add menu_item_variation_id to order_items
ALTER TABLE "public"."order_items" ADD COLUMN IF NOT EXISTS "menu_item_variation_id" uuid;
ALTER TABLE "public"."order_items" DROP CONSTRAINT IF EXISTS "order_items_menu_item_variation_id_fkey";
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_menu_item_variation_id_fkey" FOREIGN KEY ("menu_item_variation_id") REFERENCES "public"."menu_item_variations"("id") ON DELETE SET NULL;


-- 3. Update place_order function
CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text", "p_seat_id" "uuid" DEFAULT NULL::"uuid", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;
  
  -- Combo-specific variables
  v_combo_part RECORD;
  v_constituent_item menu_items%ROWTYPE;
  v_variant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;
  
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;
  
  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = v_restaurant_id;
  
  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id, loyalty_member_id, client_request_id)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id, p_loyalty_member_id, p_client_request_id)
  RETURNING id INTO v_order_id;
  
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;
    
    v_variant_id := (v_item->>'variation_id')::UUID;
    
    -- Pricing: Use variation price if passed, otherwise fall back to base effective price
    IF v_variant_id IS NOT NULL THEN
      SELECT price INTO v_effective_price FROM menu_item_variations WHERE id = v_variant_id;
    ELSE
      v_effective_price := public.get_effective_price(v_menu_item.id);
    END IF;
    
    -- Stock and Recipe Deduction
    IF v_menu_item.is_combo THEN
      FOR v_combo_part IN 
        SELECT item_id, quantity FROM public.combo_items WHERE combo_id = v_menu_item.id
      LOOP
        SELECT * INTO v_constituent_item FROM public.menu_items WHERE id = v_combo_part.item_id FOR UPDATE;
        
        IF v_constituent_item.stock_count IS NOT NULL THEN
          IF v_constituent_item.stock_count < (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT) THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item % in combo %', v_constituent_item.name, v_menu_item.name;
          END IF;
          UPDATE public.menu_items 
          SET stock_count = stock_count - (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT) 
          WHERE id = v_constituent_item.id;
        END IF;
        
        FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_constituent_item.id LOOP
          UPDATE ingredients
          SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
          WHERE id = v_recipe.ingredient_id;
          
          INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
          VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), v_order_id);
        END LOOP;
      END LOOP;
    ELSE
      IF v_menu_item.stock_count IS NOT NULL THEN
        IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
          RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
        END IF;
        UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
      END IF;
      
      -- Match variation-specific recipe first, then fallback to parent menu item recipe
      FOR v_recipe IN 
        SELECT r.ingredient_id, r.quantity_needed 
        FROM recipes r 
        WHERE (r.menu_item_variation_id = v_variant_id AND v_variant_id IS NOT NULL)
           OR (
             r.menu_item_id = v_menu_item.id 
             AND r.menu_item_variation_id IS NULL
             AND (
               v_variant_id IS NULL
               OR NOT EXISTS (
                 SELECT 1 FROM recipes r2 WHERE r2.menu_item_variation_id = v_variant_id
               )
             )
           )
      LOOP
        UPDATE ingredients
        SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
        WHERE id = v_recipe.ingredient_id;
        
        INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
        VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
      END LOOP;
    END IF;
    
    INSERT INTO order_items (order_id, menu_item_id, menu_item_variation_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, v_variant_id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;
    
    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;
    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);
        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;
    v_subtotal := v_subtotal + v_item_total;
  END LOOP;
  
  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE restaurant_id = v_restaurant_id
      AND code = UPPER(TRIM(p_promo_code))
      AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;
      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;
  
  -- Calculate taxes and totals
  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
  
  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      tax_amount = v_tax,
      total_amount = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;
  
  -- Loyalty points
  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config FROM loyalty_config WHERE restaurant_id = v_restaurant_id AND is_active = TRUE;
    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_dollar);
      UPDATE loyalty_members
      SET points_balance  = points_balance + v_points_earned,
          lifetime_points = lifetime_points + v_points_earned,
          lifetime_spend  = lifetime_spend + (v_subtotal - v_discount + v_tax),
          visit_count     = visit_count + 1,
          last_visit_at   = NOW(),
          tier = CASE
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.platinum_threshold THEN 'platinum'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.gold_threshold     THEN 'gold'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.silver_threshold   THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      WHERE id = p_loyalty_member_id;
      INSERT INTO loyalty_transactions (member_id, order_id, type, points, description)
      VALUES (p_loyalty_member_id, v_order_id, 'earn', v_points_earned,
        'Earned ' || v_points_earned || ' points on order ' || v_order_id::TEXT);
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         v_subtotal - v_discount + v_tax,
    'points_earned', v_points_earned
  );
END;
$$;


-- 4. Update deduct_ingredients_for_order function
CREATE OR REPLACE FUNCTION "public"."deduct_ingredients_for_order"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_item     RECORD;
    v_recipe   RECORD;
    v_consumed NUMERIC;
BEGIN
    FOR v_item IN
        SELECT menu_item_id, menu_item_variation_id, quantity
        FROM   order_items
        WHERE  order_id = p_order_id
    LOOP
        FOR v_recipe IN
            SELECT ingredient_id, quantity_needed
            FROM   recipes
            WHERE  (menu_item_variation_id = v_item.menu_item_variation_id AND v_item.menu_item_variation_id IS NOT NULL)
               OR  (
                 menu_item_id = v_item.menu_item_id 
                 AND menu_item_variation_id IS NULL
                 AND (
                   v_item.menu_item_variation_id IS NULL
                   OR NOT EXISTS (
                     SELECT 1 FROM recipes r2 WHERE r2.menu_item_variation_id = v_item.menu_item_variation_id
                   )
                 )
               )
        LOOP
            v_consumed := v_recipe.quantity_needed * v_item.quantity;

            UPDATE ingredients
            SET    stock_quantity = GREATEST(0, stock_quantity - v_consumed),
                   updated_at    = now()
            WHERE  id = v_recipe.ingredient_id;

            INSERT INTO ingredient_movements
                (ingredient_id, movement_type, quantity, reference_id, performed_by)
            VALUES
                (v_recipe.ingredient_id, 'usage', v_consumed, p_order_id, NULL);
        END LOOP;
    END LOOP;
END;
$$;
-- Move from the 4 internal tiers (free/basic/pro/enterprise) to the 5 published
-- plans (free/basic/premium/platinum/enterprise). 'pro' becomes 'premium'.
--
-- Ordering matters: restaurants_subscription_tier_check must accept 'premium'
-- before any row can be rewritten to it, so we drop the constraint, backfill,
-- then re-add it. Doing it the other way round fails on the first UPDATE.

ALTER TABLE public.restaurants
    DROP CONSTRAINT IF EXISTS restaurants_subscription_tier_check;

UPDATE public.restaurants
SET subscription_tier = 'premium'
WHERE subscription_tier = 'pro';

ALTER TABLE public.restaurants
    ADD CONSTRAINT restaurants_subscription_tier_check
    CHECK (subscription_tier = ANY (ARRAY['free', 'basic', 'premium', 'platinum', 'enterprise']));

-- Per-tier caps, mirroring TIER_LIMITS in src/lib/tiers.ts. 2147483647 is int4's
-- ceiling and is what "unlimited" means in both places.
--
-- The new Basic cap (5 staff / 20 tables) is tighter than the old one (10 / 30),
-- and Premium's (24 / 50) is tighter than the Pro it replaces (50 / 100). We
-- never lower a restaurant below what it is already using: an existing customer
-- keeps the capacity they have and simply cannot add more. GREATEST() does that.
WITH tier_limits(tier, max_staff, max_menu_items, max_tables) AS (
    VALUES ('free',       3,          100,        10),
           ('basic',      5,          500,        20),
           ('premium',    24,         1000,       50),
           ('platinum',   2147483647, 2147483647, 2147483647),
           ('enterprise', 2147483647, 2147483647, 2147483647)
)
UPDATE public.restaurants r
SET max_staff      = GREATEST(t.max_staff,
                              (SELECT count(*) FROM public.users      u WHERE u.restaurant_id = r.id)),
    max_menu_items = GREATEST(t.max_menu_items,
                              (SELECT count(*) FROM public.menu_items m WHERE m.restaurant_id = r.id)),
    max_tables     = GREATEST(t.max_tables,
                              (SELECT count(*) FROM public.tables     tb WHERE tb.restaurant_id = r.id))
FROM tier_limits t
WHERE r.subscription_tier = t.tier;

-- subscription_plans was never seeded, so check_plan_limit() has always taken its
-- "no plan restrictions" early-return. Seeding it makes the DB agree with
-- TIER_LIMITS. Nothing calls check_plan_limit() yet, so this changes no behavior
-- today; it stops the RPC from silently allowing everything once something does.
--
-- Display prices live in src/lib/pricing.ts. price_yearly here is the annual list
-- price (before any first-year discount) and exists so the row is not misleading.
INSERT INTO public.subscription_plans
    (id, name, price_monthly, price_yearly, currency, max_menu_items, max_staff, max_tables, is_active)
VALUES
    ('free',       'Free',       0, 0,     'NPR', 100,        3,          10,         true),
    ('basic',      'Basic',      0, 9999,  'NPR', 500,        5,          20,         true),
    ('premium',    'Premium',    0, 30000, 'NPR', 1000,       24,         50,         true),
    ('platinum',   'Platinum',   0, 55000, 'NPR', 2147483647, 2147483647, 2147483647, true),
    ('enterprise', 'Enterprise', 0, 0,     'NPR', 2147483647, 2147483647, 2147483647, true)
ON CONFLICT (id) DO UPDATE SET
    name           = EXCLUDED.name,
    price_yearly   = EXCLUDED.price_yearly,
    currency       = EXCLUDED.currency,
    max_menu_items = EXCLUDED.max_menu_items,
    max_staff      = EXCLUDED.max_staff,
    max_tables     = EXCLUDED.max_tables,
    is_active      = EXCLUDED.is_active;

DELETE FROM public.subscription_plans
WHERE id NOT IN ('free', 'basic', 'premium', 'platinum', 'enterprise');
-- Lets an admin set a manual estimated ingredient cost per unit for a menu item
-- that has no recipe configured, so COGS/gross-profit reporting isn't stuck at
-- zero for items a restaurant doesn't want to track stock for (e.g. food items
-- at a hotel that only wants automatic deduction on beverages).
ALTER TABLE "public"."menu_items" ADD COLUMN IF NOT EXISTS "estimated_cost_price" numeric(10,2);
ALTER TABLE "public"."menu_items" DROP CONSTRAINT IF EXISTS "menu_items_estimated_cost_price_check";
ALTER TABLE "public"."menu_items" ADD CONSTRAINT "menu_items_estimated_cost_price_check" CHECK ("estimated_cost_price" IS NULL OR "estimated_cost_price" >= 0);
-- Manager-editable join date, separate from created_at (account creation time),
-- used to prorate salary accrual for a staff member's actual start date.
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "join_date" date;

-- Backfill existing staff with their account creation date as a sensible default
UPDATE "public"."users" SET "join_date" = "created_at"::date WHERE "join_date" IS NULL;
-- Time-bounded salary history: one row per (user, salary, effective period).
-- effective_to = NULL means "still in effect until the manager changes it".
-- Salary accrual (lib/payroll.ts) looks up the rate that covers each day
-- worked from this table, falling back to users.monthly_salary for staff who
-- have never had a recorded change.
CREATE TABLE IF NOT EXISTS "public"."staff_salary_history" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "monthly_salary" numeric(12,2) NOT NULL,
    "effective_from" date NOT NULL,
    "effective_to" date,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "staff_salary_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_salary_history_salary_check" CHECK (("monthly_salary" >= 0)),
    CONSTRAINT "staff_salary_history_date_check" CHECK (("effective_to" IS NULL OR "effective_to" >= "effective_from"))
);

ALTER TABLE "public"."staff_salary_history" OWNER TO "postgres";

ALTER TABLE ONLY "public"."staff_salary_history"
    ADD CONSTRAINT "staff_salary_history_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_salary_history"
    ADD CONSTRAINT "staff_salary_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_salary_history"
    ADD CONSTRAINT "staff_salary_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "staff_salary_history_user_period_idx" ON "public"."staff_salary_history" ("user_id", "effective_from", "effective_to");

-- Enable Row Level Security (RLS)
ALTER TABLE "public"."staff_salary_history" ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies (mirrors staff_ledger's access model)
CREATE POLICY "manager_manage_staff_salary_history" ON "public"."staff_salary_history"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_own_salary_history" ON "public"."staff_salary_history"
    FOR SELECT
    USING (("user_id" = auth.uid()));
-- Bar Order Tickets (BOT): route each dish to the station that makes it.
--
-- Until now every order line went to the kitchen. A bar item (a cocktail, a
-- coffee) was cooked-and-plated on the same screen and printed on the same
-- KOT as the food. This splits the queue in two.
--
-- Routing resolves item -> category -> 'kitchen':
--   menu_categories.station  the default for everything in the category
--   menu_items.station       nullable override for the odd item out
--   order_items.station      RESOLVED AND FROZEN at insert time
--
-- order_items.station is stamped by a trigger rather than by the callers.
-- Five functions insert order lines (place_order has three overloads, plus
-- place_takeout_order and place_delivery_order) and two more do it from JS â€”
-- a trigger is the only place that catches all seven. Freezing the value also
-- means re-tagging a category tomorrow never rewrites yesterday's tickets.

CREATE TYPE public.station_kind AS ENUM ('kitchen', 'bar');

ALTER TABLE public.menu_categories
    ADD COLUMN IF NOT EXISTS station public.station_kind NOT NULL DEFAULT 'kitchen';

-- Nullable on purpose: NULL means "inherit the category", which is different
-- from an explicit 'kitchen' on a drink in the Beverages category.
ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS station public.station_kind;

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS station public.station_kind;

COMMENT ON COLUMN public.menu_categories.station IS
    'Default station for items in this category.';
COMMENT ON COLUMN public.menu_items.station IS
    'Overrides the category station. NULL = inherit.';
COMMENT ON COLUMN public.order_items.station IS
    'Station resolved at insert time and frozen. Never recomputed from the menu.';

CREATE OR REPLACE FUNCTION public.stamp_order_item_station()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.station IS NULL THEN
        SELECT COALESCE(mi.station, mc.station)
          INTO NEW.station
          FROM public.menu_items mi
          LEFT JOIN public.menu_categories mc ON mc.id = mi.category_id
         WHERE mi.id = NEW.menu_item_id;
    END IF;

    -- A deleted menu item, or one with no category, still has to land somewhere.
    NEW.station := COALESCE(NEW.station, 'kitchen');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_order_item_station ON public.order_items;
CREATE TRIGGER stamp_order_item_station
    BEFORE INSERT ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.stamp_order_item_station();

-- Existing lines predate the split, so they resolve to whatever their menu item
-- says today â€” which is 'kitchen' for every row, since the columns above just
-- defaulted that way. Written generally so a re-run after tagging still works.
UPDATE public.order_items oi
   SET station = COALESCE(mi.station, mc.station, 'kitchen')
  FROM public.menu_items mi
  LEFT JOIN public.menu_categories mc ON mc.id = mi.category_id
 WHERE mi.id = oi.menu_item_id
   AND oi.station IS NULL;

-- Orphaned lines (menu item hard-deleted) never matched the join above.
UPDATE public.order_items SET station = 'kitchen' WHERE station IS NULL;

ALTER TABLE public.order_items ALTER COLUMN station SET NOT NULL;

-- The bar queue asks "which open orders have bar lines". Bar items are the
-- minority of rows, so a partial index stays small and is the one that is read
-- on every /bar poll and realtime refetch.
CREATE INDEX IF NOT EXISTS order_items_bar_station_idx
    ON public.order_items (order_id)
    WHERE station = 'bar';

-- Bartenders work the BOT queue. Reference data, so it ships with the schema
-- rather than with the seed â€” production has no seed run.
--
-- Insert by NAME with a derived id (mirrors how 'cashier' and the finance roles
-- were added), NOT a hardcoded id 7: on production id 7 already belongs to
-- finance_manager (cashier=6, then finance_manager/accountant/receptionist were
-- added via MAX(id)+1), so `ON CONFLICT (id) DO UPDATE` would silently rename
-- that row and turn every finance manager into a bartender. Guarding on name
-- leaves any existing role untouched and simply skips if 'bartender' exists.
INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'bartender',
       'Views and updates drink preparation status at the bar'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'bartender');
-- Single source of truth for "which recipe applies to this menu item / variation
-- combination" â€” replaces the near-identical WHERE clause that was duplicated in
-- place_order() and deduct_ingredients_for_order(), which could silently drift
-- out of sync with each other.
CREATE OR REPLACE FUNCTION "public"."resolve_recipe_rows"("p_menu_item_id" "uuid", "p_variation_id" "uuid")
RETURNS TABLE("ingredient_id" "uuid", "quantity_needed" numeric)
LANGUAGE "sql" STABLE
AS $$
  SELECT r.ingredient_id, r.quantity_needed
  FROM recipes r
  WHERE (p_variation_id IS NOT NULL AND r.menu_item_variation_id = p_variation_id)
     OR (
       r.menu_item_id = p_menu_item_id
       AND r.menu_item_variation_id IS NULL
       AND (
         p_variation_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM recipes r2 WHERE r2.menu_item_variation_id = p_variation_id)
       )
     )
$$;

-- Update place_order: use the shared recipe resolver, and validate that a
-- variation_id passed by the client actually belongs to the menu item being
-- ordered (previously trusted blindly, and a missing variation silently
-- produced a NULL price/total instead of a clear error).
CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text", "p_seat_id" "uuid" DEFAULT NULL::"uuid", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;

  -- Combo-specific variables
  v_combo_part RECORD;
  v_constituent_item menu_items%ROWTYPE;
  v_variant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = v_restaurant_id;

  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id, loyalty_member_id, client_request_id)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id, p_loyalty_member_id, p_client_request_id)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    v_variant_id := (v_item->>'variation_id')::UUID;

    -- Pricing: Use variation price if passed, otherwise fall back to base effective price.
    -- The variation must belong to the item being ordered â€” otherwise fail loudly
    -- instead of silently producing a NULL price/total.
    IF v_variant_id IS NOT NULL THEN
      SELECT price INTO v_effective_price
      FROM menu_item_variations
      WHERE id = v_variant_id AND menu_item_id = v_menu_item.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VARIATION_UNAVAILABLE: Variation % is not available for item %', v_variant_id, v_menu_item.name;
      END IF;
    ELSE
      v_effective_price := public.get_effective_price(v_menu_item.id);
    END IF;

    -- Stock and Recipe Deduction
    IF v_menu_item.is_combo THEN
      FOR v_combo_part IN
        SELECT item_id, quantity FROM public.combo_items WHERE combo_id = v_menu_item.id
      LOOP
        SELECT * INTO v_constituent_item FROM public.menu_items WHERE id = v_combo_part.item_id FOR UPDATE;

        IF v_constituent_item.stock_count IS NOT NULL THEN
          IF v_constituent_item.stock_count < (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT) THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item % in combo %', v_constituent_item.name, v_menu_item.name;
          END IF;
          UPDATE public.menu_items
          SET stock_count = stock_count - (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT)
          WHERE id = v_constituent_item.id;
        END IF;

        FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_constituent_item.id LOOP
          UPDATE ingredients
          SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
          WHERE id = v_recipe.ingredient_id;

          INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
          VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), v_order_id);
        END LOOP;
      END LOOP;
    ELSE
      IF v_menu_item.stock_count IS NOT NULL THEN
        IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
          RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
        END IF;
        UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
      END IF;

      -- Match variation-specific recipe first, then fallback to parent menu item recipe
      FOR v_recipe IN SELECT * FROM public.resolve_recipe_rows(v_menu_item.id, v_variant_id)
      LOOP
        UPDATE ingredients
        SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
        WHERE id = v_recipe.ingredient_id;

        INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
        VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
      END LOOP;
    END IF;

    INSERT INTO order_items (order_id, menu_item_id, menu_item_variation_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, v_variant_id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;

    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;
    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);
        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;
    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE restaurant_id = v_restaurant_id
      AND code = UPPER(TRIM(p_promo_code))
      AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;
      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;

  -- Calculate taxes and totals
  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);

  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      tax_amount = v_tax,
      total_amount = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;

  -- Loyalty points
  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config FROM loyalty_config WHERE restaurant_id = v_restaurant_id AND is_active = TRUE;
    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_dollar);
      UPDATE loyalty_members
      SET points_balance  = points_balance + v_points_earned,
          lifetime_points = lifetime_points + v_points_earned,
          lifetime_spend  = lifetime_spend + (v_subtotal - v_discount + v_tax),
          visit_count     = visit_count + 1,
          last_visit_at   = NOW(),
          tier = CASE
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.platinum_threshold THEN 'platinum'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.gold_threshold     THEN 'gold'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.silver_threshold   THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      WHERE id = p_loyalty_member_id;
      INSERT INTO loyalty_transactions (member_id, order_id, type, points, description)
      VALUES (p_loyalty_member_id, v_order_id, 'earn', v_points_earned,
        'Earned ' || v_points_earned || ' points on order ' || v_order_id::TEXT);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         v_subtotal - v_discount + v_tax,
    'points_earned', v_points_earned
  );
END;
$$;

-- Update deduct_ingredients_for_order to use the same shared recipe resolver
-- as place_order, so the two can no longer silently disagree on which recipe
-- applies to an order line.
CREATE OR REPLACE FUNCTION "public"."deduct_ingredients_for_order"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_item     RECORD;
    v_recipe   RECORD;
    v_consumed NUMERIC;
BEGIN
    FOR v_item IN
        SELECT menu_item_id, menu_item_variation_id, quantity
        FROM   order_items
        WHERE  order_id = p_order_id
    LOOP
        FOR v_recipe IN SELECT * FROM public.resolve_recipe_rows(v_item.menu_item_id, v_item.menu_item_variation_id)
        LOOP
            v_consumed := v_recipe.quantity_needed * v_item.quantity;

            UPDATE ingredients
            SET    stock_quantity = GREATEST(0, stock_quantity - v_consumed),
                   updated_at    = now()
            WHERE  id = v_recipe.ingredient_id;

            INSERT INTO ingredient_movements
                (ingredient_id, movement_type, quantity, reference_id, performed_by)
            VALUES
                (v_recipe.ingredient_id, 'usage', v_consumed, p_order_id, NULL);
        END LOOP;
    END LOOP;
END;
$$;
-- expenses.bank_account_id and income_entries.bank_account_id columns already
-- exist in the baseline schema, but were never given a foreign key to
-- bank_accounts, so PostgREST can't resolve `.select('*, bank_accounts(*)')`
-- embeds on these tables ("Could not find a relationship..." error).
ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."income_entries"
    ADD CONSTRAINT "income_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Migration: Add Category ID to Ingredients and Suppliers
-- Links ingredients and suppliers to expense_categories table.
-- ============================================================

-- Add category_id to ingredients
ALTER TABLE public.ingredients 
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;

-- Add category_id to suppliers
ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
-- expense_categories is shared across Expenses, Suppliers, and Ingredients
-- (Stock). Without a way to tell "this category is relevant to stock" apart
-- from general-purpose expense categories (Electricity, Rent, etc.), the
-- Stock module's category picker showed every expense category in the
-- restaurant, most of which will never have a stock item or supplier.
ALTER TABLE "public"."expense_categories" ADD COLUMN IF NOT EXISTS "is_stock_category" boolean DEFAULT false NOT NULL;

-- Backfill: any category already referenced by an ingredient or supplier is
-- clearly a stock-relevant category, so keep it visible after this change.
UPDATE "public"."expense_categories" ec
SET "is_stock_category" = true
WHERE EXISTS (SELECT 1 FROM "public"."ingredients" i WHERE i.category_id = ec.id)
   OR EXISTS (SELECT 1 FROM "public"."suppliers" s WHERE s.category_id = ec.id);

NOTIFY pgrst, 'reload schema';
-- Capture the OAuth (Google) profile into public.users.
--
-- handle_new_user() copied full_name out of the auth metadata but dropped the
-- avatar, even though public.users.avatar_url exists and both the onboarding
-- screen and the profile page read it. So every Google sign-in fell back to a
-- generated placeholder avatar and the profile felt disconnected from the
-- account the user actually signed in with.
--
-- Google's OpenID metadata lands in auth.users.raw_user_meta_data as some mix
-- of avatar_url / picture and full_name / name, so coalesce across both spellings.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, email, avatar_url, restaurant_id, role_id)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      'New User'
    ),
    NEW.email,
    -- NULLIF guards against a provider that sends the key as an empty string.
    NULLIF(COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ), ''),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

-- Backfill Google users who signed in before this fix: their auth metadata
-- already carries the avatar, we just never copied it. Only touch rows with no
-- avatar so a user who uploaded their own photo is left alone.
UPDATE public.users u
   SET avatar_url = NULLIF(COALESCE(
           au.raw_user_meta_data->>'avatar_url',
           au.raw_user_meta_data->>'picture'
       ), '')
  FROM auth.users au
 WHERE au.id = u.id
   AND u.avatar_url IS NULL
   AND COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture') IS NOT NULL;
-- ============================================================
-- Ledger integrity: ownership links + atomic counters
-- ============================================================

-- â”€â”€ 1. Day Book entry ownership â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Vouchers and the Cash/Bank Book "Expense" entries create a day_book_entries
-- row *and* a downstream expenses / staff_ledger row. Deleting the Day Book
-- entry used to leave the downstream row behind forever, because nothing
-- linked the two. Modules where the Day Book entry owns the record set this
-- column and the cascade cleans up after them.
--
-- Income & Expenses, Suppliers and Staff work the other way round â€” they
-- create their record first and post the Day Book entry as a side effect â€” so
-- they leave this NULL and are untouched by the cascade.
ALTER TABLE "public"."expenses"
    ADD COLUMN IF NOT EXISTS "day_book_entry_id" "uuid"
    REFERENCES "public"."day_book_entries"("id") ON DELETE CASCADE;

ALTER TABLE "public"."staff_ledger"
    ADD COLUMN IF NOT EXISTS "day_book_entry_id" "uuid"
    REFERENCES "public"."day_book_entries"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "expenses_day_book_entry_id_idx"
    ON "public"."expenses" ("day_book_entry_id")
    WHERE "day_book_entry_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "staff_ledger_day_book_entry_id_idx"
    ON "public"."staff_ledger" ("day_book_entry_id")
    WHERE "day_book_entry_id" IS NOT NULL;


-- â”€â”€ 2. Atomic voucher numbering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Voucher numbers used to be derived by counting existing voucher rows in the
-- session, so two submissions racing each other both read the same count and
-- both minted the same number. A per (restaurant, date, prefix) counter with
-- an upsert hands out each number exactly once: the ON CONFLICT DO UPDATE
-- takes a row lock, serialising concurrent callers.
--
-- Named for the Day Book because the baseline schema already has an unrelated
-- `voucher_sequences` table, keyed by (restaurant, voucher_type_id, year), for
-- the Finance module's own voucher numbering.
CREATE TABLE IF NOT EXISTS "public"."day_book_voucher_sequences" (
    "restaurant_id" "uuid" NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "date" "date" NOT NULL,
    "prefix" "text" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL,
    PRIMARY KEY ("restaurant_id", "date", "prefix")
);

ALTER TABLE "public"."day_book_voucher_sequences" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION "public"."next_voucher_number"(
    "p_restaurant_id" "uuid",
    "p_date" "date",
    "p_prefix" "text"
) RETURNS integer
    LANGUAGE "sql"
    SECURITY DEFINER
    SET "search_path" = "public"
    AS $$
    INSERT INTO public.day_book_voucher_sequences (restaurant_id, date, prefix, last_number)
    VALUES (p_restaurant_id, p_date, p_prefix, 1)
    ON CONFLICT (restaurant_id, date, prefix)
    DO UPDATE SET last_number = public.day_book_voucher_sequences.last_number + 1
    RETURNING last_number;
$$;


-- â”€â”€ 3. Atomic stock adjustment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- addStockMovementAction read stock_quantity and wrote back read + delta, so
-- two concurrent movements could each read the same starting quantity and one
-- update would be lost. Doing the arithmetic inside a single UPDATE makes the
-- read-modify-write atomic under the row lock the UPDATE already takes.
CREATE OR REPLACE FUNCTION "public"."adjust_ingredient_stock"(
    "p_ingredient_id" "uuid",
    "p_delta" numeric
) RETURNS numeric
    LANGUAGE "sql"
    SECURITY DEFINER
    SET "search_path" = "public"
    AS $$
    UPDATE public.ingredients
    SET stock_quantity = GREATEST(0, stock_quantity + p_delta)
    WHERE id = p_ingredient_id
    RETURNING stock_quantity;
$$;

-- Both functions are SECURITY DEFINER and PostgREST exposes everything in
-- `public` as an RPC, so the default EXECUTE-to-PUBLIC grant would let an
-- anonymous caller bump voucher counters or rewrite stock levels. Only the
-- server-side admin client (service_role) may call them.
REVOKE EXECUTE ON FUNCTION "public"."next_voucher_number"("uuid", "date", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."adjust_ingredient_stock"("uuid", numeric) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."next_voucher_number"("uuid", "date", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."adjust_ingredient_stock"("uuid", numeric) TO "service_role";

NOTIFY pgrst, 'reload schema';
-- Allow advance payments to be recorded as a cash+QR split, so cashiers can
-- record advances collected across two payment methods (previously only a
-- single method could be stored, causing split advances to under-report in
-- income and cash-in-bank).
ALTER TABLE "public"."bookings" DROP CONSTRAINT IF EXISTS "bookings_advance_payment_method_check";
ALTER TABLE "public"."bookings" ADD CONSTRAINT "bookings_advance_payment_method_check"
    CHECK (("advance_payment_method" = ANY (ARRAY['cash'::"text", 'qr_digital'::"text", 'split'::"text", 'none'::"text"])));
-- Lets a restaurant designate which bank account their displayed payment QR
-- (payment_qr_url) actually deposits into, so QR payments post income/bank-in
-- against the right account instead of an arbitrarily picked "first active" one.
ALTER TABLE "public"."restaurants"
    ADD COLUMN IF NOT EXISTS "qr_bank_account_id" uuid REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;
-- A restaurant may run multiple payment QR codes (e.g. one eSewa QR depositing
-- into Bank A, one Fonepay QR depositing into Bank B). The prior single
-- payment_qr_url/payment_qr_label/qr_bank_account_id columns on restaurants
-- could only represent one â€” this table replaces that with a proper list, one
-- row per QR, each with its own bank account.
CREATE TABLE IF NOT EXISTS "public"."payment_qr_codes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" uuid NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "label" text NOT NULL,
    "image_url" text,
    "bank_account_id" uuid REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_qr_codes_restaurant_id_idx" ON "public"."payment_qr_codes" ("restaurant_id");

ALTER TABLE "public"."payment_qr_codes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_payment_qr_codes" ON "public"."payment_qr_codes"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_payment_qr_codes" ON "public"."payment_qr_codes"
    FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));

-- Backfill: carry forward any restaurant that already had a single QR configured.
INSERT INTO "public"."payment_qr_codes" ("restaurant_id", "label", "image_url", "bank_account_id")
SELECT "id", COALESCE(NULLIF("payment_qr_label", ''), 'Payment QR'), "payment_qr_url", "qr_bank_account_id"
FROM "public"."restaurants"
WHERE "payment_qr_url" IS NOT NULL;
-- Audit trail for supplier bills settled by a Payment Voucher.
--
-- Suppliers Ledger tracks "due" per bill (expenses.description JSON
-- paid_amount), not as an aggregate â€” so when a voucher settles a supplier's
-- overall outstanding balance (FIFO across bills), each touched bill's
-- paid_amount is mutated in place. Those bill rows leave day_book_entry_id
-- NULL by design (see 20260710020000_ledger_integrity.sql), so deleting the
-- voucher's day_book_entries row would not undo those mutations on its own.
-- This table records exactly which bill(s) a settlement touched and by how
-- much, so deleteVoucherAction can reverse it precisely before the cascade.
CREATE TABLE IF NOT EXISTS "public"."voucher_supplier_settlements" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "day_book_entry_id" uuid NOT NULL,
    "expense_id" uuid NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "voucher_supplier_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voucher_supplier_settlements_amount_check" CHECK (("amount" > (0)::numeric))
);

ALTER TABLE "public"."voucher_supplier_settlements" OWNER TO "postgres";

ALTER TABLE ONLY "public"."voucher_supplier_settlements"
    ADD CONSTRAINT "voucher_supplier_settlements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."voucher_supplier_settlements"
    ADD CONSTRAINT "voucher_supplier_settlements_day_book_entry_id_fkey" FOREIGN KEY ("day_book_entry_id") REFERENCES "public"."day_book_entries"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."voucher_supplier_settlements"
    ADD CONSTRAINT "voucher_supplier_settlements_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "voucher_supplier_settlements_day_book_entry_id_idx"
    ON "public"."voucher_supplier_settlements" ("day_book_entry_id");

CREATE INDEX IF NOT EXISTS "voucher_supplier_settlements_expense_id_idx"
    ON "public"."voucher_supplier_settlements" ("expense_id");

ALTER TABLE "public"."voucher_supplier_settlements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_manage_voucher_supplier_settlements" ON "public"."voucher_supplier_settlements"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

GRANT ALL ON TABLE "public"."voucher_supplier_settlements" TO "anon";
GRANT ALL ON TABLE "public"."voucher_supplier_settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."voucher_supplier_settlements" TO "service_role";

NOTIFY pgrst, 'reload schema';
-- Pre-launch security audit fixes (P0 items 1-3):
--
-- 1. Drop the 3 public RLS policies that let anyone read every active guest
--    session (including its bearer session_token), order, and service request
--    across every restaurant on the platform, with no authentication at all.
--    The secure replacement (/api/session/active) already exists and uses the
--    admin client + its own qr_token gate, so it does not depend on these
--    policies and continues to work unaffected. Legitimate customer access to
--    orders/requests continues via the already-correct, token-scoped
--    customer_read_own_orders / customer_read_own_requests policies.
--
-- 2. Tighten the menu_item_variations write policy so any authenticated user
--    can no longer edit or delete another restaurant's menu prices â€” it now
--    requires manager/super_admin AND ownership of the parent menu_item,
--    matching the existing manager_write_menu_items / manager_manage_recipes
--    pattern used for every other menu-management table.
--
-- 3. Add a CHECK constraint so order_items.unit_price can never be negative,
--    as a database-level backstop independent of the application code.

DROP POLICY IF EXISTS "public_read_active_sessions" ON "public"."sessions";
DROP POLICY IF EXISTS "public_read_active_session_orders" ON "public"."orders";
DROP POLICY IF EXISTS "public_read_active_session_requests" ON "public"."service_requests";

DROP POLICY IF EXISTS "Allow authenticated users to manage variations" ON "public"."menu_item_variations";

CREATE POLICY "manager_write_variations" ON "public"."menu_item_variations"
    USING (
        ("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"]))
        AND ("menu_item_id" IN (
            SELECT "menu_items"."id" FROM "public"."menu_items"
            WHERE ("menu_items"."restaurant_id" = "public"."current_restaurant_id"())
        ))
    );

ALTER TABLE "public"."order_items"
    ADD CONSTRAINT "order_items_unit_price_check" CHECK ("unit_price" >= 0);
-- Soft-delete for staff accounts.
--
-- Deleting a staff account used to hard-delete the public.users row (and the
-- auth.users row, which cascades into public.users via users_id_fkey). Because
-- staff_ledger, staff_attendance and staff_salary_history all declare
-- user_id REFERENCES users(id) ON DELETE CASCADE, that one click silently
-- wiped the staff member's entire payroll and attendance history â€” financial
-- records that must survive the person leaving.
--
-- The fix is app-level soft delete: deleteStaffAction now stamps deleted_at
-- (and is_active = false) instead of deleting the row, and soft-deletes the
-- auth account so the person can no longer log in. The CASCADE constraints
-- stay as they are â€” they are correct for genuine hard deletes (e.g. deleting
-- a whole restaurant, where mixed CASCADE/RESTRICT paths from restaurants
-- through users into the history tables would deadlock a RESTRICT approach) â€”
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
-- Pre-launch audit fix (Â§02): "Creating a new booking can silently erase a
-- real guest's stay". The application layer now rejects a new booking
-- attempt on a room that already has an active (pending/checked_in) stay
-- instead of silently auto-cancelling it (see src/app/api/bookings/route.ts).
--
-- This is the database-level backstop for that same rule: an EXCLUDE
-- constraint, using the already-installed btree_gist extension, makes two
-- overlapping active bookings on the same room impossible at the schema
-- level - regardless of whether every application code path remembers to
-- check first. Checked_out/cancelled bookings are excluded via the WHERE
-- clause so historical stays never block a new one.

ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_no_overlapping_active_stays"
    EXCLUDE USING gist (
        "room_id" WITH =,
        "tstzrange"("check_in", "check_out") WITH &&
    )
    WHERE ("status" = ANY (ARRAY['pending'::"text", 'checked_in'::"text"]));
-- Seed the reference roles the application assumes exist.
--
-- The baseline (20260708150000_baseline.sql) is a schema-only dump, so it ships
-- an empty roles table. The seed that fills it (supabase/seed.sql) only runs on
-- a local `supabase db reset`, never on a remote `db push`/deploy. As a result a
-- remote project can end up with zero roles, and since public.users.role_id has a
-- NOT-VALID... FK to roles(id), every write that sets a non-null role_id
-- (onboarding sets role_id = 2, staff create, customer signup, invite accept)
-- fails with: insert or update on table "users" violates foreign key constraint
-- "users_role_id_fkey". This migration guarantees the roles exist on every
-- environment the migrations run against.
--
-- Ids are assigned explicitly and must stay stable: they are referenced directly
-- in code (src/lib/provisioning.ts MANAGER_ROLE_ID = 2, src/lib/demoAccounts.ts,
-- src/app/login/actions.ts DEMO_ROLES). roles.id is a plain smallint PK with no
-- sequence, so there is nothing to re-sync. Idempotent and safe to re-run.

INSERT INTO public.roles (id, name, description) VALUES
    (1, 'super_admin', 'Full access to all restaurant operations and settings'),
    (2, 'manager',     'Manages daily operations, staff, and menu'),
    (3, 'kitchen',     'Views and updates order preparation status'),
    (4, 'waiter',      'Takes and serves orders on the floor'),
    (5, 'customer',    'Places orders via the QR menu'),
    (6, 'cashier',     'Payment collection and bill settlement at the counter')
ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description;

-- bartender (BOT queue) is inserted by NAME at MAX(id)+1, never a hardcoded id --
-- see 20260709180000_bar_order_tickets.sql. Code looks it up by name, not id.
INSERT INTO public.roles (id, name, description)
SELECT (SELECT COALESCE(MAX(id), 0) FROM public.roles) + 1,
       'bartender',
       'Views and updates drink preparation status at the bar'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'bartender');
-- Let a platform super_admin exist without a restaurant.
--
-- The custom_access_token_hook injected app_role='unauthenticated' whenever a
-- user had no restaurant_id. That is correct for a mid-onboarding user, but a
-- platform super_admin legitimately owns no tenant (it runs the cross-tenant
-- /admin/super-admin console). With app_role='unauthenticated' the app bounced it
-- to /onboarding and it could never reach its dashboard. Now, when a user with no
-- restaurant carries the super_admin role, we inject app_role='super_admin' (with
-- a null restaurant_id) so auth.ts recognises it as the elevated platform role.
--
-- Preserves the production hardening on this function: SET search_path TO '' and
-- fully-qualified public.* references.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    claims          JSONB;
    v_user_id       UUID;
    v_restaurant_id UUID;
    v_role_name     TEXT;
BEGIN
    v_user_id := (event->>'user_id')::UUID;
    claims    := event->'claims';

    SELECT u.restaurant_id, r.name
    INTO   v_restaurant_id, v_role_name
    FROM   public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE  u.id = v_user_id AND u.is_active = true
    LIMIT  1;

    IF v_restaurant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_role}',      to_jsonb(v_role_name));
        claims := jsonb_set(claims, '{restaurant_id}', to_jsonb(v_restaurant_id::TEXT));
    ELSIF v_role_name = 'super_admin' THEN
        -- Platform super admin: no tenant, but a real elevated role.
        claims := jsonb_set(claims, '{app_role}',      '"super_admin"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    ELSE
        claims := jsonb_set(claims, '{app_role}',      '"unauthenticated"');
        claims := jsonb_set(claims, '{restaurant_id}', 'null');
    END IF;

    RETURN jsonb_build_object('claims', claims);
END;
$function$;
-- Fix the invalid qr_token default on public.tables.
--
-- The column default was `encode(gen_random_bytes(24), 'base64url')`, but
-- Postgres `encode()` only supports 'base64', 'hex' and 'escape' â€” 'base64url'
-- raises `ERROR: 22023 unrecognized encoding: "base64url"`. So ANY insert into
-- tables that does not supply qr_token explicitly fails at the DB level (which
-- surfaces client-side as a failed request while creating a table). Callers that
-- generate the token in JS (addTableAction, provisioning, demoHotel, rooms/verify)
-- happened to dodge it, but the default itself is a latent landmine.
--
-- Replace it with a valid, URL-safe expression: base64 of 18 random bytes with
-- the base64 alphabet's non-URL-safe chars translated (+ -> -, / -> _, = removed).
-- 18 bytes -> 24 chars with no padding, so '=' never actually appears; the map is
-- kept for safety. qr_token is used directly in the /t/[qr_token] URL, so it must
-- be URL-safe.

ALTER TABLE public.tables
  ALTER COLUMN qr_token SET DEFAULT translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
-- Lets staff apply a bargained room rate at checkout, with a mandatory
-- reason as the audit trail (no separate manager-approval step â€” a guest is
-- standing there waiting to pay, per the same-day product decision). See
-- src/lib/folio.ts::computeFolioTotal, which is the single place this
-- discount actually takes effect on the bill.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "discount_amount" numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "discount_reason" text,
    ADD COLUMN IF NOT EXISTS "discount_applied_by" uuid REFERENCES "public"."users"("id"),
    ADD COLUMN IF NOT EXISTS "discount_applied_at" timestamptz;

ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_discount_amount_check" CHECK ("discount_amount" >= 0);

NOTIFY pgrst, 'reload schema';
-- Dine-in equivalent of 20260713150000_booking_discount.sql â€” lets staff
-- apply a bargained total at table checkout, with a mandatory reason as the
-- audit trail. sessions has no monetary columns today; see
-- src/app/api/tables/checkout/route.ts for where this actually takes effect.
ALTER TABLE "public"."sessions"
    ADD COLUMN IF NOT EXISTS "discount_amount" numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "discount_reason" text,
    ADD COLUMN IF NOT EXISTS "discount_applied_by" uuid REFERENCES "public"."users"("id"),
    ADD COLUMN IF NOT EXISTS "discount_applied_at" timestamptz;

ALTER TABLE "public"."sessions"
    ADD CONSTRAINT "sessions_discount_amount_check" CHECK ("discount_amount" >= 0);

NOTIFY pgrst, 'reload schema';
-- Migration to support Hotel & Restaurant Integration on the kkkhane platform
-- Adds columns to link a Hotel and Restaurant tenant, and opens up cross-tenant RLS
-- policies so they can verify room bookings and settle bills.

-- 1. Add linkage columns to restaurants table
ALTER TABLE public.restaurants 
    ADD COLUMN IF NOT EXISTS linked_hotel_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS linked_restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.restaurants.linked_hotel_id IS 'If this is a Restaurant, points to its partner Hotel on the platform.';
COMMENT ON COLUMN public.restaurants.linked_restaurant_id IS 'If this is a Hotel, points to its partner Restaurant on the platform.';

-- Create indexes on linkage columns for faster lookups
CREATE INDEX IF NOT EXISTS idx_restaurants_linked_hotel_id ON public.restaurants(linked_hotel_id) WHERE linked_hotel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurants_linked_restaurant_id ON public.restaurants(linked_restaurant_id) WHERE linked_restaurant_id IS NOT NULL;

-- 2. RLS policies for Bookings (Hotel) -> Allow partner Restaurant to read bookings for verification
DROP POLICY IF EXISTS "partner_restaurant_read_bookings" ON public.bookings;
CREATE POLICY "partner_restaurant_read_bookings" ON public.bookings
    FOR SELECT
    TO authenticated
    USING (
        restaurant_id IN (
            SELECT linked_hotel_id FROM public.restaurants WHERE id = public.current_restaurant_id()
        )
    );

-- 3. RLS policies for Rooms (Hotel) -> Allow partner Restaurant to read rooms
DROP POLICY IF EXISTS "partner_restaurant_read_rooms" ON public.rooms;
CREATE POLICY "partner_restaurant_read_rooms" ON public.rooms
    FOR SELECT
    TO authenticated
    USING (
        restaurant_id IN (
            SELECT linked_hotel_id FROM public.restaurants WHERE id = public.current_restaurant_id()
        )
    );

-- 4. RLS policies for Tables (Restaurant) -> Allow partner Hotel to read tables linked to their rooms
DROP POLICY IF EXISTS "partner_hotel_read_tables" ON public.tables;
CREATE POLICY "partner_hotel_read_tables" ON public.tables
    FOR SELECT
    TO authenticated
    USING (
        room_id IN (
            SELECT id FROM public.rooms WHERE restaurant_id = public.current_restaurant_id()
        )
    );

-- 5. RLS policies for Orders (Restaurant) -> Allow partner Hotel to read and update orders linked to their bookings
DROP POLICY IF EXISTS "partner_hotel_read_orders" ON public.orders;
CREATE POLICY "partner_hotel_read_orders" ON public.orders
    FOR SELECT
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );

DROP POLICY IF EXISTS "partner_hotel_update_orders" ON public.orders;
CREATE POLICY "partner_hotel_update_orders" ON public.orders
    FOR UPDATE
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    )
    WITH CHECK (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );

-- 6. RLS policies for Sessions (Restaurant) -> Allow partner Hotel to read and update sessions linked to their bookings
DROP POLICY IF EXISTS "partner_hotel_read_sessions" ON public.sessions;
CREATE POLICY "partner_hotel_read_sessions" ON public.sessions
    FOR SELECT
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );

DROP POLICY IF EXISTS "partner_hotel_update_sessions" ON public.sessions;
CREATE POLICY "partner_hotel_update_sessions" ON public.sessions
    FOR UPDATE
    TO authenticated
    USING (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    )
    WITH CHECK (
        booking_id IN (
            SELECT id FROM public.bookings WHERE restaurant_id = public.current_restaurant_id()
        )
    );
-- Advanced Tenant Integration Schema
-- Adds advanced ledger split controls, secure invitations, P&L PIN structures,
-- historical snapshots for tax/audit safety, and transaction-locked checkout settlement.

-- 1. Add advanced settings and analytics columns to restaurants table
ALTER TABLE public.restaurants 
    ADD COLUMN IF NOT EXISTS ledger_split_mode text NOT NULL DEFAULT 'direct' CHECK (ledger_split_mode IN ('direct', 'b2b')),
    ADD COLUMN IF NOT EXISTS billing_commission_rate numeric(5,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS analytics_pin_hash text,
    ADD COLUMN IF NOT EXISTS analytics_shared boolean NOT NULL DEFAULT false;

-- 2. Add historical linkage snapshot columns to keep logs pristine if unlinked
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS historical_linked_hotel_id uuid,
    ADD COLUMN IF NOT EXISTS historical_linked_restaurant_id uuid;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS historical_linked_hotel_id uuid,
    ADD COLUMN IF NOT EXISTS historical_linked_restaurant_id uuid;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS historical_linked_hotel_id uuid,
    ADD COLUMN IF NOT EXISTS historical_linked_restaurant_id uuid;

-- 3. Create secure invitation tables
CREATE TABLE IF NOT EXISTS public.tenant_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    recipient_email text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on invitations
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- Invitations RLS Policies
DROP POLICY IF EXISTS "Staff can view invitations sent from their tenant" ON public.tenant_invitations;
CREATE POLICY "Staff can view invitations sent from their tenant" ON public.tenant_invitations
    FOR SELECT TO authenticated
    USING (sender_tenant_id = public.current_restaurant_id());

DROP POLICY IF EXISTS "Staff can manage invitations sent from their tenant" ON public.tenant_invitations;
CREATE POLICY "Staff can manage invitations sent from their tenant" ON public.tenant_invitations
    FOR ALL TO authenticated
    USING (sender_tenant_id = public.current_restaurant_id())
    WITH CHECK (sender_tenant_id = public.current_restaurant_id());

-- 4. Create analytics temporary sessions table (10 minutes)
CREATE TABLE IF NOT EXISTS public.analytics_session_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    viewer_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on session tokens
ALTER TABLE public.analytics_session_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view session tokens" ON public.analytics_session_tokens;
CREATE POLICY "Staff can view session tokens" ON public.analytics_session_tokens
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_restaurant_id() 
        OR 
        viewer_tenant_id = public.current_restaurant_id()
    );

-- 5. Create immutable PIN access audit logs table
CREATE TABLE IF NOT EXISTS public.cross_tenant_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    target_tenant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    action text NOT NULL,
    details text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on audit logs (Only allow reading for own tenant logs)
ALTER TABLE public.cross_tenant_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read cross-tenant logs for their tenant" ON public.cross_tenant_audit_logs;
CREATE POLICY "Staff can read cross-tenant logs for their tenant" ON public.cross_tenant_audit_logs
    FOR SELECT TO authenticated
    USING (
        actor_tenant_id = public.current_restaurant_id() 
        OR 
        target_tenant_id = public.current_restaurant_id()
    );

-- 6. Indexes for database query performance
CREATE INDEX IF NOT EXISTS idx_invitations_sender ON public.tenant_invitations(sender_tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON public.tenant_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_session_tokens_viewer ON public.analytics_session_tokens(viewer_tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.cross_tenant_audit_logs(actor_tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.cross_tenant_audit_logs(target_tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_historical_link ON public.orders(historical_linked_hotel_id, historical_linked_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_historical_link ON public.bookings(historical_linked_hotel_id, historical_linked_restaurant_id);

-- 7. SQL helper functions for ledger entries
CREATE OR REPLACE FUNCTION public.post_payment_income_sql(
    p_restaurant_id uuid,
    p_user_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_category_name text,
    p_day_book_category text,
    p_desc text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_category_id uuid;
    v_bank_id uuid;
    v_session_id uuid;
    v_bank_name text;
    v_day_book_type text;
BEGIN
    IF p_amount <= 0 THEN
        RETURN;
    END IF;

    -- A. Resolve or create income category
    SELECT id INTO v_category_id FROM public.income_categories WHERE restaurant_id = p_restaurant_id AND name = p_category_name LIMIT 1;
    IF v_category_id IS NULL THEN
        INSERT INTO public.income_categories (restaurant_id, name)
        VALUES (p_restaurant_id, p_category_name)
        RETURNING id INTO v_category_id;
    END IF;

    -- B. Resolve default active bank account for digital payment methods
    IF p_payment_method IN ('qr_digital', 'card') THEN
        SELECT id, name INTO v_bank_id, v_bank_name FROM public.bank_accounts WHERE restaurant_id = p_restaurant_id AND is_active = true LIMIT 1;
    END IF;

    -- C. Insert Income Entry
    INSERT INTO public.income_entries (restaurant_id, category_id, amount, description, bank_account_id, status, created_by)
    VALUES (p_restaurant_id, v_category_id, p_amount, p_desc, v_bank_id, 'posted', p_user_id);

    -- D. Resolve or create active Day Book Session
    SELECT id INTO v_session_id FROM public.day_book_sessions WHERE restaurant_id = p_restaurant_id AND status = 'open' LIMIT 1;
    IF v_session_id IS NULL THEN
        INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
        VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
        RETURNING id INTO v_session_id;
    END IF;

    -- E. Insert Day Book Entry
    IF p_payment_method = 'cash' THEN
        v_day_book_type := 'cash_in';
    ELSE
        v_day_book_type := 'bank_in';
    END IF;

    INSERT INTO public.day_book_entries (session_id, restaurant_id, type, amount, description, category, bank_name, created_by)
    VALUES (v_session_id, p_restaurant_id, v_day_book_type, p_amount, p_desc, p_day_book_category, v_bank_name, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_expense_sql(
    p_restaurant_id uuid,
    p_user_id uuid,
    p_amount numeric,
    p_category_name text,
    p_desc text,
    p_status text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_category_id uuid;
BEGIN
    IF p_amount <= 0 THEN
        RETURN;
    END IF;

    -- Resolve or create expense category
    SELECT id INTO v_category_id FROM public.expense_categories WHERE restaurant_id = p_restaurant_id AND name = p_category_name LIMIT 1;
    IF v_category_id IS NULL THEN
        INSERT INTO public.expense_categories (restaurant_id, name)
        VALUES (p_restaurant_id, p_category_name)
        RETURNING id INTO v_category_id;
    END IF;

    -- Insert Expense
    INSERT INTO public.expenses (restaurant_id, category_id, amount, description, status, created_by)
    VALUES (p_restaurant_id, v_category_id, p_amount, p_desc, p_status, p_user_id);
END;
$$;

-- 8. Main transaction-locked settlement RPC
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
    p_session_id uuid,
    -- split amounts
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_number text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_settled_now numeric,
    p_new_paid_amount numeric,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    -- config options
    p_ledger_split_mode text,
    p_commission_rate numeric
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_sid uuid;
    v_rest_method text;
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    -- 1. Row Locking for serialization
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- 2. Lock orders matching booking or session to prevent race conditions
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids 
    FROM (
        SELECT id 
        FROM public.orders 
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Update Bookings Status
    UPDATE public.bookings 
    SET status = 'checked_out' 
    WHERE id = p_booking_id;

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items 
        SET status = 'served' 
        WHERE order_id = ANY(v_order_ids) 
        AND status != 'cancelled';

        UPDATE public.orders 
        SET status = 'delivered', payment_status = 'paid', paid_at = now() 
        WHERE id = ANY(v_order_ids) 
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and Close Sessions
    UPDATE public.sessions 
    SET status = 'closed', closed_at = now() 
    WHERE (id = p_session_id OR booking_id = p_booking_id) 
    AND status = 'active';

    -- 6. Snapshot Linked Tenant IDs historically on Invoices/Orders/Sessions
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders 
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id 
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_booking_id;

    UPDATE public.sessions 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_session_id OR booking_id = p_booking_id;

    -- 7. Persist booking financial totals
    UPDATE public.bookings 
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty
    UPDATE public.rooms 
    SET status = 'dirty' 
    WHERE id = p_room_id;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        -- Post Hotel stays directly
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Post Restaurant Portion directly under Restaurant's Ledger
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            IF p_rest_qr > 0 THEN
                v_rest_method := 'qr_digital';
            ELSE
                v_rest_method := 'cash';
            END IF;
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, v_rest_method, 'Food Revenue', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order payment (' || p_guest_name || ')');
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Create B2B Entries if partner restaurant is linked and there are orders
        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            -- Commissions calculations
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            -- A. Hotel Side: Record Accounts Payable (liability expense) to Restaurant
            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');
            
            -- If commission is earned, Hotel records commission income
            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            -- B. Restaurant Side: Record Accounts Receivable from Hotel
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain Discounts Expense (If applied)
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    -- PL/pgSQL automatically rolls back the transaction on exception
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
-- Add beds column to rooms table
ALTER TABLE public.rooms 
    ADD COLUMN IF NOT EXISTS beds integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.rooms.beds IS 'Number of beds in this room.';
-- Support splitting one physical table into independently-ordered, independently-paid
-- "seats" (e.g. a shared table where unrelated parties each want their own bill).
--
-- seat_number defaults to 1, so every existing session (and every session created by
-- code that doesn't know about seats yet, e.g. QR self-ordering) is "seat 1" â€” the
-- table's original, single-session behavior is unchanged. A waiter can open
-- additional seats (2, 3, ...) up to the table's capacity via the waiter panel.
ALTER TABLE "public"."sessions"
    ADD COLUMN IF NOT EXISTS "seat_number" smallint DEFAULT 1 NOT NULL;

ALTER TABLE "public"."sessions"
    ADD CONSTRAINT "sessions_seat_number_check" CHECK ("seat_number" >= 1);

-- Replace the old "one active session per table" index with "one active session per
-- table PER SEAT" so seats 1..N can each carry their own concurrent active session.
DROP INDEX IF EXISTS "public"."idx_sessions_one_active_per_table";

CREATE UNIQUE INDEX "idx_sessions_one_active_per_table_seat"
    ON "public"."sessions" USING "btree" ("table_id", "seat_number")
    WHERE ("status" = 'active'::"text");
-- Create dynamic pricing rules table
CREATE TABLE IF NOT EXISTS public.dynamic_pricing_rules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    rule_name text NOT NULL,
    rule_type text NOT NULL CHECK (rule_type IN ('weekend', 'occupancy')),
    multiplier numeric NOT NULL DEFAULT 1.0,
    occupancy_threshold_pct numeric CHECK (occupancy_threshold_pct >= 0 AND occupancy_threshold_pct <= 100),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.dynamic_pricing_rules ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY "Enable read for authenticated users" 
ON public.dynamic_pricing_rules FOR SELECT TO authenticated USING (true);

-- Insert/Update policies
CREATE POLICY "Enable write for authenticated staff" 
ON public.dynamic_pricing_rules FOR ALL TO authenticated USING (
    restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid
);

-- Deliberately seeds nothing.
--
-- This migration used to insert an active 'Weekend Premium (1.1x)' rule for
-- every restaurant. Creating a table is a schema change; silently raising every
-- tenant's weekend prices by 10% is a business decision, and a migration is the
-- wrong place to make one on an owner's behalf â€” nobody reviewing a schema diff
-- expects prices to move. Production was migrated table-only for exactly that
-- reason, so seeding here would also put every fresh environment out of step
-- with it.
--
-- A venue that wants weekend pricing creates the rule from Admin, where the
-- multiplier is visible and can be turned off again.
-- Add loyalty points column to customer credit accounts
ALTER TABLE public.customer_credit_accounts 
ADD COLUMN IF NOT EXISTS loyalty_points numeric DEFAULT 0.0 NOT NULL;

-- Create loyalty points ledger table
CREATE TABLE IF NOT EXISTS public.loyalty_ledger (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.customer_credit_accounts(id) ON DELETE CASCADE,
    points_changed numeric NOT NULL,
    type text NOT NULL CHECK (type IN ('earn', 'redeem', 'refund')),
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY "Enable read for authenticated users" 
ON public.loyalty_ledger FOR SELECT TO authenticated USING (true);

-- Insert/Update policies
CREATE POLICY "Enable write for authenticated staff" 
ON public.loyalty_ledger FOR ALL TO authenticated USING (
    restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid
);
-- Add toggle columns for tenant link features
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS link_allow_folio_charges boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS link_allow_loyalty_sharing boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS link_allow_credit_sharing boolean NOT NULL DEFAULT true;

-- Create partner link requests table for simple one-computer handshake
CREATE TABLE IF NOT EXISTS public.partner_link_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    receiver_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.partner_link_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users" 
ON public.partner_link_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable write for authenticated staff" 
ON public.partner_link_requests FOR ALL TO authenticated USING (
    sender_id = (auth.jwt() ->> 'restaurant_id')::uuid OR
    receiver_id = (auth.jwt() ->> 'restaurant_id')::uuid
);
-- Update settle_booking_checkout_v2 to prevent false bank entries on the restaurant side when hotel QR is scanned
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_number text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_settled_now numeric,
    p_new_paid_amount numeric,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_sid uuid;
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    -- 1. Row Locking for serialization
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- 2. Lock orders matching booking or session to prevent race conditions
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids 
    FROM (
        SELECT id 
        FROM public.orders 
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Update Bookings Status
    UPDATE public.bookings 
    SET status = 'checked_out' 
    WHERE id = p_booking_id;

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items 
        SET status = 'served' 
        WHERE order_id = ANY(v_order_ids) 
        AND status != 'cancelled';

        UPDATE public.orders 
        SET status = 'delivered', payment_status = 'paid', paid_at = now() 
        WHERE id = ANY(v_order_ids) 
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and Close Sessions
    UPDATE public.sessions 
    SET status = 'closed', closed_at = now() 
    WHERE (id = p_session_id OR booking_id = p_booking_id) 
    AND status = 'active';

    -- 6. Snapshot Linked Tenant IDs historically on Invoices/Orders/Sessions
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders 
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id 
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_booking_id;

    UPDATE public.sessions 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_session_id OR booking_id = p_booking_id;

    -- 7. Persist booking financial totals
    UPDATE public.bookings 
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty
    UPDATE public.rooms 
    SET status = 'dirty' 
    WHERE id = p_room_id;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        -- Post Hotel stays directly under Hotel books
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Post Restaurant Portion under Restaurant's Ledger.
        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- We record it under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id, 
                NULL, 
                v_total_rest_paid, 
                'cash', -- Cash ledger entry so it does NOT affect restaurant bank account statements
                'Accounts Receivable from Hotel', 
                'order_payment', 
                'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Create B2B Entries if partner restaurant is linked and there are orders
        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            -- Commissions calculations
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            -- A. Hotel Side: Record Accounts Payable (liability expense) to Restaurant
            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');
            
            -- If commission is earned, Hotel records commission income
            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            -- B. Restaurant Side: Record Accounts Receivable from Hotel
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain Discounts Expense (If applied)
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
-- Add IRD API credentials columns to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS ird_api_url text,
ADD COLUMN IF NOT EXISTS ird_api_user text,
ADD COLUMN IF NOT EXISTS ird_api_password text;
-- Create IRD Billing Sync Logs Table for Nepal CBMS compliance
CREATE TABLE IF NOT EXISTS public.ird_sync_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    invoice_number text NOT NULL,
    buyer_pan text,
    total_amount numeric(10,2) NOT NULL,
    taxable_amount numeric(10,2) NOT NULL,
    vat_amount numeric(10,2) NOT NULL,
    sync_status text NOT NULL DEFAULT 'pending', -- 'synced', 'failed', 'pending'
    sync_response text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Index for scanning and retrying failed/pending sync logs
CREATE INDEX IF NOT EXISTS idx_ird_sync_logs_status ON public.ird_sync_logs(restaurant_id, sync_status);

-- Enable RLS
ALTER TABLE public.ird_sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Enable all actions for authenticated users belonging to the restaurant"
    ON public.ird_sync_logs FOR ALL
    TO authenticated
    USING (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid)
    WITH CHECK (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid);

-- Restaurant-level network printer configuration for auto-print (KOT / BOT /
-- bill).
--
-- Until now the printer a station prints to was chosen per-device and kept in
-- the browser's localStorage (see src/lib/stores/printerSettings.ts) â€” correct
-- for a USB printer physically wired to one till. A LAN printer, however, has a
-- stable IP reachable from every device on the restaurant's network, so it
-- belongs to the restaurant, not to one screen: configure the IP once here and
-- every kitchen tab can auto-print to it.
--
-- The app is cloud-hosted (Vercel) and cannot reach a private 192.168.x.x
-- printer, so printing still happens client-side through QZ Tray running on a
-- machine inside the restaurant's LAN â€” this table only stores *which* printer
-- (host:port + role); QZ Tray opens the actual socket. Kitchen/waiter/cashier
-- staff therefore need SELECT so their screen can resolve the target; only a
-- manager (or super_admin) may add/edit printers.

CREATE TABLE IF NOT EXISTS "public"."printers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "printer_type" "text" DEFAULT 'network'::"text" NOT NULL,
    "ip_address" "text",
    "port" integer DEFAULT 9100 NOT NULL,
    "role" "text" NOT NULL,
    "paper_width" "text" DEFAULT '80mm'::"text" NOT NULL,
    "copies" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "printers_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "printers_printer_type_check" CHECK (("printer_type" = ANY (ARRAY['network'::"text", 'usb'::"text"]))),
    CONSTRAINT "printers_role_check" CHECK (("role" = ANY (ARRAY['kot'::"text", 'bot'::"text", 'bill'::"text"]))),
    CONSTRAINT "printers_paper_width_check" CHECK (("paper_width" = ANY (ARRAY['58mm'::"text", '80mm'::"text"]))),
    CONSTRAINT "printers_port_check" CHECK ((("port" >= 1) AND ("port" <= 65535))),
    CONSTRAINT "printers_copies_check" CHECK ((("copies" >= 1) AND ("copies" <= 9))),
    -- A network printer is useless without somewhere to send bytes.
    CONSTRAINT "printers_network_requires_ip" CHECK ((("printer_type" <> 'network'::"text") OR ("ip_address" IS NOT NULL)))
);


ALTER TABLE "public"."printers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_unique_name" UNIQUE ("restaurant_id", "name");


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;


-- One default per (restaurant, role) at most â€” the auto-print resolver picks the
-- default when several printers share a role. Partial unique index so multiple
-- non-default printers are fine.
CREATE UNIQUE INDEX IF NOT EXISTS "printers_one_default_per_role"
    ON "public"."printers" ("restaurant_id", "role")
    WHERE ("is_default" IS TRUE);


CREATE INDEX IF NOT EXISTS "printers_restaurant_role_idx"
    ON "public"."printers" ("restaurant_id", "role")
    WHERE ("is_active" IS TRUE);


ALTER TABLE "public"."printers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_manage_printers" ON "public"."printers"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));


CREATE POLICY "staff_read_printers" ON "public"."printers"
    FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));


GRANT ALL ON TABLE "public"."printers" TO "anon";
GRANT ALL ON TABLE "public"."printers" TO "authenticated";
GRANT ALL ON TABLE "public"."printers" TO "service_role";
-- Half/full-plate (variation) support for takeout & delivery orders.
--
-- Dine-in place_order() already honours a per-item variation_id: it prices the
-- chosen variation, validates it belongs to the item, stores
-- order_items.menu_item_variation_id, and deducts the variation-specific recipe
-- (see 20260709181000_recipe_resolution_and_variation_checks.sql).
--
-- place_takeout_order() and place_delivery_order() never received that update â€”
-- they priced every line at get_effective_price(menu_item_id) (the FULL base
-- price) and ignored variation_id entirely. A customer who selected "Half" for
-- takeout/delivery saw the half price in the cart but was charged full price,
-- the kitchen ticket carried no half/full label, and variation-specific
-- ingredient deduction was skipped. This brings both RPCs to parity with
-- place_order(): variation pricing + validation, menu_item_variation_id storage,
-- and resolve_recipe_rows()-based deduction. Signatures are unchanged.

CREATE OR REPLACE FUNCTION "public"."place_delivery_order"("p_restaurant_id" "uuid", "p_items" "jsonb", "p_customer_name" "text", "p_customer_phone" "text", "p_delivery_address" "text", "p_customer_email" "text" DEFAULT NULL::"text", "p_customer_note" "text" DEFAULT NULL::"text", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_variant_id UUID;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_recipe RECORD;
  v_existing RECORD;
  v_restaurant_active BOOLEAN;
  v_code TEXT := lpad((floor(random() * 10000))::int::text, 4, '0');
BEGIN
  SELECT (is_active AND NOT COALESCE(is_suspended, false)) INTO v_restaurant_active
  FROM restaurants WHERE id = p_restaurant_id;

  IF NOT FOUND OR NOT v_restaurant_active THEN
    RAISE EXCEPTION 'INVALID_RESTAURANT: Restaurant % is not available', p_restaurant_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, total_amount, delivery_verification_code INTO v_existing
    FROM orders WHERE client_request_id = p_client_request_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('order_id', v_existing.id, 'total', COALESCE(v_existing.total_amount, 0),
        'code', v_existing.delivery_verification_code, 'duplicate', true);
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = p_restaurant_id;

  INSERT INTO orders (
    session_id, restaurant_id, order_type, customer_note,
    customer_name, customer_phone, customer_email,
    delivery_address, delivery_verification_code,
    loyalty_member_id, client_request_id
  ) VALUES (
    NULL, p_restaurant_id, 'delivery', p_customer_note,
    p_customer_name, p_customer_phone, p_customer_email,
    p_delivery_address, v_code,
    p_loyalty_member_id, p_client_request_id
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID AND restaurant_id = p_restaurant_id AND is_available = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    v_variant_id := (v_item->>'variation_id')::UUID;

    -- Pricing: variation price if one was chosen (validated against the item),
    -- otherwise the base effective price.
    IF v_variant_id IS NOT NULL THEN
      SELECT price INTO v_effective_price
      FROM menu_item_variations
      WHERE id = v_variant_id AND menu_item_id = v_menu_item.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VARIATION_UNAVAILABLE: Variation % is not available for item %', v_variant_id, v_menu_item.name;
      END IF;
    ELSE
      v_effective_price := public.get_effective_price(v_menu_item.id);
    END IF;

    IF v_menu_item.stock_count IS NOT NULL THEN
      IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
      END IF;
      UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
    END IF;

    -- Variation-specific recipe first, falling back to the parent item recipe.
    FOR v_recipe IN SELECT * FROM public.resolve_recipe_rows(v_menu_item.id, v_variant_id) LOOP
      UPDATE ingredients
      SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
      WHERE id = v_recipe.ingredient_id;
      INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
      VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
    END LOOP;

    INSERT INTO order_items (order_id, menu_item_id, menu_item_variation_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, v_variant_id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;

    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;

    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);
        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo FROM promo_codes
    WHERE restaurant_id = p_restaurant_id AND code = UPPER(TRIM(p_promo_code)) AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;
      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;

  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);

  UPDATE orders
  SET subtotal_amount = v_subtotal, discount_amount = v_discount, promo_code_id = v_promo_id,
      tax_amount = v_tax, total_amount = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'tax', v_tax, 'total', v_subtotal - v_discount + v_tax, 'code', v_code
  );
END;
$$;


CREATE OR REPLACE FUNCTION "public"."place_takeout_order"("p_restaurant_id" "uuid", "p_items" "jsonb", "p_customer_name" "text", "p_customer_phone" "text", "p_customer_email" "text" DEFAULT NULL::"text", "p_pickup_time" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_customer_note" "text" DEFAULT NULL::"text", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_variant_id UUID;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;
  v_restaurant_active BOOLEAN;
BEGIN
  SELECT (is_active AND NOT COALESCE(is_suspended, false)) INTO v_restaurant_active
  FROM restaurants WHERE id = p_restaurant_id;

  IF NOT FOUND OR NOT v_restaurant_active THEN
    RAISE EXCEPTION 'INVALID_RESTAURANT: Restaurant % is not available', p_restaurant_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = p_restaurant_id;

  INSERT INTO orders (
    session_id, restaurant_id, order_type, customer_note,
    customer_name, customer_phone, customer_email, pickup_time,
    loyalty_member_id, client_request_id
  )
  VALUES (
    NULL, p_restaurant_id, 'takeout', p_customer_note,
    p_customer_name, p_customer_phone, p_customer_email, p_pickup_time,
    p_loyalty_member_id, p_client_request_id
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = p_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    v_variant_id := (v_item->>'variation_id')::UUID;

    -- Pricing: variation price if one was chosen (validated against the item),
    -- otherwise the base effective price.
    IF v_variant_id IS NOT NULL THEN
      SELECT price INTO v_effective_price
      FROM menu_item_variations
      WHERE id = v_variant_id AND menu_item_id = v_menu_item.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VARIATION_UNAVAILABLE: Variation % is not available for item %', v_variant_id, v_menu_item.name;
      END IF;
    ELSE
      v_effective_price := public.get_effective_price(v_menu_item.id);
    END IF;

    IF v_menu_item.stock_count IS NOT NULL THEN
      IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
      END IF;
      UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
    END IF;

    -- Variation-specific recipe first, falling back to the parent item recipe.
    FOR v_recipe IN SELECT * FROM public.resolve_recipe_rows(v_menu_item.id, v_variant_id) LOOP
      UPDATE ingredients
      SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
      WHERE id = v_recipe.ingredient_id;
      INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
      VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
    END LOOP;

    INSERT INTO order_items (order_id, menu_item_id, menu_item_variation_id, quantity, unit_price, special_request)
    VALUES (v_order_id, v_menu_item.id, v_variant_id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request')
    RETURNING id INTO v_order_item_id;

    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;

    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;

        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);

        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE restaurant_id = p_restaurant_id
      AND code = UPPER(TRIM(p_promo_code))
      AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;

    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;

      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;

  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);

  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      promo_code_id   = v_promo_id,
      tax_amount      = v_tax,
      total_amount    = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;

  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config FROM loyalty_config WHERE restaurant_id = p_restaurant_id AND is_active = TRUE;
    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_dollar);
      UPDATE loyalty_members
      SET points_balance  = points_balance + v_points_earned,
          lifetime_points = lifetime_points + v_points_earned,
          lifetime_spend  = lifetime_spend + (v_subtotal - v_discount + v_tax),
          visit_count     = visit_count + 1,
          last_visit_at   = NOW(),
          tier = CASE
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.platinum_threshold THEN 'platinum'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.gold_threshold     THEN 'gold'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.silver_threshold   THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      WHERE id = p_loyalty_member_id;
      INSERT INTO loyalty_transactions (member_id, order_id, type, points, description)
      VALUES (p_loyalty_member_id, v_order_id, 'earn', v_points_earned,
        'Earned ' || v_points_earned || ' points on order ' || v_order_id::TEXT);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         v_subtotal - v_discount + v_tax,
    'points_earned', v_points_earned
  );
END;
$$;
-- Migration: Add deactivation_reason to bank_accounts
ALTER TABLE public.bank_accounts 
ADD COLUMN IF NOT EXISTS deactivation_reason text;
-- Drop the global unique constraint that restricts invoice numbers table-wide
-- and causes multi-tenant collisions (duplicate key value violates unique constraint "orders_invoice_number_key").
-- The multi-tenant constraint "uq_restaurant_invoice" on (restaurant_id, invoice_number) already exists and is sufficient.
ALTER TABLE public.orders 
DROP CONSTRAINT IF EXISTS orders_invoice_number_key;
-- 1. Add extra_hour_charge column to bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS extra_hour_charge NUMERIC NOT NULL DEFAULT 0;

-- 2. Drop the old settle_booking_checkout_v2 function to avoid overloading
DROP FUNCTION IF EXISTS public.settle_booking_checkout_v2(
    uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric
);

-- 3. Create updated settle_booking_checkout_v2 function supporting extra_hour_charge
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_number text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_settled_now numeric,
    p_new_paid_amount numeric,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_sid uuid;
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    -- 1. Row Locking for serialization
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- 2. Lock orders matching booking or session to prevent race conditions
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids 
    FROM (
        SELECT id 
        FROM public.orders 
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Update Bookings Status
    UPDATE public.bookings 
    SET status = 'checked_out' 
    WHERE id = p_booking_id;

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items 
        SET status = 'served' 
        WHERE order_id = ANY(v_order_ids) 
        AND status != 'cancelled';

        UPDATE public.orders 
        SET status = 'delivered', payment_status = 'paid', paid_at = now() 
        WHERE id = ANY(v_order_ids) 
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and Close Sessions
    UPDATE public.sessions 
    SET status = 'closed', closed_at = now() 
    WHERE (id = p_session_id OR booking_id = p_booking_id) 
    AND status = 'active';

    -- 6. Snapshot Linked Tenant IDs historically on Invoices/Orders/Sessions
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders 
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id 
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_booking_id;

    UPDATE public.sessions 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_session_id OR booking_id = p_booking_id;

    -- 7. Persist booking financial totals
    UPDATE public.bookings 
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0)
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty
    UPDATE public.rooms 
    SET status = 'dirty' 
    WHERE id = p_room_id;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        -- Post Hotel stays directly under Hotel books
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Post Restaurant Portion under Restaurant's Ledger.
        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- We record it under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id, 
                NULL, 
                v_total_rest_paid, 
                'cash', -- Cash ledger entry so it does NOT affect restaurant bank account statements
                'Accounts Receivable from Hotel', 
                'order_payment', 
                'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Create B2B Entries if partner restaurant is linked and there are orders
        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            -- Commissions calculations
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            -- A. Hotel Side: Record Accounts Payable (liability expense) to Restaurant
            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');
            
            -- If commission is earned, Hotel records commission income
            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            -- B. Restaurant Side: Record Accounts Receivable from Hotel
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain Discounts Expense (If applied)
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    -- 11. Extra Hour Charge Income (If applied)
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
-- Lets a category be a subcategory of another (e.g. "Grocery" as the main
-- category, with "Vegetables" / "Fruits" / "Dairy & Eggs" as its children) â€”
-- one level deep, self-referencing on the same shared expense_categories
-- table used by Expenses, Suppliers, and Ingredients/Stock.
ALTER TABLE "public"."expense_categories"
    ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "public"."expense_categories"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_categories_parent_id ON "public"."expense_categories"("parent_id");

NOTIFY pgrst, 'reload schema';
-- Per-item order confirmation: QR self-ordered items start hidden from the
-- kitchen until a cashier reviews and confirms them (Cashier "Order
-- Confirmation" panel). Confirmation is item-granular so a cashier can
-- confirm some items now and leave the rest pending for later, or delete an
-- item before it's ever sent to the kitchen (no stock ever touched for it).
ALTER TABLE "public"."order_items"
    ADD COLUMN IF NOT EXISTS "needs_confirmation" boolean NOT NULL DEFAULT false;

-- EOD report line for the value of that day's cancelled orders (posted as
-- "Order Cancellation" expenses) â€” surfaced alongside the existing
-- total_cancelled count.
ALTER TABLE "public"."eod_reports"
    ADD COLUMN IF NOT EXISTS "total_cancellation_cost" numeric(12,2) DEFAULT 0 NOT NULL;

-- Item-scoped counterpart to deduct_ingredients_for_order() â€” deduction is
-- deferred from order-placement time to confirmation time for QR
-- self-orders, so only items a cashier actually confirms consume stock.
CREATE OR REPLACE FUNCTION "public"."deduct_ingredients_for_order_items"("p_order_item_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_item     RECORD;
    v_recipe   RECORD;
    v_consumed NUMERIC;
BEGIN
    FOR v_item IN
        SELECT id, order_id, menu_item_id, menu_item_variation_id, quantity
        FROM   order_items
        WHERE  id = ANY(p_order_item_ids)
    LOOP
        FOR v_recipe IN SELECT * FROM public.resolve_recipe_rows(v_item.menu_item_id, v_item.menu_item_variation_id)
        LOOP
            v_consumed := v_recipe.quantity_needed * v_item.quantity;

            UPDATE ingredients
            SET    stock_quantity = GREATEST(0, stock_quantity - v_consumed),
                   updated_at    = now()
            WHERE  id = v_recipe.ingredient_id;

            INSERT INTO ingredient_movements
                (ingredient_id, movement_type, quantity, reference_id, performed_by)
            VALUES
                (v_recipe.ingredient_id, 'usage', v_consumed, v_item.order_id, NULL);
        END LOOP;
    END LOOP;
END;
$$;

-- place_order() gains p_needs_confirmation: when true, order_items and the
-- parent order are flagged needs_confirmation and the stock/recipe
-- deduction blocks are skipped entirely (deferred to
-- deduct_ingredients_for_order_items(), called at cashier-confirm time).
-- Default is false, so every existing caller (waiter/staff order placement)
-- is unaffected â€” only the QR self-order checkout flow passes true.
--
-- Adding a parameter via CREATE OR REPLACE creates a new overload rather
-- than replacing the existing 7-arg function (Postgres matches on the full
-- argument signature), which leaves two ambiguous candidates for any named
-- RPC call that omits p_needs_confirmation. Drop the old signature first.
DROP FUNCTION IF EXISTS "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text", "p_seat_id" "uuid", "p_promo_code" "text", "p_loyalty_member_id" "uuid", "p_client_request_id" "text");

CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text", "p_seat_id" "uuid" DEFAULT NULL::"uuid", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text", "p_needs_confirmation" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;

  -- Combo-specific variables
  v_combo_part RECORD;
  v_constituent_item menu_items%ROWTYPE;
  v_variant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = v_restaurant_id;

  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id, loyalty_member_id, client_request_id, needs_confirmation)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id, p_loyalty_member_id, p_client_request_id, p_needs_confirmation)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Item % is unavailable', v_item->>'menu_item_id';
    END IF;

    v_variant_id := (v_item->>'variation_id')::UUID;

    -- Pricing: Use variation price if passed, otherwise fall back to base effective price.
    -- The variation must belong to the item being ordered â€” otherwise fail loudly
    -- instead of silently producing a NULL price/total.
    IF v_variant_id IS NOT NULL THEN
      SELECT price INTO v_effective_price
      FROM menu_item_variations
      WHERE id = v_variant_id AND menu_item_id = v_menu_item.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VARIATION_UNAVAILABLE: Variation % is not available for item %', v_variant_id, v_menu_item.name;
      END IF;
    ELSE
      v_effective_price := public.get_effective_price(v_menu_item.id);
    END IF;

    -- Stock and Recipe Deduction â€” skipped entirely when the item is left
    -- awaiting cashier confirmation; deduct_ingredients_for_order_items()
    -- performs it later, scoped to just the items actually confirmed.
    IF NOT p_needs_confirmation THEN
      IF v_menu_item.is_combo THEN
        FOR v_combo_part IN
          SELECT item_id, quantity FROM public.combo_items WHERE combo_id = v_menu_item.id
        LOOP
          SELECT * INTO v_constituent_item FROM public.menu_items WHERE id = v_combo_part.item_id FOR UPDATE;

          IF v_constituent_item.stock_count IS NOT NULL THEN
            IF v_constituent_item.stock_count < (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT) THEN
              RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item % in combo %', v_constituent_item.name, v_menu_item.name;
            END IF;
            UPDATE public.menu_items
            SET stock_count = stock_count - (v_combo_part.quantity * (v_item->>'quantity')::SMALLINT)
            WHERE id = v_constituent_item.id;
          END IF;

          FOR v_recipe IN SELECT r.ingredient_id, r.quantity_needed FROM recipes r WHERE r.menu_item_id = v_constituent_item.id LOOP
            UPDATE ingredients
            SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
            WHERE id = v_recipe.ingredient_id;

            INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
            VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * v_combo_part.quantity * (v_item->>'quantity')::SMALLINT), v_order_id);
          END LOOP;
        END LOOP;
      ELSE
        IF v_menu_item.stock_count IS NOT NULL THEN
          IF v_menu_item.stock_count < (v_item->>'quantity')::SMALLINT THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: Insufficient stock for item %', v_menu_item.name;
          END IF;
          UPDATE menu_items SET stock_count = stock_count - (v_item->>'quantity')::SMALLINT WHERE id = v_menu_item.id;
        END IF;

        -- Match variation-specific recipe first, then fallback to parent menu item recipe
        FOR v_recipe IN SELECT * FROM public.resolve_recipe_rows(v_menu_item.id, v_variant_id)
        LOOP
          UPDATE ingredients
          SET stock_quantity = stock_quantity - (v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), updated_at = NOW()
          WHERE id = v_recipe.ingredient_id;

          INSERT INTO ingredient_movements (ingredient_id, movement_type, quantity, reference_id)
          VALUES (v_recipe.ingredient_id, 'usage', -(v_recipe.quantity_needed * (v_item->>'quantity')::SMALLINT), v_order_id);
        END LOOP;
      END IF;
    END IF;

    INSERT INTO order_items (order_id, menu_item_id, menu_item_variation_id, quantity, unit_price, special_request, needs_confirmation)
    VALUES (v_order_id, v_menu_item.id, v_variant_id, (v_item->>'quantity')::SMALLINT, v_effective_price, v_item->>'special_request', p_needs_confirmation)
    RETURNING id INTO v_order_item_id;

    v_item_total := v_effective_price * (v_item->>'quantity')::SMALLINT;
    IF v_item ? 'modifiers' AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers') LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID AND is_available = TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'MODIFIER_UNAVAILABLE: Modifier % is unavailable', v_modifier->>'modifier_id';
        END IF;
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_adjustment)
        VALUES (v_order_item_id, v_mod_record.id, v_mod_record.name, v_mod_record.price_adjustment);
        v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::SMALLINT);
      END LOOP;
    END IF;
    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE restaurant_id = v_restaurant_id
      AND code = UPPER(TRIM(p_promo_code))
      AND is_active = TRUE
      AND (valid_until IS NULL OR valid_until > NOW())
      AND (max_uses IS NULL OR current_uses < max_uses)
      AND min_order_amount <= v_subtotal
    FOR UPDATE;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      CASE v_promo.promo_type
        WHEN 'percentage_off' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
          IF v_promo.max_discount_amount IS NOT NULL THEN v_discount := LEAST(v_discount, v_promo.max_discount_amount); END IF;
        WHEN 'amount_off' THEN v_discount := LEAST(v_promo.value, v_subtotal);
        WHEN 'free_item' THEN
          IF v_promo.free_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.free_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
        WHEN 'bogo' THEN
          IF v_promo.bogo_get_item_id IS NOT NULL THEN
            SELECT price INTO v_discount FROM menu_items WHERE id = v_promo.bogo_get_item_id;
            v_discount := COALESCE(v_discount, 0);
          END IF;
      END CASE;
      INSERT INTO order_promos (order_id, promo_code_id, code_used, discount_amount)
      VALUES (v_order_id, v_promo_id, v_promo.code, v_discount);
      UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
    END IF;
  END IF;

  -- Calculate taxes and totals
  v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);

  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      tax_amount = v_tax,
      total_amount = v_subtotal - v_discount + v_tax
  WHERE id = v_order_id;

  -- Loyalty points
  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config FROM loyalty_config WHERE restaurant_id = v_restaurant_id AND is_active = TRUE;
    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_dollar);
      UPDATE loyalty_members
      SET points_balance  = points_balance + v_points_earned,
          lifetime_points = lifetime_points + v_points_earned,
          lifetime_spend  = lifetime_spend + (v_subtotal - v_discount + v_tax),
          visit_count     = visit_count + 1,
          last_visit_at   = NOW(),
          tier = CASE
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.platinum_threshold THEN 'platinum'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.gold_threshold     THEN 'gold'
            WHEN lifetime_points + v_points_earned >= v_loyalty_config.silver_threshold   THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      WHERE id = p_loyalty_member_id;
      INSERT INTO loyalty_transactions (member_id, order_id, type, points, description)
      VALUES (p_loyalty_member_id, v_order_id, 'earn', v_points_earned,
        'Earned ' || v_points_earned || ' points on order ' || v_order_id::TEXT);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         v_subtotal - v_discount + v_tax,
    'points_earned', v_points_earned
  );
END;
$$;
-- Create a partial index on order_items where needs_confirmation is true
-- to optimize query performance for the waiter/cashier order confirmation flow.
CREATE INDEX IF NOT EXISTS "idx_order_items_needs_confirmation" 
    ON "public"."order_items" ("order_id") 
    WHERE ("needs_confirmation" = true);
-- Repair bookings whose check-in/check-out were stored 5h45m late.
--
-- src/app/api/bookings/route.ts used to do `new Date(check_in).toISOString()`
-- on a naive `YYYY-MM-DDTHH:mm` value coming from an <input type="datetime-local">.
-- A string with no zone resolves against the *runtime's* zone, and that route
-- executes on Vercel in UTC - so the Kathmandu wall-clock time the staff member
-- typed was stored as though it were UTC, i.e. exactly +05:45 too late. A stay
-- booked at 2:42 PM was recorded, and displayed back, as 8:27 PM.
--
-- The route now anchors the offset (see nepalInputToISO in src/lib/utils.ts).
-- This migration corrects the rows already written by the broken path.
--
-- Scope is deliberately narrow. Only rows created from 2026-07-20 onwards whose
-- check_in sits 5.6-5.8h after their own created_at are touched: those are the
-- "book now" defaults, where the shift provably reconciles check_in back to the
-- moment the booking was actually created. Earlier bookings predate the
-- regression and several of them are already correct, so shifting those would
-- introduce the very error this fixes.
--
-- check_in and check_out move together, so stay length - and therefore every
-- nightly charge derived from it - is unchanged.
--
-- Idempotent: after the shift the drift is ~0, so the predicate no longer
-- matches and a re-run is a no-op.

UPDATE "public"."bookings"
SET "check_in"  = "check_in"  - interval '5 hours 45 minutes',
    "check_out" = "check_out" - interval '5 hours 45 minutes'
WHERE "created_at" >= '2026-07-20'::timestamptz
  AND extract(epoch FROM ("check_in" - "created_at")) / 3600 BETWEEN 5.6 AND 5.8;
-- Enable Realtime replication for `rooms` and `bookings`.
--
-- CashierClient and CashierRoomManager have always carried working
-- subscriptions for these two tables - patching room status, appending new
-- bookings, syncing the open billing stay. Neither table was ever added to the
-- `supabase_realtime` publication, so those handlers could never receive a
-- payload: the hotel side of the app looked live but was static until a manual
-- refresh. Two cashiers could each see the same room as vacant and both try to
-- book it, with the bookings_no_overlapping_active_stays constraint surfacing
-- as a raw error at submit instead of the room greying out on the second
-- terminal.
--
-- REPLICA IDENTITY FULL matches every other table the app subscribes to
-- (orders, sessions, tables, service_requests, users). It is what puts the
-- pre-image in the WAL, so DELETE events can be matched against the
-- `restaurant_id=eq.<id>` filter the shared channel applies, and so handlers
-- can read `payload.old`. Both tables are low-write - a room's status changes a
-- handful of times a day - so the extra WAL volume is negligible.
--
-- RLS needs no change: staff_read_rooms / staff_read_bookings already gate on
-- `restaurant_id = current_restaurant_id()`, and both that and current_app_role
-- are STABLE wrappers over auth.jwt(), which Realtime evaluates per subscriber.

ALTER TABLE ONLY "public"."rooms" REPLICA IDENTITY FULL;
ALTER TABLE ONLY "public"."bookings" REPLICA IDENTITY FULL;

-- Idempotent: ALTER PUBLICATION ... ADD TABLE errors if the table is already a
-- member, which would break a replay onto an environment that has them.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'
    ) THEN
        ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."rooms";
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings'
    ) THEN
        ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bookings";
    END IF;
END
$$;
-- Bring payment_verifications in line with every other table the app
-- subscribes to.
--
-- It is the one replicated table still on REPLICA IDENTITY DEFAULT, which puts
-- only the primary key in the WAL pre-image. Two consequences: `payload.old` is
-- unusable, and DELETE events cannot be matched against the shared channel's
-- `restaurant_id=eq.<id>` filter, so they are dropped before they reach a
-- subscriber.
--
-- Nothing is broken today - PaymentVerificationPanel and PaymentVerificationFeed
-- only handle INSERT and UPDATE, both of which carry a full new record. This is
-- pre-emptive: the next handler to branch on a delete, or to read a previous
-- value to decide whether a claim moved out of "pending", would fail silently
-- rather than loudly, which is the hard kind of realtime bug to find.
--
-- Payment claims are low-volume, so the extra WAL is immaterial.

ALTER TABLE ONLY "public"."payment_verifications" REPLICA IDENTITY FULL;
-- Two related additions to a stay: who is in the room, and which rooms the
-- stay has occupied over time.

-- â”€â”€ 1. Guest mix â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- `adults` held a single head count, so a booking could not record that a party
-- of four is two men and two women â€” which front desks need for room allocation
-- and which Nepali hotels record for the police/tourist register.
--
-- `adults` is kept as the adult total rather than replaced: it is NOT NULL, it
-- is read elsewhere, and existing rows have no split to derive. The API writes
-- adults = adult_male + adult_female from here on. Legacy rows keep their total
-- with a 0/0 split, and the UI shows a plain "N adults" for those rather than
-- inventing a breakdown.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "adult_male"   integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "adult_female" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."bookings"
    DROP CONSTRAINT IF EXISTS "bookings_guest_mix_non_negative";
ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "bookings_guest_mix_non_negative"
    CHECK ("adult_male" >= 0 AND "adult_female" >= 0 AND "children" >= 0);

COMMENT ON COLUMN "public"."bookings"."adult_male" IS
    'Adult male guests. 0 on bookings made before the split existed â€” read `adults` for the total.';
COMMENT ON COLUMN "public"."bookings"."adult_female" IS
    'Adult female guests. 0 on bookings made before the split existed â€” read `adults` for the total.';

-- â”€â”€ 2. Room move history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- A stay could only ever name one room (bookings.room_id), so moving a guest
-- meant overwriting it and losing the fact they had been anywhere else. The
-- folio reads the nightly rate live from whatever room the booking currently
-- points at, so an overwrite silently re-priced every night of the stay â€”
-- including nights already spent in the cheaper room.
--
-- One row per room the stay has occupied. `to_ts` NULL marks the room the guest
-- is in now; bookings.room_id still points at that same room, so every existing
-- reader (the room QR resolver, the room board, checkout) keeps working
-- unchanged and this table is consulted only where per-night rates are built.
CREATE TABLE IF NOT EXISTS "public"."booking_room_stays" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" uuid NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "booking_id"    uuid NOT NULL REFERENCES "public"."bookings"("id")    ON DELETE CASCADE,
    "room_id"       uuid NOT NULL REFERENCES "public"."rooms"("id")       ON DELETE RESTRICT,
    -- When the guest entered this room. The first segment starts at check-in.
    "from_ts"       timestamptz NOT NULL,
    -- When they left it. NULL means "still here".
    "to_ts"         timestamptz,
    "moved_by"      uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "reason"        text,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "booking_room_stays_period_valid" CHECK ("to_ts" IS NULL OR "to_ts" > "from_ts")
);

CREATE INDEX IF NOT EXISTS "booking_room_stays_booking_idx"
    ON "public"."booking_room_stays" ("booking_id", "from_ts");

-- A stay is in exactly one room at a time, so at most one open segment.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_room_stays_one_open_per_booking"
    ON "public"."booking_room_stays" ("booking_id")
    WHERE "to_ts" IS NULL;

-- Backfill: every stay that exists today has occupied exactly its current room,
-- from check-in until now. Without this the folio would find no segment for
-- older bookings and fall back to the whole-stay rate.
INSERT INTO "public"."booking_room_stays" ("restaurant_id", "booking_id", "room_id", "from_ts", "to_ts")
SELECT b."restaurant_id", b."id", b."room_id", b."check_in", NULL
FROM "public"."bookings" b
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."booking_room_stays" s WHERE s."booking_id" = b."id"
);

ALTER TABLE "public"."booking_room_stays" ENABLE ROW LEVEL SECURITY;

-- Mirrors the bookings policies: staff of the owning restaurant read and write,
-- and a linked partner restaurant may read (it bills room-service to the stay).
DROP POLICY IF EXISTS "staff_manage_booking_room_stays" ON "public"."booking_room_stays";
CREATE POLICY "staff_manage_booking_room_stays" ON "public"."booking_room_stays"
    FOR ALL USING (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    );

DROP POLICY IF EXISTS "staff_read_booking_room_stays" ON "public"."booking_room_stays";
CREATE POLICY "staff_read_booking_room_stays" ON "public"."booking_room_stays"
    FOR SELECT USING ("restaurant_id" = "public"."current_restaurant_id"());

DROP POLICY IF EXISTS "partner_restaurant_read_booking_room_stays" ON "public"."booking_room_stays";
CREATE POLICY "partner_restaurant_read_booking_room_stays" ON "public"."booking_room_stays"
    FOR SELECT TO "authenticated" USING (
        "restaurant_id" IN (
            SELECT "restaurants"."linked_hotel_id" FROM "public"."restaurants"
            WHERE "restaurants"."id" = "public"."current_restaurant_id"()
        )
    );

COMMENT ON TABLE "public"."booking_room_stays" IS
    'One row per room a stay has occupied. to_ts NULL = current room. Drives per-night rates when a guest is moved mid-stay.';
-- Make a printed kitchen ticket a piece of state rather than a side effect of a
-- realtime event.
--
-- Auto-print was driven entirely by postgres_changes: a station printed an
-- order because it happened to be subscribed the instant the row was inserted.
-- Realtime is at-most-once and only while you are listening, so no tab open, a
-- wifi blip or a sleeping laptop meant the ticket simply never existed, with
-- nothing recording that it should have. That is fine for refreshing a UI (a
-- missed update self-corrects on the next fetch) and wrong for a physical,
-- one-shot side effect: a missed ticket is a dish that never gets cooked.
--
-- kot_printed_at moves that fact onto the row. A station claims lines
-- atomically, so two open tabs cannot print the same ones, and anything still
-- unclaimed is outstanding work any station can pick up whenever it connects.
-- Granularity is per item, not per order, because a QR self-order is confirmed
-- in batches and each batch prints only its own new lines.

ALTER TABLE "public"."order_items"
    ADD COLUMN IF NOT EXISTS "kot_printed_at" timestamptz;

-- Everything that exists today has already been printed (or is long past
-- mattering). Without this backfill the first station to connect after this
-- migration would treat the entire order history as outstanding and print it.
UPDATE "public"."order_items" SET "kot_printed_at" = now() WHERE "kot_printed_at" IS NULL;

-- The outstanding-work query is "unprinted lines, newest orders first", so index
-- only the unprinted rows. The set is near-empty in steady state, which keeps
-- this tiny no matter how large order_items grows.
CREATE INDEX IF NOT EXISTS "order_items_unprinted_idx"
    ON "public"."order_items" ("order_id")
    WHERE "kot_printed_at" IS NULL;

-- Claim lines for printing, returning only the ids this caller won.
--
-- The UPDATE ... WHERE kot_printed_at IS NULL ... RETURNING is the whole
-- concurrency story: row locks serialise two stations racing for the same
-- lines, and the loser's WHERE no longer matches, so it gets back an empty set
-- and prints nothing. Callers must print exactly what is returned.
--
-- SECURITY DEFINER because staff hold read-only RLS on order_items; the
-- restaurant check below is what stops it becoming a cross-tenant write.
CREATE OR REPLACE FUNCTION "public"."claim_order_items_for_printing"("p_item_ids" "uuid"[])
    RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_restaurant_id UUID := current_restaurant_id();
BEGIN
    IF v_restaurant_id IS NULL OR p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE order_items oi
       SET kot_printed_at = now()
      FROM orders o
     WHERE oi.order_id = o.id
       AND oi.id = ANY(p_item_ids)
       AND oi.kot_printed_at IS NULL
       AND o.restaurant_id = v_restaurant_id
    RETURNING oi.id;
END;
$$;

-- Hand a claim back when the ticket never made it onto paper, so the lines stay
-- outstanding for the next attempt instead of being lost to a claim that
-- printed nothing. Scoped the same way as the claim.
CREATE OR REPLACE FUNCTION "public"."release_order_item_print_claim"("p_item_ids" "uuid"[])
    RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_restaurant_id UUID := current_restaurant_id();
BEGIN
    IF v_restaurant_id IS NULL OR p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    UPDATE order_items oi
       SET kot_printed_at = NULL
      FROM orders o
     WHERE oi.order_id = o.id
       AND oi.id = ANY(p_item_ids)
       AND o.restaurant_id = v_restaurant_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."claim_order_items_for_printing"("uuid"[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION "public"."release_order_item_print_claim"("uuid"[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."claim_order_items_for_printing"("uuid"[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION "public"."release_order_item_print_claim"("uuid"[]) TO authenticated, service_role;

-- Version deliberately matches the version this was recorded under when applied
-- to production (supabase_migrations.schema_migrations), so a later db push
-- skips it. Re-running would be worse than a no-op: the DDL is guarded, but the
-- backfill above would stamp genuinely-unprinted lines as printed and swallow
-- exactly the tickets this migration exists to guarantee.
-- Create system_advertisements table
CREATE TABLE IF NOT EXISTS public.system_advertisements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    badge TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    cta TEXT NOT NULL,
    link TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.system_advertisements ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users and public visitors can read advertisements
CREATE POLICY "Allow public select on system_advertisements" ON public.system_advertisements
    FOR SELECT USING (true);

-- RLS Policy: Super Admins can manage advertisements (Insert, Update, Delete)
CREATE POLICY "Allow super admin full control on system_advertisements" ON public.system_advertisements
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid() AND r.name = 'super_admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid() AND r.name = 'super_admin'
        )
    );

-- Seed initial default advertisements
INSERT INTO public.system_advertisements (badge, title, description, cta, link)
VALUES
    ('NEW INTEGRATION', 'Supercharge Room Bookings with Booking.com Sync', 'Connect your hotel rooms directory directly to online travel agents for automatic real-time rate updates and zero overbookings.', 'Connect Channels', '/admin/settings'),
    ('HARDWARE CORNER', 'Auto-Print KOTs to Your Thermal Printer', 'Point your 80mm LAN printer at the cashier counter and KOT tickets print the moment an order is confirmed. No manual reprints.', 'Set Up Printer', '/admin/printers'),
    ('SRMS PLATINUM', 'Auto-Backup Data to Google Drive & Dropbox', 'Never worry about server outages or laptop loss. Keep encrypted hourly database backups synced automatically to your own cloud storage.', 'Enable Backups', '/admin/profile')
ON CONFLICT DO NOTHING;
-- One guest, several rooms.
--
-- Until now a stay was one room: `bookings.room_id` is NOT NULL and singular,
-- so a family taking three rooms had to be entered as three unrelated stays.
-- The front desk then had no way to see they belonged together, and the guest
-- got three separate bills at checkout.
--
-- The fix is a reservation header rather than a rewrite of `bookings`.
-- `bookings.room_id` is load-bearing in ~50 call sites â€” the in-room QR
-- resolver, the room board, the per-room EXCLUDE overlap constraint, the room
-- move history in `booking_room_stays`, and the checkout RPC all key off it.
-- Exploding it into a join table would touch every one of them.
--
-- So each room keeps its own `bookings` row, exactly as before, and a
-- `booking_groups` row ties them together. Every existing reader keeps working
-- untouched; only the places that bill or display a stay learn about groups.
-- A single-room booking has `group_id` NULL and behaves as it always has.

CREATE TABLE IF NOT EXISTS "public"."booking_groups" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" uuid NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    -- The person the whole reservation is under. Copied onto each member
    -- booking too, so anything reading a single booking (the room QR page, the
    -- kitchen ticket) still finds a guest name without joining up to the group.
    "guest_name"    text NOT NULL,
    "guest_phone"   text,
    "guest_email"   text,
    -- The group's shared stay window. Member bookings carry their own copies of
    -- these; these are the values the booking form applied to every room, kept
    -- so the header still reads correctly if one room is later extended.
    "check_in"      timestamptz NOT NULL,
    "check_out"     timestamptz NOT NULL,
    "notes"         text,
    "created_by"    uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "booking_groups_dates_check" CHECK ("check_out" > "check_in"),
    CONSTRAINT "booking_groups_guest_name_check"
        CHECK (char_length("guest_name") >= 1 AND char_length("guest_name") <= 200)
);

CREATE INDEX IF NOT EXISTS "booking_groups_restaurant_idx"
    ON "public"."booking_groups" ("restaurant_id", "check_in");

-- NULL = an ordinary one-room stay, which is every booking that exists today.
-- ON DELETE SET NULL rather than CASCADE: dropping a reservation header must
-- never take real stay records (and their revenue history) with it.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "group_id" uuid
    REFERENCES "public"."booking_groups"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "bookings_group_id_idx"
    ON "public"."bookings" ("group_id")
    WHERE "group_id" IS NOT NULL;

COMMENT ON TABLE "public"."booking_groups" IS
    'A reservation covering several rooms for one guest. Member rooms are ordinary bookings rows with group_id set; they bill as one combined folio and check out together.';
COMMENT ON COLUMN "public"."bookings"."group_id" IS
    'The multi-room reservation this stay belongs to, or NULL for a normal single-room stay.';

ALTER TABLE "public"."booking_groups" ENABLE ROW LEVEL SECURITY;

-- Mirrors the bookings policies exactly: staff of the owning restaurant read
-- and write, anyone in the restaurant reads, and a linked partner restaurant
-- may read (it bills room-service against member stays).
DROP POLICY IF EXISTS "staff_manage_booking_groups" ON "public"."booking_groups";
CREATE POLICY "staff_manage_booking_groups" ON "public"."booking_groups"
    FOR ALL USING (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    ) WITH CHECK (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    );

DROP POLICY IF EXISTS "staff_read_booking_groups" ON "public"."booking_groups";
CREATE POLICY "staff_read_booking_groups" ON "public"."booking_groups"
    FOR SELECT USING ("restaurant_id" = "public"."current_restaurant_id"());

DROP POLICY IF EXISTS "partner_restaurant_read_booking_groups" ON "public"."booking_groups";
CREATE POLICY "partner_restaurant_read_booking_groups" ON "public"."booking_groups"
    FOR SELECT TO "authenticated" USING (
        "restaurant_id" IN (
            SELECT "restaurants"."linked_hotel_id" FROM "public"."restaurants"
            WHERE "restaurants"."id" = "public"."current_restaurant_id"()
        )
    );
-- Settling a multi-room reservation in one transaction.
--
-- settle_booking_checkout_v2 closes exactly one booking and posts one set of
-- ledger entries for it. Calling it once per room in a group would be wrong on
-- both counts: the rooms would check out in separate transactions (so a failure
-- half-way leaves a guest checked out of two rooms and still in the third), and
-- one payment would be posted to the day book several times over.
--
-- This is the group equivalent. It locks every member booking up front, closes
-- them together, and posts the ledger ONCE for the reservation's combined
-- total. Per-room financial figures still land on each booking row â€” the caller
-- passes an allocation in p_bookings so total_amount/paid_amount/discount stay
-- meaningful per room for revenue reporting, while the guest pays once.
--
-- p_bookings is a jsonb array; one element per room:
--   { "booking_id": uuid, "room_id": uuid, "total_amount": numeric,
--     "paid_amount": numeric, "discount_amount": numeric }

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb,
    p_restaurant_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_label text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_already_out text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    -- 1. Lock every member booking before touching anything, so two cashiers
    -- settling the same reservation serialize instead of double-posting.
    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    -- The whole reservation settles or none of it does: if any room was already
    -- closed out, abort rather than partially re-settling the rest.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_out
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_out IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already checked out: room ' || v_already_out
        );
    END IF;

    -- 2. Lock orders reachable from any member booking or the active session
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id
        FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = ANY(v_booking_ids)
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close every member booking
    UPDATE public.bookings
    SET status = 'checked_out'
    WHERE id = ANY(v_booking_ids);

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now()
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and close sessions belonging to any room in the group
    UPDATE public.sessions
    SET status = 'closed', closed_at = now()
    WHERE (id = p_session_id OR booking_id = ANY(v_booking_ids))
    AND status = 'active';

    -- 6. Snapshot linked tenant IDs historically
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = ANY(v_booking_ids);

    -- 7. Persist each room's own share of the settlement. The reservation was
    -- paid once, but splitting the figures back out per room keeps revenue-by-
    -- room reporting truthful instead of dumping the whole bill on one room.
    -- The extra-hour charge rides on the first room only, so summing member
    -- rows still reproduces the reservation total exactly.
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0)
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- 8. Every room in the group goes to housekeeping
    UPDATE public.rooms
    SET status = 'dirty'
    WHERE id = ANY(v_room_ids);

    -- 9. Post ledger entries ONCE for the whole reservation, labelled with every
    -- room it covered. Identical in structure to settle_booking_checkout_v2 â€”
    -- only the amounts are the group's combined figures.
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- Recorded under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain discount expense, once for the reservation
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    -- 11. Extra hour charge income, once for the reservation
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
-- post_payment_income_sql opens a day-book session when none is currently open,
-- and inserted `CURRENT_DATE::text` into day_book_sessions.date, which is a
-- `date` column. Postgres does not implicitly cast text to date on INSERT, so
-- that statement raises:
--
--     column "date" is of type date but expression is of type text
--
-- The function is called by every checkout path (settle_booking_checkout_v2,
-- settle_booking_group_checkout, table settlement), each of which wraps it in
-- `EXCEPTION WHEN OTHERS` â€” so the failure surfaced as a generic "Checkout
-- transaction failed" rather than pointing at the cast. It only bites when
-- there is no open session to reuse, which is why it survived: in day-to-day
-- use a session is almost always already open.
--
-- Introduced in 20260714110000_advanced_tenant_integration.sql. Only the cast
-- changes here; the rest of the body is reproduced verbatim.

CREATE OR REPLACE FUNCTION public.post_payment_income_sql(
    p_restaurant_id uuid,
    p_user_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_category_name text,
    p_day_book_category text,
    p_desc text
) RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_category_id uuid;
    v_bank_id uuid;
    v_session_id uuid;
    v_bank_name text;
    v_day_book_type text;
BEGIN
    IF p_amount <= 0 THEN
        RETURN;
    END IF;

    -- A. Resolve or create income category
    SELECT id INTO v_category_id FROM public.income_categories WHERE restaurant_id = p_restaurant_id AND name = p_category_name LIMIT 1;
    IF v_category_id IS NULL THEN
        INSERT INTO public.income_categories (restaurant_id, name)
        VALUES (p_restaurant_id, p_category_name)
        RETURNING id INTO v_category_id;
    END IF;

    -- B. Resolve default active bank account for digital payment methods
    IF p_payment_method IN ('qr_digital', 'card') THEN
        SELECT id, name INTO v_bank_id, v_bank_name FROM public.bank_accounts WHERE restaurant_id = p_restaurant_id AND is_active = true LIMIT 1;
    END IF;

    -- C. Insert Income Entry
    INSERT INTO public.income_entries (restaurant_id, category_id, amount, description, bank_account_id, status, created_by)
    VALUES (p_restaurant_id, v_category_id, p_amount, p_desc, v_bank_id, 'posted', p_user_id);

    -- D. Resolve or create active Day Book Session
    SELECT id INTO v_session_id FROM public.day_book_sessions WHERE restaurant_id = p_restaurant_id AND status = 'open' LIMIT 1;
    IF v_session_id IS NULL THEN
        INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
        VALUES (p_restaurant_id, CURRENT_DATE, 0.00, 0.00, 'open', p_user_id)
        RETURNING id INTO v_session_id;
    END IF;

    -- E. Insert Day Book Entry
    IF p_payment_method = 'cash' THEN
        v_day_book_type := 'cash_in';
    ELSE
        v_day_book_type := 'bank_in';
    END IF;

    INSERT INTO public.day_book_entries (session_id, restaurant_id, type, amount, description, category, bank_name, created_by)
    VALUES (v_session_id, p_restaurant_id, v_day_book_type, p_amount, p_desc, p_day_book_category, v_bank_name, p_user_id);
END;
$$;
-- When the guest actually left, as opposed to when they were due to.
--
-- `check_out` is the scheduled departure agreed at booking. Nothing recorded
-- the real one, so an overstay was invisible to billing â€” the folio priced the
-- stay from the scheduled window no matter how long past it the guest stayed,
-- and the only recourse was a manual "extra hour charge" the cashier typed in
-- from memory.
--
-- Billing a late departure needs the actual moment, and it has to be stored
-- rather than read from the clock: the folio is recomputed after checkout (the
-- receipt email does exactly this), so a now()-based overstay would keep
-- growing and the emailed bill would disagree with the amount charged.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "checked_out_at" timestamptz;

COMMENT ON COLUMN "public"."bookings"."checked_out_at" IS
    'When the guest actually departed (settlement time). NULL while in house, and on stays checked out before this column existed â€” the folio treats that NULL as "left on time" so historical bills never re-price.';

-- Stamped by a trigger rather than by each caller. Three separate paths close a
-- booking today â€” settle_booking_checkout_v2, settle_booking_group_checkout,
-- and the non-invoice branch of /api/bookings/checkout â€” and a fourth would be
-- easy to add without noticing this column. Missing the stamp is silent and
-- expensive: the folio would fall back to reading the clock and re-price a
-- settled stay every time the receipt was regenerated.
--
-- An explicit value always wins, so a caller that wants to record a departure
-- other than "now" (a correction, an import) still can.
CREATE OR REPLACE FUNCTION "public"."stamp_booking_checked_out_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'checked_out'
       AND OLD."status" IS DISTINCT FROM 'checked_out'
       AND NEW."checked_out_at" IS NULL
    THEN
        NEW."checked_out_at" := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_stamp_checked_out_at" ON "public"."bookings";
CREATE TRIGGER "bookings_stamp_checked_out_at"
    BEFORE UPDATE ON "public"."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."stamp_booking_checked_out_at"();
-- Write the module flags that provisioning never wrote.
--
-- features_v2 is built from TIER_FEATURES (src/lib/tiers.ts), which had no
-- entry for staffManagementEnabled, tableManagementEnabled or financeEnabled.
-- So those keys were *absent* rather than set, on every restaurant ever
-- created. The server read an absent key as "off" and redirected away from the
-- page, while the client read the same absent key as "on" and rendered a nav
-- link to it â€” a link straight to a redirect. Upgrading the plan did not help,
-- because changing the subscription tier only ever wrote the seat/table caps.
--
-- The application now resolves an absent flag from the plan, so this backfill
-- is not strictly required for the app to behave. It is here so the stored row
-- says what is actually true: anything reading settings directly, a support
-- engineer looking at the table, or a future code path that forgets to call the
-- resolver, all see the same answer the app does.
--
-- Mirrors applyTierModuleDefaults() exactly:
--   * staff/table management are core â€” default on where absent
--   * accounting is opt-in â€” default off where absent, and revoked outright
--     below Premium, which preserves the old downgrade protection
--   * an explicitly stored value is never overwritten while the plan allows it
UPDATE public.settings s
SET features_v2 = s.features_v2 || jsonb_build_object(
        'staffManagementEnabled',
            COALESCE((s.features_v2 ->> 'staffManagementEnabled')::boolean, true),
        'tableManagementEnabled',
            COALESCE((s.features_v2 ->> 'tableManagementEnabled')::boolean, true),
        'financeEnabled',
            CASE
                WHEN r.subscription_tier IN ('premium', 'platinum', 'enterprise')
                    THEN COALESCE((s.features_v2 ->> 'financeEnabled')::boolean, false)
                ELSE false
            END
    )
FROM public.restaurants r
WHERE r.id = s.restaurant_id
  AND s.features_v2 IS NOT NULL
  AND (
        NOT (s.features_v2 ? 'staffManagementEnabled')
     OR NOT (s.features_v2 ? 'tableManagementEnabled')
     OR NOT (s.features_v2 ? 'financeEnabled')
     -- Also correct a stored finance flag the plan no longer entitles.
     OR (    (s.features_v2 ->> 'financeEnabled')::boolean IS TRUE
         AND r.subscription_tier NOT IN ('premium', 'platinum', 'enterprise'))
  );
-- Recognising a returning guest at the front desk.
--
-- Re-registering someone who has stayed before meant retyping their name, phone
-- and citizenship/passport number from scratch, with no sign they were a repeat
-- visitor at all. Their history is already in the system â€” 41 stays across 36
-- distinct phone numbers on production today â€” it just was not reachable while
-- filling the form.
--
-- Two problems to solve: finding the guest quickly, and returning one row per
-- person rather than one per stay.

-- â”€â”€ Indexes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Nothing indexed guest_phone or customer_phone, so any prefix lookup was a
-- sequential scan of every booking in the tenant. text_pattern_ops is required
-- for LIKE 'prefix%' to use a btree at all under a non-C collation.
CREATE INDEX IF NOT EXISTS "bookings_restaurant_guest_phone_idx"
    ON "public"."bookings" ("restaurant_id", "guest_phone" text_pattern_ops);

CREATE INDEX IF NOT EXISTS "bookings_restaurant_guest_name_idx"
    ON "public"."bookings" ("restaurant_id", lower("guest_name") text_pattern_ops);

CREATE INDEX IF NOT EXISTS "cca_restaurant_customer_phone_idx"
    ON "public"."customer_credit_accounts" ("restaurant_id", "customer_phone" text_pattern_ops);

-- â”€â”€ Lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- One row per guest, not per stay. Aggregating in the database rather than the
-- route means a single round trip and no guessing at how many stay rows to pull
-- back before the distinct guests run out â€” a guest with forty visits would
-- otherwise crowd every other match out of the page.
--
-- The caller is responsible for scoping p_restaurant_id to the signed-in user's
-- own restaurant; this is guest PII and must never span tenants. The API route
-- passes its own session's restaurant id and never accepts one from the client.
CREATE OR REPLACE FUNCTION "public"."search_guest_history"(
    p_restaurant_id uuid,
    p_query text,
    p_limit integer DEFAULT 8
) RETURNS TABLE (
    guest_phone   text,
    guest_name    text,
    guest_email   text,
    kyc           text,
    visits        bigint,
    last_stay_at  timestamptz,
    loyalty_points integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
STABLE
AS $$
    WITH needle AS (
        SELECT lower(btrim(p_query)) AS q
    ),
    -- Every stay matching the typed text, by phone prefix or anywhere in the
    -- name. Phone is a prefix match because that is how a number is dialled and
    -- typed; a name is matched loosely since the desk may enter a surname.
    matched AS (
        SELECT
            b.guest_phone,
            b.guest_name,
            b.guest_email,
            -- KYC is stored as a 'KYC: <value>' prefix on notes (see
            -- /api/bookings). Strip the label back off so it can repopulate the
            -- field it came from.
            NULLIF(regexp_replace(COALESCE(b.notes, ''), '^KYC:\s*', ''), '') AS kyc,
            b.check_in,
            b.created_at
        FROM public.bookings b, needle n
        WHERE b.restaurant_id = p_restaurant_id
          AND b.guest_phone IS NOT NULL
          AND btrim(b.guest_phone) <> ''
          AND (
                b.guest_phone LIKE n.q || '%'
             OR lower(b.guest_name) LIKE '%' || n.q || '%'
          )
    ),
    -- Collapse to one row per phone. The most recent stay supplies the details,
    -- so a guest who has since corrected their name or email is offered the
    -- corrected version rather than whatever they first gave.
    ranked AS (
        SELECT
            m.*,
            row_number() OVER (PARTITION BY m.guest_phone ORDER BY m.created_at DESC) AS rn,
            count(*)     OVER (PARTITION BY m.guest_phone) AS visit_count,
            max(m.check_in) OVER (PARTITION BY m.guest_phone) AS latest_stay
        FROM matched m
    )
    SELECT
        r.guest_phone,
        r.guest_name,
        r.guest_email,
        r.kyc,
        r.visit_count,
        r.latest_stay,
        -- Loyalty balance if this guest also has a CRM record, so the desk can
        -- see standing without a second lookup.
        (SELECT c.loyalty_points
           FROM public.customer_credit_accounts c
          WHERE c.restaurant_id = p_restaurant_id
            AND c.customer_phone = r.guest_phone
          LIMIT 1)
    FROM ranked r
    WHERE r.rn = 1
    ORDER BY r.latest_stay DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 25));
$$;

COMMENT ON FUNCTION "public"."search_guest_history"(uuid, text, integer) IS
    'One row per returning guest matching a phone prefix or name fragment, newest details first. Caller must scope p_restaurant_id to the signed-in user''s restaurant â€” this returns guest PII.';
-- Close every room's own QR session when a multi-room reservation settles.
--
-- settle_booking_group_checkout closed sessions matching `id = p_session_id OR
-- booking_id = ANY(member bookings)`. Neither reaches the sibling rooms: the
-- caller only ever knows the session of the room the cashier clicked, and a
-- room's in-room QR session never gets `sessions.booking_id` stamped â€” an order
-- placed from the room carries the booking on the ORDER row, not the session
-- (see the note in lib/folio.ts). So rooms 306 and 307 of a settled reservation
-- kept an "active" session after checkout, and the next guest's scan joined the
-- previous guest's tab.
--
-- Matching on the rooms themselves closes them: every session sitting on a
-- table belonging to a room that just checked out is done, by definition.
-- Everything else about the function is unchanged from
-- 20260727130000_settle_booking_group_checkout.sql.

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb,
    p_restaurant_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_label text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_already_out text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    -- 1. Lock every member booking before touching anything, so two cashiers
    -- settling the same reservation serialize instead of double-posting.
    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    -- The whole reservation settles or none of it does: if any room was already
    -- closed out, abort rather than partially re-settling the rest.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_out
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_out IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already checked out: room ' || v_already_out
        );
    END IF;

    -- 2. Lock orders reachable from any member booking or the active session
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id
        FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close every member booking
    UPDATE public.bookings
    SET status = 'checked_out'
    WHERE id = ANY(v_booking_ids);

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now()
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and close sessions belonging to any room in the group. The
    -- table_id clause is what catches the rooms the caller didn't name.
    UPDATE public.sessions
    SET status = 'closed', closed_at = now()
    WHERE (
        id = p_session_id
        OR booking_id = ANY(v_booking_ids)
        OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
    )
    AND status = 'active';

    -- 6. Snapshot linked tenant IDs historically
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids));

    -- 7. Persist each room's own share of the settlement. The reservation was
    -- paid once, but splitting the figures back out per room keeps revenue-by-
    -- room reporting truthful instead of dumping the whole bill on one room.
    -- The extra-hour charge rides on the first room only, so summing member
    -- rows still reproduces the reservation total exactly.
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0)
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- 8. Every room in the group goes to housekeeping
    UPDATE public.rooms
    SET status = 'dirty'
    WHERE id = ANY(v_room_ids);

    -- 9. Post ledger entries ONCE for the whole reservation, labelled with every
    -- room it covered. Identical in structure to settle_booking_checkout_v2 â€”
    -- only the amounts are the group's combined figures.
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- Recorded under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain discount expense, once for the reservation
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    -- 11. Extra hour charge income, once for the reservation
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
-- Restores the service_charge_amount column on orders, which the app code
-- (and the 20260708150000 baseline schema) already assumes exists but was
-- never applied here â€” the original addition lived only in
-- migrations_archive/20260704120000_add_service_charge.sql.
ALTER TABLE "public"."orders"
    ADD COLUMN IF NOT EXISTS "service_charge_amount" numeric(15,2) DEFAULT 0.00 NOT NULL;
-- Migration to track individual advance payment transactions with cashier notes and timestamps
CREATE TABLE IF NOT EXISTS "public"."booking_payments" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL REFERENCES "public"."restaurants"("id") ON DELETE CASCADE,
    "booking_id" UUID NOT NULL REFERENCES "public"."bookings"("id") ON DELETE CASCADE,
    "amount" NUMERIC(12, 2) NOT NULL CHECK ("amount" > 0),
    "payment_method" TEXT NOT NULL DEFAULT 'cash',
    "cash_amount" NUMERIC(12, 2) DEFAULT 0,
    "qr_amount" NUMERIC(12, 2) DEFAULT 0,
    "note" TEXT DEFAULT 'Advance',
    "created_at" TIMESTAMPTZ DEFAULT now(),
    -- public.users, not auth.users: every route writing this passes
    -- currentUser.id, which is the app user row (same id as the auth user, but
    -- this is the table the rest of the schema points at â€” see
    -- bookings_cashier_id_fkey).
    "created_by" UUID REFERENCES "public"."users"("id") ON DELETE SET NULL
);

-- Index for fast lookup by booking_id and restaurant_id
CREATE INDEX IF NOT EXISTS "idx_booking_payments_booking_id" ON "public"."booking_payments"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_booking_payments_restaurant_id" ON "public"."booking_payments"("restaurant_id");

-- Enable RLS
ALTER TABLE "public"."booking_payments" ENABLE ROW LEVEL SECURITY;

-- RLS policies.
--
-- These read the caller's tenant from current_restaurant_id()/current_app_role(),
-- the helpers every other table in this schema uses. The original pair selected
-- from a `public.profiles` table that does not exist here â€” that made the whole
-- migration unapplyable, which is why this table was missing from production
-- while the routes writing to it silently swallowed the failed inserts.
DROP POLICY IF EXISTS "staff_manage_booking_payments" ON "public"."booking_payments";
CREATE POLICY "staff_manage_booking_payments" ON "public"."booking_payments"
    FOR ALL USING (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    ) WITH CHECK (
        "public"."current_app_role"() = ANY (ARRAY['manager', 'super_admin', 'cashier', 'waiter'])
        AND "restaurant_id" = "public"."current_restaurant_id"()
    );

DROP POLICY IF EXISTS "staff_read_booking_payments" ON "public"."booking_payments";
CREATE POLICY "staff_read_booking_payments" ON "public"."booking_payments"
    FOR SELECT USING ("restaurant_id" = "public"."current_restaurant_id"());
-- Update place_order function to allow ordering on active sessions OR room-linked sessions
CREATE OR REPLACE FUNCTION "public"."place_order"("p_session_id" "uuid", "p_items" "jsonb", "p_customer_note" "text" DEFAULT NULL::"text", "p_seat_id" "uuid" DEFAULT NULL::"uuid", "p_promo_code" "text" DEFAULT NULL::"text", "p_loyalty_member_id" "uuid" DEFAULT NULL::"uuid", "p_client_request_id" "text" DEFAULT NULL::"text", "p_needs_confirmation" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_restaurant_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_subtotal NUMERIC(10,2) := 0;
  v_order_item_id UUID;
  v_modifier JSONB;
  v_mod_record menu_item_modifiers%ROWTYPE;
  v_item_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_promo RECORD;
  v_promo_id UUID := NULL;
  v_discount NUMERIC(10,2) := 0;
  v_tax_rate NUMERIC(6,2) := 0;
  v_tax NUMERIC(10,2) := 0;
  v_loyalty_config RECORD;
  v_points_earned INTEGER := 0;
  v_recipe RECORD;
  v_existing RECORD;

  -- Combo-specific variables
  v_combo_part RECORD;
  v_constituent_item menu_items%ROWTYPE;
  v_variant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND (status = 'active' OR booking_id IS NOT NULL) AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, subtotal_amount, discount_amount, tax_amount, total_amount
      INTO v_existing
    FROM orders
    WHERE client_request_id = p_client_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',      v_existing.id,
        'subtotal',      COALESCE(v_existing.subtotal_amount, 0),
        'discount',      COALESCE(v_existing.discount_amount, 0),
        'tax',           COALESCE(v_existing.tax_amount, 0),
        'total',         COALESCE(v_existing.total_amount, 0),
        'points_earned', 0,
        'duplicate',     true
      );
    END IF;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = v_restaurant_id;

  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id, loyalty_member_id, client_request_id, needs_confirmation)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id, p_loyalty_member_id, p_client_request_id, p_needs_confirmation)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item->>'menu_item_id')::UUID
      AND restaurant_id = v_restaurant_id
      AND is_available = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: Item % is not available', (v_item->>'menu_item_id');
    END IF;

    -- Standard single menu item resolution
    IF (v_item->>'variation_id') IS NOT NULL AND (v_item->>'variation_id') != '' THEN
      SELECT v.id, v.price INTO v_variant_id, v_effective_price
      FROM menu_item_variations v
      WHERE v.id = (v_item->>'variation_id')::UUID
        AND v.menu_item_id = v_menu_item.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VARIATION_NOT_FOUND: Variation % not valid for item %', (v_item->>'variation_id'), v_menu_item.id;
      END IF;
    ELSE
      v_variant_id := NULL;
      v_effective_price := v_menu_item.price;
    END IF;

    v_item_total := v_effective_price * (v_item->>'quantity')::INT;

    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request, status, menu_item_variation_id, needs_confirmation)
    VALUES (
      v_order_id,
      v_menu_item.id,
      (v_item->>'quantity')::INT,
      v_effective_price,
      v_item->>'special_request',
      CASE WHEN p_needs_confirmation THEN 'pending'::order_item_status ELSE 'sent_to_kitchen'::order_item_status END,
      v_variant_id,
      p_needs_confirmation
    )
    RETURNING id INTO v_order_item_id;

    IF v_item->'modifiers' IS NOT NULL AND jsonb_array_length(v_item->'modifiers') > 0 THEN
      FOR v_modifier IN SELECT * FROM jsonb_array_elements(v_item->'modifiers')
      LOOP
        SELECT * INTO v_mod_record
        FROM menu_item_modifiers
        WHERE id = (v_modifier->>'modifier_id')::UUID;

        IF FOUND THEN
          INSERT INTO order_item_modifiers (order_item_id, modifier_id, price_adjustment)
          VALUES (v_order_item_id, v_mod_record.id, v_mod_record.price_adjustment);

          v_item_total := v_item_total + (v_mod_record.price_adjustment * (v_item->>'quantity')::INT);
        END IF;
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_item_total;
  END LOOP;

  IF p_promo_code IS NOT NULL AND p_promo_code != '' THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE code = UPPER(p_promo_code)
      AND restaurant_id = v_restaurant_id
      AND is_active = true
      AND (valid_until IS NULL OR valid_until > NOW());

    IF FOUND THEN
      v_promo_id := v_promo.id;
      IF v_promo.discount_type = 'percentage' THEN
        v_discount := (v_subtotal * v_promo.discount_percent / 100);
      ELSIF v_promo.discount_type = 'fixed' THEN
        v_discount := LEAST(v_promo.discount_amount, v_subtotal);
      END IF;
    END IF;
  END IF;

  v_tax := ((v_subtotal - v_discount) * v_tax_rate / 100);

  IF p_loyalty_member_id IS NOT NULL THEN
    SELECT * INTO v_loyalty_config
    FROM loyalty_program_configs
    WHERE restaurant_id = v_restaurant_id AND is_active = true;

    IF FOUND THEN
      v_points_earned := FLOOR((v_subtotal - v_discount) * v_loyalty_config.points_per_currency);
      IF v_points_earned > 0 THEN
        UPDATE loyalty_members
        SET total_points = total_points + v_points_earned,
            updated_at = NOW()
        WHERE id = p_loyalty_member_id;

        INSERT INTO loyalty_transactions (member_id, restaurant_id, points, type, description)
        VALUES (p_loyalty_member_id, v_restaurant_id, v_points_earned, 'earned', 'Points earned for Order #' || LEFT(v_order_id::TEXT, 8));
      END IF;
    END IF;
  END IF;

  UPDATE orders
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      tax_amount = v_tax,
      total_amount = (v_subtotal - v_discount + v_tax),
      promo_code_id = v_promo_id
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'subtotal',      v_subtotal,
    'discount',      v_discount,
    'tax',           v_tax,
    'total',         (v_subtotal - v_discount + v_tax),
    'points_earned', v_points_earned
  );
END;
$$;
-- Migration: Embed booking_id in receivable_transactions description JSON on room checkout

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_restaurant_id UUID,
    p_session_id UUID,
    p_hotel_cash NUMERIC,
    p_hotel_qr NUMERIC,
    p_hotel_credit NUMERIC,
    p_rest_cash NUMERIC,
    p_rest_qr NUMERIC,
    p_rest_credit NUMERIC,
    p_discount_amount NUMERIC,
    p_discount_reason TEXT,
    p_hotel_credit_account_id UUID,
    p_guest_name TEXT,
    p_user_id UUID,
    p_partner_restaurant_id UUID DEFAULT NULL,
    p_payment_status TEXT DEFAULT 'paid',
    p_authoritative_total NUMERIC DEFAULT 0,
    p_orders_total NUMERIC DEFAULT 0,
    p_ledger_split_mode TEXT DEFAULT 'direct',
    p_commission_rate NUMERIC DEFAULT 0,
    p_extra_hour_charge NUMERIC DEFAULT 0,
    p_room_label TEXT DEFAULT '',
    p_bookings JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_booking_ids UUID[];
    v_room_ids UUID[];
    v_order_ids UUID[];
    v_already_out TEXT;
    v_alloc JSONB;
    v_total_rest_paid NUMERIC;
    v_commission_amount NUMERIC;
    v_net_to_restaurant NUMERIC;
BEGIN
    SELECT array_agg((elem->>'id')::uuid)
    INTO v_booking_ids
    FROM jsonb_array_elements(p_bookings) elem;

    IF v_booking_ids IS NULL OR array_length(v_booking_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings provided for checkout');
    END IF;

    SELECT array_agg(DISTINCT room_id)
    INTO v_room_ids
    FROM public.bookings
    WHERE id = ANY(v_booking_ids) AND room_id IS NOT NULL;

    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_out
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_out IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already checked out: room ' || v_already_out
        );
    END IF;

    SELECT array_agg(DISTINCT id)
    INTO v_order_ids
    FROM public.orders
    WHERE (
        booking_id = ANY(v_booking_ids)
        OR session_id = p_session_id
        OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        )
    )
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now()
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    UPDATE public.sessions
    SET status = 'closed', closed_at = now()
    WHERE (
        id = p_session_id
        OR booking_id = ANY(v_booking_ids)
        OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
    )
    AND status = 'active';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            status = 'checked_out',
            checked_out_at = now()
        WHERE id = (v_alloc->>'id')::uuid;
    END LOOP;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id,
                p_hotel_credit_account_id,
                'charge',
                p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', v_booking_ids,
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted',
                p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id,
                p_hotel_credit_account_id,
                'charge',
                p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', v_booking_ids,
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted',
                p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(
            p_restaurant_id,
            p_user_id,
            p_discount_amount,
            'Bargain Discount Expense',
            'Staff Bargain Discount: Guest ' || p_guest_name || ' (Rooms ' || p_room_label || ') - Reason: ' || COALESCE(NULLIF(p_discount_reason, ''), 'Unspecified'),
            'posted'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_ids', v_booking_ids,
        'order_ids', v_order_ids
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;
-- Stamps the bill itself with the staff member who settled it.
--
-- Until now a checkout's operator only survived on the rows it happened to
-- write on the side â€” payment_verifications.staff_verified_by, the day book /
-- income entry's created_by, the audit log â€” so "who billed this order?" could
-- only be answered by joining back through those. orders already names the
-- waiter and the chef; this gives it the cashier too, and gives bookings the
-- same for a room settlement.
--
-- Deliberately nullable with no backfill: every pre-existing paid row was
-- settled by someone unknown to the schema, and inventing an id for them would
-- be worse than an honest NULL.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cashier_id uuid;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS cashier_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_cashier_id_fkey') THEN
        ALTER TABLE public.orders
            ADD CONSTRAINT orders_cashier_id_fkey FOREIGN KEY (cashier_id)
            REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cashier_id_fkey') THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_cashier_id_fkey FOREIGN KEY (cashier_id)
            REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Partial: the vast majority of rows are unsettled or legacy, and every query
-- that reaches for this column ("what did cashier X bill today?") filters on a
-- non-null value.
CREATE INDEX IF NOT EXISTS orders_cashier_id_idx
    ON public.orders USING btree (cashier_id) WHERE cashier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_cashier_id_idx
    ON public.bookings USING btree (cashier_id) WHERE cashier_id IS NOT NULL;

COMMENT ON COLUMN public.orders.cashier_id IS
    'Staff member who settled this order at checkout. NULL for unsettled orders and for anything paid before this column existed.';

COMMENT ON COLUMN public.bookings.cashier_id IS
    'Staff member who settled this stay at checkout. NULL while in house, and for anything checked out before this column existed.';
-- Stamps orders.cashier_id / bookings.cashier_id inside the room-checkout
-- transaction (columns: 20260728030000_add_cashier_id.sql).
--
-- Both RPCs already receive p_user_id â€” they use it for discount_applied_by and
-- every ledger posting â€” so the operator was always in hand here; it just never
-- landed on the bill itself. Stamping inside the RPC rather than as a follow-up
-- UPDATE keeps it in the settlement's transaction, so a settled bill can never
-- be left with a NULL cashier.
--
-- BASE VERSIONS â€” deliberately NOT the newest file on disk for the group
-- function. 20260728020000 re-defined settle_booking_group_checkout from an
-- older lineage: it drops both FOR UPDATE row locks, the rooms -> 'dirty'
-- housekeeping update and the extra-hour income posting, and it reads
-- v_alloc->>'id' while allocateAcrossRooms (api/bookings/checkout/route.ts)
-- sends 'booking_id' â€” so a group checkout would match zero booking rows and
-- silently leave every room occupied. Production runs 20260727180000, which is
-- correct and matches that route contract, so this rebuilds from it and
-- supersedes 20260728020000. The booking_id/grand_total JSON embedding that
-- 20260728020000 intended still needs redoing on this base.
--
-- Function bodies are otherwise byte-identical to:
--   v2:    20260719181300_add_booking_extra_hour_charge.sql
--   group: 20260727180000_group_checkout_closes_every_room_session.sql

CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_number text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_settled_now numeric,
    p_new_paid_amount numeric,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_sid uuid;
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    -- 1. Row Locking for serialization
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- 2. Lock orders matching booking or session to prevent race conditions
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids 
    FROM (
        SELECT id 
        FROM public.orders 
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Update Bookings Status
    UPDATE public.bookings 
    SET status = 'checked_out' 
    WHERE id = p_booking_id;

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items 
        SET status = 'served' 
        WHERE order_id = ANY(v_order_ids) 
        AND status != 'cancelled';

        UPDATE public.orders 
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id 
        WHERE id = ANY(v_order_ids) 
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and Close Sessions
    UPDATE public.sessions 
    SET status = 'closed', closed_at = now() 
    WHERE (id = p_session_id OR booking_id = p_booking_id) 
    AND status = 'active';

    -- 6. Snapshot Linked Tenant IDs historically on Invoices/Orders/Sessions
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders 
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id 
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_booking_id;

    UPDATE public.sessions 
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id 
    WHERE id = p_session_id OR booking_id = p_booking_id;

    -- 7. Persist booking financial totals
    UPDATE public.bookings 
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty
    UPDATE public.rooms 
    SET status = 'dirty' 
    WHERE id = p_room_id;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        -- Post Hotel stays directly under Hotel books
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Post Restaurant Portion under Restaurant's Ledger.
        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- We record it under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id, 
                NULL, 
                v_total_rest_paid, 
                'cash', -- Cash ledger entry so it does NOT affect restaurant bank account statements
                'Accounts Receivable from Hotel', 
                'order_payment', 
                'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        
        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Create B2B Entries if partner restaurant is linked and there are orders
        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            -- Commissions calculations
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            -- A. Hotel Side: Record Accounts Payable (liability expense) to Restaurant
            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');
            
            -- If commission is earned, Hotel records commission income
            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            -- B. Restaurant Side: Record Accounts Receivable from Hotel
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain Discounts Expense (If applied)
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    -- 11. Extra Hour Charge Income (If applied)
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb,
    p_restaurant_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_label text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_already_out text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    -- 1. Lock every member booking before touching anything, so two cashiers
    -- settling the same reservation serialize instead of double-posting.
    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    -- The whole reservation settles or none of it does: if any room was already
    -- closed out, abort rather than partially re-settling the rest.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_out
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_out IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already checked out: room ' || v_already_out
        );
    END IF;

    -- 2. Lock orders reachable from any member booking or the active session
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id
        FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close every member booking
    UPDATE public.bookings
    SET status = 'checked_out'
    WHERE id = ANY(v_booking_ids);

    -- 4. Mark matching order items as served
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and close sessions belonging to any room in the group. The
    -- table_id clause is what catches the rooms the caller didn't name.
    UPDATE public.sessions
    SET status = 'closed', closed_at = now()
    WHERE (
        id = p_session_id
        OR booking_id = ANY(v_booking_ids)
        OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
    )
    AND status = 'active';

    -- 6. Snapshot linked tenant IDs historically
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids));

    -- 7. Persist each room's own share of the settlement. The reservation was
    -- paid once, but splitting the figures back out per room keeps revenue-by-
    -- room reporting truthful instead of dumping the whole bill on one room.
    -- The extra-hour charge rides on the first room only, so summing member
    -- rows still reproduces the reservation total exactly.
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- 8. Every room in the group goes to housekeeping
    UPDATE public.rooms
    SET status = 'dirty'
    WHERE id = ANY(v_room_ids);

    -- 9. Post ledger entries ONCE for the whole reservation, labelled with every
    -- room it covered. Identical in structure to settle_booking_checkout_v2 â€”
    -- only the amounts are the group's combined figures.
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- Recorded under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain discount expense, once for the reservation
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    -- 11. Extra hour charge income, once for the reservation
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
-- Close the anon-executable SECURITY DEFINER surface.
--
-- SECURITY DEFINER runs as the owner and so bypasses RLS entirely. Every one of
-- these functions took the tenant id as a plain argument and checked nothing
-- about the caller, so anyone holding the public anon key could enumerate the
-- restaurants table and then read or write against any tenant they liked --
-- search_guest_history alone returned guest name, phone, email and KYC.
--
-- Most of them were never granted to anon at all: they simply had no ACL, and
-- Postgres grants EXECUTE to PUBLIC by default. Revoking from anon and
-- authenticated therefore does nothing on its own; PUBLIC is what has to go.
-- But dropping PUBLIC from a NULL acl materialises it as owner-only, which
-- would strip service_role too and take every server route down with it, so
-- each function is re-granted to service_role in the same breath.
--
-- Every caller of these runs server-side through createAdminClient(), i.e. as
-- service_role, which is unaffected. The only RPCs the browser makes are
-- claim_order_items_for_printing and release_order_item_print_claim (kitchen
-- and cashier ticket printing); those already carry explicit ACLs granting
-- authenticated, are not part of this set, and are named below so a future
-- re-run cannot sweep them up. custom_access_token_hook is excluded for the
-- same reason -- revoking it would break login for every tenant.
DO $$
DECLARE
    v_targets oid[];
    v_oid     oid;
    v_sig     text;
BEGIN
    SELECT array_agg(p.oid)
    INTO   v_targets
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.prosecdef
      AND  has_function_privilege('anon', p.oid, 'EXECUTE')
      AND  p.proname NOT IN (
               'claim_order_items_for_printing',
               'release_order_item_print_claim',
               'custom_access_token_hook'
           );

    IF v_targets IS NULL THEN
        RAISE NOTICE 'nothing to revoke';
        RETURN;
    END IF;

    FOREACH v_oid IN ARRAY v_targets LOOP
        v_sig := v_oid::regprocedure::text;
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', v_sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    END LOOP;

    RAISE NOTICE 'revoked PUBLIC/anon/authenticated EXECUTE on % functions', array_length(v_targets, 1);
END $$;

-- New functions default to EXECUTE for PUBLIC, which is how this happened. Stop
-- the next one from landing open.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Remembers a service charge the cashier typed over at checkout.
--
-- The folio recomputes a stay's service charge from the rules every time it is
-- asked (see computeFolioForStays: 10% of kitchen items, gated on
-- roomServiceChargeEnabled and the per-room allowlist). That is the right
-- behaviour while a guest is in house, but it means a charge the cashier
-- deliberately moved at settlement was forgotten the moment the request ended:
-- the emailed invoice and the guest-facing stay bill both rebuild the folio
-- from the database and would quote the automatic figure, disagreeing with the
-- money actually taken.
--
-- bookings.discount_amount already solves exactly this problem for the other
-- staff-applied adjustment on the same bill; this is its counterpart.
--
-- NULL means "no override" â€” the folio falls back to computing the charge, as
-- it always has. That is distinct from 0, which is a cashier deliberately
-- waiving the charge, so the column must stay nullable rather than defaulting.
-- No backfill: every stay settled before this column existed was billed at
-- whatever the rules said at the time, which is what a NULL already replays.

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS service_charge_override numeric;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_service_charge_override_non_negative'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_service_charge_override_non_negative
            CHECK (service_charge_override IS NULL OR service_charge_override >= 0);
    END IF;
END $$;

COMMENT ON COLUMN public.bookings.service_charge_override IS
    'Service charge the cashier set at checkout, replacing the figure the folio rules produce. NULL means no override (recompute from the rules); 0 means the charge was deliberately waived. Billed as the difference from the automatic figure, never on top of it.';
-- Whether a stay needs a parking space, asked at booking time.
--
-- The front desk has to know this before the guest arrives â€” the yard holds a
-- fixed number of vehicles â€” and the plate is what lets them tell one guest's
-- car from another's when one has to be moved. Both were being written into the
-- free-text `notes` field by hand, where nothing can filter or count them.
--
-- The money is deliberately NOT here. A parking fee is charged as an ordinary
-- `room_charges` row of type 'parking' (a charge_type the table has always
-- accepted), so it lands on the folio, itemizes on the bill and receipt, and is
-- refundable/editable through the same screens as any other incidental. Storing
-- an amount on the booking too would give the same fee two homes that could
-- disagree.
--
-- Defaults to false rather than NULL: every stay already on file was taken
-- without a parking request, which is exactly what false says. `false` with a
-- plate recorded is a legitimate state â€” the guest has a vehicle but wanted no
-- space reserved.

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS parking_required boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS parking_vehicle_no text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_parking_vehicle_no_length'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_parking_vehicle_no_length
            CHECK (parking_vehicle_no IS NULL OR char_length(parking_vehicle_no) <= 32);
    END IF;
END $$;

COMMENT ON COLUMN public.bookings.parking_required IS
    'Guest asked for a parking space at booking. The fee, if any, is a room_charges row of type ''parking'' â€” never stored here.';
COMMENT ON COLUMN public.bookings.parking_vehicle_no IS
    'Vehicle registration recorded at the desk, so a car can be identified without waking the guest. Optional, and valid even when parking_required is false.';

-- The desk view that matters: which cars are on the property right now.
CREATE INDEX IF NOT EXISTS bookings_parking_required_idx
    ON public.bookings USING btree (restaurant_id, status)
    WHERE parking_required;
-- Let a guest pay the bill and keep the room.
--
-- Settlement and departure were the same event: the only way to take a guest's
-- money through the folio was to check them out, which closed the stay, closed
-- the room's QR session and sent the room to housekeeping. But guests settle
-- early all the time â€” the company card is here now, the group is splitting up,
-- the guest is leaving before the desk is staffed â€” and the room is still
-- theirs until the morning. The desk's workaround was to check them out anyway
-- and re-book the room, which loses the stay's history, or to hold the money
-- off the books until they left, which misdates the revenue.
--
-- So the two events are separated. `p_close_stay` false posts every peso of the
-- settlement exactly as before â€” ledger, day book, partner split, credit,
-- discounts, orders marked paid and dropped out of the kitchen queue â€” and then
-- stops: the booking stays `checked_in`, the room stays `occupied`, and the
-- room's QR session stays open so the guest can keep ordering. What they order
-- afterwards lands on the same folio and shows up as a new balance, because
-- `paid_amount` is what settlement recorded and the folio is always recomputed
-- against it.
--
-- Passing `p_close_stay` true â€” every existing caller, by default â€” behaves
-- exactly as it did before this migration.

-- When the bill was settled ahead of departure. NULL is the ordinary case:
-- either still unsettled, or settled at checkout in the usual single step.
-- Distinct from payment_status='paid', which a stay also reaches by paying an
-- advance that happens to cover the total.
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS bill_settled_at timestamptz;

COMMENT ON COLUMN public.bookings.bill_settled_at IS
    'When the guest settled the bill without checking out. NULL means no early settlement â€” the stay is either unsettled or was settled at departure in one step. Anything charged after this timestamp reopens a balance on the same folio.';

CREATE INDEX IF NOT EXISTS bookings_bill_settled_idx
    ON public.bookings USING btree (restaurant_id, status)
    WHERE bill_settled_at IS NOT NULL;

-- Both RPCs gain a trailing parameter, so the old signatures have to go rather
-- than be replaced: a same-named overload would make every named-argument call
-- from the app ambiguous.
DROP FUNCTION IF EXISTS public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_room_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_number text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_settled_now numeric,
    p_new_paid_amount numeric,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    -- False settles the money and leaves the guest in the room. See the header.
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    -- 1. Row Locking for serialization
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- 2. Lock orders matching booking or session to prevent race conditions
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id
        FROM public.orders
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close the stay â€” skipped when the guest is only settling up.
    IF p_close_stay THEN
        UPDATE public.bookings
        SET status = 'checked_out'
        WHERE id = p_booking_id;
    END IF;

    -- 4. Mark matching order items as served. Runs either way: the guest has
    -- paid for this food, so it leaves the kitchen queue and the billing panels
    -- whether or not they are leaving the building.
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and Close Sessions. Left open on an early settlement â€” the
    -- guest still has the room, and closing their QR session would take away
    -- the ability to order anything else for the rest of the stay.
    IF p_close_stay THEN
        UPDATE public.sessions
        SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id)
        AND status = 'active';
    END IF;

    -- 6. Snapshot Linked Tenant IDs historically on Invoices/Orders/Sessions
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    -- 7. Persist booking financial totals. bill_settled_at is stamped only on an
    -- early settlement, and only the first time: a guest who settles, orders
    -- another round and settles again keeps the timestamp of the first one,
    -- which is the one that tells the desk this room has been paying as it goes.
    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = CASE
            WHEN p_close_stay THEN bill_settled_at
            ELSE COALESCE(bill_settled_at, now())
        END
    WHERE id = p_booking_id;

    -- 8. Set Room to dirty â€” only when the guest has actually left it.
    IF p_close_stay THEN
        UPDATE public.rooms
        SET status = 'dirty'
        WHERE id = p_room_id;
    END IF;

    -- 9. Post Ledger Entries based on Mode
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain Discounts Expense (If applied)
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    -- 11. Extra Hour Charge Income (If applied)
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb,
    p_restaurant_id uuid,
    p_session_id uuid,
    p_hotel_cash numeric,
    p_hotel_qr numeric,
    p_hotel_credit numeric,
    p_rest_cash numeric,
    p_rest_qr numeric,
    p_rest_credit numeric,
    p_discount_amount numeric,
    p_discount_reason text,
    p_hotel_credit_account_id uuid,
    p_room_label text,
    p_guest_name text,
    p_user_id uuid,
    p_partner_restaurant_id uuid,
    p_payment_status text,
    p_authoritative_total numeric,
    p_orders_total numeric,
    p_ledger_split_mode text,
    p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    -- False settles the money and leaves every room of the reservation
    -- occupied. See the header.
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_already_out text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    -- 1. Lock every member booking before touching anything, so two cashiers
    -- settling the same reservation serialize instead of double-posting.
    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    -- The whole reservation settles or none of it does: if any room was already
    -- closed out, abort rather than partially re-settling the rest.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_out
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_out IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already checked out: room ' || v_already_out
        );
    END IF;

    -- 2. Lock orders reachable from any member booking or the active session
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id
        FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        ))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    -- 3. Close every member booking â€” skipped when the guests are only
    -- settling up and keeping their rooms.
    IF p_close_stay THEN
        UPDATE public.bookings
        SET status = 'checked_out'
        WHERE id = ANY(v_booking_ids);
    END IF;

    -- 4. Mark matching order items as served. Runs either way â€” the food is
    -- paid for whether or not the guests are leaving.
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items
        SET status = 'served'
        WHERE order_id = ANY(v_order_ids)
        AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids)
        AND payment_status != 'paid';
    END IF;

    -- 5. Settle and close sessions belonging to any room in the group. The
    -- table_id clause is what catches the rooms the caller didn't name. Left
    -- open on an early settlement so the rooms can still order.
    IF p_close_stay THEN
        UPDATE public.sessions
        SET status = 'closed', closed_at = now()
        WHERE (
            id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids))
        )
        AND status = 'active';
    END IF;

    -- 6. Snapshot linked tenant IDs historically
    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_room_ids));

    -- 7. Persist each room's own share of the settlement. The reservation was
    -- paid once, but splitting the figures back out per room keeps revenue-by-
    -- room reporting truthful instead of dumping the whole bill on one room.
    -- The extra-hour charge rides on the first room only, so summing member
    -- rows still reproduces the reservation total exactly.
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = CASE
                WHEN p_close_stay THEN bill_settled_at
                ELSE COALESCE(bill_settled_at, now())
            END
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- 8. Every room in the group goes to housekeeping â€” only once the guests
    -- have actually left them.
    IF p_close_stay THEN
        UPDATE public.rooms
        SET status = 'dirty'
        WHERE id = ANY(v_room_ids);
    END IF;

    -- 9. Post ledger entries ONCE for the whole reservation, labelled with every
    -- room it covered. Identical in structure to settle_booking_checkout_v2 â€”
    -- only the amounts are the group's combined figures.
    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        -- Prevent false Bank-in entries when guest scans Hotel's QR code.
        -- Recorded under Accounts Receivable from Hotel (collected by hotel, pending settlement).
        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(
                p_partner_restaurant_id,
                NULL,
                v_total_rest_paid,
                'cash',
                'Accounts Receivable from Hotel',
                'order_payment',
                'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')'
            );
        END IF;

    ELSE
        -- Option B: B2B Transfer (Hotel bills everything, creates Accounts Payable to Restaurant)
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    -- 10. Bargain discount expense, once for the reservation
    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    -- 11. Extra hour charge income, once for the reservation
    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(
            p_restaurant_id,
            p_user_id,
            p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour',
            'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Recreating a function resets its ACL to the default, which on this database
-- means EXECUTE for PUBLIC â€” and both of these move money. Restore the locked
-- grants from 20260728092457: PUBLIC out, service_role (the only role the API
-- calls these as) in.
REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;
-- Let one room leave a shared bill without settling it.
--
-- A combined bill settles and closes as one unit, which is right when everyone
-- leaves together and wrong the moment they don't. Two colleagues share a bill;
-- one flies out Wednesday, the other stays to Friday. Until now the desk had to
-- either separate Wednesday's room onto its own bill â€” defeating the point of
-- combining them â€” or leave a departed guest checked in for two days, holding a
-- room that housekeeping could not turn over and reception could not re-let.
--
-- So a room can now depart on its own while staying on the bill. Its status
-- goes to 'checked_out' (which is what frees the room to be re-let â€” see the
-- active-booking guard in /api/bookings) and `checked_out_at` freezes its
-- nights, but its `group_id` is untouched, so its stay cost, its orders and its
-- charges all stay on the combined folio and settle with everyone else at the
-- end. No money moves at departure.
--
-- Two consequences fall out of a room being releasable mid-reservation, both
-- handled below:
--
--   * That room may have a NEW guest in it by the time the bill settles. The
--     group RPC used to send every room of the reservation to housekeeping and
--     close every session on those rooms' tables â€” which would now evict a
--     stranger. Both are re-scoped to the rooms this reservation still occupies.
--   * 'checked_out' can no longer mean "already settled". The RPC's re-settle
--     guard read it that way and would refuse to close the remaining rooms, so
--     it now reads an explicit settlement stamp instead.

-- Widened from "settled early and kept the room" to "this stay's bill was
-- closed out", and now stamped by every settlement path rather than only the
-- early ones. That is what makes it a trustworthy re-settle guard: departure
-- and settlement are no longer the same event, so only an explicit mark can
-- tell them apart.
COMMENT ON COLUMN public.bookings.bill_settled_at IS
    'When this stay''s bill was closed out. Stamped by every settlement, and kept at the FIRST one if a stay settles more than once. NULL means never settled â€” including a room that departed early and is still riding on a shared bill. "Settled but still in the room" is this being set while status is still checked_in.';

-- Every stay closed before this column existed was settled at checkout, because
-- checking out was the only way to close one. Without this they would read as
-- unsettled and the guard below would happily re-settle them.
UPDATE public.bookings
SET bill_settled_at = COALESCE(checked_out_at, check_out)
WHERE status = 'checked_out'
  AND bill_settled_at IS NULL;

DROP FUNCTION IF EXISTS public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean);
DROP FUNCTION IF EXISTS public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean);

-- Single-room settlement. Unchanged but for stamping bill_settled_at on every
-- settlement rather than only early ones; a lone room has no partial departure
-- to worry about, so its guard still reads status.
CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid, p_restaurant_id uuid, p_room_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_number text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_settled_now numeric, p_new_paid_amount numeric, p_payment_status text,
    p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text,
    p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = p_booking_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id) AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = COALESCE(bill_settled_at, now())
    WHERE id = p_booking_id;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = p_room_id;
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb, p_restaurant_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_label text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_payment_status text, p_authoritative_total numeric, p_orders_total numeric,
    p_ledger_split_mode text, p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    -- The rooms this reservation is STILL in. A room that departed early may
    -- already have a different guest in it, so anything that closes a room or
    -- its sessions must work from this list, never from every room the bill
    -- happens to cover.
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    -- 1. Lock every member booking before touching anything, so two cashiers
    -- settling the same reservation serialize instead of double-posting.
    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    -- The whole reservation settles or none of it does. This reads the
    -- settlement stamp rather than 'checked_out', which since partial departure
    -- exists no longer means "already paid for": a room that left early is
    -- checked out precisely so it can be re-let, and its share of this bill is
    -- still owed.
    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_settled
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.bill_settled_at IS NOT NULL;

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already settled: room ' || v_already_settled
        );
    END IF;

    SELECT COALESCE(array_agg(b.room_id), ARRAY[]::uuid[])
    INTO v_open_room_ids
    FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids) AND b.status <> 'checked_out';

    -- 2. Lock orders reachable from any member booking or the active session.
    -- The room-table clause is scoped to rooms still held: a departed room's own
    -- orders are already reachable through booking_id, whereas sweeping by room
    -- would drag in whatever the next guest has since ordered there.
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids))))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = ANY(v_booking_ids);
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids)))
        AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = COALESCE(bill_settled_at, now())
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    -- Only the rooms this reservation still occupies go to housekeeping. One
    -- that departed earlier was handed over then, and may be someone else's now.
    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_open_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit, 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit, 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')', 'posted', p_user_id);
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

-- Recreating a function resets its ACL to PUBLIC EXECUTE, and both of these
-- move money. Restore the lockdown from 20260728092457.
REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;
-- Orders that never go to a station.
--
-- A ticket assumes someone has to make the thing. Plenty of what a counter
-- sells does not: cigarettes, a bottle off the shelf, a packet of crisps. The
-- cashier takes it down, hands it over and the transaction is finished before
-- any printer could have spat paper. Until now every staff order still queued
-- to the kitchen or bar board and still printed a KOT, so someone had to walk
-- over and mark a cigarette 'ready' before it would leave the queue â€” and the
-- board filled with work nobody was doing.
--
-- `no_kot` records that the goods changed hands across the counter. Orders
-- carrying it are written with every line already 'served' and the order
-- already 'delivered', which is what keeps them off the station boards (those
-- query pending/confirmed/preparing/ready) and out of the print claim.
--
-- It is a record, not a mechanism: nothing reads this column to decide whether
-- to print. The order is simply never in a state a station would look at. The
-- column exists so "sold over the counter" stays distinguishable afterwards
-- from "cooked, served and closed", which the statuses alone cannot tell apart.
--
-- Billing is untouched. These lines are on the bill exactly like any other, and
-- stock was deducted by place_order the same way â€” the only thing skipped is
-- the paper and the queue.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS no_kot boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.no_kot IS
    'Sold straight over the counter â€” cigarettes, a bottle off the shelf â€” so no station ticket was printed and no station ever queued it. Its lines are written already served. Billing and stock behave exactly as for any other order.';

-- The question this column gets asked is "what did we sell over the counter
-- today", always within one restaurant and date range.
CREATE INDEX IF NOT EXISTS orders_no_kot_idx
    ON public.orders USING btree (restaurant_id, placed_at)
    WHERE no_kot;

-- Placing a counter sale, atomically.
--
-- Marking the lines finished in a second round-trip after place_order() is not
-- enough. Realtime publishes at COMMIT, so the station board receives the
-- INSERT the instant place_order's transaction closes â€” with every line still
-- unclaimed â€” and its 400ms print timer starts before the follow-up UPDATE can
-- land. The ticket would print perhaps nine times in ten and not the tenth,
-- which is the worst possible behaviour for a feature whose entire purpose is
-- not printing.
--
-- Doing both in one transaction removes the window: the board's first sight of
-- the order already has `kot_printed_at` set on every line, and
-- claim_order_items_for_printing() only ever claims rows where that is NULL. No
-- station can take them, so no station can print them â€” by construction rather
-- than by winning a race.
--
-- Deliberately a thin wrapper. place_order() owns pricing, promos, loyalty,
-- stock deduction and idempotency, and none of that changes for a packet of
-- cigarettes; forking it would mean maintaining that twice.
CREATE OR REPLACE FUNCTION public.place_counter_order(
    p_session_id uuid,
    p_items jsonb,
    p_customer_note text DEFAULT NULL,
    p_client_request_id text DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
    v_result jsonb;
    v_order_id uuid;
BEGIN
    v_result := public.place_order(
        p_session_id, p_items, p_customer_note,
        NULL, NULL, NULL, p_client_request_id, false
    );

    v_order_id := NULLIF(v_result->>'order_id', '')::uuid;
    -- place_order reports its own failures in the payload; pass them straight
    -- back rather than masking them with a stamping error.
    IF v_order_id IS NULL THEN
        RETURN v_result;
    END IF;

    -- Handed over, so already served. Cancelled lines are left alone â€” they
    -- were never handed to anyone.
    UPDATE public.order_items
       SET status = 'served',
           kot_printed_at = now()
     WHERE order_id = v_order_id
       AND status <> 'cancelled';

    -- 'delivered' is what keeps it off the station boards, which query
    -- pending/confirmed/preparing/ready.
    UPDATE public.orders
       SET status = 'delivered',
           needs_confirmation = false,
           no_kot = true
     WHERE id = v_order_id;

    RETURN v_result || jsonb_build_object('no_kot', true);
END;
$$;

-- Same posture as every other money-touching routine here: PUBLIC out,
-- service_role in (see 20260728092457). Staff reach this through the server
-- action, never directly from the browser.
REVOKE ALL ON FUNCTION public.place_counter_order(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_counter_order(uuid, jsonb, text, text) TO service_role;
-- Who actually did the work.
--
-- `orders.waiter_id`, `orders.chef_id` and `order_items.chef_id` have existed
-- since the baseline and have never been written: 0 rows of 297 orders and 634
-- items carried any of them. Only `cashier_id` is populated, and only since it
-- was added a day ago. So "which waiter took this order" and "who cooked this
-- dish" were questions the schema looked able to answer and the data could not.
--
-- This migration does the history; the writes that keep it true from here on
-- are in the order and kitchen paths.
--
-- On the kitchen side the attribution was not merely missing, it was being
-- destroyed: setOrderItemsStatus() sets `claimed_by` when a chef starts a dish
-- and CLEARS it again when they mark it ready. That is correct for what
-- claimed_by is â€” a lock, so two cooks can't start the same dish â€” but it means
-- the finished dish remembers nobody. `chef_id` is the durable counterpart, and
-- is now written alongside the lock.

-- A backfilled waiter is a reasonable guess, not a record, and the report must
-- be able to say so. The guess is "whoever opened the table served it", which
-- is usually right and occasionally not â€” a second waiter covering a section,
-- or a QR self-order the guest placed themselves on a staff-opened table.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS waiter_id_inferred boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.waiter_id_inferred IS
    'True when waiter_id was reconstructed from sessions.opened_by rather than recorded at the time the order was placed. Reports must label these as inferred â€” the table''s opener is not always who took the order.';

-- Recover what can be recovered. Only session-linked orders with a known
-- opener, and only where nothing was recorded â€” a real attribution is never
-- overwritten by a guess.
UPDATE public.orders o
SET waiter_id = s.opened_by,
    waiter_id_inferred = true
FROM public.sessions s
WHERE o.session_id = s.id
  AND o.waiter_id IS NULL
  AND s.opened_by IS NOT NULL;

-- Reporting reads these three ways and no other: one restaurant's orders for a
-- date range, narrowed to one member of staff. Partial, because the columns are
-- null on every guest-placed order and always will be.
CREATE INDEX IF NOT EXISTS orders_waiter_activity_idx
    ON public.orders USING btree (restaurant_id, waiter_id, placed_at)
    WHERE waiter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_cashier_activity_idx
    ON public.orders USING btree (restaurant_id, cashier_id, paid_at)
    WHERE cashier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_items_chef_activity_idx
    ON public.order_items USING btree (chef_id, created_at)
    WHERE chef_id IS NOT NULL;

-- The oversight half of the report â€” discounts and voids â€” reads audit_logs by
-- actor over a date range, which nothing indexed for.
CREATE INDEX IF NOT EXISTS audit_logs_actor_activity_idx
    ON public.audit_logs USING btree (restaurant_id, user_id, created_at);
-- Who checked the guest in, and when â€” the counterpart to cashier_id /
-- checked_out_at (20260728030000, 20260727150000) on the other end of the
-- stay. `check_in` is the scheduled/booked date, not the moment the front
-- desk actually handed over the room, and nothing recorded who did it â€” so
-- the Bookings & Stays History detail card could show a checkout operator
-- but not a check-in one.
--
-- Deliberately nullable with no backfill, same reasoning as cashier_id: every
-- pre-existing stay was checked in by someone unknown to the schema.
ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "checked_in_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "checked_in_by" uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_checked_in_by_fkey') THEN
        ALTER TABLE "public"."bookings"
            ADD CONSTRAINT "bookings_checked_in_by_fkey" FOREIGN KEY ("checked_in_by")
            REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_checked_in_by_idx"
    ON "public"."bookings" USING btree ("checked_in_by") WHERE "checked_in_by" IS NOT NULL;

COMMENT ON COLUMN "public"."bookings"."checked_in_at" IS
    'When the guest actually checked in (room handover), stamped automatically the moment status first becomes checked_in. NULL for a still-pending reservation and for stays checked in before this column existed.';

COMMENT ON COLUMN "public"."bookings"."checked_in_by" IS
    'Staff member who checked the guest in â€” the walk-in creator (bookings insert) or whoever clicked Check In (bookings/status). NULL for anything checked in before this column existed.';

-- Stamped by a trigger rather than by each caller, mirroring
-- stamp_booking_checked_out_at: a walk-in booking is inserted already
-- checked_in (POST /api/bookings), while a reserved one flips pending ->
-- checked_in later (POST /api/bookings/status) â€” both paths must not be able
-- to skip the stamp. The NULL guard makes it idempotent and one-shot: once
-- set, it is never overwritten by a later unrelated update.
CREATE OR REPLACE FUNCTION "public"."stamp_booking_checked_in_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'checked_in' AND NEW."checked_in_at" IS NULL THEN
        NEW."checked_in_at" := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_stamp_checked_in_at" ON "public"."bookings";
CREATE TRIGGER "bookings_stamp_checked_in_at"
    BEFORE INSERT OR UPDATE ON "public"."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."stamp_booking_checked_in_at"();
-- Restore booking_id in receivable_transactions description JSON on room checkout.
--
-- 20260728020000 first embedded booking_id in the credit-charge description so
-- the admin UI could recover a bill/invoice number and the underlying booking
-- for a credit charge. 20260729110000 and 20260729120000 (settle-without-
-- checkout, then partial-room-checkout) both had to redefine
-- settle_booking_checkout_v2 / settle_booking_group_checkout wholesale for
-- unrelated reasons and, in doing so, reintroduced the old plain-text
-- description â€” silently dropping the JSON embedding again. This migration
-- changes nothing else: every other line is identical to 20260729120000's
-- definitions, so `p_close_stay` / partial-departure behavior is untouched.

CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid, p_restaurant_id uuid, p_room_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_number text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_settled_now numeric, p_new_paid_amount numeric, p_payment_status text,
    p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text,
    p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = p_booking_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id) AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = COALESCE(bill_settled_at, now())
    WHERE id = p_booking_id;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = p_room_id;
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb, p_restaurant_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_label text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_payment_status text, p_authoritative_total numeric, p_orders_total numeric,
    p_ledger_split_mode text, p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((elem->>'booking_id')::uuid), array_agg((elem->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings) elem;

    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
    INTO v_already_settled
    FROM public.bookings b
    LEFT JOIN public.rooms r ON r.id = b.room_id
    WHERE b.id = ANY(v_booking_ids) AND b.bill_settled_at IS NOT NULL;

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Already settled: room ' || v_already_settled
        );
    END IF;

    SELECT COALESCE(array_agg(b.room_id), ARRAY[]::uuid[])
    INTO v_open_room_ids
    FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids) AND b.status <> 'checked_out';

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids) OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions
            WHERE booking_id = ANY(v_booking_ids)
               OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids))))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = ANY(v_booking_ids);
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids)))
        AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = COALESCE(bill_settled_at, now())
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_open_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

-- Recreating a function resets its ACL to PUBLIC EXECUTE, and both of these
-- move money. Restore the lockdown from 20260728092457 / 20260729120000.
REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;
-- The booking bill/history lookup (see lib/bookingBill.ts) finds a stay's
-- settlement snapshot by filtering audit_logs on restaurant_id, entity_type,
-- entity_id and action, ordered by created_at desc limit 1. audit_logs has
-- one row per action across the whole restaurant, and the only existing
-- indexes cover (restaurant_id, created_at) or user_id â€” neither helps this
-- query pick out one entity's rows, so it degrades as the log grows. This
-- covers the lookup directly.
CREATE INDEX IF NOT EXISTS "audit_logs_entity_lookup_idx"
    ON "public"."audit_logs" USING "btree" ("restaurant_id", "entity_type", "entity_id", "created_at" DESC);
-- Modifier groups/options have existed in the schema, in lib/menu-cache.ts and
-- in the customer + KOT rendering since the baseline, but nothing could ever
-- create one: /admin/menu has no modifier UI, so the only way to get a row in
-- was raw SQL. Wiring up that editor needs one thing the schema doesn't have â€”
-- a way to remove an option.
--
-- order_item_modifiers.modifier_id is ON DELETE RESTRICT (deliberately: a past
-- order must keep naming what it charged for). So the moment an option has been
-- ordered once it can never be deleted, and deleting its group cascades into
-- the same RESTRICT and fails the whole statement. Without a soft-delete the
-- editor would offer a Remove button that throws a foreign-key error on exactly
-- the options a busy restaurant most wants to retire.
--
-- is_archived is that soft delete, and it is deliberately NOT is_available:
--   is_available = false â†’ temporarily off (out of stock tonight), still in the
--                          editor, manager flips it back
--   is_archived  = true  â†’ removed for good; hidden from the editor and the
--                          menu, but the row survives so old bills still read
--                          correctly.
-- The actions layer hard-deletes when there is no order history and archives
-- when there is, so a restaurant that mistypes an option still gets a clean
-- delete rather than accumulating tombstones.

ALTER TABLE "public"."menu_item_modifier_groups"
    ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."menu_item_modifiers"
    ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false;

-- Both read paths (menu-cache and the admin editor) filter on this, and always
-- alongside the parent key, so it belongs in the existing lookup indexes rather
-- than in indexes of its own.
DROP INDEX IF EXISTS "public"."idx_modifier_groups_menu_item";
CREATE INDEX "idx_modifier_groups_menu_item"
    ON "public"."menu_item_modifier_groups" USING "btree" ("menu_item_id", "is_archived");

DROP INDEX IF EXISTS "public"."idx_modifiers_group";
CREATE INDEX "idx_modifiers_group"
    ON "public"."menu_item_modifiers" USING "btree" ("group_id", "is_archived");
-- Voids, comps and refunds all already work â€” cancelOrder, cancelOrderItem and
-- refundOrderAction each take a reason and each post their value to the books.
-- What none of them produce is data anyone can add up. Every reason is free
-- text, so "how much did we lose to kitchen errors last month, and how much
-- did we give away as staff meals" has no answer short of reading 400 strings.
--
-- Three gaps, closed here:
--
-- 1. Reason CODES beside the free text. The text stays â€” it is where the
--    specifics live ("table 7 sent back the momo, cold") â€” but the code is what
--    a report can group by. The vocabulary lives in lib/voidReasons.ts and is
--    validated in the actions; deliberately no CHECK constraint, so adding a
--    code stays a one-line TS change rather than a migration + deploy dance.
--
-- 2. COMP as a first-class kind. A staff meal and a kitchen mistake are both
--    "cancelled" today and land in the same Order Cancellation expense, which
--    makes the wastage number wrong in both directions: it counts food that was
--    deliberately given away, and it hides the cost of feeding staff. They post
--    to separate expense categories now, so the two are separable.
--
-- 3. Item-level attribution. cancelOrderItem writes its reason to the audit log
--    only â€” the order_items row itself records nothing about who voided it, why,
--    or when. That is the one place a cashier can quietly remove a single plate
--    from a bill, so it is exactly the row that needs to carry the evidence.
--
-- Refund reason moves onto its own columns for the same reason. It was being
-- appended to orders.customer_note â€” a field the customer wrote and, on some
-- receipts, reads back â€” which mixed staff-only audit text into guest-facing
-- content and made the note unparseable after two refunds.

-- Guarded because CREATE TYPE has no IF NOT EXISTS: every other statement in
-- this file is re-runnable, and one that isn't would fail a replay of the whole
-- migration on a database that already has the type.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_kind') THEN
        CREATE TYPE "public"."cancellation_kind" AS ENUM (
            'void',   -- cancelled: a mistake, a change of mind, an item sent back
            'comp'    -- deliberately given free: staff meal, service recovery, tasting
        );
    END IF;
END $$;

ALTER TABLE "public"."orders"
    ADD COLUMN IF NOT EXISTS "cancellation_kind" "public"."cancellation_kind",
    ADD COLUMN IF NOT EXISTS "cancellation_reason_code" "text",
    ADD COLUMN IF NOT EXISTS "refund_reason" "text",
    ADD COLUMN IF NOT EXISTS "refund_reason_code" "text";

ALTER TABLE "public"."order_items"
    ADD COLUMN IF NOT EXISTS "cancellation_kind" "public"."cancellation_kind",
    ADD COLUMN IF NOT EXISTS "cancellation_reason" "text",
    ADD COLUMN IF NOT EXISTS "cancellation_reason_code" "text",
    ADD COLUMN IF NOT EXISTS "cancelled_by" "uuid",
    ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

-- SET NULL rather than RESTRICT: losing the name of a staff member who has
-- since been deleted must not make the void record itself undeletable, and the
-- audit log keeps the user id independently.
ALTER TABLE ONLY "public"."order_items"
    DROP CONSTRAINT IF EXISTS "order_items_cancelled_by_fkey";
ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

-- Partial indexes: voids and comps are a small fraction of all rows, and every
-- report that wants them wants only them.
CREATE INDEX IF NOT EXISTS "orders_cancellation_kind_idx"
    ON "public"."orders" USING "btree" ("restaurant_id", "cancellation_kind", "placed_at" DESC)
    WHERE "cancellation_kind" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "order_items_cancellation_idx"
    ON "public"."order_items" USING "btree" ("cancelled_at" DESC)
    WHERE "cancellation_kind" IS NOT NULL;

-- Anon exposure â€” the two tables differ, and it is worth being exact:
--
--   orders      anon has NO table-level SELECT, only per-column grants (the
--               customer order tracker reads a handful). New columns are
--               therefore private by default, which is what we want:
--               refund_reason is internal. Do not add anon grants for them.
--
--   order_items anon DOES hold a table-level SELECT, so the five columns added
--               above are readable by anon for whatever rows RLS lets through
--               (a guest's own order). That is inherited, not introduced here â€”
--               the table already exposes chef_id, claimed_by and
--               special_request the same way â€” but cancellation_reason is
--               staff-written free text, which is a genuinely new kind of
--               content on that surface. Staff should assume a guest can read
--               what they type there.
--
-- Tightening it means revoking the table-level SELECT and re-granting the
-- columns the guest flows actually need, which touches live guest-facing reads
-- and does not belong in this migration.
-- day_book_entries.description doubles as a JSON payload for vouchers
-- (createVoucherAction) that carry full cheque details â€” written name,
-- issuer bank, cheque number/date/type, plus the usual voucher fields.
-- The original 500-char cap was sized for a plain text description and
-- silently rejects any reasonably detailed cheque voucher (confirmed by the
-- new "Bank to Hotel Cash" cheque flow in Manual Entry). Widened well past
-- what a JSON-packed description realistically needs.
ALTER TABLE "public"."day_book_entries"
    DROP CONSTRAINT "day_book_entries_description_check";

ALTER TABLE "public"."day_book_entries"
    ADD CONSTRAINT "day_book_entries_description_check"
    CHECK ((char_length(description) >= 1) AND (char_length(description) <= 5000));
-- The "Add on Stock Item" restock flow now defaults an item's Category to
-- "Others" instead of leaving it blank when the item has none. Backfill the
-- same default onto ingredients that were already sitting uncategorized
-- before this change, so they aren't stuck without one just because they
-- predate it. Per-restaurant: creates that tenant's own "Others" stock
-- category first if it doesn't already have one, then assigns it.

INSERT INTO "public"."expense_categories" (restaurant_id, name, is_stock_category)
SELECT DISTINCT i.restaurant_id, 'Others', true
FROM "public"."ingredients" i
WHERE i.category_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "public"."expense_categories" ec
      WHERE ec.restaurant_id = i.restaurant_id
        AND ec.is_stock_category = true
        AND lower(trim(ec.name)) = 'others'
  );

UPDATE "public"."ingredients" i
SET category_id = ec.id
FROM "public"."expense_categories" ec
WHERE i.category_id IS NULL
  AND ec.restaurant_id = i.restaurant_id
  AND ec.is_stock_category = true
  AND lower(trim(ec.name)) = 'others';
-- Fix adjust_ingredient_stock RPC to reset negative stock baseline before adding delta,
-- so adding stock never remains in minus if past order deductions drove stock negative.
CREATE OR REPLACE FUNCTION "public"."adjust_ingredient_stock"(
    "p_ingredient_id" "uuid",
    "p_delta" numeric
) RETURNS numeric
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" = "public"
    AS $$
    DECLARE
        v_new_stock numeric;
    BEGIN
        UPDATE public.ingredients
        SET stock_quantity = GREATEST(0, GREATEST(0, stock_quantity) + p_delta),
            updated_at = NOW()
        WHERE id = p_ingredient_id
        RETURNING stock_quantity INTO v_new_stock;

        RETURN v_new_stock;
    END;
$$;

REVOKE EXECUTE ON FUNCTION "public"."adjust_ingredient_stock"("uuid", numeric) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."adjust_ingredient_stock"("uuid", numeric) TO "service_role";

-- Recalculate and repair ingredients.stock_quantity from all historical ingredient_movements,
-- so past Adjustments (like +73 Golden Oak, +8 8848) correctly populate current stock.
WITH movement_sums AS (
    SELECT 
        ingredient_id,
        GREATEST(0, SUM(
            CASE 
                WHEN movement_type IN ('purchase', 'adjustment') THEN ABS(quantity)
                WHEN movement_type IN ('waste', 'transfer') THEN -ABS(quantity)
                WHEN movement_type = 'usage' THEN -ABS(quantity)
                ELSE 0
            END
        )) AS calculated_stock
    FROM public.ingredient_movements
    GROUP BY ingredient_id
)
UPDATE public.ingredients i
SET stock_quantity = ms.calculated_stock,
    updated_at = NOW()
FROM movement_sums ms
WHERE i.id = ms.ingredient_id;

-- Reset any remaining negative ingredient stock levels to 0
UPDATE public.ingredients
SET stock_quantity = 0
WHERE stock_quantity < 0;
-- Turn the kitchen on for every restaurant that never had it written.
--
-- buildFeaturesV2 (src/lib/tiers.ts) had no entry for kotEnabled or kdsEnabled,
-- so both keys were *absent* on every restaurant ever provisioned. Absent
-- kotEnabled reads as off everywhere, and every cashier-side auto-print is
-- gated on it (CashierClient printOutstanding/claimAndPrint, CashierOrdersPanel
-- printConfirmedItems) â€” so placing an order produced no ticket, no error and
-- no toast. Nothing in the UI could distinguish that from KOT printing simply
-- not being built.
--
-- The two flags used to clear each other, on the theory that a kitchen runs
-- either a screen or a printer. They are independent: the KDS is how the
-- kitchen works a ticket, the printer is how the ticket reaches the pass, and a
-- kitchen may want both. The application no longer forces one off when the
-- other goes on, so this writes both true where the tenant never chose.
--
-- An explicitly stored value is never overwritten â€” a restaurant that has
-- deliberately switched either half off keeps it off.
UPDATE public.settings s
SET features_v2 = s.features_v2 || jsonb_build_object(
        'kotEnabled', COALESCE((s.features_v2 ->> 'kotEnabled')::boolean, true),
        'kdsEnabled', COALESCE((s.features_v2 ->> 'kdsEnabled')::boolean, true)
    )
WHERE s.features_v2 IS NOT NULL
  AND (
        NOT (s.features_v2 ? 'kotEnabled')
     OR NOT (s.features_v2 ? 'kdsEnabled')
  );
-- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries during room checkout.
--
-- Previously, when advance paid > bill total, the UI displayed "Return to Guest",
-- but the database settlement RPCs only posted positive income to day_book_entries.
-- This migration updates settle_booking_checkout_v2 and settle_booking_group_checkout
-- to post a cash_out refund entry into day_book_entries whenever p_new_paid_amount > p_authoritative_total.

CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid, p_restaurant_id uuid, p_room_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_number text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_settled_now numeric, p_new_paid_amount numeric, p_payment_status text,
    p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text,
    p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
            SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = p_booking_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id) AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = COALESCE(bill_settled_at, now())
    WHERE id = p_booking_id;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = p_room_id;
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')');
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, p_new_paid_amount - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Room ' || p_room_number || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb, p_restaurant_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_label text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_payment_status text, p_authoritative_total numeric, p_orders_total numeric,
    p_ledger_split_mode text, p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
    v_sum_group_paid numeric := 0;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((value->>'booking_id')::uuid), array_agg((value->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings);

    SELECT string_agg(b.id::text, ', ') INTO v_already_settled
    FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out'
    FOR UPDATE;

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more bookings are already checked out: ' || v_already_settled);
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_open_room_ids
    FROM public.bookings
    WHERE id = ANY(v_booking_ids) AND status != 'checked_out';

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM (
        SELECT id FROM public.orders
        WHERE (booking_id = ANY(v_booking_ids)
            OR session_id = p_session_id
            OR session_id IN (SELECT id FROM public.sessions WHERE booking_id = ANY(v_booking_ids)))
        AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
        AND status != 'cancelled'
        FOR UPDATE
    ) sub;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = ANY(v_booking_ids);
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids)))
        AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        v_sum_group_paid := v_sum_group_paid + COALESCE((v_alloc->>'paid_amount')::numeric, 0);

        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = COALESCE(bill_settled_at, now())
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_open_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, v_sum_group_paid - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Rooms ' || p_room_label || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;
-- Fix PostgreSQL error: "FOR UPDATE is not allowed with aggregate functions"
-- Separates row locking (PERFORM ... FOR UPDATE) from aggregate functions (string_agg, array_agg)
-- in settle_booking_checkout_v2 and settle_booking_group_checkout.

CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(
    p_booking_id uuid, p_restaurant_id uuid, p_room_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_number text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_settled_now numeric, p_new_paid_amount numeric, p_payment_status text,
    p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text,
    p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_status text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
        SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
    AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        PERFORM 1 FROM public.orders WHERE id = ANY(v_order_ids) FOR UPDATE;
    END IF;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = p_booking_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id) AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = COALESCE(bill_settled_at, now())
    WHERE id = p_booking_id;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = p_room_id;
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')');
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, p_new_paid_amount - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Room ' || p_room_number || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(
    p_bookings jsonb, p_restaurant_id uuid, p_session_id uuid,
    p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric,
    p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric,
    p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid,
    p_room_label text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid,
    p_payment_status text, p_authoritative_total numeric, p_orders_total numeric,
    p_ledger_split_mode text, p_commission_rate numeric,
    p_extra_hour_charge numeric DEFAULT 0,
    p_close_stay boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
    v_sum_group_paid numeric := 0;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((value->>'booking_id')::uuid), array_agg((value->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings);

    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    SELECT string_agg(b.id::text, ', ') INTO v_already_settled
    FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids) AND b.status = 'checked_out';

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more bookings are already checked out: ' || v_already_settled);
    END IF;

    SELECT COALESCE(array_agg(room_id), ARRAY[]::uuid[]) INTO v_open_room_ids
    FROM public.bookings
    WHERE id = ANY(v_booking_ids) AND status != 'checked_out';

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE (booking_id = ANY(v_booking_ids)
        OR session_id = p_session_id
        OR session_id IN (SELECT id FROM public.sessions WHERE booking_id = ANY(v_booking_ids)))
    AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        PERFORM 1 FROM public.orders WHERE id = ANY(v_order_ids) FOR UPDATE;
    END IF;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = ANY(v_booking_ids);
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids)))
        AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        v_sum_group_paid := v_sum_group_paid + COALESCE((v_alloc->>'paid_amount')::numeric, 0);

        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = COALESCE(bill_settled_at, now())
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, v_sum_group_paid - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Rooms ' || p_room_label || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_checkout_v2(uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, numeric, numeric, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_booking_group_checkout(jsonb, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, uuid, text, numeric, numeric, text, numeric, numeric, boolean) TO service_role;

-- Clean up any rooms currently stuck in 'occupied' whose stays are already checked out
UPDATE public.rooms
SET status = 'dirty'
WHERE status = 'occupied'
  AND id NOT IN (
      SELECT room_id FROM public.bookings WHERE status IN ('checked_in', 'pending')
  );
-- Write out the default-on feature flags that stored settings never wrote.
--
-- resolveFeatureDefaults() in src/lib/tiers.ts already reads an absent one of
-- these as true, and useFeatureEnabled() agrees with it, so this changes no
-- behaviour today. What it removes is the reliance on that: any code path that
-- reads settings.features_v2 directly instead of going through the resolver
-- sees an absent key as false, and that disagreement is what has repeatedly put
-- a link in the nav to a page that redirects straight back.
--
-- The defaults are concatenated on the LEFT so a stored value always wins:
-- jsonb `a || b` lets b override a. Only keys that are genuinely absent get
-- written. A tenant that has deliberately switched one of these off keeps it
-- off -- verified before applying, with zero existing values altered.
--
-- The WHERE clause restricts this to rows actually missing a key, so untouched
-- tenants are not rewritten. There is no trigger on settings, so updated_at is
-- deliberately left alone.
--
-- Companion to 20260727160000_backfill_module_feature_flags.sql, which did the
-- same for the three plan-gated module keys.
update settings s
set features_v2 = jsonb_build_object(
      'promosEnabled',          true,
      'feedbackEnabled',        true,
      'dineInEnabled',          true,
      'serviceRequestsEnabled', true,
      'splitBillingEnabled',    true,
      'printInvoiceEnabled',    true,
      'generateInvoiceEnabled', true,
      'manualEntryEnabled',     true,
      'printBillEnabled',       true,
      'showInvoiceEnabled',     true,
      'kdsEnabled',             true,
      'kotEnabled',             true
    ) || s.features_v2
where s.features_v2 is not null
  and not (s.features_v2 ?& array[
      'promosEnabled', 'feedbackEnabled', 'dineInEnabled',
      'serviceRequestsEnabled', 'splitBillingEnabled', 'printInvoiceEnabled',
      'generateInvoiceEnabled', 'manualEntryEnabled', 'printBillEnabled',
      'showInvoiceEnabled', 'kdsEnabled', 'kotEnabled']);
-- Drop indexes that have never been read, on the four tables the booking and
-- billing screens actually query.
--
-- Planning, not execution, is what these screens were paying for. On bookings a
-- representative query planned in 23.1ms and executed in 0.19ms -- 121x more
-- time deciding how to fetch nine rows than fetching them. The planner loads
-- and costs every index on the table, and bookings carried 15 of them for 109
-- rows. A screen issuing fifteen or twenty queries spends most of its server
-- time in the planner, and the room panel pays that four times over across the
-- four endpoints it calls.
--
-- Measured on production either side of this migration:
--   bookings by status      23.065ms -> 1.263ms planning
--   orders unpaid            (same shape) 1.233ms planning
--   bookings joined to rooms              1.548ms planning
-- Execution time was never the problem and did not change.
--
-- Every index dropped here has idx_scan = 0 over a 77-day pg_stat_user_indexes
-- window, and none is unique, primary, or backing a constraint -- checked
-- explicitly, because several zero-scan indexes elsewhere DO enforce uniqueness
-- despite having no pg_constraint row (rooms_restaurant_number_uidx guards room
-- numbers, printers_one_default_per_role guards the default printer). Those are
-- deliberately left in place.
--
-- These were also premature at this data size: the tables hold 109 to 301 rows,
-- where a sequential scan costs a fraction of a millisecond, so none of them was
-- earning its planning cost. Re-add a specific one when the data volume and a
-- real query pattern justify it -- and check idx_scan before assuming it is.

-- bookings (109 rows, 15 indexes before this)
drop index if exists public.bookings_check_in_idx;
drop index if exists public.bookings_checked_in_by_idx;
drop index if exists public.bookings_parking_required_idx;
drop index if exists public.bookings_restaurant_guest_phone_idx;
drop index if exists public.idx_bookings_historical_link;

-- orders (144 rows)
drop index if exists public.idx_orders_legacy_takeout_id;
drop index if exists public.idx_orders_seat_id;
drop index if exists public.idx_orders_stripe_pi;          -- Stripe is dead code here
drop index if exists public.orders_cancellation_kind_idx;
drop index if exists public.orders_no_kot_idx;

-- order_items (301 rows)
drop index if exists public.idx_order_items_needs_confirmation;
drop index if exists public.order_items_bar_station_idx;
drop index if exists public.order_items_cancellation_idx;

-- rooms (52 rows) -- rooms_restaurant_number_uidx is UNIQUE and stays
drop index if exists public.idx_rooms_available;
drop index if exists public.idx_rooms_dirty;
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
-- Second pass of the never-read index cleanup, on every other table that
-- actually sees traffic.
--
-- NOT YET APPLIED TO PROD. 20260804114305 (the four booking/billing tables) is
-- live; this one is staged for `supabase db push`.
--
-- The same planning tax applies everywhere the planner has to cost an index
-- nothing reads. menu_items is the busiest table in the database at 16.4M
-- scans, and planned a 50-row lookup in 15.5ms against 5.6ms to execute it
-- while carrying a full-text index no query has ever used -- there is no
-- textSearch/to_tsquery anywhere in the application and no database function
-- references tsquery or tsvector. The first pass took a comparable bookings
-- query from 23.065ms of planning to 1.263ms.
--
-- Selection is the same and deliberately conservative: idx_scan = 0 across the
-- 77-day pg_stat_user_indexes window, not unique, not primary, not an exclusion
-- constraint, and backing no pg_constraint row. Restricted further to tables
-- with real activity, since dropping an index on a table nothing queries buys
-- nothing. Indexes that silently enforce uniqueness *without* a constraint row
-- -- rooms_restaurant_number_uidx, printers_one_default_per_role,
-- idx_fiscal_years_one_current, idx_financial_events_unique_source -- are
-- deliberately untouched; a backs_constraint = 0 filter alone would drop them
-- and let duplicate room numbers in.
--
-- Re-add any of these when a query pattern and data volume actually justify it,
-- and check idx_scan before assuming one is earning its keep.

-- hottest tables first
drop index if exists public.idx_menu_items_fts;
drop index if exists public.idx_order_item_modifiers_modifier_id;
drop index if exists public.idx_restaurants_linked_restaurant_id;
drop index if exists public.idx_restaurants_linked_hotel_id;
drop index if exists public.idx_expense_categories_parent_id;

-- payments / takeout
drop index if exists public.idx_payment_verifications_takeout_order_id;
drop index if exists public.idx_payment_verifications_pending;
drop index if exists public.idx_takeout_orders_loyalty_member_id;
drop index if exists public.idx_takeout_orders_phone;

-- books
drop index if exists public.idx_expenses_recurring;
drop index if exists public.idx_day_book_entries_bank_deposit;
drop index if exists public.idx_vouchers_status;
drop index if exists public.idx_voucher_attachments_voucher_id;
drop index if exists public.idx_financial_events_status;
drop index if exists public.idx_financial_events_type;
drop index if exists public.idx_financial_transactions_status;
drop index if exists public.idx_financial_transactions_type;
drop index if exists public.idx_financial_transactions_source_module;
drop index if exists public.idx_chart_of_accounts_parent_id;
drop index if exists public.idx_chart_of_accounts_restaurant_id;
drop index if exists public.idx_account_mappings_credit_account;
drop index if exists public.idx_account_mappings_debit_account;
drop index if exists public.idx_account_mappings_lookup;
drop index if exists public.idx_mapped_transactions_account_mapping;
drop index if exists public.idx_accounting_periods_fiscal_year_id;

-- cash
drop index if exists public.idx_cash_counts_drawer_id;
drop index if exists public.idx_cash_transactions_shift_id;
drop index if exists public.idx_cash_transactions_drawer_id;
drop index if exists public.idx_cash_transactions_counterparty_drawer_id;

-- loans / budgets / tax
drop index if exists public.idx_loans_restaurant_id;
drop index if exists public.idx_loan_payments_loan_id;
drop index if exists public.idx_loan_emi_schedule_loan_id;
drop index if exists public.idx_budgets_restaurant_id;
drop index if exists public.idx_budget_lines_budget_id;
drop index if exists public.idx_tax_filings_configuration_id;
drop index if exists public.idx_supplier_payments_bill_id;

-- loyalty / misc
drop index if exists public.idx_loyalty_tx_member;
drop index if exists public.idx_loyalty_members_phone;
drop index if exists public.idx_translations_lookup;
drop index if exists public.idx_translations_restaurant;
drop index if exists public.invitations_status_idx;
drop index if exists public.printers_restaurant_role_idx;
drop index if exists public.idx_phone_otp_active;
-- Give the backup password a home that anon cannot read.
--
-- settings.features_v2 is the wrong place for a credential: settings carries
-- `public_read_settings` (SELECT USING (true) for {public}) and anon holds
-- SELECT on the table, because the customer QR menu reads currency and feature
-- flags without logging in. RLS is row-level, so that policy hands over every
-- column of every row -- verified with the anon key: a plain REST call returns
-- full features_v2 for any restaurant. restaurants is no better; it has
-- anyone_can_read_restaurants USING (is_active = true).
--
-- Nothing has leaked. The profile page's write to that field never actually
-- landed until it was repaired earlier today, so no tenant has a stored
-- password yet -- but the next manager to open their profile would have
-- published one, and /api/backup/export grants a full dump of a restaurant's
-- orders, bookings and books to whoever presents it.
--
-- RLS is enabled with no policies at all, which denies anon and authenticated
-- outright. Both sides of this feature already go through createAdminClient()
-- (service_role), which bypasses RLS, so neither needs a grant.
create table if not exists public.restaurant_backup_secrets (
    restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
    backup_password text not null,
    created_at timestamptz not null default now()
);

alter table public.restaurant_backup_secrets enable row level security;

-- Explicitly take away the blanket grants Supabase hands these roles on new
-- public tables. Without this the table is reachable the moment someone adds a
-- permissive policy by habit.
revoke all on public.restaurant_backup_secrets from anon, authenticated;

comment on table public.restaurant_backup_secrets is
    'Backup/export password per restaurant. Deliberately outside settings.features_v2, which is world-readable via public_read_settings. RLS on with no policies: service_role only.';
-- Who actually handed over the money.
--
-- booking_payments records created_by, which is the staff member who took the
-- payment, and that is all it has ever recorded. On a combined reservation the
-- payer is a real question: several rooms share one folio, each with its own
-- occupant, and when they settle separately the desk needs to be able to say
-- afterwards which guest paid for which room. Without this the only evidence is
-- the note, which reads 'Settlement' on every row.
--
-- Free text, and nullable: it is a name a cashier types, not a foreign key --
-- the payer is frequently not any of the guests on the booking (a company, a
-- relative, the colleague who organised the trip). Existing rows keep NULL,
-- which reads correctly as "not recorded".
alter table public.booking_payments
    add column if not exists paid_by text;

comment on column public.booking_payments.paid_by is
    'Name of the person who paid, as typed by the cashier. Distinct from created_by, which is the staff member who took it. Used when rooms on a combined reservation settle separately.';
-- Let a subscription say it is on trial.
--
-- restaurants.subscription_status has always been constrained to
-- active/past_due/suspended/cancelled. A 14-day full-access trial needs to be
-- distinguishable from a paid 'active' subscription for exactly one reason: the
-- nightly auto-suspend job treats an expired subscription as a billing failure
-- and suspends the tenant outright. A trial running out is not a billing
-- failure â€” the tenant never owed anything â€” so it must downgrade to free
-- instead, and the job can only tell the two apart if the status says so.
--
-- Widening a CHECK constraint cannot invalidate an existing row (every current
-- value stays legal), so this needs no backfill and no NOT VALID dance.
alter table public.restaurants
    drop constraint if exists restaurants_subscription_status_check;

alter table public.restaurants
    add constraint restaurants_subscription_status_check
    check (subscription_status = any (array[
        'active'::text,
        'trialing'::text,
        'past_due'::text,
        'suspended'::text,
        'cancelled'::text
    ]));

comment on column public.restaurants.subscription_status is
    'active = paying (or a manually-billed enterprise). trialing = inside the 14-day full-access trial; subscription_expires_at is when it ends, and lapsing downgrades to free rather than suspending. past_due/suspended/cancelled are billing states.';

-- When this tenant's trial ends, kept after it has ended.
--
-- subscription_expires_at cannot answer this on its own: the downgrade clears
-- it (a Free plan does not expire), so the moment the trial ends the only
-- record that there ever was one is gone. That leaves the app unable to tell a
-- tenant whose trial just ran out from one that signed up on Free years ago â€”
-- and those two need to be told very different things.
--
-- Written once at provisioning and never cleared, so it doubles as the answer
-- to "did this tenant ever have a trial". NULL means no: every tenant that
-- predates this, plus demo tenants and anything a super admin created by hand.
alter table public.restaurants
    add column if not exists trial_ends_at timestamptz;

comment on column public.restaurants.trial_ends_at is
    'When the 14-day signup trial ends (or ended). Set once at provisioning and never cleared, so it survives the downgrade that clears subscription_expires_at. NULL = this tenant never had a trial.';
-- Where the guest lives, taken at the desk while registering a stay.
--
-- Nepali hotels are required to record a guest's permanent address alongside
-- the citizenship/passport number they already collect, and the desk had
-- nowhere to put it: it was either dropped on the floor or smuggled into the
-- free-text `notes` field next to the KYC string, where nothing can read it
-- back out or reprint it.
--
-- Nullable, with no default: every stay already on file was taken without one,
-- and NULL says exactly that â€” "never asked" â€” where an empty string would
-- claim the guest was asked and gave nothing. The column is deliberately plain
-- text rather than structured parts; what the desk writes is a line like
-- "Ward 5, Bharatpur, Chitwan", which no address schema improves.
--
-- Also lands on booking_groups, which carries the same guest identity for a
-- multi-room reservation. Leaving it off there would make the group header
-- disagree with its own rooms.

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS guest_address text;

ALTER TABLE public.booking_groups
    ADD COLUMN IF NOT EXISTS guest_address text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_guest_address_length'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_guest_address_length
            CHECK (guest_address IS NULL OR char_length(guest_address) <= 200);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_groups_guest_address_length'
    ) THEN
        ALTER TABLE public.booking_groups
            ADD CONSTRAINT booking_groups_guest_address_length
            CHECK (guest_address IS NULL OR char_length(guest_address) <= 200);
    END IF;
END $$;

COMMENT ON COLUMN public.bookings.guest_address IS
    'Guest''s address as written at the front desk. NULL means it was never asked for â€” not that the guest has none.';
COMMENT ON COLUMN public.booking_groups.guest_address IS
    'Guest''s address for a multi-room reservation. Mirrors bookings.guest_address on every room of the group.';

-- â”€â”€ Returning guests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The lookup that fills the booking form from a past stay has to offer the
-- address too, otherwise a repeat guest gets their name, phone and KYC back but
-- retypes where they live every visit.
--
-- The return type gains a column, so this is a DROP + CREATE rather than a
-- CREATE OR REPLACE. Dropping takes the ACL with it, and a fresh function is
-- EXECUTE-to-PUBLIC by default, so the revoke from
-- 20260728092457_revoke_public_execute_on_security_definer_functions is
-- re-applied below â€” this returns guest PII and must stay server-side only.
DROP FUNCTION IF EXISTS "public"."search_guest_history"(uuid, text, integer);

CREATE FUNCTION "public"."search_guest_history"(
    p_restaurant_id uuid,
    p_query text,
    p_limit integer DEFAULT 8
) RETURNS TABLE (
    guest_phone   text,
    guest_name    text,
    guest_email   text,
    guest_address text,
    kyc           text,
    visits        bigint,
    last_stay_at  timestamptz,
    loyalty_points integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
STABLE
AS $$
    WITH needle AS (
        SELECT lower(btrim(p_query)) AS q
    ),
    -- Every stay matching the typed text, by phone prefix or anywhere in the
    -- name. Phone is a prefix match because that is how a number is dialled and
    -- typed; a name is matched loosely since the desk may enter a surname.
    matched AS (
        SELECT
            b.guest_phone,
            b.guest_name,
            b.guest_email,
            b.guest_address,
            -- KYC is stored as a 'KYC: <value>' prefix on notes (see
            -- /api/bookings). Strip the label back off so it can repopulate the
            -- field it came from.
            NULLIF(regexp_replace(COALESCE(b.notes, ''), '^KYC:\s*', ''), '') AS kyc,
            b.check_in,
            b.created_at
        FROM public.bookings b, needle n
        WHERE b.restaurant_id = p_restaurant_id
          AND b.guest_phone IS NOT NULL
          AND btrim(b.guest_phone) <> ''
          AND (
                b.guest_phone LIKE n.q || '%'
             OR lower(b.guest_name) LIKE '%' || n.q || '%'
          )
    ),
    -- Collapse to one row per phone. The most recent stay supplies the details,
    -- so a guest who has since corrected their name or email is offered the
    -- corrected version rather than whatever they first gave.
    ranked AS (
        SELECT
            m.*,
            row_number() OVER (PARTITION BY m.guest_phone ORDER BY m.created_at DESC) AS rn,
            count(*)     OVER (PARTITION BY m.guest_phone) AS visit_count,
            max(m.check_in) OVER (PARTITION BY m.guest_phone) AS latest_stay
        FROM matched m
    )
    SELECT
        r.guest_phone,
        r.guest_name,
        r.guest_email,
        r.guest_address,
        r.kyc,
        r.visit_count,
        r.latest_stay,
        -- Loyalty balance if this guest also has a CRM record, so the desk can
        -- see standing without a second lookup.
        (SELECT c.loyalty_points
           FROM public.customer_credit_accounts c
          WHERE c.restaurant_id = p_restaurant_id
            AND c.customer_phone = r.guest_phone
          LIMIT 1)
    FROM ranked r
    WHERE r.rn = 1
    ORDER BY r.latest_stay DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 25));
$$;

COMMENT ON FUNCTION "public"."search_guest_history"(uuid, text, integer) IS
    'One row per returning guest matching a phone prefix or name fragment, newest details first. Caller must scope p_restaurant_id to the signed-in user''s restaurant â€” this returns guest PII.';

REVOKE EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) TO service_role;
-- Lets a manager reconcile the cash+QR a staff member should have collected
-- during one clock-in/clock-out shift against what's physically counted, so
-- a shortfall becomes an automatic deduction on that staff member's ledger
-- instead of being tracked by hand. One row per shift, since staff_shifts
-- already creates a separate row per login/logout even for the same person
-- on the same day.
ALTER TABLE "public"."staff_shifts"
    ADD COLUMN IF NOT EXISTS "expected_cash_amount" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "counted_cash_amount" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "cash_variance" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "cash_reconciled_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "cash_reconciled_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "deduction_ledger_id" uuid REFERENCES "public"."staff_ledger"("id") ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
-- Add expected_qr_amount and counted_qr_amount to staff_shifts for split Cash vs QR shift reconciliation
ALTER TABLE "public"."staff_shifts"
    ADD COLUMN IF NOT EXISTS "expected_qr_amount" numeric(12,2),
    ADD COLUMN IF NOT EXISTS "counted_qr_amount" numeric(12,2);

NOTIFY pgrst, 'reload schema';
-- Restore the two guards that an older-lineage rewrite dropped, and close the
-- settle-only double-post.
--
-- 1. settle_booking_group_checkout refused any group containing a room that had
--    departed early, because 20260802130000 replaced the settlement-stamp check
--    from 20260729120000 with a status check. Partial departure closes a room
--    WITHOUT settling it, by design, so the combined bill could never be
--    collected -- and the only workaround (settle_member_only) billed one room
--    and silently dropped the other's nights.
--
-- 2. The same function flipped ALL member rooms to 'dirty' on settlement
--    (v_room_ids, introduced by 20260802220000) instead of only the ones this
--    reservation still holds (v_open_room_ids). Inert while (1) blocked the
--    path; live the moment (1) is fixed, which is why both change together.
--
-- 3. settle_booking_checkout_v2 guarded only on status = 'checked_out', which is
--    never true for a settle-only bill (p_close_stay = false), leaving a retry
--    free to post the same settlement twice.
--
-- Both bodies below are the definitions read from production with
-- pg_get_functiondef on 2026-08-23, edited only where commented -- the migration
-- files for these functions have diverged from what is actually running (19
-- redefinitions each), so the live body is the only safe base. search_path
-- pinning from 20260804124419 is preserved.

CREATE OR REPLACE FUNCTION public.settle_booking_group_checkout(p_bookings jsonb, p_restaurant_id uuid, p_session_id uuid, p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric, p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric, p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid, p_room_label text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid, p_payment_status text, p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text, p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0, p_close_stay boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_booking_ids uuid[];
    v_room_ids uuid[];
    v_open_room_ids uuid[];
    v_already_settled text;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_alloc jsonb;
    v_sum_group_paid numeric := 0;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    IF p_bookings IS NULL OR jsonb_array_length(p_bookings) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No bookings supplied for group checkout');
    END IF;

    SELECT array_agg((value->>'booking_id')::uuid), array_agg((value->>'room_id')::uuid)
    INTO v_booking_ids, v_room_ids
    FROM jsonb_array_elements(p_bookings);

    PERFORM 1 FROM public.bookings WHERE id = ANY(v_booking_ids) FOR UPDATE;

    SELECT string_agg(b.id::text, ', ') INTO v_already_settled
    FROM public.bookings b
    -- Read the settlement stamp, not the status. Since partial departure
    -- exists (/api/bookings/checkout-room), 'checked_out' no longer means
    -- "already paid for": a room sent home early is deliberately closed
    -- WITHOUT settling so its share rides on the shared folio. Guarding on
    -- status made that combined bill permanently unsettleable.
    WHERE b.id = ANY(v_booking_ids) AND b.bill_settled_at IS NOT NULL;

    IF v_already_settled IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more bookings have already been settled: ' || v_already_settled);
    END IF;

    SELECT COALESCE(array_agg(room_id), ARRAY[]::uuid[]) INTO v_open_room_ids
    FROM public.bookings
    WHERE id = ANY(v_booking_ids) AND status != 'checked_out';

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE (booking_id = ANY(v_booking_ids)
        OR session_id = p_session_id
        OR session_id IN (SELECT id FROM public.sessions WHERE booking_id = ANY(v_booking_ids)))
    AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        PERFORM 1 FROM public.orders WHERE id = ANY(v_order_ids) FOR UPDATE;
    END IF;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = ANY(v_booking_ids);
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id
            OR booking_id = ANY(v_booking_ids)
            OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids)))
        AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = ANY(v_booking_ids);

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id
       OR booking_id = ANY(v_booking_ids)
       OR table_id IN (SELECT id FROM public.tables WHERE room_id = ANY(v_open_room_ids));

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_bookings)
    LOOP
        v_sum_group_paid := v_sum_group_paid + COALESCE((v_alloc->>'paid_amount')::numeric, 0);

        UPDATE public.bookings
        SET total_amount = COALESCE((v_alloc->>'total_amount')::numeric, 0),
            paid_amount = COALESCE((v_alloc->>'paid_amount')::numeric, 0),
            payment_status = p_payment_status,
            discount_amount = COALESCE((v_alloc->>'discount_amount')::numeric, 0),
            discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
            discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
            discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
            extra_hour_charge = COALESCE((v_alloc->>'extra_hour_charge')::numeric, 0),
            cashier_id = p_user_id,
            bill_settled_at = COALESCE(bill_settled_at, now())
        WHERE id = (v_alloc->>'booking_id')::uuid;
    END LOOP;

    IF p_close_stay THEN
        -- Only the rooms still occupied by this reservation. A room that
        -- departed early went to housekeeping then and may hold a different
        -- guest by now; v_room_ids would evict them from the board.
        UPDATE public.rooms SET status = 'dirty' WHERE id = ANY(v_open_room_ids);
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Rooms ' || p_room_label || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Rooms ' || p_room_label || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Rooms ' || p_room_label || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', v_booking_ids[1],
                    'booking_ids', to_jsonb(v_booking_ids),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Rooms ' || p_room_label || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Rooms ' || p_room_label || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Rooms ' || p_room_label || ')'
        );
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, v_sum_group_paid - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Rooms ' || p_room_label || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'rooms_settled', array_length(v_booking_ids, 1), 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_booking_checkout_v2(p_booking_id uuid, p_restaurant_id uuid, p_room_id uuid, p_session_id uuid, p_hotel_cash numeric, p_hotel_qr numeric, p_hotel_credit numeric, p_rest_cash numeric, p_rest_qr numeric, p_rest_credit numeric, p_discount_amount numeric, p_discount_reason text, p_hotel_credit_account_id uuid, p_room_number text, p_guest_name text, p_user_id uuid, p_partner_restaurant_id uuid, p_settled_now numeric, p_new_paid_amount numeric, p_payment_status text, p_authoritative_total numeric, p_orders_total numeric, p_ledger_split_mode text, p_commission_rate numeric, p_extra_hour_charge numeric DEFAULT 0, p_close_stay boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_booking_status text;
    v_prior_paid numeric;
    v_order_ids uuid[];
    v_total_rest_paid numeric;
    v_commission_amount numeric;
    v_net_to_restaurant numeric;
    v_return_to_guest numeric;
    v_day_book_session_id uuid;
BEGIN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking_status = 'checked_out' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking is already checked out');
    END IF;

    -- The guard above only fires once a stay is closed, so a settle-only bill
    -- (p_close_stay = false) had no protection at all: a retry after a timeout,
    -- or a second till, would post the same settlement again -- doubling
    -- paid_amount, posting the income twice and then emitting a "Return to
    -- Guest" refund for the phantom overpayment.
    --
    -- The caller computed p_new_paid_amount as (the paid_amount it read) +
    -- p_settled_now, so subtracting gives us what it believed it was starting
    -- from. If the row no longer matches, someone settled or took an advance in
    -- between and this request is working from a stale read. A legitimate later
    -- settlement -- charges added after a settle-only bill -- reads fresh and
    -- still passes. The row is already locked by the SELECT ... FOR UPDATE above.
    SELECT COALESCE(paid_amount, 0) INTO v_prior_paid
    FROM public.bookings WHERE id = p_booking_id;

    IF abs(v_prior_paid - (COALESCE(p_new_paid_amount, 0) - COALESCE(p_settled_now, 0))) > 0.005 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'This bill changed after it was loaded (it may already have been settled) -- reload it and settle again.');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE (booking_id = p_booking_id OR session_id = p_session_id OR session_id IN (
        SELECT id FROM public.sessions WHERE booking_id = p_booking_id))
    AND restaurant_id IN (p_restaurant_id, p_partner_restaurant_id)
    AND status != 'cancelled';

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        PERFORM 1 FROM public.orders WHERE id = ANY(v_order_ids) FOR UPDATE;
    END IF;

    IF p_close_stay THEN
        UPDATE public.bookings SET status = 'checked_out' WHERE id = p_booking_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.order_items SET status = 'served'
        WHERE order_id = ANY(v_order_ids) AND status != 'cancelled';

        UPDATE public.orders
        SET status = 'delivered', payment_status = 'paid', paid_at = now(), cashier_id = p_user_id
        WHERE id = ANY(v_order_ids) AND payment_status != 'paid';
    END IF;

    IF p_close_stay THEN
        UPDATE public.sessions SET status = 'closed', closed_at = now()
        WHERE (id = p_session_id OR booking_id = p_booking_id) AND status = 'active';
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        UPDATE public.orders
        SET historical_linked_hotel_id = p_restaurant_id,
            historical_linked_restaurant_id = p_partner_restaurant_id
        WHERE id = ANY(v_order_ids);
    END IF;

    UPDATE public.bookings
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_booking_id;

    UPDATE public.sessions
    SET historical_linked_hotel_id = p_restaurant_id,
        historical_linked_restaurant_id = p_partner_restaurant_id
    WHERE id = p_session_id OR booking_id = p_booking_id;

    UPDATE public.bookings
    SET total_amount = p_authoritative_total,
        paid_amount = p_new_paid_amount,
        payment_status = p_payment_status,
        discount_amount = p_discount_amount,
        discount_reason = CASE WHEN p_discount_amount > 0 THEN p_discount_reason ELSE NULL END,
        discount_applied_by = CASE WHEN p_discount_amount > 0 THEN p_user_id ELSE NULL END,
        discount_applied_at = CASE WHEN p_discount_amount > 0 THEN now() ELSE NULL END,
        extra_hour_charge = COALESCE(p_extra_hour_charge, 0),
        cashier_id = p_user_id,
        bill_settled_at = COALESCE(bill_settled_at, now())
    WHERE id = p_booking_id;

    IF p_close_stay THEN
        UPDATE public.rooms SET status = 'dirty' WHERE id = p_room_id;
    END IF;

    IF p_ledger_split_mode = 'direct' THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF p_hotel_credit > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        v_total_rest_paid := p_rest_cash + p_rest_qr + p_rest_credit;
        IF p_partner_restaurant_id IS NOT NULL AND v_total_rest_paid > 0 THEN
            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_total_rest_paid, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'Room ' || p_room_number || ' checkout - Food Order collected by Hotel (Pending Settlement) (' || p_guest_name || ')');
        END IF;
    ELSE
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_cash + p_rest_cash, 'cash', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (Cash): ' || p_guest_name || ' (Room ' || p_room_number || ')');
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_hotel_qr + p_rest_qr, 'qr_digital', 'Room Revenue', 'booking_payment', 'Room Settlement - B2B (QR): ' || p_guest_name || ' (Room ' || p_room_number || ')');

        IF (p_hotel_credit + p_rest_credit) > 0 AND p_hotel_credit_account_id IS NOT NULL THEN
            INSERT INTO public.receivable_transactions (restaurant_id, customer_credit_account_id, type, amount, description, status, created_by)
            VALUES (
                p_restaurant_id, p_hotel_credit_account_id, 'charge', p_hotel_credit + p_rest_credit,
                jsonb_build_object(
                    'text_desc', 'Room ' || p_room_number || ' stay B2B on credit (' || p_guest_name || ')',
                    'booking_id', p_booking_id,
                    'booking_ids', jsonb_build_array(p_booking_id),
                    'grand_total', p_authoritative_total,
                    'discount', p_discount_amount
                )::text,
                'posted', p_user_id
            );
        END IF;

        IF p_partner_restaurant_id IS NOT NULL AND p_orders_total > 0 THEN
            v_commission_amount := round((p_orders_total * (coalesce(p_commission_rate, 0.00) / 100.00)), 2);
            v_net_to_restaurant := p_orders_total - v_commission_amount;

            PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_orders_total, 'Accounts Payable to Restaurant', 'B2B Food Order Payable to Partner Restaurant (Room ' || p_room_number || ', Guest ' || p_guest_name || ')', 'pending');

            IF v_commission_amount > 0 THEN
                PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, v_commission_amount, 'cash', 'Partner Commission Income', 'booking_payment', 'B2B Food Order Commission (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
            END IF;

            PERFORM public.post_payment_income_sql(p_partner_restaurant_id, NULL, v_net_to_restaurant, 'cash', 'Accounts Receivable from Hotel', 'order_payment', 'B2B Food Order Receivable from Partner Hotel (Room ' || p_room_number || ', Guest ' || p_guest_name || ')');
        END IF;
    END IF;

    IF p_discount_amount > 0 THEN
        PERFORM public.post_expense_sql(p_restaurant_id, p_user_id, p_discount_amount, 'Bargain Discounts', 'Bargain discount: ' || p_discount_reason || ' (' || p_guest_name || ', Room ' || p_room_number || ')', 'paid');
    END IF;

    IF p_extra_hour_charge > 0 THEN
        PERFORM public.post_payment_income_sql(p_restaurant_id, p_user_id, p_extra_hour_charge,
            CASE WHEN p_hotel_qr > 0 THEN 'qr_digital'::text ELSE 'cash'::text END,
            'extra hour', 'booking_payment',
            'Extra Hour Charge: ' || p_guest_name || ' (Room ' || p_room_number || ')');
    END IF;

    -- Record excess advance refund ("Return to Guest") as cash_out in day_book_entries
    v_return_to_guest := round(GREATEST(0, p_new_paid_amount - p_authoritative_total), 2);
    IF v_return_to_guest > 0 THEN
        SELECT id INTO v_day_book_session_id
        FROM public.day_book_sessions
        WHERE restaurant_id = p_restaurant_id AND status = 'open'
        LIMIT 1;

        IF v_day_book_session_id IS NULL THEN
            INSERT INTO public.day_book_sessions (restaurant_id, date, opening_balance, opening_bank_balance, status, created_by)
            VALUES (p_restaurant_id, CURRENT_DATE::text, 0.00, 0.00, 'open', p_user_id)
            RETURNING id INTO v_day_book_session_id;
        END IF;

        INSERT INTO public.day_book_entries (
            session_id, restaurant_id, type, amount, description, category, created_by
        ) VALUES (
            v_day_book_session_id, p_restaurant_id, 'cash_out', v_return_to_guest,
            'Return to Guest (Refund): ' || p_guest_name || ' (Room ' || p_room_number || ')',
            'refund', p_user_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'closed', p_close_stay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
-- Keep the service charge on the order total when a pricing rule reprices it.
--
-- Both order paths write total_amount = subtotal + service_charge + tax and THEN
-- call apply_pricing_rules_to_order (waiter/actions.ts:816 then :854;
-- t/[tableSlug]/checkout/actions.ts:403 then :445, and its fallback at :740 then
-- :753). This function rebuilt the total as subtotal - discount + tax, silently
-- dropping the service charge that had just been written.
--
-- Downstream reads that total as authoritative: /api/tables/checkout bills a
-- service-charge override as the DIFFERENCE from what the order already carries
-- ("Each order's total_amount already contains its own service charge"), so with
-- the charge stripped the delta came to zero and it was never billed at all. The
-- room folio recomputes the charge itself and was unaffected, but shiftCash and
-- reports read a service_charge_amount that the matching total did not contain.
--
-- tax_amount is deliberately left as it stands: it is written by the caller for
-- the whole order and this function has no rate to recompute it from. A pricing
-- rule that changes unit_price therefore still leaves tax slightly stale -- a
-- separate defect, not one this migration can fix correctly.
--
-- Body read from production with pg_get_functiondef on 2026-08-23 and edited
-- only where marked; the migration files for this function have drifted.

CREATE OR REPLACE FUNCTION public.apply_pricing_rules_to_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_restaurant_id UUID;
    v_now           TIMESTAMPTZ := now();
    v_dow           INT         := EXTRACT(DOW FROM v_now)::INT;
    v_time          TIME        := v_now::TIME;
    v_date          DATE        := v_now::DATE;
    v_item          RECORD;
    v_rule          RECORD;
    v_new_price     NUMERIC;
    v_new_subtotal  NUMERIC := 0;
    v_var_name      TEXT;
    v_item_base_price NUMERIC;
BEGIN
    SELECT restaurant_id INTO v_restaurant_id
    FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN RETURN; END IF;
    FOR v_item IN
        SELECT
            oi.id          AS oi_id,
            oi.quantity,
            oi.unit_price,
            mi.price       AS base_price,
            mi.id          AS menu_item_id,
            mi.category_id AS category_id,
            oi.special_request
        FROM order_items oi
        JOIN menu_items  mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = p_order_id
    LOOP
        -- Determine the base price of the item before discount.
        -- If it's a variation item, extract the variation name from the special_request column
        -- (e.g. '[large cheese pizza] ...') and look up its price in menu_item_variations.
        v_item_base_price := v_item.base_price;
        
        IF v_item.special_request IS NOT NULL THEN
            v_var_name := substring(v_item.special_request from '^\[([^\]]+)\]');
            IF v_var_name IS NOT NULL THEN
                SELECT price INTO v_item_base_price
                FROM menu_item_variations
                WHERE menu_item_id = v_item.menu_item_id
                  AND name = v_var_name
                LIMIT 1;
                
                IF NOT FOUND THEN
                    v_item_base_price := v_item.base_price;
                END IF;
            END IF;
        END IF;
        
        -- Safe fallback: if the base price resolved to 0 but unit_price was already set to a non-zero value,
        -- use the current unit_price as the base price.
        IF v_item_base_price = 0 AND v_item.unit_price > 0 THEN
            v_item_base_price := v_item.unit_price;
        END IF;
        SELECT *
        INTO   v_rule
        FROM   pricing_rules
        WHERE  restaurant_id = v_restaurant_id
          AND  is_active = true
          AND  v_dow = ANY(days_of_week)
          AND  v_time BETWEEN start_time::TIME AND end_time::TIME
          AND  (valid_from  IS NULL OR valid_from::DATE  <= v_date)
          AND  (valid_until IS NULL OR valid_until::DATE >= v_date)
          AND  (
                   applies_to_item_id     = v_item.menu_item_id
                OR applies_to_category_id = v_item.category_id
                OR applies_to_all         = true
               )
        ORDER BY
            CASE
                WHEN applies_to_item_id     IS NOT NULL THEN 1
                WHEN applies_to_category_id IS NOT NULL THEN 2
                ELSE                                         3
            END,
            priority DESC
        LIMIT 1;
        IF FOUND THEN
            v_new_price := CASE v_rule.rule_type
                WHEN 'percentage_off' THEN GREATEST(0, v_item_base_price * (1 - v_rule.value / 100.0))
                WHEN 'amount_off'     THEN GREATEST(0, v_item_base_price - v_rule.value)
                WHEN 'fixed_price'    THEN v_rule.value
                ELSE                       v_item.unit_price
            END;
            UPDATE order_items SET unit_price = v_new_price WHERE id = v_item.oi_id;
        ELSE
            v_new_price := v_item.unit_price;
        END IF;
        v_new_subtotal := v_new_subtotal + (v_new_price * v_item.quantity);
    END LOOP;
    UPDATE orders
    SET
        subtotal_amount = v_new_subtotal,
        total_amount    = v_new_subtotal
                          - COALESCE(discount_amount, 0)
                          + COALESCE(service_charge_amount, 0)
                          + COALESCE(tax_amount, 0)
    WHERE id = p_order_id;
END;
$function$;
-- Add money to a booking's paid_amount in one statement.
--
-- Two call sites read paid_amount into JS, added to it and wrote the sum back
-- (/api/bookings/advance and /api/tables/checkout crediting a linked table bill
-- to the stay). Two advances taken at the same moment, or a table bill settled
-- while the desk takes a deposit, and one of them is lost: its booking_payments
-- row and its ledger posting survive, so the books say the money came in while
-- the guest's balance says it did not.
--
-- Returns the new balance so callers that need it (the advance route reports it
-- back to the screen) do not have to re-read.

CREATE OR REPLACE FUNCTION public.increment_booking_paid_amount(
    p_booking_id uuid,
    p_restaurant_id uuid,
    p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_new_paid numeric;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'increment_booking_paid_amount: amount must be greater than zero';
    END IF;

    UPDATE public.bookings
    SET paid_amount = COALESCE(paid_amount, 0) + p_amount
    WHERE id = p_booking_id
      AND restaurant_id = p_restaurant_id
    RETURNING paid_amount INTO v_new_paid;

    IF v_new_paid IS NULL THEN
        RAISE EXCEPTION 'increment_booking_paid_amount: booking % not found for this restaurant', p_booking_id;
    END IF;

    RETURN v_new_paid;
END;
$function$;

-- Same lockdown the other settlement functions get: reachable by the server's
-- service role, never by an anon or authenticated caller directly.
REVOKE ALL ON FUNCTION public.increment_booking_paid_amount(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_booking_paid_amount(uuid, uuid, numeric) TO service_role;
-- Tie the "Credit Sale" income row to the receivable transaction that created it.
--
-- Recording a credit charge writes a receivable_transactions row AND an
-- income_entries row recognising the sale. Deleting the charge removed only the
-- first, leaving income the business never earned on the books with no way to
-- find it again -- income_entries carries no reference to its source.
--
-- ON DELETE CASCADE rather than app-side cleanup: the delete path is a plain
-- .delete() in a server action, and anything that removes a receivable
-- transaction by any route should take its recognition with it.

ALTER TABLE public.income_entries
    ADD COLUMN IF NOT EXISTS receivable_transaction_id uuid
        REFERENCES public.receivable_transactions(id) ON DELETE CASCADE;

-- Only rows written by the credit-charge path ever carry this, so the index
-- stays small; it exists for the cascade's own lookup.
CREATE INDEX IF NOT EXISTS income_entries_receivable_transaction_id_idx
    ON public.income_entries (receivable_transaction_id)
    WHERE receivable_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.income_entries.receivable_transaction_id IS
    'Set when this income row recognises a credit sale; deleting that receivable_transactions row deletes this one. NULL for every other income entry.';
-- Record what a booking payment IS, instead of inferring it from its note text.
--
-- An advance and a settlement are different things -- one reduces what the guest
-- still owes, the other IS the payment of it -- and the only thing separating
-- them was the literal note 'Settlement' written by the checkout route. `note`
-- is user-editable free text on the advance form, so a clerk typing "Settlement"
-- into it reclassified their own deposit: bookingBill dropped it from
-- advanceTotal and the guest was asked for the full bill again. shiftCash and
-- the customer statement key off the same string.
--
-- Backfilled from the note so existing rows carry the same meaning they had.
-- Readers keep a note-based fallback for NULL, which is what rows written by the
-- previous release during a rollout will have.

ALTER TABLE public.booking_payments
    ADD COLUMN IF NOT EXISTS payment_kind text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_payment_kind_check'
    ) THEN
        ALTER TABLE public.booking_payments
            ADD CONSTRAINT booking_payments_payment_kind_check
            CHECK (payment_kind IS NULL OR payment_kind IN ('advance', 'settlement'));
    END IF;
END $$;

UPDATE public.booking_payments
SET payment_kind = CASE WHEN note = 'Settlement' THEN 'settlement' ELSE 'advance' END
WHERE payment_kind IS NULL;

COMMENT ON COLUMN public.booking_payments.payment_kind IS
    'advance = money taken before settlement; settlement = the payment of the bill itself. NULL only for rows written by a release that predates this column - readers fall back to note = ''Settlement''.';
