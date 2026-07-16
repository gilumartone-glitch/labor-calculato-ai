
CREATE OR REPLACE FUNCTION public.is_amministrazione(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND approved = true
      AND 'amministrazione'::public.app_settore = ANY(settori)
  )
$$;

CREATE OR REPLACE FUNCTION public.get_contabilita_cash_only()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_data jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autenticato';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_permission(v_uid, 'contabilita', 'read'::public.permission_level)
    OR public.has_permission(v_uid, 'contabilita', 'write'::public.permission_level)
    OR public.is_amministrazione(v_uid)
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  SELECT data INTO v_data FROM public.contabilita_state WHERE key = 'shared' LIMIT 1;
  IF v_data IS NULL THEN
    RETURN jsonb_build_object(
      'salaries', '[]'::jsonb,
      'salariesProcessed', '[]'::jsonb,
      'salaryPayDates', '[]'::jsonb
    );
  END IF;

  SELECT jsonb_build_object(
    'salaries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s->>'id',
        'name', s->>'name',
        'month', (s->>'month')::int,
        'year', (s->>'year')::int,
        'contanti', COALESCE((s->>'contanti')::numeric, 0)
      ))
      FROM jsonb_array_elements(COALESCE(v_data->'salaries', '[]'::jsonb)) s
    ), '[]'::jsonb),
    'salariesProcessed', COALESCE(v_data->'salariesProcessed', '[]'::jsonb),
    'salaryPayDates', COALESCE(v_data->'salaryPayDates', '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_amministrazione(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_contabilita_cash_only() TO authenticated, service_role;
