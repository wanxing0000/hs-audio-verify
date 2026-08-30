-- Phase 1.5.19: feedback type/status enums for Admin management.
-- Incremental. Does not change 001/002/003.
-- Maps legacy 001 values, then replaces CHECK constraints.
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_status_check;
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_type_check;

UPDATE public.feedback
SET status = CASE status
  WHEN 'new' THEN 'OPEN'
  WHEN 'reviewing' THEN 'IN_PROGRESS'
  WHEN 'resolved' THEN 'RESOLVED'
  WHEN 'ignored' THEN 'CLOSED'
  ELSE status
END
WHERE status IN ('new', 'reviewing', 'resolved', 'ignored');

UPDATE public.feedback
SET type = CASE type
  WHEN 'bug' THEN 'BUG'
  WHEN 'suggestion' THEN 'FEATURE_REQUEST'
  WHEN 'data' THEN 'CARD_DATA'
  WHEN 'audio' THEN 'AUDIO'
  WHEN 'other' THEN 'OTHER'
  ELSE type
END
WHERE type IN ('bug', 'suggestion', 'data', 'audio', 'other');

UPDATE public.feedback
SET type = 'OTHER'
WHERE type IS NULL OR type = '';

ALTER TABLE public.feedback
  ALTER COLUMN status SET DEFAULT 'OPEN';

ALTER TABLE public.feedback
  ALTER COLUMN type SET DEFAULT 'OTHER';

ALTER TABLE public.feedback
  ALTER COLUMN type SET NOT NULL;

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_status_check
  CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'));

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_type_check
  CHECK (type IN ('BUG', 'FEATURE_REQUEST', 'CARD_DATA', 'AUDIO', 'OTHER'));

CREATE INDEX IF NOT EXISTS feedback_status_idx
  ON public.feedback (status);

CREATE INDEX IF NOT EXISTS feedback_type_idx
  ON public.feedback (type);

CREATE INDEX IF NOT EXISTS feedback_created_at_idx
  ON public.feedback (created_at DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;
