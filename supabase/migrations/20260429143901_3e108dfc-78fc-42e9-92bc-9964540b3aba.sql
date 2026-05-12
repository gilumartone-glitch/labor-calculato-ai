-- Enums
CREATE TYPE public.prod_order_status AS ENUM ('nuovo','in_corso','pronto','spedito','chiuso','annullato');
CREATE TYPE public.prod_sub_status AS ENUM ('in_attesa','in_lavorazione','completato','bloccato');
CREATE TYPE public.prod_priority AS ENUM ('normale','urgente','bloccante');
CREATE TYPE public.prod_dept AS ENUM ('taglio','stampa','tappezzeria','assemblaggio','altro');
CREATE TYPE public.prod_delivery AS ENUM ('spedizione','ritiro');
CREATE TYPE public.inv_item_kind AS ENUM ('nuovo','sfrido');
CREATE TYPE public.prod_notif_type AS ENUM (
  'ordine_creato','subordine_assegnato','subordine_completato',
  'ordine_pronto','ordine_chiuso','stock_basso','chat_messaggio','priorita_cambiata'
);
CREATE TYPE public.prod_chat_kind AS ENUM ('generale','ordine','diretto');

-- ORDERS
CREATE TABLE public.production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  cliente TEXT NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  priorita prod_priority NOT NULL DEFAULT 'normale',
  delivery prod_delivery NOT NULL DEFAULT 'spedizione',
  status prod_order_status NOT NULL DEFAULT 'nuovo',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  nesting_included BOOLEAN NOT NULL DEFAULT false,
  ddt_number TEXT,
  ddt_date DATE,
  ddt_causale TEXT,
  ddt_note TEXT,
  corriere TEXT,
  spedizione_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.production_sub_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  dept prod_dept NOT NULL,
  status prod_sub_status NOT NULL DEFAULT 'in_attesa',
  ordine INT NOT NULL DEFAULT 0,
  note TEXT,
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_psub_order ON public.production_sub_orders(order_id);
CREATE INDEX idx_psub_dept_status ON public.production_sub_orders(dept, status);

-- INVENTORY
CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  kind inv_item_kind NOT NULL DEFAULT 'nuovo',
  nome TEXT NOT NULL,
  descrizione TEXT,
  qty_intera NUMERIC NOT NULL DEFAULT 0,
  qty_sfrido NUMERIC NOT NULL DEFAULT 0,
  um TEXT NOT NULL DEFAULT 'pz',
  posizione TEXT,
  soglia_minima NUMERIC NOT NULL DEFAULT 5,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  qty NUMERIC NOT NULL DEFAULT 1,
  reserved_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHAT
CREATE TABLE public.prod_chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind prod_chat_kind NOT NULL,
  name TEXT NOT NULL,
  order_id UUID REFERENCES public.production_orders(id) ON DELETE CASCADE,
  members UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.prod_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.prod_chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  body TEXT NOT NULL,
  reactions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chatmsg_channel ON public.prod_chat_messages(channel_id, created_at);

-- NOTIFICATIONS
CREATE TABLE public.prod_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type prod_notif_type NOT NULL,
  message TEXT NOT NULL,
  order_id UUID REFERENCES public.production_orders(id) ON DELETE CASCADE,
  link TEXT,
  is_urgent BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user_unread ON public.prod_notifications(user_id, read_at);

-- AUDIT LOG
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  prev_state JSONB,
  new_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);
CREATE INDEX idx_audit_entity ON public.audit_log(entity_type, entity_id);

-- updated_at triggers
CREATE TRIGGER trg_porders_upd BEFORE UPDATE ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_psub_upd BEFORE UPDATE ON public.production_sub_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_inv_upd BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_sub_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Helper: writer on produzione page
-- (uses existing has_permission + has_role)

-- production_orders
CREATE POLICY "porders_select_all" ON public.production_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "porders_insert_writer" ON public.production_orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "porders_update_writer" ON public.production_orders FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "porders_delete_admin_creator" ON public.production_orders FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(),'admin'));

-- sub_orders
CREATE POLICY "psub_select_all" ON public.production_sub_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "psub_cud_writer" ON public.production_sub_orders FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'));

-- inventory
CREATE POLICY "inv_select_all" ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "inv_cud_writer" ON public.inventory_items FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "invres_select_all" ON public.inventory_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY "invres_cud_writer" ON public.inventory_reservations FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'));

-- chat channels
CREATE POLICY "chan_select_all" ON public.prod_chat_channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "chan_cud_auth" ON public.prod_chat_channels FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- chat messages
CREATE POLICY "msg_select_all" ON public.prod_chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "msg_insert_self" ON public.prod_chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "msg_update_self" ON public.prod_chat_messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "msg_delete_self_admin" ON public.prod_chat_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- notifications
CREATE POLICY "notif_select_self" ON public.prod_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "notif_insert_auth" ON public.prod_notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "notif_update_self" ON public.prod_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notif_delete_self" ON public.prod_notifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- audit log
CREATE POLICY "audit_select_all" ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_insert_self" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "audit_delete_admin" ON public.audit_log FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.production_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.production_sub_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prod_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prod_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;

-- App page
INSERT INTO public.app_pages (key, label, description, ordine)
VALUES ('produzione','Produzione','Gestione flusso ordini, magazzino, chat e log', 50)
ON CONFLICT (key) DO NOTHING;

-- Seed a #generale chat channel
INSERT INTO public.prod_chat_channels (kind, name) VALUES ('generale','#generale')
ON CONFLICT DO NOTHING;
