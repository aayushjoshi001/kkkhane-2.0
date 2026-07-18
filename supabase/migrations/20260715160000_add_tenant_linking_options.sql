-- Add toggle columns for tenant link features
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS link_allow_folio_charges boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS link_allow_loyalty_sharing boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS link_allow_credit_sharing boolean NOT NULL DEFAULT true;

-- Create partner link requests table for simple one-computer handshake
CREATE TABLE IF NOT EXISTS public.partner_link_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    receiver_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.partner_link_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users" 
ON public.partner_link_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable write for authenticated staff" 
ON public.partner_link_requests FOR ALL TO authenticated USING (
    sender_id = (auth.jwt() ->> 'restaurant_id')::uuid OR
    receiver_id = (auth.jwt() ->> 'restaurant_id')::uuid
);
