DO $$
DECLARE
  v_uid uuid := 'ec286f30-85c5-4005-bd05-69cf1b183782'::uuid;
BEGIN
  IF NOT public.is_approved(v_uid) THEN
    RAISE EXCEPTION 'Federica non risulta approvata';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'coordinatore'::public.app_role)
    OR public.has_permission(v_uid, 'flow'::text, 'write'::public.permission_level)
    OR public.has_permission(v_uid, 'produzione'::text, 'write'::public.permission_level)
    OR public.has_permission(v_uid, 'preventivi'::text, 'write'::public.permission_level)
    OR public.has_permission(v_uid, 'progettazione'::text, 'write'::public.permission_level)
  ) THEN
    RAISE EXCEPTION 'Federica non ha permessi sufficienti per il lancio Flow';
  END IF;
END $$;