-- Add beds column to rooms table
ALTER TABLE public.rooms 
    ADD COLUMN IF NOT EXISTS beds integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.rooms.beds IS 'Number of beds in this room.';
