-- Recognising a returning guest at the front desk.
--
-- Re-registering someone who has stayed before meant retyping their name, phone
-- and citizenship/passport number from scratch, with no sign they were a repeat
-- visitor at all. Their history is already in the system — 41 stays across 36
-- distinct phone numbers on production today — it just was not reachable while
-- filling the form.
--
-- Two problems to solve: finding the guest quickly, and returning one row per
-- person rather than one per stay.

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Nothing indexed guest_phone or customer_phone, so any prefix lookup was a
-- sequential scan of every booking in the tenant. text_pattern_ops is required
-- for LIKE 'prefix%' to use a btree at all under a non-C collation.
CREATE INDEX IF NOT EXISTS "bookings_restaurant_guest_phone_idx"
    ON "public"."bookings" ("restaurant_id", "guest_phone" text_pattern_ops);

CREATE INDEX IF NOT EXISTS "bookings_restaurant_guest_name_idx"
    ON "public"."bookings" ("restaurant_id", lower("guest_name") text_pattern_ops);

CREATE INDEX IF NOT EXISTS "cca_restaurant_customer_phone_idx"
    ON "public"."customer_credit_accounts" ("restaurant_id", "customer_phone" text_pattern_ops);

-- ── Lookup ──────────────────────────────────────────────────────────────────
-- One row per guest, not per stay. Aggregating in the database rather than the
-- route means a single round trip and no guessing at how many stay rows to pull
-- back before the distinct guests run out — a guest with forty visits would
-- otherwise crowd every other match out of the page.
--
-- The caller is responsible for scoping p_restaurant_id to the signed-in user's
-- own restaurant; this is guest PII and must never span tenants. The API route
-- passes its own session's restaurant id and never accepts one from the client.
CREATE OR REPLACE FUNCTION "public"."search_guest_history"(
    p_restaurant_id uuid,
    p_query text,
    p_limit integer DEFAULT 8
) RETURNS TABLE (
    guest_phone   text,
    guest_name    text,
    guest_email   text,
    kyc           text,
    visits        bigint,
    last_stay_at  timestamptz,
    loyalty_points integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
STABLE
AS $$
    WITH needle AS (
        SELECT lower(btrim(p_query)) AS q
    ),
    -- Every stay matching the typed text, by phone prefix or anywhere in the
    -- name. Phone is a prefix match because that is how a number is dialled and
    -- typed; a name is matched loosely since the desk may enter a surname.
    matched AS (
        SELECT
            b.guest_phone,
            b.guest_name,
            b.guest_email,
            -- KYC is stored as a 'KYC: <value>' prefix on notes (see
            -- /api/bookings). Strip the label back off so it can repopulate the
            -- field it came from.
            NULLIF(regexp_replace(COALESCE(b.notes, ''), '^KYC:\s*', ''), '') AS kyc,
            b.check_in,
            b.created_at
        FROM public.bookings b, needle n
        WHERE b.restaurant_id = p_restaurant_id
          AND b.guest_phone IS NOT NULL
          AND btrim(b.guest_phone) <> ''
          AND (
                b.guest_phone LIKE n.q || '%'
             OR lower(b.guest_name) LIKE '%' || n.q || '%'
          )
    ),
    -- Collapse to one row per phone. The most recent stay supplies the details,
    -- so a guest who has since corrected their name or email is offered the
    -- corrected version rather than whatever they first gave.
    ranked AS (
        SELECT
            m.*,
            row_number() OVER (PARTITION BY m.guest_phone ORDER BY m.created_at DESC) AS rn,
            count(*)     OVER (PARTITION BY m.guest_phone) AS visit_count,
            max(m.check_in) OVER (PARTITION BY m.guest_phone) AS latest_stay
        FROM matched m
    )
    SELECT
        r.guest_phone,
        r.guest_name,
        r.guest_email,
        r.kyc,
        r.visit_count,
        r.latest_stay,
        -- Loyalty balance if this guest also has a CRM record, so the desk can
        -- see standing without a second lookup.
        (SELECT c.loyalty_points
           FROM public.customer_credit_accounts c
          WHERE c.restaurant_id = p_restaurant_id
            AND c.customer_phone = r.guest_phone
          LIMIT 1)
    FROM ranked r
    WHERE r.rn = 1
    ORDER BY r.latest_stay DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 25));
$$;

COMMENT ON FUNCTION "public"."search_guest_history"(uuid, text, integer) IS
    'One row per returning guest matching a phone prefix or name fragment, newest details first. Caller must scope p_restaurant_id to the signed-in user''s restaurant — this returns guest PII.';
