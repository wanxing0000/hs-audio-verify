-- Phase 1.5.16: data_versions + update_jobs.
-- Does not change 001/002. Idempotent. service_role only.
-- HSJSON snapshot metadata and update-job tracking. No card rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.data_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  status text NOT NULL DEFAULT 'STAGED',
  source text NOT NULL,
  locale text NOT NULL,
  build text,
  cards_sha256 text NOT NULL,
  collectible_sha256 text NOT NULL,
  cards_count integer,
  collectible_count integer,
  snapshot_fingerprint text NOT NULL,
  snapshot_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_versions_status_check CHECK (
    status IN ('STAGED', 'VALIDATED', 'READY', 'ACTIVE', 'FAILED', 'RETIRED')
  ),
  CONSTRAINT data_versions_fingerprint_key UNIQUE (snapshot_fingerprint),
  CONSTRAINT data_versions_version_key UNIQUE (version)
);

CREATE INDEX IF NOT EXISTS data_versions_status_idx
  ON public.data_versions (status);

CREATE INDEX IF NOT EXISTS data_versions_created_at_idx
  ON public.data_versions (created_at DESC);

CREATE TABLE IF NOT EXISTS public.update_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL DEFAULT 'HSJSON_SNAPSHOT',
  status text NOT NULL DEFAULT 'PENDING',
  data_version_id uuid REFERENCES public.data_versions (id) ON DELETE SET NULL,
  source text,
  locale text,
  snapshot_fingerprint text,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  failed_at timestamptz,
  created_by uuid REFERENCES public.admin_users (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT update_jobs_type_check CHECK (job_type IN ('HSJSON_SNAPSHOT')),
  CONSTRAINT update_jobs_status_check CHECK (
    status IN (
      'PENDING',
      'CHECKING',
      'DOWNLOADING',
      'VALIDATING',
      'READY',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED'
    )
  )
);

CREATE INDEX IF NOT EXISTS update_jobs_status_idx
  ON public.update_jobs (status);

CREATE INDEX IF NOT EXISTS update_jobs_created_at_idx
  ON public.update_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS update_jobs_data_version_id_idx
  ON public.update_jobs (data_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS update_jobs_one_active_hsjson
  ON public.update_jobs (job_type)
  WHERE status IN ('CHECKING', 'DOWNLOADING', 'VALIDATING', 'RUNNING');

DROP TRIGGER IF EXISTS trg_data_versions_updated_at ON public.data_versions;
CREATE TRIGGER trg_data_versions_updated_at
  BEFORE UPDATE ON public.data_versions
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS trg_update_jobs_updated_at ON public.update_jobs;
CREATE TRIGGER trg_update_jobs_updated_at
  BEFORE UPDATE ON public.update_jobs
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.data_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.update_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.data_versions FROM anon, authenticated;
REVOKE ALL ON TABLE public.update_jobs FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.data_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.update_jobs TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
