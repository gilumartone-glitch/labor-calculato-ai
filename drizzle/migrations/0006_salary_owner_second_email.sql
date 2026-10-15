CREATE OR REPLACE FUNCTION public.is_salary_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id AND lower(email) IN ('gilumartone@gmail.com','gmartone@tecnofra.it'))
$$;