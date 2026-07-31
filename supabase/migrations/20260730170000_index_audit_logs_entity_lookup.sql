-- The booking bill/history lookup (see lib/bookingBill.ts) finds a stay's
-- settlement snapshot by filtering audit_logs on restaurant_id, entity_type,
-- entity_id and action, ordered by created_at desc limit 1. audit_logs has
-- one row per action across the whole restaurant, and the only existing
-- indexes cover (restaurant_id, created_at) or user_id — neither helps this
-- query pick out one entity's rows, so it degrades as the log grows. This
-- covers the lookup directly.
CREATE INDEX IF NOT EXISTS "audit_logs_entity_lookup_idx"
    ON "public"."audit_logs" USING "btree" ("restaurant_id", "entity_type", "entity_id", "created_at" DESC);
