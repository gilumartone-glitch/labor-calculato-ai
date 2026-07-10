import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Package, Layers, Wrench, Check, X, Lock, Trash, Calendar } from "lucide-react";
import type { SubProject, ProductWork } from "./types";
import { getProductWorks } from "./types";
import { uid } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchDipendenti, type Dipendente } from "@/lib/dipendenti";
import { DEPT_LABEL, WORK_DEPTS } from "@/lib/produzione/types";

interface SubProjectBarProps {
  subProjects: SubProject[];
  setSubProjects: (list: SubProject[]) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** Pieces per contare le lavorazioni per sub-progetto (opzionale). */
  pieceCounts?: Record<string, number>;
  /** Slot opzionale renderizzato in coda alla barra (es. bottone "Lancia nel Flow"). */
  trailing?: React.ReactNode;
}

/** Barra dei "prodotti finiti" (sub-progetti) del progetto madre.
 *  Chip cliccabili + "Tutti" + azione "Nuovo prodotto". Rinomina/elimina inline. */
export const SubProjectBar = ({
  subProjects, setSubProjects, activeId, setActiveId, pieceCounts, trailing,
}: SubProjectBarProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const startAdd = () => {
    setIsAdding(true);
    setNewName("");
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setNewName("");
  };

  const commitAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const next: SubProject = {
      id: uid(),
      name,
      order: subProjects.reduce((m, s) => Math.max(m, s.order), -1) + 1,
    };
    setSubProjects([...subProjects, next]);
    setActiveId(next.id);
    cancelAdd();
  };

  const startEdit = (s: SubProject) => {
    setEditingId(s.id);
    setEditValue(s.name);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const v = editValue.trim();
    if (v) {
      setSubProjects(subProjects.map((s) => (s.id === editingId ? { ...s, name: v } : s)));
    }
    setEditingId(null);
    setEditValue("");
  };

  const remove = (s: SubProject) => {
    const n = pieceCounts?.[s.id] ?? 0;
    const msg =
      n > 0
        ? `Eliminare il prodotto "${s.name}"?\n${n} pezz${n === 1 ? "o verrà" : "i verranno"} spostat${n === 1 ? "o" : "i"} in "Generale".`
        : `Eliminare il prodotto "${s.name}"?`;
    if (!window.confirm(msg)) return;
    setSubProjects(subProjects.filter((x) => x.id !== s.id));
    if (activeId === s.id) setActiveId(null);
  };

  return (
    <div className="border-2 border-ink/15 bg-paper rounded-sm p-2 flex flex-wrap items-center gap-1.5">
      <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-ink/15 text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
        <Layers className="w-3.5 h-3.5" />
        Prodotti finiti
      </div>

      <button
        type="button"
        onClick={() => setActiveId(null)}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] uppercase tracking-wider font-semibold border-2 transition-colors ${
          activeId === null
            ? "bg-ink text-paper border-ink"
            : "border-ink/20 text-ink/60 hover:text-ink"
        }`}
      >
        Tutti
      </button>

      {subProjects.length > 0 && (() => {
        const n = pieceCounts?.["__none__"] ?? 0;
        const active = activeId === "__none__";
        return (
          <button
            type="button"
            onClick={() => setActiveId("__none__")}
            title="Lavorazioni non assegnate a un prodotto finito"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] uppercase tracking-wider font-semibold border-2 transition-colors ${
              active
                ? "bg-accent text-ink border-accent"
                : "border-dashed border-ink/30 text-ink/70 hover:text-ink hover:bg-accent/20"
            }`}
          >
            Generale
            {n > 0 && (
              <span className={`font-mono text-[9px] ${active ? "opacity-80" : "opacity-60"}`}>·{n}</span>
            )}
          </button>
        );
      })()}

      {subProjects
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => {
          const active = s.id === activeId;
          const n = pieceCounts?.[s.id] ?? 0;
          const locked = !!s.launchedCommessaId;
          if (editingId === s.id && !locked) {
            return (
              <input
                key={s.id}
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") { setEditingId(null); setEditValue(""); }
                }}
                className="h-7 px-2 border-2 border-primary rounded-sm text-[11px] font-semibold bg-paper w-40"
              />
            );
          }
          return (
            <div
              key={s.id}
              className={`inline-flex items-center gap-1 rounded-sm border-2 transition-colors ${
                locked
                  ? (active
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-amber-50 border-amber-500/60 text-amber-800")
                  : (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-ink/20 text-ink/70 hover:text-ink")
              }`}
              title={locked ? "Inviato al Flow — per modificare, fallo tornare indietro dal Flow" : undefined}
            >
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[11px] uppercase tracking-wider font-semibold"
              >
                {locked ? <Lock className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                {s.name}
                {n > 0 && (
                  <span className={`font-mono text-[9px] ${active ? "opacity-80" : "opacity-60"}`}>
                    ·{n}
                  </span>
                )}
              </button>
              {locked ? (
                <span className="px-1.5 py-0.5 mr-1 text-[9px] uppercase tracking-widest font-bold font-mono rounded-sm bg-amber-700 text-white">
                  Inviato al Flow
                </span>
              ) : (
                <>
                  <ProductWorksPill
                    sp={s}
                    active={active}
                    onChange={(next) =>
                      setSubProjects(
                        subProjects.map((x) => (x.id === s.id ? { ...x, productWorks: next } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    title="Rinomina"
                    className={`p-1 ${active ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-ink/40 hover:text-ink"}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    title="Elimina"
                    className={`p-1 pr-1.5 ${active ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-ink/40 hover:text-destructive"}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          );
        })}

      {isAdding ? (
        <form
          onSubmit={(e) => { e.preventDefault(); commitAdd(); }}
          className="inline-flex items-center gap-1 rounded-sm border-2 border-primary bg-paper px-1 py-0.5"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelAdd();
            }}
            placeholder="Nome prodotto"
            className="h-7 w-40 bg-paper px-2 text-[11px] font-semibold uppercase tracking-wider outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            title="Crea prodotto"
            disabled={!newName.trim()}
            className="p-1 text-primary transition-colors hover:text-primary/80 disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={cancelAdd}
            title="Annulla"
            className="p-1 text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] uppercase tracking-wider font-semibold border-2 border-dashed border-primary/60 text-primary hover:bg-primary/10 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Nuovo prodotto
        </button>
      )}

      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
};

/** Pillola compatta "Lavorazioni prodotto" (decorazione, assemblaggio, ignifugazione, ...).
 *  Multi-riga: ogni riga = ProductWork con reparto proprio, ore/€h, responsabile,
 *  assegnatari e date (tutti opzionali in preventivo). Il costo entra nel Riepilogo
 *  e genera un task per riga in Flow bloccato dalle lavorazioni base del sub. */
const DEPT_OPTIONS: string[] = WORK_DEPTS.filter((d) => d !== "progettazione");

const emptyWork = (): ProductWork => ({
  id: uid(),
  name: "",
  dept: "falegnameria",
  hours: 0,
  hourlyCost: 35,
  assigneeIds: [],
});

const ProductWorksPill = ({
  sp, active, onChange,
}: {
  sp: SubProject;
  active: boolean;
  onChange: (next: ProductWork[]) => void;
}) => {
  const works = getProductWorks(sp);
  const count = works.length;
  const totalHours = works.reduce((s, w) => s + (Number(w.hours) || 0), 0);
  const totalCost = works.reduce((s, w) => s + (Number(w.hours) || 0) * (Number(w.hourlyCost) || 0), 0);

  const [open, setOpen] = useState(false);
  const [dips, setDips] = useState<Dipendente[]>([]);
  useEffect(() => {
    if (!open || dips.length > 0) return;
    fetchDipendenti(true).then(setDips).catch(() => setDips([]));
  }, [open, dips.length]);

  const update = (id: string, patch: Partial<ProductWork>) =>
    onChange(works.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const remove = (id: string) => onChange(works.filter((w) => w.id !== id));
  const add = () => onChange([...works, emptyWork()]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={count > 0 ? `${count} lavorazion${count === 1 ? "e" : "i"} · ${totalHours}h` : "Lavorazioni prodotto (decorazione, assemblaggio, ignifugazione, ...)"}
          className={`p-1 inline-flex items-center gap-1 text-[10px] ${
            count > 0
              ? (active ? "text-primary-foreground" : "text-amber-700")
              : (active ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-ink/40 hover:text-ink")
          }`}
        >
          <Wrench className="w-3 h-3" />
          {count > 0 && (
            <span className="font-mono tabular-nums">
              {count}·{totalHours}h
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-3 space-y-2 max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider">
            Lavorazioni prodotto · {sp.name}
          </div>
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] uppercase tracking-wider font-semibold border border-primary text-primary hover:bg-primary/10"
          >
            <Plus className="w-3 h-3" /> Aggiungi
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground leading-tight">
          Decorazione, assemblaggio, ignifugazione, altro: nome + reparto liberi. Responsabile, assegnatari e date sono opzionali in preventivo — puoi compilarli anche al lancio nel Flow.
        </p>

        {works.length === 0 && (
          <div className="rounded-sm border border-dashed border-ink/20 p-4 text-center text-[11px] text-muted-foreground">
            Nessuna lavorazione aggiuntiva. Premi "Aggiungi" per inserirne una.
          </div>
        )}

        {works.map((w) => {
          const cost = (Number(w.hours) || 0) * (Number(w.hourlyCost) || 0);
          return (
            <div key={w.id} className="rounded-sm border-2 border-ink/10 p-2 space-y-2 bg-paper">
              <div className="grid grid-cols-[1fr_140px_auto] gap-2">
                <input
                  type="text"
                  value={w.name}
                  onChange={(e) => update(w.id, { name: e.target.value })}
                  placeholder="Nome lavorazione (es. Decorazione)"
                  className="h-8 px-2 border-2 border-ink/15 rounded-sm text-sm bg-paper"
                />
                <select
                  value={w.dept}
                  onChange={(e) => update(w.id, { dept: e.target.value })}
                  className="h-8 px-2 border-2 border-ink/15 rounded-sm text-[11px] bg-paper"
                >
                  {DEPT_OPTIONS.map((d) => (
                    <option key={d} value={d}>{DEPT_LABEL[d as keyof typeof DEPT_LABEL] ?? d}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  title="Rimuovi"
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Ore
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={w.hours || ""}
                    onChange={(e) => update(w.id, { hours: parseFloat(e.target.value) || 0 })}
                    className="mt-1 w-full h-8 px-2 border-2 border-ink/15 rounded-sm font-mono text-sm bg-paper"
                  />
                </label>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  €/ora
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={w.hourlyCost || ""}
                    onChange={(e) => update(w.id, { hourlyCost: parseFloat(e.target.value) || 0 })}
                    className="mt-1 w-full h-8 px-2 border-2 border-ink/15 rounded-sm font-mono text-sm bg-paper"
                  />
                </label>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Costo
                  <div className="mt-1 h-8 flex items-center justify-end px-2 border-2 border-ink/10 rounded-sm font-mono text-sm tabular-nums bg-ink/5">
                    {cost.toFixed(2)} €
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Responsabile (opz.)
                  <select
                    value={w.responsibleId ?? ""}
                    onChange={(e) => update(w.id, { responsibleId: e.target.value || null })}
                    className="mt-1 w-full h-8 px-2 border-2 border-ink/15 rounded-sm text-[11px] bg-paper"
                  >
                    <option value="">—</option>
                    {dips.map((d) => (
                      <option key={d.id} value={`dip:${d.id}`}>{d.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Assegnatari (opz.)
                  <select
                    multiple
                    value={w.assigneeIds ?? []}
                    onChange={(e) => {
                      const sel = Array.from(e.target.selectedOptions).map((o) => o.value);
                      update(w.id, { assigneeIds: sel });
                    }}
                    className="mt-1 w-full min-h-[64px] px-2 py-1 border-2 border-ink/15 rounded-sm text-[11px] bg-paper"
                  >
                    {dips.map((d) => (
                      <option key={d.id} value={`dip:${d.id}`}>{d.nome}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {([
                  ["startAt", "Inizio"],
                  ["endAt", "Fine"],
                  ["deliveryAt", "Consegna"],
                ] as const).map(([field, label]) => (
                  <label key={field} className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{label}</span>
                    <input
                      type="date"
                      value={(w[field] as string | null | undefined) ?? ""}
                      onChange={(e) => update(w.id, { [field]: e.target.value || null } as Partial<ProductWork>)}
                      className="mt-1 w-full h-8 px-2 border-2 border-ink/15 rounded-sm text-[11px] bg-paper"
                    />
                  </label>
                ))}
              </div>

              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Note
                <textarea
                  rows={2}
                  value={w.notes ?? ""}
                  onChange={(e) => update(w.id, { notes: e.target.value })}
                  className="mt-1 w-full px-2 py-1 border-2 border-ink/15 rounded-sm font-mono text-[11px] bg-paper"
                />
              </label>
            </div>
          );
        })}

        {works.length > 0 && (
          <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-ink/10">
            <span className="text-muted-foreground">Totale</span>
            <span className="tabular-nums font-semibold">{totalHours}h · {totalCost.toFixed(2)} €</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
