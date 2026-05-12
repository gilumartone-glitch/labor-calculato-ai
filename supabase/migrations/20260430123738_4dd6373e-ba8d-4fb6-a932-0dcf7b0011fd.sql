REVOKE EXECUTE ON FUNCTION public.return_order_to_revision(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_order_to_revision(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.return_order_to_revision(uuid, uuid, text) TO authenticated;