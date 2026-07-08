-- Add image support to menu categories
alter table public.menu_categories
    add column if not exists image_url text;

comment on column public.menu_categories.image_url is 'Optional image URL representing this category (shown in admin and customer menu).';
