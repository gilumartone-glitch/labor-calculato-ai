
-- =========================================================
-- ENUMS
-- =========================================================
DO $$ BEGIN
  CREATE TYPE public.admin_task_category AS ENUM (
    'amministrazione','acquisti','vendite','marketing','hr','generico'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.admin_task_status AS ENUM (
    'da_fare','in_corso','in_attesa','bloccato','completato','annullato'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.admin_task_priority AS ENUM ('bassa','media','alta','urgente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- TABELLA admin_tasks
-- =========================================================
CREATE TABLE IF NOT EXISTS public.admin_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.admin_task_category NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status public.admin_task_status NOT NULL DEFAULT 'da_fare',
  priority public.admin_task_priority NOT NULL DEFAULT 'media',
  responsible_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  start_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  reminder_at TIMESTAMPTZ,
  checklist JSONB NOT NULL DEFAULT '[]'::JSONB,
  attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
  linked_commessa_id UUID REFERENCES public.commesse(id) ON DELETE SET NULL,
  linked_contact_id UUID REFERENCES public.marketing_contacts(id) ON DELETE SET NULL,
  linked_sub_project JSONB,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_status    ON public.admin_tasks(status);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_category  ON public.admin_tasks(category);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_resp      ON public.admin_tasks(responsible_id);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_created_by ON public.admin_tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_assignees ON public.admin_tasks USING GIN (assignee_ids);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_commessa  ON public.admin_tasks(linked_commessa_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_tasks TO authenticated;
GRANT ALL ON public.admin_tasks TO service_role;

ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;

-- Helper: chiave permesso per categoria
CREATE OR REPLACE FUNCTION public.admin_task_permission_key(_cat public.admin_task_category)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'tasks_' || _cat::text
$$;

-- Helper: chi può vedere il task
CREATE OR REPLACE FUNCTION public.can_view_admin_task(_user UUID, _task_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_tasks t
    WHERE t.id = _task_id
      AND (
        public.has_role(_user, 'admin')
        OR t.created_by = _user
        OR t.responsible_id = _user
        OR _user = ANY(COALESCE(t.assignee_ids, ARRAY[]::UUID[]))
        OR public.has_permission(_user, public.admin_task_permission_key(t.category), 'read')
      )
  )
$$;

-- Policies
CREATE POLICY "admin_tasks_select"
ON public.admin_tasks FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR responsible_id = auth.uid()
  OR auth.uid() = ANY(COALESCE(assignee_ids, ARRAY[]::UUID[]))
  OR public.has_permission(auth.uid(), public.admin_task_permission_key(category), 'read')
);

CREATE POLICY "admin_tasks_insert"
ON public.admin_tasks FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), public.admin_task_permission_key(category), 'write')
  )
);

CREATE POLICY "admin_tasks_update"
ON public.admin_tasks FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR responsible_id = auth.uid()
  OR public.has_permission(auth.uid(), public.admin_task_permission_key(category), 'write')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR responsible_id = auth.uid()
  OR public.has_permission(auth.uid(), public.admin_task_permission_key(category), 'write')
);

CREATE POLICY "admin_tasks_delete"
ON public.admin_tasks FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR public.has_permission(auth.uid(), public.admin_task_permission_key(category), 'write')
);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_admin_tasks_updated ON public.admin_tasks;
CREATE TRIGGER trg_admin_tasks_updated
BEFORE UPDATE ON public.admin_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- DIPENDENZE BIDIREZIONALI
-- =========================================================
CREATE TABLE IF NOT EXISTS public.admin_task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.admin_tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID REFERENCES public.admin_tasks(id) ON DELETE CASCADE,
  depends_on_sub_order_id UUID REFERENCES public.production_sub_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dep_exactly_one CHECK (
    (depends_on_task_id IS NOT NULL)::int + (depends_on_sub_order_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT dep_no_self CHECK (depends_on_task_id IS NULL OR depends_on_task_id <> task_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atd_task_task ON public.admin_task_dependencies(task_id, depends_on_task_id) WHERE depends_on_task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_atd_task_sub  ON public.admin_task_dependencies(task_id, depends_on_sub_order_id) WHERE depends_on_sub_order_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_task_dependencies TO authenticated;
GRANT ALL ON public.admin_task_dependencies TO service_role;

ALTER TABLE public.admin_task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "atd_select"
ON public.admin_task_dependencies FOR SELECT TO authenticated
USING (public.can_view_admin_task(auth.uid(), task_id));

CREATE POLICY "atd_write"
ON public.admin_task_dependencies FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.admin_tasks t WHERE t.id = task_id AND (t.created_by = auth.uid() OR t.responsible_id = auth.uid()))
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.admin_tasks t WHERE t.id = task_id AND (t.created_by = auth.uid() OR t.responsible_id = auth.uid()))
);

