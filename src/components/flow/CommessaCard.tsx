import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Tag, Trash2, GripVertical, AlertTriangle, Factory } from "lucide-react";
import { Commessa, REPARTI, PRIORITA_LABEL } from "./types";
import { urgencyBadge } from "@/lib/urgency";

export type OrderColor = { bg: string; border: string; chip: string };

export type ProdSubInfo = {
  id: string;
  dept: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  code: string;
};

interface Props {
  commessa: Commessa;
  onOpen: () => void;
  onDelete: () => void;
  canDelete?: boolean;
  color?: OrderColor;
  prodSubs?: ProdSubInfo[];
}

const REPARTO_LABEL: Record<string, string> = Object.fromEntries(REPARTI.map((r) => [r.k, r.label]));

/** Mappa reparto -> tipo (ufficio vs lavorazione) + colore identificativo + icona */
const REPARTO_META: Record<string, { kind: "ufficio" | "lavorazione" | "altro"; cls: string; icon: string; short: string }> = {
  amministrazione: { kind: "ufficio",     cls: "bg-slate-700 text-white border-slate-700",    icon: "📋", short: "AMM" },
  acquisti:        { kind: "ufficio",     cls: "bg-blue-600 text-white border-blue-600",      icon: "🛒", short: "ACQ" },
  vendite:         { kind: "ufficio",     cls: "bg-cyan-600 text-white border-cyan-600",      icon: "💼", short: "VEN" },
  progettazione:   { kind: "lavorazione", cls: "bg-fuchsia-600 text-white border-fuchsia-600", icon: "📐", short: "PRG" },
  lavorazione:     { kind: "lavorazione", cls: "bg-emerald-600 text-white border-emerald-600", icon: "🔬", short: "LAV" },
  laboratorio:     { kind: "lavorazione", cls: "bg-emerald-600 text-white border-emerald-600", icon: "🔬", short: "LAV" },
  stampa:          { kind: "lavorazione", cls: "bg-blue-600 text-white border-blue-600",       icon: "🖨️", short: "STA" },
  taglio:          { kind: "lavorazione", cls: "bg-cyan-600 text-white border-cyan-600",       icon: "✂️", short: "TAG" },
  falegnameria:    { kind: "lavorazione", cls: "bg-amber-700 text-white border-amber-700",     icon: "🪚", short: "FAL" },
  tappezzeria:     { kind: "lavorazione", cls: "bg-rose-600 text-white border-rose-600",       icon: "🪡", short: "TAP" },
  logistica:       { kind: "ufficio",     cls: "bg-slate-500 text-white border-slate-500",    icon: "📦", short: "LOG" },
  generale:        { kind: "altro",       cls: "bg-ink/70 text-paper border-ink/70",          icon: "•",  short: "GEN" },
};

const eur = (n: number) =>
  n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const formatDate = (iso: string | null) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
};

const isOverdue = (iso: string | null, stato: string) => {
  if (!iso || stato === "consegnato") return false;
  return new Date(iso) < new Date(new Date().toDateString());
};

/** Mappa dept produzione -> chip colorato (allineato a ProdBoard) */
const PROD_DEPT_CHIP: Record<string, { cls: string; label: string; icon: string }> = {
  acquisti:     { cls: "bg-blue-600 text-white",      label: "Acquisti",      icon: "🛒" },
  vendite:      { cls: "bg-cyan-600 text-white",      label: "Vendite",       icon: "💼" },
  magazzino:    { cls: "bg-slate-700 text-white",     label: "Amministr.",    icon: "📋" },
  progettazione:{ cls: "bg-fuchsia-600 text-white",   label: "Progettazione", icon: "📐" },
  tappezzeria:  { cls: "bg-rose-600 text-white",      label: "Tappezzeria",   icon: "🪡" },
  laboratorio:  { cls: "bg-emerald-600 text-white",   label: "Lavorazione",   icon: "🔬" },
  stampa:       { cls: "bg-blue-600 text-white",      label: "Stampa",        icon: "🖨️" },
  taglio:       { cls: "bg-cyan-600 text-white",      label: "Taglio",        icon: "✂️" },
  stampa_3d:    { cls: "bg-indigo-600 text-white",    label: "Stampa 3D",     icon: "🧊" },
  falegnameria: { cls: "bg-amber-700 text-white",     label: "Falegnameria",  icon: "🪚" },
  assemblaggio: { cls: "bg-emerald-600 text-white",   label: "Lavorazione",   icon: "🔬" },
  altro:        { cls: "bg-ink/70 text-paper",        label: "Altro",         icon: "•"  },
};

