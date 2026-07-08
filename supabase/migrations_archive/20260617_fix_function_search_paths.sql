-- All DB functions were created with SET search_path TO '' (security hardening)
-- but their bodies use unqualified table names (e.g. FROM sessions, INSERT INTO orders).
-- With an empty search path those references fail immediately:
--   ERROR: relation "sessions" does not exist
-- This caused ALL customer orders to fail via the primary RPC path.
-- Fix: set search_path to 'public' so unqualified names resolve correctly.

-- ─── place_order overload 1 (simple, no modifiers/promo) ────────────────────
CREATE OR REPLACE FUNCTION public.place_order(
  p_session_id   uuid,
  p_items        jsonb,
  p_customer_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

-- ─── place_order overload 2 (with seat + modifiers) ─────────────────────────
CREATE OR REPLACE FUNCTION public.place_order(
  p_session_id    uuid,
  p_items         jsonb,
  p_customer_note text DEFAULT NULL,
  p_seat_id       uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

-- ─── place_order overload 3 (full: promo + loyalty + dynamic pricing) ────────
CREATE OR REPLACE FUNCTION public.place_order(
  p_session_id        uuid,
  p_items             jsonb,
  p_customer_note     text  DEFAULT NULL,
  p_seat_id           uuid  DEFAULT NULL,
  p_promo_code        text  DEFAULT NULL,
  p_loyalty_member_id uuid  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM sessions
  WHERE id = p_session_id AND status = 'active' AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION: Session % is not active or has expired', p_session_id;
  END IF;

  SELECT COALESCE((features_v2->>'defaultTaxRate')::NUMERIC, 0) INTO v_tax_rate
  FROM settings WHERE restaurant_id = v_restaurant_id;

  INSERT INTO orders (session_id, restaurant_id, customer_note, seat_id, loyalty_member_id)
  VALUES (p_session_id, v_restaurant_id, p_customer_note, p_seat_id, p_loyalty_member_id)
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

-- ─── get_effective_price ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_effective_price(
  p_menu_item_id uuid,
  p_at           timestamp with time zone DEFAULT now()
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_base_price      NUMERIC(10,2);
  v_category_id     UUID;
  v_restaurant_id   UUID;
  v_rule            RECORD;
  v_effective_price NUMERIC(10,2);
  v_day             SMALLINT;
  v_time            TIME;
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
      applies_to_item_id        = p_menu_item_id
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

-- ─── generate_invoice_number ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_seq  INTEGER;
  v_year TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kathmandu', 'YYYY');
BEGIN
  INSERT INTO invoice_sequences (restaurant_id, last_sequence)
  VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET last_sequence = invoice_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  RETURN 'INV-' || v_year || '-' || lpad(v_seq::TEXT, 5, '0');
END;
$$;

-- ─── assign_invoice_on_paid (trigger function) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_invoice_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
