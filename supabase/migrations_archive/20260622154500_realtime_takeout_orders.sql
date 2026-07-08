-- Add takeout_orders to the realtime publication.
-- This ensures that when takeout orders are marked as ready, the waiter page receives updates in real time.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_rel pr
        JOIN pg_class c ON pr.prrelid = c.oid
        JOIN pg_publication p ON pr.prpubid = p.oid
        WHERE c.relname = 'takeout_orders' AND p.pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.takeout_orders;
    END IF;
END
$$;
