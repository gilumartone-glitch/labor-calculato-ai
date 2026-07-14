REVOKE ALL ON FUNCTION public.debug_flow_launch_permissions(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.debug_flow_launch_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_flow_launch_permissions(uuid) TO authenticated;