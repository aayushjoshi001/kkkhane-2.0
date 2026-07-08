-- Align homepage_configs with the frontend contract.
--
-- The table originally stored hero/theme as JSONB, but the entire frontend
-- (TS types, all templates, HomepageManager, get/update routes) uses flat
-- columns. Saving failed with "Could not find the 'hero_subtitle' column".
--
-- This migration:
--   1. Adds flat hero_*/theme_* columns.
--   2. Backfills them from the existing hero/theme JSONB.
--   3. Drops the redundant hero/theme JSONB columns.
--   4. Adds new columns for full manager-driven website customization
--      (logo, gallery, social links, contact/map).
-- about/features/cta/footer JSONB columns already match the frontend and are
-- left unchanged.

-- 1. Flat hero columns
ALTER TABLE public.homepage_configs
    ADD COLUMN IF NOT EXISTS hero_title     text NOT NULL DEFAULT 'Welcome to Our Restaurant',
    ADD COLUMN IF NOT EXISTS hero_subtitle  text NOT NULL DEFAULT 'Experience authentic flavors',
    ADD COLUMN IF NOT EXISTS hero_image_url text,
    ADD COLUMN IF NOT EXISTS hero_video_url text,
    ADD COLUMN IF NOT EXISTS hero_cta_text  text NOT NULL DEFAULT 'View Menu';

-- 2. Flat theme columns
ALTER TABLE public.homepage_configs
    ADD COLUMN IF NOT EXISTS theme_primary   text NOT NULL DEFAULT '#E85D04',
    ADD COLUMN IF NOT EXISTS theme_secondary text NOT NULL DEFAULT '#1B263B',
    ADD COLUMN IF NOT EXISTS theme_accent    text NOT NULL DEFAULT '#EC4899';

-- 3. New website-customization columns
ALTER TABLE public.homepage_configs
    ADD COLUMN IF NOT EXISTS logo_url text,
    -- gallery: [{ "image_url": "", "caption": "" }]
    ADD COLUMN IF NOT EXISTS gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- social: { "facebook": "", "instagram": "", "whatsapp": "", "tiktok": "" }
    ADD COLUMN IF NOT EXISTS social jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- contact: { "review_link": "", "map_address": "", "map_embed_url": "", "phone": "", "email": "", "enabled": true }
    ADD COLUMN IF NOT EXISTS contact jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 4. Backfill flat columns from existing hero/theme JSONB (only where present)
UPDATE public.homepage_configs
SET
    hero_title     = COALESCE(NULLIF(hero->>'headline', ''),  hero_title),
    hero_subtitle  = COALESCE(NULLIF(hero->>'subtitle', ''),  hero_subtitle),
    hero_image_url = NULLIF(hero->>'image_url', ''),
    hero_video_url = NULLIF(hero->>'video_url', ''),
    hero_cta_text  = COALESCE(NULLIF(hero->>'cta_text', ''),  hero_cta_text)
WHERE hero IS NOT NULL;

UPDATE public.homepage_configs
SET
    theme_primary   = COALESCE(NULLIF(theme->>'primary', ''),   theme_primary),
    theme_secondary = COALESCE(NULLIF(theme->>'secondary', ''), theme_secondary),
    theme_accent    = COALESCE(NULLIF(theme->>'accent', ''),    theme_accent)
WHERE theme IS NOT NULL;

-- 5. Drop the redundant JSONB columns
ALTER TABLE public.homepage_configs
    DROP COLUMN IF EXISTS hero,
    DROP COLUMN IF EXISTS theme;
