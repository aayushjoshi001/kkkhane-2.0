


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
    "footer" "jsonb" DEFAULT '{"enabled": true, "copyright": "© 2024 Your Restaurant", "social_links": []}'::"jsonb" NOT NULL,
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




























