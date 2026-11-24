import { TechnicalDrawing } from "@/components/calculator/TechnicalDrawing";
import {
  caratteristicheScheda, latiDisegno, lavorazioniPerLato, misureScheda, type SchedaTecnica,
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
        const { lati, altre, haLati } = lavorazioniPerLato(s);
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
                {haLati || altre.length > 0 ? "Lavorazioni" : "Nessuna lavorazione"}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                {haLati && lati.map((l) => (
                  <div key={l.lato} className="contents">
                    <dt className="font-semibold">{l.nome}:</dt>
                    <dd className="flex flex-wrap gap-x-2">
                      {l.voci.length === 0 ? <span className="text-muted-foreground">—</span> : l.voci.map((v, j) => (
                        <span key={j} className="inline-flex items-center gap-1">
                          <span className="w-2.5 h-2.5 shrink-0 rounded-sm border border-ink/30" style={{ background: v.colore ?? "hsl(220 14% 35%)" }} />{v.nome}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
                {altre.length > 0 && <div className="contents"><dt className="font-semibold">{haLati ? "Altre:" : "Lavorazioni:"}</dt><dd>{altre.join(", ")}</dd></div>}
              </dl>
              {s.nota && <div className="italic text-muted-foreground border-l-2 border-ink/20 pl-2">{s.nota}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};
