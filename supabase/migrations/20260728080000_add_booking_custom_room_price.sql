-- Add custom_room_price column to bookings table
-- This stores a temporary per-session room price agreed at booking time.
-- Only applies to that specific check-in/check-out session.
-- Does NOT change the room_types.base_price (the master catalog price).

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS custom_room_price numeric(12, 2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS room_rate numeric(12, 2) DEFAULT NULL;

COMMENT ON COLUMN bookings.custom_room_price IS
    'Temporary per-session room price set at booking time (overrides room_types.base_price for this stay only). NULL means use standard room type price.';

COMMENT ON COLUMN bookings.room_rate IS
    'Alias for custom_room_price. Kept for backwards compatibility with client code that reads room_rate.';
