-- Fix apply_pricing_rules_to_order to support menu item variations.
-- Since variations have a base price of 0 in menu_items, the function previously
-- calculated discounts based on 0, resetting the unit_price and order totals to 0.
-- This fix extracts the variation name from the special_request column to look up 
-- the correct variation price, falling back to order_items.unit_price if already set.

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
