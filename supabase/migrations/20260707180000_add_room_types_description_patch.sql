-- Add description column to room_types if it was missed in older schemas
ALTER TABLE public.room_types ADD COLUMN IF NOT EXISTS description text;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
