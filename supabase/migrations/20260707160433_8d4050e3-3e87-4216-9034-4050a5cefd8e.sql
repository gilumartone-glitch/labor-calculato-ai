
-- commesse: restrict SELECT
DROP POLICY IF EXISTS "Authenticated users can view all commesse" ON public.commesse;
CREATE POLICY "commesse_select_scoped" ON public.commesse
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR has_permission(auth.uid(),'flow','read')
  OR auth.uid() = created_by
  OR auth.uid() = responsabile_id
  OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
  OR EXISTS (SELECT 1 FROM public.commessa_assegnatari ca WHERE ca.commessa_id = commesse.id AND ca.user_id = auth.uid())
);

-- commessa_updates: restrict SELECT
DROP POLICY IF EXISTS "updates_select_auth" ON public.commessa_updates;
CREATE POLICY "updates_select_scoped" ON public.commessa_updates
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR auth.uid() = author_id
  OR EXISTS (
    SELECT 1 FROM public.commesse c
    WHERE c.id = commessa_updates.commessa_id
      AND (
        c.created_by = auth.uid()
        OR c.responsabile_id = auth.uid()
        OR auth.uid() = ANY(COALESCE(c.operator_ids, ARRAY[]::uuid[]))
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.commessa_assegnatari ca
    WHERE ca.commessa_id = commessa_updates.commessa_id AND ca.user_id = auth.uid()
  )
);

-- montaggi_lavorazione_templates: restrict UPDATE/DELETE
DROP POLICY IF EXISTS "Authenticated can update templates" ON public.montaggi_lavorazione_templates;
DROP POLICY IF EXISTS "Authenticated can delete templates" ON public.montaggi_lavorazione_templates;
CREATE POLICY "templates_update_priv" ON public.montaggi_lavorazione_templates
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','write')
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','write')
);
CREATE POLICY "templates_delete_priv" ON public.montaggi_lavorazione_templates
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','write')
);

-- montaggi_lavorazioni: restrict UPDATE/DELETE + also SELECT (finding says internal labor/cost readable by all)
DROP POLICY IF EXISTS "Authenticated can update lavorazioni" ON public.montaggi_lavorazioni;
DROP POLICY IF EXISTS "Authenticated can delete lavorazioni" ON public.montaggi_lavorazioni;
DROP POLICY IF EXISTS "Authenticated can read lavorazioni" ON public.montaggi_lavorazioni;
CREATE POLICY "lavorazioni_select_priv" ON public.montaggi_lavorazioni
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','read')
);
CREATE POLICY "lavorazioni_update_priv" ON public.montaggi_lavorazioni
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','write')
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','write')
);
CREATE POLICY "lavorazioni_delete_priv" ON public.montaggi_lavorazioni
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(),'admin')
  OR auth.uid() = created_by
  OR has_permission(auth.uid(),'montaggi','write')
);

-- storage: marketing-attachments bucket
DROP POLICY IF EXISTS "Auth upload marketing-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete marketing-attachments" ON storage.objects;
CREATE POLICY "marketing_attachments_insert_priv" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'marketing-attachments'
  AND (has_role(auth.uid(),'admin') OR has_permission(auth.uid(),'marketing','write'))
);
CREATE POLICY "marketing_attachments_delete_priv" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'marketing-attachments'
  AND (has_role(auth.uid(),'admin') OR has_permission(auth.uid(),'marketing','write') OR owner = auth.uid())
);
