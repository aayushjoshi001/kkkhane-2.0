-- ============================================================
-- Finance Module — Tax (structure only, Phase 1)
-- Migration: 20260707210500_finance_tax.sql
--
-- Tables: tax_configurations, tax_filings
-- restaurants.pan_number / vat_registered / vat_number already exist
-- (pre-migrations bootstrap schema) — the VAT/PAN tab surfaces those
-- read-only alongside tax_configurations, no duplication here.
-- ============================================================

-- ============================================================
-- 1. TAX CONFIGURATIONS (master)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_configurations (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    tax_type       text        NOT NULL DEFAULT 'other' CHECK (tax_type IN ('vat', 'pan', 'other')),
    rate_percent   numeric(5, 2) CHECK (rate_percent >= 0),
    is_active      boolean     NOT NULL DEFAULT true,
    created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tax_configurations_unique_name UNIQUE (restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tax_configurations_restaurant_id ON public.tax_configurations (restaurant_id);

-- ============================================================
-- 2. TAX FILINGS (Tax Reports / Summary / IRD Reports)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_filings (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id          uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    tax_configuration_id   uuid        NOT NULL REFERENCES public.tax_configurations(id) ON DELETE CASCADE,
    period_start           date        NOT NULL,
    period_end             date        NOT NULL,
    ird_reference          text,
    notes                  text,
    status                 text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed')),
    filed_by               uuid        REFERENCES public.users(id) ON DELETE SET NULL,
    filed_at               timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tax_filings_valid_range CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_tax_filings_restaurant_created ON public.tax_filings (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_filings_configuration_id ON public.tax_filings (tax_configuration_id);

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.tax_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_filings        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_tax_configurations"   ON public.tax_configurations;
DROP POLICY IF EXISTS "admin_manage_tax_configurations" ON public.tax_configurations;
CREATE POLICY "staff_read_tax_configurations" ON public.tax_configurations
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_tax_configurations" ON public.tax_configurations
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());

DROP POLICY IF EXISTS "staff_read_tax_filings"   ON public.tax_filings;
DROP POLICY IF EXISTS "admin_manage_tax_filings" ON public.tax_filings;
CREATE POLICY "staff_read_tax_filings" ON public.tax_filings
    FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "admin_manage_tax_filings" ON public.tax_filings
    FOR ALL
    USING (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id())
    WITH CHECK (current_app_role() = ANY (ARRAY['manager', 'super_admin']) AND restaurant_id = current_restaurant_id());
