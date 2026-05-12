-- Trigger per aggiornare updated_at su ogni UPDATE di contabilita_state,
-- così possiamo verificare quando un salvataggio reale arriva al DB.
DROP TRIGGER IF EXISTS contabilita_state_set_updated_at ON public.contabilita_state;
CREATE TRIGGER contabilita_state_set_updated_at
BEFORE UPDATE ON public.contabilita_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();