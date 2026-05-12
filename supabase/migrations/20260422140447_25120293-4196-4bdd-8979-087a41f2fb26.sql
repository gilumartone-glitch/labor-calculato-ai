-- Sostituisco le policy "USING (true)" con condizioni esplicite di autenticazione
DROP POLICY IF EXISTS "Authenticated users can update commesse" ON public.commesse;
CREATE POLICY "Authenticated users can update commesse"
  ON public.commesse FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can manage assignments" ON public.commessa_assegnatari;

CREATE POLICY "Authenticated users can insert assignments"
  ON public.commessa_assegnatari FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update assignments"
  ON public.commessa_assegnatari FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete assignments"
  ON public.commessa_assegnatari FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);