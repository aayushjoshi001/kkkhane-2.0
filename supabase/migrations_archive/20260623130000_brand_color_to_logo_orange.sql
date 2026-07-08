-- Brand color fix: the app primary was the legacy brown #E85D04, but the logo
-- orange is #FB6303 (the --color-primary fallback). Update restaurants still on
-- the old default (leave any that customized their color) and change the
-- settings.theme column default so new restaurants match the logo.

UPDATE public.settings
SET theme = jsonb_set(theme, '{primaryColor}', '"#FB6303"')
WHERE theme->>'primaryColor' = '#E85D04';

ALTER TABLE public.settings
ALTER COLUMN theme SET DEFAULT
  '{"fontFamily": "Inter", "menuLayout": "grid", "borderRadius": "lg", "primaryColor": "#FB6303", "secondaryColor": "#1B263B"}'::jsonb;

UPDATE public.homepage_configs
SET theme_primary = '#FB6303'
WHERE theme_primary = '#E85D04';
