CREATE OR REPLACE FUNCTION public.contabilita_payroll_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['salaries','salaryCalc','salaryRates','salariesProcessed','salaryPayDates','salaryPayDays','cashView']
$$;