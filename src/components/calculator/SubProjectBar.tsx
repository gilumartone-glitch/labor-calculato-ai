import { useState } from "react";
import { Plus, Pencil, Trash2, Package, Layers, Wrench, Check, X, Lock } from "lucide-react";
import type { SubProject } from "./types";
import { uid } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
                  <AssemblyLabPill
                    sp={s}
                    active={active}
                    onChange={(patch) =>
                      setSubProjects(
                        subProjects.map((x) =>
                          x.id === s.id
                            ? { ...x, assemblyLab: { enabled: false, hours: 0, hourlyCost: 35, ...(x.assemblyLab ?? {}), ...patch } }
                            : x,
                        ),
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

/** Pillola compatta per attivare "Assemblaggio in laboratorio" sul sub-progetto.
 *  Popover con ore + €/h. Il costo entra nel Riepilogo e genera un task Falegnameria
 *  bloccato da tutte le altre lavorazioni del sub. */
const AssemblyLabPill = ({
  sp, active, onChange,
}: {
  sp: SubProject;
  active: boolean;
  onChange: (patch: Partial<NonNullable<SubProject["assemblyLab"]>>) => void;
}) => {
  const cfg = sp.assemblyLab;
  const enabled = !!cfg?.enabled;
  const hours = cfg?.hours ?? 0;
  const rate = cfg?.hourlyCost ?? 35;
  const cost = Math.max(0, hours) * Math.max(0, rate);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={enabled ? `Assemblaggio lab · ${hours}h × ${rate}€/h` : "Assemblaggio finale in laboratorio"}
          className={`p-1 inline-flex items-center gap-1 text-[10px] ${
            enabled
              ? (active ? "text-primary-foreground" : "text-amber-700")
              : (active ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-ink/40 hover:text-ink")
          }`}
        >
          <Wrench className="w-3 h-3" />
          {enabled && <span className="font-mono tabular-nums">{hours}h</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider">Assemblaggio in laboratorio</div>
          <label className="inline-flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="accent-primary"
            />
            Attivo
          </label>
        </div>
        <p className="text-[10px] text-muted-foreground leading-tight">
          Task finale in Falegnameria per il sub "{sp.name}". Bloccato da tutte le altre lavorazioni del sub.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Ore
            <input
              type="number"
              min={0}
              step={0.5}
              value={hours || ""}
              disabled={!enabled}
              onChange={(e) => onChange({ hours: parseFloat(e.target.value) || 0 })}
              className="mt-1 w-full h-8 px-2 border-2 border-ink/15 rounded-sm font-mono text-sm bg-paper disabled:opacity-40"
            />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            €/ora
            <input
              type="number"
              min={0}
              step={1}
              value={rate || ""}
              disabled={!enabled}
              onChange={(e) => onChange({ hourlyCost: parseFloat(e.target.value) || 0 })}
              className="mt-1 w-full h-8 px-2 border-2 border-ink/15 rounded-sm font-mono text-sm bg-paper disabled:opacity-40"
            />
          </label>
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-muted-foreground">Costo</span>
          <span className="tabular-nums font-semibold">{cost.toFixed(2)} €</span>
        </div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Note (checklist componenti extra)
          <textarea
            rows={2}
            value={cfg?.notes ?? ""}
            disabled={!enabled}
            onChange={(e) => onChange({ notes: e.target.value })}
            className="mt-1 w-full px-2 py-1 border-2 border-ink/15 rounded-sm font-mono text-[11px] bg-paper disabled:opacity-40"
          />
        </label>
      </PopoverContent>
    </Popover>
  );
};
