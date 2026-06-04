
-- Tabelle Record personali
CREATE TABLE public.personal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  contact_kind text NOT NULL DEFAULT 'altro' CHECK (contact_kind IN ('cliente','fornitore','entrambi','altro')),
  record_type text NOT NULL CHECK (record_type IN ('pagamento_ricevuto','da_incassare','pagamento_fatto','da_pagare','promemoria','nota')),
  title text NOT NULL DEFAULT '',
  description text,
  amount numeric,
  currency text NOT NULL DEFAULT 'EUR',
  due_date date,
  event_at timestamptz,
  status text NOT NULL DEFAULT 'aperto' CHECK (status IN ('aperto','chiuso')),
  tags text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','all')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX personal_records_owner_idx ON public.personal_records(owner_id, created_at DESC);
CREATE INDEX personal_records_contact_idx ON public.personal_records(owner_id, lower(contact_name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_records TO authenticated;
GRANT ALL ON public.personal_records TO service_role;

ALTER TABLE public.personal_records ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.personal_record_shares (
  record_id uuid NOT NULL REFERENCES public.personal_records(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  PRIMARY KEY (record_id, shared_with)
);

CREATE INDEX personal_record_shares_user_idx ON public.personal_record_shares(shared_with);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_record_shares TO authenticated;
GRANT ALL ON public.personal_record_shares TO service_role;

ALTER TABLE public.personal_record_shares ENABLE ROW LEVEL SECURITY;

-- Helper security definer per evitare ricorsione fra RLS dei due tavoli
CREATE OR REPLACE FUNCTION public.is_record_owner(_record_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.personal_records
    WHERE id = _record_id AND owner_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_record_shared_with_me(_record_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.personal_record_shares
    WHERE record_id = _record_id AND shared_with = auth.uid()
  )
$$;

-- RLS personal_records
CREATE POLICY "records_select_own_or_shared"
ON public.personal_records FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR visibility = 'all'
  OR public.is_record_shared_with_me(id)
);

CREATE POLICY "records_insert_own"
ON public.personal_records FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "records_update_own"
ON public.personal_records FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "records_delete_own"
ON public.personal_records FOR DELETE TO authenticated
USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- RLS personal_record_shares
CREATE POLICY "shares_select_owner_or_recipient"
ON public.personal_record_shares FOR SELECT TO authenticated
USING (shared_with = auth.uid() OR public.is_record_owner(record_id));

CREATE POLICY "shares_insert_owner"
ON public.personal_record_shares FOR INSERT TO authenticated
WITH CHECK (public.is_record_owner(record_id) AND shared_by = auth.uid());

CREATE POLICY "shares_delete_owner"
ON public.personal_record_shares FOR DELETE TO authenticated
USING (public.is_record_owner(record_id));

CREATE POLICY "shares_update_read_self"
ON public.personal_record_shares FOR UPDATE TO authenticated
USING (shared_with = auth.uid())
WITH CHECK (shared_with = auth.uid());

-- Trigger updated_at
CREATE TRIGGER personal_records_set_updated_at
BEFORE UPDATE ON public.personal_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
