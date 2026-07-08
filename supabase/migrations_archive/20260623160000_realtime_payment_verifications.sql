-- Add payment_verifications to the realtime publication.
-- PaymentVerificationFeed subscribes to this table via useRestaurantTable, but
-- the table was never published — so new online-payment claims (INSERT) and
-- staff verify/reject updates only appeared on a full reload, never live. This
-- powers live verification on both the waiter and the cashier portals.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_rel pr
        JOIN pg_class c ON pr.prrelid = c.oid
        JOIN pg_publication p ON pr.prpubid = p.oid
        WHERE c.relname = 'payment_verifications' AND p.pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_verifications;
    END IF;
END
$$;
