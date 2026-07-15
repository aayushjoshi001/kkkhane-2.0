-- Create dynamic pricing rules table
CREATE TABLE IF NOT EXISTS public.dynamic_pricing_rules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    rule_name text NOT NULL,
    rule_type text NOT NULL CHECK (rule_type IN ('weekend', 'occupancy')),
    multiplier numeric NOT NULL DEFAULT 1.0,
    occupancy_threshold_pct numeric CHECK (occupancy_threshold_pct >= 0 AND occupancy_threshold_pct <= 100),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.dynamic_pricing_rules ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY "Enable read for authenticated users" 
ON public.dynamic_pricing_rules FOR SELECT TO authenticated USING (true);

-- Insert/Update policies
CREATE POLICY "Enable write for authenticated staff" 
ON public.dynamic_pricing_rules FOR ALL TO authenticated USING (
    restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid
);

-- Seed basic weekend pricing rule (1.1x multiplier for Friday/Saturday)
-- This will serve as a default active rule for restaurants.
INSERT INTO public.dynamic_pricing_rules (restaurant_id, rule_name, rule_type, multiplier)
SELECT id, 'Weekend Premium (1.1x)', 'weekend', 1.10
FROM public.restaurants;