export const CommessaCard = ({ commessa, onOpen, onDelete, canDelete = false, color, prodSubs }: Props) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: commessa.id,
    data: { stato: commessa.stato },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const overdue = isOverdue(commessa.data_scadenza, commessa.stato);
  const dateLabel = formatDate(commessa.data_scadenza);
  const urgency = urgencyBadge(commessa.data_scadenza, { done: commessa.stato === "consegnato" });
  const activeProdDepts = (prodSubs ?? [])
    .map((s) => s.dept)
    .filter((d, i, arr) => arr.indexOf(d) === i);
  const primaryProdDept = activeProdDepts.find((d) => !["acquisti", "magazzino"].includes(d)) ?? activeProdDepts[0];
  const displayDept = primaryProdDept ?? commessa.reparto;
  const meta = REPARTO_META[displayDept] ?? REPARTO_META[commessa.reparto] ?? REPARTO_META.generale;
  const repartoLabel = primaryProdDept
    ? `${PROD_DEPT_CHIP[primaryProdDept]?.label ?? primaryProdDept}${activeProdDepts.length > 1 ? ` +${activeProdDepts.length - 1}` : ""}`
    : REPARTO_LABEL[commessa.reparto] ?? commessa.reparto;
  const assignees = commessa.assegnatari ?? [];
  const hasProdAssignees = (prodSubs ?? []).some((s) => !!s.assigneeName);

  const orderBg = color?.bg ?? "bg-paper";
  const orderBorder = color?.border ?? "border-l-ink/30";
  const orderChip = color?.chip ?? "bg-ink/70";

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group cursor-pointer border-l-[6px] border border-ink/15 ${orderBg} ${orderBorder} rounded-sm hover:shadow-md hover:border-primary/40 transition-all overflow-hidden`}
    >
      {/* Banda reparto: si capisce a colpo d'occhio a CHI è destinata */}
      <div className={`flex items-center justify-between gap-2 px-2 py-1 border-b ${meta.cls}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm leading-none" aria-hidden>{meta.icon}</span>
          <span className="text-[10px] font-mono uppercase tracking-widest font-bold truncate">
            {repartoLabel}
          </span>
          <span className="text-[9px] font-mono opacity-70 uppercase tracking-wider">
            · {meta.kind === "ufficio" ? "Ufficio" : meta.kind === "lavorazione" ? "Lavorazione" : "Generale"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {urgency && (
            <span className={`inline-flex items-center px-1.5 py-0.5 border-2 rounded-sm text-[10px] font-mono font-bold uppercase tracking-wider ${urgency.cls}`}>
              {urgency.label}
            </span>
          )}
          {commessa.priorita === "alta" && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-paper/20 rounded-sm text-[9px] font-bold uppercase tracking-wider">
              <AlertTriangle className="w-2.5 h-2.5" /> Alta
            </span>
          )}
        </div>

      <div className="flex items-start gap-2 p-3">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 cursor-grab active:cursor-grabbing text-ink/30 hover:text-ink/70 shrink-0"
          aria-label="Trascina"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${orderChip} shrink-0`} aria-hidden />
              <h4 className="font-display text-sm font-semibold leading-tight break-words">
                {commessa.titolo}
                {commessa.tipo === "task" && (
                  <span className="ml-1.5 inline-block px-1.5 py-0.5 bg-ink/10 text-ink/60 text-[8px] font-mono uppercase tracking-wider rounded-sm align-middle">
                    task
                  </span>
                )}
              </h4>
            </div>
            {canDelete && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  aria-label="Elimina (admin)"
                  title="Elimina (admin)"
                  className="w-6 h-6 grid place-items-center rounded-sm border border-ink/20 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {commessa.cliente && (
            <div className="text-[11px] text-ink/70 mb-1.5 truncate">
              <span className="font-mono text-[9px] uppercase tracking-wider text-ink/40 mr-1">cliente</span>
              {commessa.cliente}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-mono uppercase tracking-wider">
            {commessa.priorita !== "alta" && (
              <span
                className={`px-1.5 py-0.5 rounded-sm border ${
                  commessa.priorita === "media"
                    ? "border-primary/30 text-primary bg-primary/5"
                    : "border-ink/15 text-ink/50"
                }`}
              >
                <Tag className="w-2.5 h-2.5 inline mr-0.5" />
                {PRIORITA_LABEL[commessa.priorita]}
              </span>
            )}
            {dateLabel && (
              <span
                className={`px-1.5 py-0.5 rounded-sm border ${
                  overdue
                    ? "border-destructive/40 text-destructive bg-destructive/5 font-bold"
                    : "border-ink/15 text-ink/60"
                }`}
              >
                <Calendar className="w-2.5 h-2.5 inline mr-0.5" />
                {dateLabel}
              </span>
            )}
            {typeof commessa.importo === "number" && commessa.importo > 0 && (
              <span className="px-1.5 py-0.5 rounded-sm border border-ink/15 text-ink font-bold">
                {eur(commessa.importo)}
              </span>
            )}
          </div>

            {assignees.length > 0 ? (
            <div className="flex items-center flex-wrap gap-1 mt-2">
              <span className="font-mono text-[9px] uppercase tracking-wider text-ink/40">A:</span>
              {assignees.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 bg-ink text-paper rounded-full text-[10px] font-bold"
                  title={a.display_name ?? "Utente"}
                >
                  <span className="w-4 h-4 rounded-full bg-paper text-ink grid place-items-center text-[8px] font-mono font-bold">
                    {(a.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span>{(a.display_name ?? "Utente").split(" ")[0]}</span>
                </span>
              ))}
              {assignees.length > 3 && (
                <span className="text-[9px] font-mono text-ink/60">+{assignees.length - 3}</span>
              )}
            </div>
          ) : prodSubs && prodSubs.length > 0 ? (
            <div className="mt-2">
              <span className={`inline-flex items-center px-1.5 py-0.5 border border-dashed text-[9px] font-mono uppercase tracking-wider rounded-sm ${hasProdAssignees ? "border-primary/40 text-primary" : "border-amber-500/50 text-amber-700"}`}>
                {hasProdAssignees ? "Assegnato in Flow Board" : "Da assegnare in Flow Board"}
              </span>
            </div>
          ) : (
            <div className="mt-2">
              <span className="inline-flex items-center px-1.5 py-0.5 border border-dashed border-destructive/40 text-destructive text-[9px] font-mono uppercase tracking-wider rounded-sm">
                Nessun assegnatario
              </span>
            </div>
          )}

          {/* Sub‑ordini di produzione: chi sta lavorando in fabbrica, in tempo reale */}
          {prodSubs && prodSubs.length > 0 && (
            <div className="mt-2 pt-2 border-t border-dashed border-ink/15">
              <div className="flex items-center gap-1 mb-1">
                <Factory className="w-3 h-3 text-ink/50" />
                <span className="font-mono text-[9px] uppercase tracking-wider text-ink/50 font-bold">
                  In produzione · {prodSubs.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {prodSubs.map((s) => {
                  const chip = PROD_DEPT_CHIP[s.dept] ?? PROD_DEPT_CHIP.altro;
                  return (
                    <span
                      key={s.id}
                      title={`${s.code} · ${s.status}${s.assigneeName ? ` · ${s.assigneeName}` : ""}`}
                      className={`inline-flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-sm text-[10px] font-bold ${chip.cls} ${s.status === "in_lavorazione" ? "ring-2 ring-ink/30" : ""}`}
                    >
                      <span aria-hidden>{chip.icon}</span>
                      <span className="font-mono uppercase tracking-wider">{chip.label}</span>
                      {s.assigneeName ? (
                        <span className="opacity-90">· {s.assigneeName.split(" ")[0]}</span>
                      ) : (
                        <span className="opacity-70 italic">· libero</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};