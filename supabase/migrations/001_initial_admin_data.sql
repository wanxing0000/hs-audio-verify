-- Phase 1.5.10: admin / dynamic-ops tables only.
-- Static catalog, HSJSON, audio indexes, and WAV stay out of this database.
-- Idempotent: safe to re-run. Does not open anon/authenticated policies.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin',
  is_active boolean NOT NULL DEFAULT true,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_role_check CHECK (role = 'admin')
);

CREATE INDEX IF NOT EXISTS admin_users_is_active_idx
  ON public.admin_users (is_active);

CREATE TABLE IF NOT EXISTS public.latest_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_code text NOT NULL,
  name_en text NOT NULL,
  name_zh text NOT NULL,
  release_date timestamptz,
  source text,
  source_url text,
  verified boolean NOT NULL DEFAULT false,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT latest_sets_set_code_key UNIQUE (set_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS latest_sets_one_current
  ON public.latest_sets (is_current)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS latest_sets_is_current_idx
  ON public.latest_sets (is_current);

CREATE INDEX IF NOT EXISTS latest_sets_release_date_idx
  ON public.latest_sets (release_date);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.admin_users (user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  contact text,
  type text,
  status text NOT NULL DEFAULT 'new',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_status_check CHECK (status IN ('new', 'reviewing', 'resolved', 'ignored')),
  CONSTRAINT feedback_type_check CHECK (type IS NULL OR type IN ('bug', 'suggestion', 'data', 'audio', 'other'))
);

CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES public.admin_users (user_id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS trg_latest_sets_updated_at ON public.latest_sets;
CREATE TRIGGER trg_latest_sets_updated_at
  BEFORE UPDATE ON public.latest_sets
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS trg_feedback_updated_at ON public.feedback;
CREATE TRIGGER trg_feedback_updated_at
  BEFORE UPDATE ON public.feedback
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.latest_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.latest_sets FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.feedback FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_logs FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.latest_sets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_logs TO service_role;

UPDATE public.latest_sets
SET is_current = false
WHERE set_code <> 'ESCAPEFROM_VIOLET_HOLD'
  AND is_current = true;

INSERT INTO public.latest_sets (
  set_code,
  name_en,
  name_zh,
  release_date,
  source,
  source_url,
  verified,
  is_current
) VALUES (
  'ESCAPEFROM_VIOLET_HOLD',
  'Escape from Violet Hold',
  '逃离紫罗兰监狱',
  TIMESTAMPTZ '2026-07-07 10:00:00-07',
  'Blizzard official expansion page',
  'https://hearthstone.blizzard.com/en-us/expansions-adventures/escape-from-violet-hold',
  true,
  true
)
ON CONFLICT (set_code) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_zh = EXCLUDED.name_zh,
  release_date = EXCLUDED.release_date,
  source = EXCLUDED.source,
  source_url = EXCLUDED.source_url,
  verified = EXCLUDED.verified,
  is_current = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
