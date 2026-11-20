import { ChevronRight } from "lucide-react";
import { TIPO_BREVE, TIPO_LABEL, catenaDocumento, numeroDocumento, type NodoPercorso, type TipoDocumento } from "@/lib/gestionale/documenti";

const fmtData = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const NOME: Record<TipoDocumento, string> = { ...TIPO_LABEL, ordine: "Conferma d'ordine" };

/**
 * Il percorso dei documenti: da dove nasce questo documento e cosa ne è nato.
 * `compatto` per gli elenchi (una riga di sigle); altrimenti una fascia con numero e data, cliccabile.
 */
export const PercorsoDocumenti = ({ id, nodi, compatto, onApri }: {
  id: string;
  nodi: Map<string, NodoPercorso>;
  compatto?: boolean;
  onApri?: (id: string, tipo: TipoDocumento) => void;
}) => {
  const questo = nodi.get(id);
  if (!questo) return null;
  const { prima, dopo } = catenaDocumento(id, nodi);
  const passi = [...prima, questo, ...dopo];

  if (compatto) {
    if (passi.length === 1) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1 text-xs" title={passi.map((p) => `${NOME[p.tipo]} ${numeroDocumento(p)} del ${fmtData(p.data)}`).join("  →  ")}>
        {passi.map((p, i) => (
          <span key={p.id} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            <span className={`${p.id === id ? "font-semibold" : "text-muted-foreground"} ${p.stato === "annullato" ? "line-through" : ""}`}>
              {TIPO_BREVE[p.tipo]} {p.numero ?? "bozza"}
            </span>
          </span>
        ))}
      </span>
    );
  }

  return (
    <section className="border-2 border-ink/20 bg-paper rounded-sm px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Percorso dei documenti</div>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {passi.map((p, i) => {
          const attuale = p.id === id;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
              <button
                type="button"
                disabled={attuale || !onApri}
                onClick={() => onApri?.(p.id, p.tipo)}
                className={`text-left rounded-sm border-2 px-2.5 py-1.5 leading-tight ${attuale ? "border-ink bg-ink text-paper" : "border-ink/20 hover:border-ink/60"} ${p.stato === "annullato" ? "opacity-60 line-through" : ""}`}
              >
                <div className="text-xs font-semibold">{NOME[p.tipo]}</div>
                <div className="text-xs tabular-nums">
                  {p.numero != null ? `n. ${numeroDocumento(p)}` : "bozza"} · {fmtData(p.data)}
                </div>
              </button>
            </div>
          );
        })}
        {passi.length === 1 && <span className="self-center text-xs text-muted-foreground">Primo documento del percorso: da qui nascono gli altri.</span>}
      </div>
    </section>
  );
};
