-- Add is_combo column to menu_items if it doesn't exist
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS is_combo BOOLEAN DEFAULT false NOT NULL;

-- Create combo_items table
CREATE TABLE IF NOT EXISTS public.combo_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    combo_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_combo_item UNIQUE (combo_id, item_id)
);

-- Enable RLS
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;

-- Create policies for combo_items
CREATE POLICY "public_read_combo_items" ON public.combo_items
    FOR SELECT USING (true);

CREATE POLICY "admin_write_combo_items" ON public.combo_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid() AND r.name IN ('super_admin', 'manager')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid() AND r.name IN ('super_admin', 'manager')
        )
    );

-- Recreate place_order with combo stock/ingredient deduction support.
-- Drop the existing function first.
DROP FUNCTION IF EXISTS public.place_order(uuid, jsonb, text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.place_order(
  p_session_id        uuid,
  p_items             jsonb,
  p_customer_note     text  DEFAULT NULL,
  p_seat_id           uuid  DEFAULT NULL,
  p_promo_code        text  DEFAULT NULL,
  p_loyalty_member_id uuid  DEFAULT NULL,
  p_client_request_id text  DEFAULT NULL
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
