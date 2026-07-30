-- Whether a stay needs a parking space, asked at booking time.
--
-- The front desk has to know this before the guest arrives — the yard holds a
-- fixed number of vehicles — and the plate is what lets them tell one guest's
-- car from another's when one has to be moved. Both were being written into the
-- free-text `notes` field by hand, where nothing can filter or count them.
--
-- The money is deliberately NOT here. A parking fee is charged as an ordinary
-- `room_charges` row of type 'parking' (a charge_type the table has always
-- accepted), so it lands on the folio, itemizes on the bill and receipt, and is
-- refundable/editable through the same screens as any other incidental. Storing
-- an amount on the booking too would give the same fee two homes that could
-- disagree.
--
-- Defaults to false rather than NULL: every stay already on file was taken
-- without a parking request, which is exactly what false says. `false` with a
-- plate recorded is a legitimate state — the guest has a vehicle but wanted no
-- space reserved.

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS parking_required boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS parking_vehicle_no text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_parking_vehicle_no_length'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_parking_vehicle_no_length
            CHECK (parking_vehicle_no IS NULL OR char_length(parking_vehicle_no) <= 32);
    END IF;
END $$;

COMMENT ON COLUMN public.bookings.parking_required IS
    'Guest asked for a parking space at booking. The fee, if any, is a room_charges row of type ''parking'' — never stored here.';
COMMENT ON COLUMN public.bookings.parking_vehicle_no IS
    'Vehicle registration recorded at the desk, so a car can be identified without waking the guest. Optional, and valid even when parking_required is false.';

-- The desk view that matters: which cars are on the property right now.
CREATE INDEX IF NOT EXISTS bookings_parking_required_idx
    ON public.bookings USING btree (restaurant_id, status)
    WHERE parking_required;
