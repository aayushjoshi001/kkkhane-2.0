-- Add loyalty points column to customer credit accounts
ALTER TABLE public.customer_credit_accounts 
ADD COLUMN IF NOT EXISTS loyalty_points numeric DEFAULT 0.0 NOT NULL;

-- Create loyalty points ledger table
CREATE TABLE IF NOT EXISTS public.loyalty_ledger (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.customer_credit_accounts(id) ON DELETE CASCADE,
    points_changed numeric NOT NULL,
    type text NOT NULL CHECK (type IN ('earn', 'redeem', 'refund')),
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY "Enable read for authenticated users" 
ON public.loyalty_ledger FOR SELECT TO authenticated USING (true);

-- Insert/Update policies
CREATE POLICY "Enable write for authenticated staff" 
ON public.loyalty_ledger FOR ALL TO authenticated USING (
    restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid
);
