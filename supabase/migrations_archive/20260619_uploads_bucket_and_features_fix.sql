-- Two production fixes:
--
-- 1. The /api/upload route writes to a public storage bucket named `uploads`,
--    which did not exist -> "Bucket not found" on every logo/image upload.
-- 2. Some homepage_configs rows stored `features` as a legacy object
--    { enabled, items: [...] } instead of the plain array the type and all
--    templates expect -> "features.map is not a function" in the manager.

-- 1. Storage bucket for uploads (logos, hero images/videos, gallery, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Normalize homepage_configs.features to a plain JSON array
UPDATE public.homepage_configs
SET features = CASE
    WHEN jsonb_typeof(features) = 'object' AND features ? 'items' AND jsonb_typeof(features->'items') = 'array'
        THEN features->'items'
    WHEN jsonb_typeof(features) <> 'array'
        THEN '[]'::jsonb
    ELSE features
END
WHERE jsonb_typeof(features) <> 'array';
