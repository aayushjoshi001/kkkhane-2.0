-- Fix missing search_path on apply_pricing_rules_to_order and
-- deduct_ingredients_for_order. Both were created as SECURITY DEFINER
-- without SET search_path, causing "relation does not exist" errors
-- when the hosted Supabase instance has an empty search_path default.

CREATE OR REPLACE FUNCTION public.apply_pricing_rules_to_order(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
            mi.category_id AS category_id
        FROM order_items oi
        JOIN menu_items  mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = p_order_id
    LOOP
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
                WHEN 'percentage_off' THEN GREATEST(0, v_item.base_price * (1 - v_rule.value / 100.0))
                WHEN 'amount_off'     THEN GREATEST(0, v_item.base_price - v_rule.value)
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

CREATE OR REPLACE FUNCTION public.deduct_ingredients_for_order(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

GRANT EXECUTE ON FUNCTION public.apply_pricing_rules_to_order(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_ingredients_for_order(UUID) TO service_role;
