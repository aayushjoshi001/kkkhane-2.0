-- Force PostgREST to reload its schema cache.
--
-- Several recent migrations added columns (order_items.claimed_by/claimed_at,
-- orders.needs_confirmation/cancellation_reason/delivery_*, tables.cleaning_*).
-- When DDL is applied without notifying PostgREST, its cached schema goes stale
-- and the REST API rejects those columns ("column ... does not exist") even
-- though they exist in Postgres — which broke kitchen Cook / Mark Ready.
--
-- Always end column-adding migrations with this NOTIFY.
NOTIFY pgrst, 'reload schema';
