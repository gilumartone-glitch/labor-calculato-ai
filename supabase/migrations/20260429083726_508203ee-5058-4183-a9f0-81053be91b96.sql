
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, text[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_permission(uuid, text, public.permission_level) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text, public.permission_level) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_permission(uuid, text, public.permission_level) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, public.permission_level) TO authenticated;
