import { useState } from "react";
import { Plus, Pencil, Trash2, Package, Layers } from "lucide-react";
import type { SubProject } from "./types";
import { uid } from "@/lib/format";

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

  const add = () => {
    const name = window.prompt("Nome del prodotto finito (es. Tavolino):", "");
    if (!name || !name.trim()) return;
    const next: SubProject = {
      id: uid(),
      name: name.trim(),
      order: subProjects.reduce((m, s) => Math.max(m, s.order), -1) + 1,
    };
    setSubProjects([...subProjects, next]);
    setActiveId(next.id);
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
          if (editingId === s.id) {
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
                active ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 text-ink/70 hover:text-ink"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[11px] uppercase tracking-wider font-semibold"
              >
                <Package className="w-3 h-3" />
                {s.name}
                {n > 0 && (
                  <span className={`font-mono text-[9px] ${active ? "opacity-80" : "opacity-60"}`}>
                    ·{n}
                  </span>
                )}
              </button>
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
            </div>
          );
        })}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] uppercase tracking-wider font-semibold border-2 border-dashed border-primary/60 text-primary hover:bg-primary/10 transition-colors"
      >
        <Plus className="w-3 h-3" />
        Nuovo prodotto
      </button>

      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
};
