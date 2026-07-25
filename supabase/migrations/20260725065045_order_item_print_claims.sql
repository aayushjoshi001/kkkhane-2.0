-- Make a printed kitchen ticket a piece of state rather than a side effect of a
-- realtime event.
--
-- Auto-print was driven entirely by postgres_changes: a station printed an
-- order because it happened to be subscribed the instant the row was inserted.
-- Realtime is at-most-once and only while you are listening, so no tab open, a
-- wifi blip or a sleeping laptop meant the ticket simply never existed, with
-- nothing recording that it should have. That is fine for refreshing a UI (a
-- missed update self-corrects on the next fetch) and wrong for a physical,
-- one-shot side effect: a missed ticket is a dish that never gets cooked.
--
-- kot_printed_at moves that fact onto the row. A station claims lines
-- atomically, so two open tabs cannot print the same ones, and anything still
-- unclaimed is outstanding work any station can pick up whenever it connects.
-- Granularity is per item, not per order, because a QR self-order is confirmed
-- in batches and each batch prints only its own new lines.

ALTER TABLE "public"."order_items"
    ADD COLUMN IF NOT EXISTS "kot_printed_at" timestamptz;

-- Everything that exists today has already been printed (or is long past
-- mattering). Without this backfill the first station to connect after this
-- migration would treat the entire order history as outstanding and print it.
UPDATE "public"."order_items" SET "kot_printed_at" = now() WHERE "kot_printed_at" IS NULL;

-- The outstanding-work query is "unprinted lines, newest orders first", so index
-- only the unprinted rows. The set is near-empty in steady state, which keeps
-- this tiny no matter how large order_items grows.
CREATE INDEX IF NOT EXISTS "order_items_unprinted_idx"
    ON "public"."order_items" ("order_id")
    WHERE "kot_printed_at" IS NULL;

-- Claim lines for printing, returning only the ids this caller won.
--
-- The UPDATE ... WHERE kot_printed_at IS NULL ... RETURNING is the whole
-- concurrency story: row locks serialise two stations racing for the same
-- lines, and the loser's WHERE no longer matches, so it gets back an empty set
-- and prints nothing. Callers must print exactly what is returned.
--
-- SECURITY DEFINER because staff hold read-only RLS on order_items; the
-- restaurant check below is what stops it becoming a cross-tenant write.
CREATE OR REPLACE FUNCTION "public"."claim_order_items_for_printing"("p_item_ids" "uuid"[])
    RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_restaurant_id UUID := current_restaurant_id();
BEGIN
    IF v_restaurant_id IS NULL OR p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE order_items oi
       SET kot_printed_at = now()
      FROM orders o
     WHERE oi.order_id = o.id
       AND oi.id = ANY(p_item_ids)
       AND oi.kot_printed_at IS NULL
       AND o.restaurant_id = v_restaurant_id
    RETURNING oi.id;
END;
$$;

-- Hand a claim back when the ticket never made it onto paper, so the lines stay
-- outstanding for the next attempt instead of being lost to a claim that
-- printed nothing. Scoped the same way as the claim.
CREATE OR REPLACE FUNCTION "public"."release_order_item_print_claim"("p_item_ids" "uuid"[])
    RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_restaurant_id UUID := current_restaurant_id();
BEGIN
    IF v_restaurant_id IS NULL OR p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    UPDATE order_items oi
       SET kot_printed_at = NULL
      FROM orders o
     WHERE oi.order_id = o.id
       AND oi.id = ANY(p_item_ids)
       AND o.restaurant_id = v_restaurant_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."claim_order_items_for_printing"("uuid"[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION "public"."release_order_item_print_claim"("uuid"[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."claim_order_items_for_printing"("uuid"[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION "public"."release_order_item_print_claim"("uuid"[]) TO authenticated, service_role;

-- Version deliberately matches the version this was recorded under when applied
-- to production (supabase_migrations.schema_migrations), so a later db push
-- skips it. Re-running would be worse than a no-op: the DDL is guarded, but the
-- backfill above would stamp genuinely-unprinted lines as printed and swallow
-- exactly the tickets this migration exists to guarantee.
