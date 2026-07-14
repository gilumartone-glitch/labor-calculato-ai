
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND approved = true)
$$;

DROP POLICY IF EXISTS "Approved users can view profiles" ON public.profiles;

CREATE POLICY "Approved users can view profiles"
ON public.profiles
FOR SELECT
USING (
  auth.uid() = id
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_approved(auth.uid())
);
