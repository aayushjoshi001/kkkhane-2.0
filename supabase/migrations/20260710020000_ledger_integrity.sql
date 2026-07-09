-- ============================================================
-- Ledger integrity: ownership links + atomic counters
-- ============================================================

-- ── 1. Day Book entry ownership ──────────────────────────────────────────────
-- Vouchers and the Cash/Bank Book "Expense" entries create a day_book_entries
-- row *and* a downstream expenses / staff_ledger row. Deleting the Day Book
-- entry used to leave the downstream row behind forever, because nothing
-- linked the two. Modules where the Day Book entry owns the record set this
-- column and the cascade cleans up after them.
--
-- Income & Expenses, Suppliers and Staff work the other way round — they
-- create their record first and post the Day Book entry as a side effect — so
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


-- ── 2. Atomic voucher numbering ──────────────────────────────────────────────
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


-- ── 3. Atomic stock adjustment ───────────────────────────────────────────────
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
