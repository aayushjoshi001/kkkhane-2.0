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

-- Deliberately seeds nothing.
--
-- This migration used to insert an active 'Weekend Premium (1.1x)' rule for
-- every restaurant. Creating a table is a schema change; silently raising every
-- tenant's weekend prices by 10% is a business decision, and a migration is the
-- wrong place to make one on an owner's behalf — nobody reviewing a schema diff
-- expects prices to move. Production was migrated table-only for exactly that
-- reason, so seeding here would also put every fresh environment out of step
-- with it.
--
-- A venue that wants weekend pricing creates the rule from Admin, where the
-- multiplier is visible and can be turned off again.
