-- Voids, comps and refunds all already work — cancelOrder, cancelOrderItem and
-- refundOrderAction each take a reason and each post their value to the books.
-- What none of them produce is data anyone can add up. Every reason is free
-- text, so "how much did we lose to kitchen errors last month, and how much
-- did we give away as staff meals" has no answer short of reading 400 strings.
--
-- Three gaps, closed here:
--
-- 1. Reason CODES beside the free text. The text stays — it is where the
--    specifics live ("table 7 sent back the momo, cold") — but the code is what
--    a report can group by. The vocabulary lives in lib/voidReasons.ts and is
--    validated in the actions; deliberately no CHECK constraint, so adding a
--    code stays a one-line TS change rather than a migration + deploy dance.
--
-- 2. COMP as a first-class kind. A staff meal and a kitchen mistake are both
--    "cancelled" today and land in the same Order Cancellation expense, which
--    makes the wastage number wrong in both directions: it counts food that was
--    deliberately given away, and it hides the cost of feeding staff. They post
--    to separate expense categories now, so the two are separable.
--
-- 3. Item-level attribution. cancelOrderItem writes its reason to the audit log
--    only — the order_items row itself records nothing about who voided it, why,
--    or when. That is the one place a cashier can quietly remove a single plate
--    from a bill, so it is exactly the row that needs to carry the evidence.
--
-- Refund reason moves onto its own columns for the same reason. It was being
-- appended to orders.customer_note — a field the customer wrote and, on some
-- receipts, reads back — which mixed staff-only audit text into guest-facing
-- content and made the note unparseable after two refunds.

-- Guarded because CREATE TYPE has no IF NOT EXISTS: every other statement in
-- this file is re-runnable, and one that isn't would fail a replay of the whole
-- migration on a database that already has the type.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_kind') THEN
        CREATE TYPE "public"."cancellation_kind" AS ENUM (
            'void',   -- cancelled: a mistake, a change of mind, an item sent back
            'comp'    -- deliberately given free: staff meal, service recovery, tasting
        );
    END IF;
END $$;

ALTER TABLE "public"."orders"
    ADD COLUMN IF NOT EXISTS "cancellation_kind" "public"."cancellation_kind",
    ADD COLUMN IF NOT EXISTS "cancellation_reason_code" "text",
    ADD COLUMN IF NOT EXISTS "refund_reason" "text",
    ADD COLUMN IF NOT EXISTS "refund_reason_code" "text";

ALTER TABLE "public"."order_items"
    ADD COLUMN IF NOT EXISTS "cancellation_kind" "public"."cancellation_kind",
    ADD COLUMN IF NOT EXISTS "cancellation_reason" "text",
    ADD COLUMN IF NOT EXISTS "cancellation_reason_code" "text",
    ADD COLUMN IF NOT EXISTS "cancelled_by" "uuid",
    ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

-- SET NULL rather than RESTRICT: losing the name of a staff member who has
-- since been deleted must not make the void record itself undeletable, and the
-- audit log keeps the user id independently.
ALTER TABLE ONLY "public"."order_items"
    DROP CONSTRAINT IF EXISTS "order_items_cancelled_by_fkey";
ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

-- Partial indexes: voids and comps are a small fraction of all rows, and every
-- report that wants them wants only them.
CREATE INDEX IF NOT EXISTS "orders_cancellation_kind_idx"
    ON "public"."orders" USING "btree" ("restaurant_id", "cancellation_kind", "placed_at" DESC)
    WHERE "cancellation_kind" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "order_items_cancellation_idx"
    ON "public"."order_items" USING "btree" ("cancelled_at" DESC)
    WHERE "cancellation_kind" IS NOT NULL;

-- Anon exposure — the two tables differ, and it is worth being exact:
--
--   orders      anon has NO table-level SELECT, only per-column grants (the
--               customer order tracker reads a handful). New columns are
--               therefore private by default, which is what we want:
--               refund_reason is internal. Do not add anon grants for them.
--
--   order_items anon DOES hold a table-level SELECT, so the five columns added
--               above are readable by anon for whatever rows RLS lets through
--               (a guest's own order). That is inherited, not introduced here —
--               the table already exposes chef_id, claimed_by and
--               special_request the same way — but cancellation_reason is
--               staff-written free text, which is a genuinely new kind of
--               content on that surface. Staff should assume a guest can read
--               what they type there.
--
-- Tightening it means revoking the table-level SELECT and re-granting the
-- columns the guest flows actually need, which touches live guest-facing reads
-- and does not belong in this migration.
