CREATE OR REPLACE FUNCTION public.next_production_order_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := extract(year from now())::int;
  v_prefix text := 'ORD-' || v_year::text || '-';
  v_max int;
  v_next int;
BEGIN
  SELECT COALESCE(MAX((regexp_match(code, '-(\d+)$'))[1]::int), 0)
  INTO v_max
  FROM public.production_orders
  WHERE code LIKE v_prefix || '%';
  v_next := v_max + 1;
  RETURN v_prefix || lpad(v_next::text, 3, '0');
END $$;