
-- 1) Campi per arricchire i sub-ordini di tipo "acquisti"
ALTER TABLE public.production_sub_orders
  ADD COLUMN IF NOT EXISTS material_qty numeric,
  ADD COLUMN IF NOT EXISTS material_unit text,
  ADD COLUMN IF NOT EXISTS material_code text,
  ADD COLUMN IF NOT EXISTS material_label text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS order_status text;

-- Valori ammessi per order_status (solo per leggibilità, non vincolante)
COMMENT ON COLUMN public.production_sub_orders.order_status IS
  'Stato avanzamento ordine acquisti: da_ordinare | ordinato | in_transito | arrivato (NULL = non un sub acquisti)';

-- 2) Fix del trigger push: l'URL puntava a un progetto Supabase diverso
CREATE OR REPLACE FUNCTION public.dispatch_push_on_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_anon text;
BEGIN
  v_url := 'https://oylveuwfvsijguwzlauw.supabase.co/functions/v1/send-push';
  v_anon := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95bHZldXdmdnNpamd1d3psYXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTU4NjMsImV4cCI6MjA5NDE3MTg2M30.lSrUmQLS1ilqPKwdUoCZwZslnai_Z8BIqODm02C92MI';
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'user_id', NEW.user_id,
      'message', NEW.message,
      'link', NEW.link,
      'is_urgent', NEW.is_urgent,
      'order_id', NEW.order_id
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $function$;

-- 3) Assicura che il trigger esista sulla tabella notifiche
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'prod_notifications_dispatch_push'
  ) THEN
    CREATE TRIGGER prod_notifications_dispatch_push
      AFTER INSERT ON public.prod_notifications
      FOR EACH ROW EXECUTE FUNCTION public.dispatch_push_on_notification();
  END IF;
END $$;
