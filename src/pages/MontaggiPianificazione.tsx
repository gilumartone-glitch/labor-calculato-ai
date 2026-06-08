import { useState } from "react";
import { HardHat } from "lucide-react";
import { toast } from "sonner";
import { HubLink } from "@/components/HubLink";
import { AdminUsersLink } from "@/components/AdminUsersLink";
import { CalendarGlobalView } from "@/components/montaggi/CalendarGlobalView";
import { MyActivities } from "@/components/montaggi/MyActivities";

type FilterReparto = "stampa" | "taglio" | "tappezzeria" | "montaggi" | "magazzino";

const FILTERS: { key: FilterReparto; label: string }[] = [
  { key: "stampa", label: "Stampa" },
  { key: "taglio", label: "Taglio" },
  { key: "tappezzeria", label: "Tappezzeria" },
  { key: "montaggi", label: "Montaggi" },
  { key: "magazzino", label: "Magazzino" },
];

export default function MontaggiPianificazione() {
  // Selezione vuota = "Tutti" (mostra tutti i reparti)
  const [selected, setSelected] = useState<FilterReparto[]>([]);

  const isAll = selected.length === 0;

  const toggleAll = () => setSelected([]);
  const toggleReparto = (r: FilterReparto) => {
    setSelected((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  };

  return (
    <div data-dept="montaggi" className="min-h-screen bg-dept-soft/50 text-foreground">
      <header className="sticky top-0 z-20 border-b-2 border-dept bg-paper">
        <div className="container flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-dept text-dept-foreground"><HardHat className="h-5 w-5" /></div>
            <div>
              <h1 className="font-display text-2xl font-semibold leading-none">Pianificazione</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Montaggi e lavorazioni · operai, cantieri e impegni</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HubLink />
            <AdminUsersLink variant="outline" />
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        <MyActivities />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider font-bold text-ink/60 mr-1">Filtra reparti</span>
            <button
              type="button"
              onClick={toggleAll}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm border-2 transition-colors ${
                isAll
                  ? "bg-dept text-dept-foreground border-dept"
                  : "bg-background border-ink/20 hover:border-dept"
              }`}
            >
              Tutti
            </button>
            {FILTERS.map((f) => {
              const active = selected.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleReparto(f.key)}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm border-2 transition-colors ${
                    active
                      ? "bg-dept text-dept-foreground border-dept"
                      : "bg-background border-ink/20 hover:border-dept"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
            {!isAll && (
              <span className="text-[10px] font-mono text-muted-foreground ml-1">
                {selected.length} selezionati
              </span>
            )}
          </div>

          <CalendarGlobalView selectedReparti={selected} />
        </div>
      </main>
    </div>
  );
}
