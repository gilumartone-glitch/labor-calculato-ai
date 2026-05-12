-- 1. ENUM per stato workflow e priorità
CREATE TYPE public.commessa_stato AS ENUM (
  'da_fare',
  'preventivo',
  'in_produzione',
  'pronto',
  'consegnato'
);

CREATE TYPE public.commessa_priorita AS ENUM ('bassa', 'media', 'alta');

CREATE TYPE public.commessa_tipo AS ENUM ('commessa', 'task');

CREATE TYPE public.commessa_reparto AS ENUM (
  'tappezzeria',
  'stampa',
  'falegnameria',
  'generale'
);

CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- 2. PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- 3. USER_ROLES (separato da profiles per sicurezza)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Funzione SECURITY DEFINER per evitare ricorsione RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Authenticated users can view roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. COMMESSE (le card del flow)
CREATE TABLE public.commesse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titolo TEXT NOT NULL,
  descrizione TEXT,
  cliente TEXT,
  importo NUMERIC(12, 2),
  data_scadenza DATE,
  reparto commessa_reparto NOT NULL DEFAULT 'generale',
  priorita commessa_priorita NOT NULL DEFAULT 'media',
  stato commessa_stato NOT NULL DEFAULT 'da_fare',
  tipo commessa_tipo NOT NULL DEFAULT 'commessa',
  note TEXT,
  ordine INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.commesse ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all commesse"
  ON public.commesse FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create commesse"
  ON public.commesse FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update commesse"
  ON public.commesse FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Creators and admins can delete commesse"
  ON public.commesse FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_commesse_stato ON public.commesse(stato);
CREATE INDEX idx_commesse_ordine ON public.commesse(stato, ordine);

-- 5. COMMESSA_ASSEGNATARI (n-a-n)
CREATE TABLE public.commessa_assegnatari (
  commessa_id UUID NOT NULL REFERENCES public.commesse(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (commessa_id, user_id)
);

ALTER TABLE public.commessa_assegnatari ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view assignments"
  ON public.commessa_assegnatari FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage assignments"
  ON public.commessa_assegnatari FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Trigger per updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_commesse_updated_at
  BEFORE UPDATE ON public.commesse
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Trigger per creare profilo automaticamente al signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  -- Il primo utente registrato diventa admin
  IF (SELECT COUNT(*) FROM auth.users) = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();