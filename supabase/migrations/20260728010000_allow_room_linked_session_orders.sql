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
