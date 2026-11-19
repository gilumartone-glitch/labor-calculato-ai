import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, Loader2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { creaDocumento, elencoAliquote, salvaBozza } from "@/lib/gestionale/documenti";
import { preventivoDaProgettazione, type RiepilogoProgetto } from "@/lib/gestionale/da-progettazione";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id della scheda di Progettazione attiva, se è una scheda salvata. */
const schedaAttiva = (): string | null => {
  try {
    const id = localStorage.getItem("officina:active-draft");
    return id && RE_UUID.test(id) ? id : null;
  } catch { return null; }
};

/**
 * Dal Riepilogo generale di Progettazione: crea nel Gestionale un preventivo in bozza
 * con una riga per reparto e lo apre. Visibile solo a chi può scrivere nel Gestionale.
 */
export const CreaPreventivoGestionaleButton = ({ riepilogo, disabled, className }: {
  riepilogo: () => RiepilogoProgetto;
  disabled?: boolean;
  className?: string;
}) => {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [occupato, setOccupato] = useState(false);

  if (!can("gestionale", "write")) return null;

  const crea = async () => {
    setOccupato(true);
    try {
      const preventivo = preventivoDaProgettazione(riepilogo(), await elencoAliquote());
      if (preventivo.righe.length === 0) {
        toast({ title: "Niente da portare", description: "La scheda non ha ancora costi.", variant: "destructive" });
        return;
      }
      if (!confirm(`Creare nel Gestionale un preventivo in bozza da questa scheda?\n\nImponibile: ${eur(preventivo.netto)}`)) return;
      const id = await creaDocumento("preventivo", { oggetto: preventivo.oggetto, design_draft_id: schedaAttiva() });
      await salvaBozza(id, {}, preventivo.righe, []);
      if (preventivo.aliquotaMancante !== null) {
        toast({
          title: "Preventivo creato, IVA da scegliere",
          description: `Nel Gestionale non esiste l'aliquota ${preventivo.aliquotaMancante}%: le righe sono senza IVA.`,
        });
      } else {
        toast({ title: "Preventivo creato in bozza", description: "Scegli il cliente e conferma per dargli il numero." });
      }
      navigate(`/gestionale?doc=${id}`);
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setOccupato(false); }
  };

  return (
    <button type="button" onClick={crea} disabled={disabled || occupato} className={className}>
      {occupato ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FilePlus2 className="w-3.5 h-3.5" />} Crea preventivo nel Gestionale
    </button>
  );
};
