REVOKE EXECUTE ON FUNCTION public.debug_flow_launch_permissions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.debug_flow_launch_permissions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debug_flow_launch_permissions() FROM public;
GRANT EXECUTE ON FUNCTION public.debug_flow_launch_permissions() TO authenticated;