
CREATE OR REPLACE FUNCTION public.dispatch_email_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_anon text;
  v_email text;
  v_name text;
  v_cta_url text;
  v_title text;
BEGIN
  -- Recupera email + display_name del destinatario
  SELECT u.email::text, COALESCE(p.display_name, split_part(u.email::text, '@', 1))
  INTO v_email, v_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = NEW.user_id;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  v_url := 'https://oylveuwfvsijguwzlauw.supabase.co/functions/v1/send-transactional-email';
  v_anon := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95bHZldXdmdnNpamd1d3psYXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTU4NjMsImV4cCI6MjA5NDE3MTg2M30.lSrUmQLS1ilqPKwdUoCZwZslnai_Z8BIqODm02C92MI';

  -- CTA URL: usa il link della notifica se presente
  IF NEW.link IS NOT NULL AND NEW.link <> '' THEN
    v_cta_url := 'https://flow.tecnofra.it' || NEW.link;
  ELSE
    v_cta_url := 'https://flow.tecnofra.it/produzione';
  END IF;

  -- Titolo email a partire dal tipo notifica
  v_title := CASE NEW.type
    WHEN 'sub_assegnato' THEN 'Nuovo sub-ordine assegnato'
    WHEN 'sub_sbloccato' THEN 'Lavorazione sbloccata'
    WHEN 'sub_completato' THEN 'Sub-ordine completato'
    WHEN 'sub_rimandato' THEN 'Sub-ordine rimandato'
    WHEN 'ordine_pronto' THEN 'Ordine pronto'
    WHEN 'ordine_spedito' THEN 'Ordine spedito'
    WHEN 'ordine_fatturabile' THEN 'Ordine fatturabile'
    WHEN 'ordine_rimandato' THEN 'Progetto in revisione'
    WHEN 'commessa_mention' THEN 'Sei stato menzionato in una commessa'
    WHEN 'commessa_update' THEN 'Aggiornamento commessa'
    WHEN 'montaggio_assegnato' THEN 'Nuovo turno di montaggio'
    WHEN 'lavoro_in_ritardo' THEN 'Lavoro in ritardo'
    ELSE 'Aggiornamento dal tuo workspace'
  END;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer '||v_anon
    ),
    body := jsonb_build_object(
      'templateName', 'notification',
      'recipientEmail', v_email,
      'idempotencyKey', concat('notif-', NEW.id::text),
      'templateData', jsonb_build_object(
        'recipientName', v_name,
        'title', v_title,
        'message', NEW.message,
        'ctaLabel', 'Apri nell''app',
        'ctaUrl', v_cta_url,
        'footerNote', CASE WHEN NEW.is_urgent THEN 'Notifica urgente.' ELSE NULL END
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_dispatch_email_on_notification ON public.prod_notifications;
CREATE TRIGGER trg_dispatch_email_on_notification
AFTER INSERT ON public.prod_notifications
FOR EACH ROW EXECUTE FUNCTION public.dispatch_email_on_notification();
