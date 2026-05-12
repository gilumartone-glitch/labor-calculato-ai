
-- Categorie (con sottocategorie)
CREATE TABLE public.marketing_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES public.marketing_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_categories_parent ON public.marketing_categories(parent_id);

ALTER TABLE public.marketing_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view marketing_categories" ON public.marketing_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert marketing_categories" ON public.marketing_categories FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "auth update marketing_categories" ON public.marketing_categories FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete marketing_categories" ON public.marketing_categories FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_marketing_categories_updated BEFORE UPDATE ON public.marketing_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Contatti rubrica
CREATE TABLE public.marketing_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  azienda TEXT,
  note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_contacts_email ON public.marketing_contacts(email);

ALTER TABLE public.marketing_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view marketing_contacts" ON public.marketing_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert marketing_contacts" ON public.marketing_contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "auth update marketing_contacts" ON public.marketing_contacts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete marketing_contacts" ON public.marketing_contacts FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_marketing_contacts_updated BEFORE UPDATE ON public.marketing_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Mappa contatto <-> categoria (M:N)
CREATE TABLE public.marketing_contact_categories (
  contact_id UUID NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.marketing_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, category_id)
);
CREATE INDEX idx_mcc_category ON public.marketing_contact_categories(category_id);

ALTER TABLE public.marketing_contact_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view marketing_contact_categories" ON public.marketing_contact_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage marketing_contact_categories" ON public.marketing_contact_categories FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Newsletter
CREATE TABLE public.marketing_newsletters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subject TEXT NOT NULL,
  preview_text TEXT,
  from_name TEXT,
  from_email TEXT,
  content_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'bozza',
  category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  mailchimp_campaign_id TEXT,
  mailchimp_audience_id TEXT,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_newsletters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view marketing_newsletters" ON public.marketing_newsletters FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert marketing_newsletters" ON public.marketing_newsletters FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "auth update marketing_newsletters" ON public.marketing_newsletters FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete marketing_newsletters" ON public.marketing_newsletters FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_marketing_newsletters_updated BEFORE UPDATE ON public.marketing_newsletters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Aggiungi pagina nei permessi
INSERT INTO public.app_pages (key, label, description, ordine)
VALUES ('marketing', 'Marketing', 'Newsletter e rubrica contatti', 60)
ON CONFLICT (key) DO NOTHING;
