-- Atomic latest_set publish. Does not change 001 schema.
-- service_role only.

CREATE OR REPLACE FUNCTION public.publish_latest_set(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.latest_sets;
  v_prev_code text;
BEGIN
  SELECT * INTO v_target
  FROM public.latest_sets
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LATEST_SET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT set_code INTO v_prev_code
  FROM public.latest_sets
  WHERE is_current = true
    AND id <> p_id
  FOR UPDATE;

  UPDATE public.latest_sets
  SET is_current = false
  WHERE is_current = true
    AND id <> p_id;

  UPDATE public.latest_sets
  SET is_current = true
  WHERE id = p_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_target.id,
    'set_code', v_target.set_code,
    'previous_set_code', v_prev_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_latest_set(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_latest_set(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_latest_set(uuid) TO service_role;
