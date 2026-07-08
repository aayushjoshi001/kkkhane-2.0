-- Migration: Add physical_menu_urls to restaurants
ALTER TABLE public.restaurants 
ADD COLUMN physical_menu_urls text[] DEFAULT ARRAY[]::text[];
