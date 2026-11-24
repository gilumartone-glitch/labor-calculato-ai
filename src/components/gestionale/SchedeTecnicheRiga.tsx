import { TechnicalDrawing } from "@/components/calculator/TechnicalDrawing";
import {
  caratteristicheScheda, latiDisegno, misureScheda, testoLavorazione, type SchedaTecnica,
} from "@/lib/gestionale/scheda-tecnica";

/**
 * I pezzi di Progettazione che una riga del documento comprende: il disegno com'è in Progettazione
 * e tutte le lavorazioni. Sono una fotografia presa alla creazione del preventivo: qui si consultano.
 */
export const SchedeTecnicheRiga = ({ schede }: { schede: SchedaTecnica[] }) => {
  if (schede.length === 0) return null;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {schede.map((s, i) => {
        const libere = [...(s.stampa ? [s.stampa] : []), ...s.lavorazioniLibere];
        return (
          <div key={i} className="border border-ink/15 rounded-sm bg-paper p-2 grid grid-cols-[minmax(0,200px)_1fr] gap-3">
            <TechnicalDrawing
              width={s.larghezza} height={s.altezza} unit={s.unita} shape={s.forma} widthBottom={s.baseMinore ?? undefined}
              sides={latiDisegno(s)} canvasWidth={300} canvasHeight={220}
            />
            <div className="text-xs space-y-1 min-w-0">
              <div className="font-semibold text-sm">
                {s.titolo}{s.quantita > 1 && <span className="ml-1 font-mono text-muted-foreground">× {s.quantita}</span>}
              </div>
              <div className="text-muted-foreground">{[misureScheda(s), ...caratteristicheScheda(s)].join(" · ")}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground pt-1">
                {s.lavorazioni.length + libere.length > 0 ? "Lavorazioni" : "Nessuna lavorazione"}
              </div>
              <ul className="space-y-0.5">
                {libere.map((l, j) => <li key={`l${j}`} className="flex items-start gap-1.5"><span className="mt-1 w-2.5 h-2.5 shrink-0 rounded-sm bg-ink/30" />{l}</li>)}
                {s.lavorazioni.map((l, j) => (
                  <li key={j} className="flex items-start gap-1.5">
                    <span className="mt-1 w-2.5 h-2.5 shrink-0 rounded-sm border border-ink/30" style={{ background: l.lati.length > 0 ? l.colore ?? "hsl(220 14% 35%)" : undefined }} />
                    {testoLavorazione(l)}
                  </li>
                ))}
              </ul>
              {s.nota && <div className="italic text-muted-foreground border-l-2 border-ink/20 pl-2">{s.nota}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};
