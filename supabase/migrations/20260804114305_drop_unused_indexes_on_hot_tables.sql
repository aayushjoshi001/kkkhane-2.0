-- Drop indexes that have never been read, on the four tables the booking and
-- billing screens actually query.
--
-- Planning, not execution, is what these screens were paying for. On bookings a
-- representative query planned in 23.1ms and executed in 0.19ms -- 121x more
-- time deciding how to fetch nine rows than fetching them. The planner loads
-- and costs every index on the table, and bookings carried 15 of them for 109
-- rows. A screen issuing fifteen or twenty queries spends most of its server
-- time in the planner, and the room panel pays that four times over across the
-- four endpoints it calls.
--
-- Measured on production either side of this migration:
--   bookings by status      23.065ms -> 1.263ms planning
--   orders unpaid            (same shape) 1.233ms planning
--   bookings joined to rooms              1.548ms planning
-- Execution time was never the problem and did not change.
--
-- Every index dropped here has idx_scan = 0 over a 77-day pg_stat_user_indexes
-- window, and none is unique, primary, or backing a constraint -- checked
-- explicitly, because several zero-scan indexes elsewhere DO enforce uniqueness
-- despite having no pg_constraint row (rooms_restaurant_number_uidx guards room
-- numbers, printers_one_default_per_role guards the default printer). Those are
-- deliberately left in place.
--
-- These were also premature at this data size: the tables hold 109 to 301 rows,
-- where a sequential scan costs a fraction of a millisecond, so none of them was
-- earning its planning cost. Re-add a specific one when the data volume and a
-- real query pattern justify it -- and check idx_scan before assuming it is.

-- bookings (109 rows, 15 indexes before this)
drop index if exists public.bookings_check_in_idx;
drop index if exists public.bookings_checked_in_by_idx;
drop index if exists public.bookings_parking_required_idx;
drop index if exists public.bookings_restaurant_guest_phone_idx;
drop index if exists public.idx_bookings_historical_link;

-- orders (144 rows)
drop index if exists public.idx_orders_legacy_takeout_id;
drop index if exists public.idx_orders_seat_id;
drop index if exists public.idx_orders_stripe_pi;          -- Stripe is dead code here
drop index if exists public.orders_cancellation_kind_idx;
drop index if exists public.orders_no_kot_idx;

-- order_items (301 rows)
drop index if exists public.idx_order_items_needs_confirmation;
drop index if exists public.order_items_bar_station_idx;
drop index if exists public.order_items_cancellation_idx;

-- rooms (52 rows) -- rooms_restaurant_number_uidx is UNIQUE and stays
drop index if exists public.idx_rooms_available;
drop index if exists public.idx_rooms_dirty;
