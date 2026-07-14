DO $$
DECLARE
  v_has boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.debug_flow_launch_permissions()', 'EXECUTE') INTO v_has;
  IF v_has THEN
    RAISE EXCEPTION 'La diagnostica Flow è ancora eseguibile da anon';
  END IF;
END $$;