-- production_sub_orders: dipendenza inversa verso un task (opzionale)
ALTER TABLE public.production_sub_orders
  ADD COLUMN IF NOT EXISTS depends_on_task_id UUID REFERENCES public.admin_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pso_depends_on_task ON public.production_sub_orders(depends_on_task_id);

-- =========================================================
-- TRIGGER DI SBLOCCO
-- =========================================================

-- 1) Quando un task diventa completato: sblocca task dipendenti (se non hanno altre dipendenze pending)
-- e sblocca sub-ordini che dipendono da questo task.
CREATE OR REPLACE FUNCTION public.on_admin_task_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  pending_count INT;
BEGIN
  IF NEW.status = 'completato' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());

    -- Sblocca task dipendenti da questo task
    FOR r IN
      SELECT DISTINCT t.*
      FROM public.admin_task_dependencies d
      JOIN public.admin_tasks t ON t.id = d.task_id
      WHERE d.depends_on_task_id = NEW.id
        AND t.status = 'bloccato'
    LOOP
      -- verifica che TUTTE le altre dipendenze siano soddisfatte
      SELECT COUNT(*) INTO pending_count
      FROM public.admin_task_dependencies d2
      LEFT JOIN public.admin_tasks t2 ON t2.id = d2.depends_on_task_id
      LEFT JOIN public.production_sub_orders s2 ON s2.id = d2.depends_on_sub_order_id
      WHERE d2.task_id = r.id
        AND (
          (d2.depends_on_task_id IS NOT NULL AND d2.depends_on_task_id <> NEW.id AND COALESCE(t2.status::text,'') <> 'completato')
          OR (d2.depends_on_sub_order_id IS NOT NULL AND COALESCE(s2.status::text,'') <> 'completato')
        );
      IF pending_count = 0 THEN
        UPDATE public.admin_tasks SET status = 'da_fare', updated_at = now() WHERE id = r.id;
        IF r.responsible_id IS NOT NULL THEN
          INSERT INTO public.prod_notifications (user_id, type, message, link, is_urgent)
          VALUES (r.responsible_id, 'task_sbloccato',
            concat('Task sbloccato: ', r.title), concat('/produzione/tasks?task=', r.id::text), false);
        END IF;
      END IF;
    END LOOP;

    -- Sblocca sub-ordini di produzione che dipendevano da questo task
    FOR r IN
      SELECT s.* FROM public.production_sub_orders s
      WHERE s.depends_on_task_id = NEW.id AND s.status = 'bloccato'
    LOOP
      UPDATE public.production_sub_orders SET status = 'in_attesa', updated_at = now() WHERE id = r.id;
      IF r.assignee_id IS NOT NULL THEN
        INSERT INTO public.prod_notifications (user_id, type, message, order_id, link, is_urgent)
        VALUES (r.assignee_id, 'sub_sbloccato',
          concat('Lavorazione ', r.code, ' sbloccata: può partire'),
          r.order_id, concat('/produzione/board?sub=', r.id::text), false);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_admin_task_completed ON public.admin_tasks;
CREATE TRIGGER trg_admin_task_completed
BEFORE UPDATE ON public.admin_tasks
FOR EACH ROW EXECUTE FUNCTION public.on_admin_task_completed();

