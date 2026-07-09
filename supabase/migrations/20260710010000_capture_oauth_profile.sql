-- Capture the OAuth (Google) profile into public.users.
--
-- handle_new_user() copied full_name out of the auth metadata but dropped the
-- avatar, even though public.users.avatar_url exists and both the onboarding
-- screen and the profile page read it. So every Google sign-in fell back to a
-- generated placeholder avatar and the profile felt disconnected from the
-- account the user actually signed in with.
--
-- Google's OpenID metadata lands in auth.users.raw_user_meta_data as some mix
-- of avatar_url / picture and full_name / name, so coalesce across both spellings.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, email, avatar_url, restaurant_id, role_id)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      'New User'
    ),
    NEW.email,
    -- NULLIF guards against a provider that sends the key as an empty string.
    NULLIF(COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ), ''),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

-- Backfill Google users who signed in before this fix: their auth metadata
-- already carries the avatar, we just never copied it. Only touch rows with no
-- avatar so a user who uploaded their own photo is left alone.
UPDATE public.users u
   SET avatar_url = NULLIF(COALESCE(
           au.raw_user_meta_data->>'avatar_url',
           au.raw_user_meta_data->>'picture'
       ), '')
  FROM auth.users au
 WHERE au.id = u.id
   AND u.avatar_url IS NULL
   AND COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture') IS NOT NULL;
