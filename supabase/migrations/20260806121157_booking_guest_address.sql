-- Where the guest lives, taken at the desk while registering a stay.
--
-- Nepali hotels are required to record a guest's permanent address alongside
-- the citizenship/passport number they already collect, and the desk had
-- nowhere to put it: it was either dropped on the floor or smuggled into the
-- free-text `notes` field next to the KYC string, where nothing can read it
-- back out or reprint it.
--
-- Nullable, with no default: every stay already on file was taken without one,
-- and NULL says exactly that — "never asked" — where an empty string would
-- claim the guest was asked and gave nothing. The column is deliberately plain
-- text rather than structured parts; what the desk writes is a line like
-- "Ward 5, Bharatpur, Chitwan", which no address schema improves.
--
-- Also lands on booking_groups, which carries the same guest identity for a
-- multi-room reservation. Leaving it off there would make the group header
-- disagree with its own rooms.

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS guest_address text;

ALTER TABLE public.booking_groups
    ADD COLUMN IF NOT EXISTS guest_address text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_guest_address_length'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_guest_address_length
            CHECK (guest_address IS NULL OR char_length(guest_address) <= 200);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_groups_guest_address_length'
    ) THEN
        ALTER TABLE public.booking_groups
            ADD CONSTRAINT booking_groups_guest_address_length
            CHECK (guest_address IS NULL OR char_length(guest_address) <= 200);
    END IF;
END $$;

COMMENT ON COLUMN public.bookings.guest_address IS
    'Guest''s address as written at the front desk. NULL means it was never asked for — not that the guest has none.';
COMMENT ON COLUMN public.booking_groups.guest_address IS
    'Guest''s address for a multi-room reservation. Mirrors bookings.guest_address on every room of the group.';

-- ── Returning guests ────────────────────────────────────────────────────────
-- The lookup that fills the booking form from a past stay has to offer the
-- address too, otherwise a repeat guest gets their name, phone and KYC back but
-- retypes where they live every visit.
--
-- The return type gains a column, so this is a DROP + CREATE rather than a
-- CREATE OR REPLACE. Dropping takes the ACL with it, and a fresh function is
-- EXECUTE-to-PUBLIC by default, so the revoke from
-- 20260728092457_revoke_public_execute_on_security_definer_functions is
-- re-applied below — this returns guest PII and must stay server-side only.
DROP FUNCTION IF EXISTS "public"."search_guest_history"(uuid, text, integer);

CREATE FUNCTION "public"."search_guest_history"(
    p_restaurant_id uuid,
    p_query text,
    p_limit integer DEFAULT 8
) RETURNS TABLE (
    guest_phone   text,
    guest_name    text,
    guest_email   text,
    guest_address text,
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
            b.guest_address,
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
        r.guest_address,
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

REVOKE EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION "public"."search_guest_history"(uuid, text, integer) TO service_role;
