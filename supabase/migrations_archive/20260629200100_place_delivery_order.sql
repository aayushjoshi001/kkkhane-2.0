-- place_delivery_order: sibling of place_takeout_order for online delivery.
-- Same unified-orders pipeline (items, stock deduction, pricing, promo, tax) but
-- sets order_type='delivery', stores the delivery address, and generates a 4-digit
-- verification code the customer reads back to the delivery staff on arrival.
-- A separate function (not extra params on place_takeout_order) avoids PostgREST
-- overload-resolution ambiguity.

CREATE OR REPLACE FUNCTION public.place_delivery_order(
  p_restaurant_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_customer_email text DEFAULT NULL,
  p_customer_note text DEFAULT NULL,
  p_promo_code text DEFAULT NULL,
  p_loyalty_member_id uuid DEFAULT NULL,
  p_client_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
