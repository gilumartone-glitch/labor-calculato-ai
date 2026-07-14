CREATE OR REPLACE FUNCTION public.debug_flow_launch_permissions(_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'user_id', _user_id,
    'approved', public.is_approved(_user_id),
    'admin', public.has_role(_user_id, 'admin'::public.app_role),
    'coordinatore', public.has_role(_user_id, 'coordinatore'::public.app_role),
    'flow_write', public.has_permission(_user_id, 'flow'::text, 'write'::public.permission_level),
    'produzione_write', public.has_permission(_user_id, 'produzione'::text, 'write'::public.permission_level),
    'preventivi_write', public.has_permission(_user_id, 'preventivi'::text, 'write'::public.permission_level),
    'progettazione_write', public.has_permission(_user_id, 'progettazione'::text, 'write'::public.permission_level),
    'falegnameria_write', public.has_permission(_user_id, 'falegnameria'::text, 'write'::public.permission_level),
    'montaggi_write', public.has_permission(_user_id, 'montaggi'::text, 'write'::public.permission_level)
  )
$$;

REVOKE ALL ON FUNCTION public.debug_flow_launch_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_flow_launch_permissions(uuid) TO authenticated;