-- 2) Estendi unlock_dependent_subs: quando un sub-ordine diventa completato,
--    sblocca anche i task che dipendevano da esso.
CREATE OR REPLACE FUNCTION public.unlock_dependent_subs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  pending_count int;
BEGIN
  IF NEW.status = 'completato' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    -- sub-ordini
    FOR r IN
      SELECT s.* FROM public.production_sub_orders s
      WHERE s.depends_on = NEW.id AND s.status = 'bloccato'
    LOOP
      UPDATE public.production_sub_orders SET status = 'in_attesa', updated_at = now() WHERE id = r.id;
      IF r.assignee_id IS NOT NULL THEN
        INSERT INTO public.prod_notifications (user_id, type, message, order_id, link, is_urgent)
        VALUES (r.assignee_id, 'sub_sbloccato',
          concat('Lavorazione ', r.code, ' sbloccata: può partire'),
          r.order_id, concat('/produzione/board?sub=', r.id::text), false);
      END IF;
    END LOOP;

    -- task che dipendono da questo sub-ordine
    FOR r IN
      SELECT DISTINCT t.*
      FROM public.admin_task_dependencies d
      JOIN public.admin_tasks t ON t.id = d.task_id
      WHERE d.depends_on_sub_order_id = NEW.id
        AND t.status = 'bloccato'
    LOOP
      SELECT COUNT(*) INTO pending_count
      FROM public.admin_task_dependencies d2
      LEFT JOIN public.admin_tasks t2 ON t2.id = d2.depends_on_task_id
      LEFT JOIN public.production_sub_orders s2 ON s2.id = d2.depends_on_sub_order_id
      WHERE d2.task_id = r.id
        AND (
          (d2.depends_on_task_id IS NOT NULL AND COALESCE(t2.status::text,'') <> 'completato')
          OR (d2.depends_on_sub_order_id IS NOT NULL AND d2.depends_on_sub_order_id <> NEW.id AND COALESCE(s2.status::text,'') <> 'completato')
        );
      IF pending_count = 0 THEN
        UPDATE public.admin_tasks SET status = 'da_fare', updated_at = now() WHERE id = r.id;
        IF r.responsible_id IS NOT NULL THEN
          INSERT INTO public.prod_notifications (user_id, type, message, link, is_urgent)
          VALUES (r.responsible_id, 'task_sbloccato',
            concat('Task sbloccato: ', r.title), concat('/produzione/tasks?task=', r.id::text), false);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

-- 3) Notifica assegnazione task
CREATE OR REPLACE FUNCTION public.notify_task_assignments()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID;
  new_assignees UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_assignees := COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]);
    IF NEW.responsible_id IS NOT NULL AND NEW.responsible_id <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::UUID) THEN
      INSERT INTO public.prod_notifications (user_id, type, message, link, is_urgent)
      VALUES (NEW.responsible_id, 'task_assegnato',
        concat('Sei responsabile del task: ', NEW.title),
        concat('/produzione/tasks?task=', NEW.id::text),
        NEW.priority = 'urgente');
    END IF;
  ELSE
    new_assignees := ARRAY(
      SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]))
      EXCEPT SELECT unnest(COALESCE(OLD.assignee_ids, ARRAY[]::UUID[]))
    );
    IF NEW.responsible_id IS NOT NULL AND NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
      INSERT INTO public.prod_notifications (user_id, type, message, link, is_urgent)
      VALUES (NEW.responsible_id, 'task_assegnato',
        concat('Sei responsabile del task: ', NEW.title),
        concat('/produzione/tasks?task=', NEW.id::text),
        NEW.priority = 'urgente');
    END IF;
  END IF;

  FOREACH uid IN ARRAY new_assignees LOOP
    IF uid IS NOT NULL THEN
      INSERT INTO public.prod_notifications (user_id, type, message, link, is_urgent)
      VALUES (uid, 'task_assegnato',
        concat('Nuovo task assegnato: ', NEW.title),
        concat('/produzione/tasks?task=', NEW.id::text),
        NEW.priority = 'urgente');
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_notify_assign ON public.admin_tasks;
CREATE TRIGGER trg_task_notify_assign
AFTER INSERT OR UPDATE OF assignee_ids, responsible_id ON public.admin_tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignments();

-- =========================================================
-- APP_PAGES: registra i 6 permessi per la matrice admin
-- =========================================================
INSERT INTO public.app_pages (key, label) VALUES
  ('tasks_amministrazione','Task: Amministrazione'),
  ('tasks_acquisti','Task: Acquisti'),
  ('tasks_vendite','Task: Vendite'),
  ('tasks_marketing','Task: Marketing'),
  ('tasks_hr','Task: HR'),
  ('tasks_generico','Task: Generico')
ON CONFLICT (key) DO NOTHING;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_task_dependencies;
