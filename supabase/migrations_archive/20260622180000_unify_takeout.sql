-- Phase 2 — Unify takeout into the orders pipeline.
--
-- Before: takeout lived in takeout_orders with a denormalized JSONB `items`
-- column, bypassing order_items, ingredient deduction, KOT and the kitchen
-- OrderQueue. After: takeout flows through the same orders/order_items tables
-- via place_takeout_order(), which mirrors place_order() minus the table session.
--
-- Status model (decision): takeout reuses order_status; its terminal "picked up"
-- maps to 'delivered' (shown as "Picked up" in the takeout UI). No enum change,
-- avoiding the enum/CHECK-constraint gotchas noted in project memory.

-- 1. order_type enum + columns on orders ------------------------------------
DO $$ BEGIN
  CREATE TYPE order_type AS ENUM ('dine_in', 'takeout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_type      order_type NOT NULL DEFAULT 'dine_in',
  ADD COLUMN IF NOT EXISTS customer_name   text,
  ADD COLUMN IF NOT EXISTS customer_phone  text,
  ADD COLUMN IF NOT EXISTS customer_email  text,
  ADD COLUMN IF NOT EXISTS pickup_time     timestamptz,
  -- provenance marker so the backfill below is idempotent and reconcilable
  ADD COLUMN IF NOT EXISTS legacy_takeout_id uuid;

-- 2. session_id is required for dine-in only; takeout has no table session ---
ALTER TABLE public.orders ALTER COLUMN session_id DROP NOT NULL;

-- Guard: a dine-in order must have a session; a takeout order must not.
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_session_per_type_chk CHECK (
    (order_type = 'dine_in' AND session_id IS NOT NULL)
    OR (order_type = 'takeout' AND session_id IS NULL)
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_orders_legacy_takeout_id ON public.orders (legacy_takeout_id);
CREATE INDEX IF NOT EXISTS idx_orders_type_restaurant   ON public.orders (restaurant_id, order_type);

-- 3. place_takeout_order RPC -------------------------------------------------
-- Mirrors place_order() (items, stock, recipes, modifiers, promo, tax, loyalty)
-- but takes a restaurant + customer instead of a session.
CREATE OR REPLACE FUNCTION public.place_takeout_order(
  p_restaurant_id     uuid,
  p_items             jsonb,
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_email    text        DEFAULT NULL,
  p_pickup_time       timestamptz DEFAULT NULL,
  p_customer_note     text        DEFAULT NULL,
  p_promo_code        text        DEFAULT NULL,
  p_loyalty_member_id uuid        DEFAULT NULL,
  p_client_request_id text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  -- Validate the restaurant exists and is operational.
  SELECT (is_active AND NOT COALESCE(is_suspended, false)) INTO v_restaurant_active
  FROM restaurants WHERE id = p_restaurant_id;

  IF NOT FOUND OR NOT v_restaurant_active THEN
    RAISE EXCEPTION 'INVALID_RESTAURANT: Restaurant % is not available', p_restaurant_id;
  END IF;

  -- Idempotency: return the existing order for a repeated client_request_id.
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

-- 4. Backfill existing takeout_orders into orders/order_items ----------------
-- Idempotent: skips any takeout order already migrated (legacy_takeout_id set).
DO $$
DECLARE
  t RECORD;
  v_new_order_id UUID;
  v_line JSONB;
  v_mapped_status order_status;
BEGIN
  FOR t IN
    SELECT * FROM takeout_orders src
    WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.legacy_takeout_id = src.id)
  LOOP
    v_mapped_status := CASE t.status::text
      WHEN 'placed'           THEN 'pending'
      WHEN 'confirmed'        THEN 'confirmed'
      WHEN 'preparing'        THEN 'preparing'
      WHEN 'ready_for_pickup' THEN 'ready'
      WHEN 'picked_up'        THEN 'delivered'
      WHEN 'cancelled'        THEN 'cancelled'
      ELSE 'pending'
    END::order_status;

    INSERT INTO orders (
      session_id, restaurant_id, order_type, status, payment_status,
      customer_name, customer_phone, customer_email, pickup_time,
      customer_note, subtotal_amount, discount_amount, tax_amount, total_amount,
      promo_code_id, loyalty_member_id, placed_at, confirmed_at, ready_at,
      delivered_at, legacy_takeout_id
    )
    VALUES (
      NULL, t.restaurant_id, 'takeout', v_mapped_status, t.payment_status,
      t.customer_name, t.customer_phone, t.customer_email, t.pickup_time,
      t.customer_note, t.subtotal_amount, t.discount_amount, t.tax_amount, t.total_amount,
      t.promo_code_id, t.loyalty_member_id, t.placed_at, t.confirmed_at, t.ready_at,
      t.picked_up_at, t.id
    )
    RETURNING id INTO v_new_order_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(t.items) LOOP
      -- Skip lines whose menu item no longer exists (order_items.menu_item_id
      -- is NOT NULL + FK); the order's stored totals remain authoritative.
      CONTINUE WHEN (v_line->>'menu_item_id') IS NULL
        OR NOT EXISTS (SELECT 1 FROM menu_items WHERE id = (v_line->>'menu_item_id')::UUID);

      INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_request)
      VALUES (
        v_new_order_id,
        (v_line->>'menu_item_id')::UUID,
        COALESCE((v_line->>'quantity')::SMALLINT, 1),
        COALESCE((v_line->>'unit_price')::NUMERIC, 0),
        v_line->>'special_request'
      );
    END LOOP;
  END LOOP;
END $$;
