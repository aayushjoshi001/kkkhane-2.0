-- Add booking_id to public.sessions to associate dining sessions with hotel bookings
ALTER TABLE public.sessions
ADD COLUMN booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL;

-- Add index on booking_id for search optimization
CREATE INDEX IF NOT EXISTS idx_sessions_booking_id ON public.sessions(booking_id);
