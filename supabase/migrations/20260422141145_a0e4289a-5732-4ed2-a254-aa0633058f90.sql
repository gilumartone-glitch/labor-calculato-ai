-- Tabella cataloghi condivisi: un record per reparto
CREATE TABLE public.catalogs (
  dept text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;

-- Tutti gli utenti autenticati possono leggere e scrivere il listino condiviso
CREATE POLICY "Authenticated users can view catalogs"
  ON public.catalogs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert catalogs"
  ON public.catalogs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update catalogs"
  ON public.catalogs FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete catalogs"
  ON public.catalogs FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger updated_at
CREATE TRIGGER update_catalogs_updated_at
  BEFORE UPDATE ON public.catalogs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime: tutti vedono modifiche in tempo reale
ALTER PUBLICATION supabase_realtime ADD TABLE public.catalogs;
ALTER TABLE public.catalogs REPLICA IDENTITY FULL;