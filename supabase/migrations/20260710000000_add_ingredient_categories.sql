-- ============================================================
-- Migration: Add Category ID to Ingredients and Suppliers
-- Links ingredients and suppliers to expense_categories table.
-- ============================================================

-- Add category_id to ingredients
ALTER TABLE public.ingredients 
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;

-- Add category_id to suppliers
ALTER TABLE public.suppliers 
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;
