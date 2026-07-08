-- Add per-variation image support to menu item variations
alter table public.menu_item_variations
    add column if not exists image_url text;

comment on column public.menu_item_variations.image_url is 'Optional image URL for this specific variation (e.g. different sizes/flavors).';
