CREATE OR REPLACE FUNCTION public.debug_flow_launch_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'approved', public.is_approved(auth.uid()),
    'admin', public.has_role(auth.uid(), 'admin'::public.app_role),
    'coordinatore', public.has_role(auth.uid(), 'coordinatore'::public.app_role),
    'flow_write', public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level),
    'produzione_write', public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level),
    'preventivi_write', public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level),
    'progettazione_write', public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level),
    'falegnameria_write', public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level),
    'montaggi_write', public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
  )
$$;

REVOKE ALL ON FUNCTION public.debug_flow_launch_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_flow_launch_permissions() TO authenticated;
DROP FUNCTION IF EXISTS public.debug_flow_launch_permissions(uuid);