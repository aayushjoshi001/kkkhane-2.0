-- Orders that never go to a station.
--
-- A ticket assumes someone has to make the thing. Plenty of what a counter
-- sells does not: cigarettes, a bottle off the shelf, a packet of crisps. The
-- cashier takes it down, hands it over and the transaction is finished before
-- any printer could have spat paper. Until now every staff order still queued
-- to the kitchen or bar board and still printed a KOT, so someone had to walk
-- over and mark a cigarette 'ready' before it would leave the queue — and the
-- board filled with work nobody was doing.
--
-- `no_kot` records that the goods changed hands across the counter. Orders
-- carrying it are written with every line already 'served' and the order
-- already 'delivered', which is what keeps them off the station boards (those
-- query pending/confirmed/preparing/ready) and out of the print claim.
--
-- It is a record, not a mechanism: nothing reads this column to decide whether
-- to print. The order is simply never in a state a station would look at. The
-- column exists so "sold over the counter" stays distinguishable afterwards
-- from "cooked, served and closed", which the statuses alone cannot tell apart.
--
-- Billing is untouched. These lines are on the bill exactly like any other, and
-- stock was deducted by place_order the same way — the only thing skipped is
-- the paper and the queue.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS no_kot boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.no_kot IS
    'Sold straight over the counter — cigarettes, a bottle off the shelf — so no station ticket was printed and no station ever queued it. Its lines are written already served. Billing and stock behave exactly as for any other order.';

-- The question this column gets asked is "what did we sell over the counter
-- today", always within one restaurant and date range.
CREATE INDEX IF NOT EXISTS orders_no_kot_idx
    ON public.orders USING btree (restaurant_id, placed_at)
    WHERE no_kot;

-- Placing a counter sale, atomically.
--
-- Marking the lines finished in a second round-trip after place_order() is not
-- enough. Realtime publishes at COMMIT, so the station board receives the
-- INSERT the instant place_order's transaction closes — with every line still
-- unclaimed — and its 400ms print timer starts before the follow-up UPDATE can
-- land. The ticket would print perhaps nine times in ten and not the tenth,
-- which is the worst possible behaviour for a feature whose entire purpose is
-- not printing.
--
-- Doing both in one transaction removes the window: the board's first sight of
-- the order already has `kot_printed_at` set on every line, and
-- claim_order_items_for_printing() only ever claims rows where that is NULL. No
-- station can take them, so no station can print them — by construction rather
-- than by winning a race.
--
-- Deliberately a thin wrapper. place_order() owns pricing, promos, loyalty,
-- stock deduction and idempotency, and none of that changes for a packet of
-- cigarettes; forking it would mean maintaining that twice.
CREATE OR REPLACE FUNCTION public.place_counter_order(
    p_session_id uuid,
    p_items jsonb,
    p_customer_note text DEFAULT NULL,
    p_client_request_id text DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
    v_result jsonb;
    v_order_id uuid;
BEGIN
    v_result := public.place_order(
        p_session_id, p_items, p_customer_note,
        NULL, NULL, NULL, p_client_request_id, false
    );

    v_order_id := NULLIF(v_result->>'order_id', '')::uuid;
    -- place_order reports its own failures in the payload; pass them straight
    -- back rather than masking them with a stamping error.
    IF v_order_id IS NULL THEN
        RETURN v_result;
    END IF;

    -- Handed over, so already served. Cancelled lines are left alone — they
    -- were never handed to anyone.
    UPDATE public.order_items
       SET status = 'served',
           kot_printed_at = now()
     WHERE order_id = v_order_id
       AND status <> 'cancelled';

    -- 'delivered' is what keeps it off the station boards, which query
    -- pending/confirmed/preparing/ready.
    UPDATE public.orders
       SET status = 'delivered',
           needs_confirmation = false,
           no_kot = true
     WHERE id = v_order_id;

    RETURN v_result || jsonb_build_object('no_kot', true);
END;
$$;

-- Same posture as every other money-touching routine here: PUBLIC out,
-- service_role in (see 20260728092457). Staff reach this through the server
-- action, never directly from the browser.
REVOKE ALL ON FUNCTION public.place_counter_order(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_counter_order(uuid, jsonb, text, text) TO service_role;
