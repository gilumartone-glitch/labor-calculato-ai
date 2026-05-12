
-- 1) Estende l'enum app_role con i ruoli reparto
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'contabilita';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'produzione';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'commerciale';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'magazzino';

-- 2) Enum livello permesso
DO $$ BEGIN
  CREATE TYPE public.permission_level AS ENUM ('none','read','write');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Tabella pagine dell'app
CREATE TABLE IF NOT EXISTS public.app_pages (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  ordine INT NOT NULL DEFAULT 0
);

ALTER TABLE public.app_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view app pages" ON public.app_pages;
CREATE POLICY "Authenticated can view app pages"
  ON public.app_pages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Only admins can manage app pages" ON public.app_pages;
CREATE POLICY "Only admins can manage app pages"
  ON public.app_pages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_pages (key, label, description, ordine) VALUES
  ('preventivi','Preventivi','Calcolatore preventivi e listini',10),
  ('flow','Flow commesse','Bacheca commesse',20),
  ('contabilita','Contabilità','Cassa, competenza e movimenti',30),
  ('falegnameria','Falegnameria','Modulo falegnameria',40),
  ('montaggi','Montaggi','Modulo montaggi',50),
  ('admin','Pannello admin','Gestione utenti e permessi',99)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, ordine = EXCLUDED.ordine;

-- 4) Tabella permessi per utente / pagina
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  page_key TEXT NOT NULL REFERENCES public.app_pages(key) ON DELETE CASCADE,
  level public.permission_level NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_key)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own permissions" ON public.user_permissions;
CREATE POLICY "Users can view own permissions"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Only admins can manage permissions" ON public.user_permissions;
CREATE POLICY "Only admins can manage permissions"
  ON public.user_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_user_permissions_updated
  BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Aggiunge "approved" sui profili
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;

-- Promuove esistenti (non rompiamo chi sta già usando l'app): admin = approvato
UPDATE public.profiles p
SET approved = true
WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'admin');

-- Solo admin può cambiare "approved": rinforziamo via trigger
CREATE OR REPLACE FUNCTION public.guard_profile_approved()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.approved IS DISTINCT FROM OLD.approved AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo gli admin possono modificare lo stato di approvazione';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_approved ON public.profiles;
CREATE TRIGGER trg_guard_profile_approved
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_approved();

-- 6) Aggiorna handle_new_user per non approvare automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_first BOOLEAN;
BEGIN
  is_first := (SELECT COUNT(*) FROM auth.users) = 1;
  INSERT INTO public.profiles (id, display_name, approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    is_first  -- primo utente approvato di default
  );
  IF is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    -- Permessi pieni su tutte le pagine
    INSERT INTO public.user_permissions (user_id, page_key, level)
    SELECT NEW.id, key, 'write' FROM public.app_pages
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  END IF;
  RETURN NEW;
END $$;

-- Trigger di creazione utenti (se non già presente)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7) Funzione di check permesso
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _page TEXT, _required public.permission_level)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_permissions up
      WHERE up.user_id = _user_id
        AND up.page_key = _page
        AND (
          (_required = 'read'  AND up.level IN ('read','write'))
          OR (_required = 'write' AND up.level = 'write')
        )
    )
$$;

-- 8) Funzione admin per leggere elenco utenti completo (bypassa RLS)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  approved BOOLEAN,
  created_at TIMESTAMPTZ,
  roles TEXT[]
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    u.email::TEXT,
    p.display_name,
    p.approved,
    p.created_at,
    COALESCE(ARRAY_AGG(ur.role::TEXT) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::TEXT[])
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE public.has_role(auth.uid(), 'admin')
  GROUP BY p.id, u.email, p.display_name, p.approved, p.created_at
  ORDER BY p.created_at DESC;
$$;

-- 9) RPC per impostare ruoli (solo admin)
CREATE OR REPLACE FUNCTION public.admin_set_user_roles(_user_id UUID, _roles TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  IF _roles IS NOT NULL AND array_length(_roles,1) > 0 THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT _user_id, r::public.app_role FROM unnest(_roles) AS r
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 10) RPC per impostare un permesso (upsert)
CREATE OR REPLACE FUNCTION public.admin_set_user_permission(_user_id UUID, _page TEXT, _level public.permission_level)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;
  INSERT INTO public.user_permissions (user_id, page_key, level)
  VALUES (_user_id, _page, _level)
  ON CONFLICT (user_id, page_key) DO UPDATE SET level = EXCLUDED.level, updated_at = now();
END $$;
