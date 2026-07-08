-- Prevent TOCTOU race in staff_clock_in: enforce at most one open shift
-- per user at the DB level. The unique partial index makes concurrent
-- INSERTs (both passing the app/RPC EXISTS check before either commits)
-- fail with a constraint violation instead of silently creating two open shifts.

CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_one_open_per_user
    ON public.staff_shifts (user_id)
    WHERE clock_out IS NULL;
