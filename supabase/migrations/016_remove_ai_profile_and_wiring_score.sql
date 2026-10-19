DROP TABLE IF EXISTS public.ai_recommendations;
DROP TABLE IF EXISTS public.coach_profiles;

ALTER TABLE IF EXISTS public.desks
  DROP COLUMN IF EXISTS wiring_score;

ALTER TABLE IF EXISTS public.desk_versions
  DROP COLUMN IF EXISTS wiring_score;
