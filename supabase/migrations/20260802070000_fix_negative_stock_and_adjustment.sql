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
