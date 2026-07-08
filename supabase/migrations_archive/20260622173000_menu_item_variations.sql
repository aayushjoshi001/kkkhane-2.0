-- Create menu_item_variations table
CREATE TABLE IF NOT EXISTS public.menu_item_variations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.menu_item_variations ENABLE ROW LEVEL SECURITY;

-- Allow public read access to variations
CREATE POLICY "Allow public read access to variations"
    ON public.menu_item_variations
    FOR SELECT
    USING (true);

-- Allow authenticated users to manage variations
CREATE POLICY "Allow authenticated users to manage variations"
    ON public.menu_item_variations
    FOR ALL
    USING (auth.role() = 'authenticated');

-- Add to realtime publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_rel pr
        JOIN pg_class c ON pr.prrelid = c.oid
        JOIN pg_publication p ON pr.prpubid = p.oid
        WHERE c.relname = 'menu_item_variations' AND p.pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_item_variations;
    END IF;
END
$$;
