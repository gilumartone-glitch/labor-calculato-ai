import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, User, Tag, Briefcase, Trash2, GripVertical } from "lucide-react";
import { Commessa, REPARTI, PRIORITA_LABEL } from "./types";

interface Props {
  commessa: Commessa;
  onOpen: () => void;
  onDelete: () => void;
  canDelete?: boolean;
}

const PRIORITY_STYLES: Record<string, string> = {
  alta: "border-l-destructive bg-destructive/5",
  media: "border-l-primary bg-paper",
  bassa: "border-l-ink/20 bg-paper",
};

const REPARTO_LABEL: Record<string, string> = Object.fromEntries(REPARTI.map((r) => [r.k, r.label]));

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

export const CommessaCard = ({ commessa, onOpen, onDelete, canDelete = false }: Props) => {
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
      className={`group cursor-pointer border-l-4 border border-ink/15 ${
        PRIORITY_STYLES[commessa.priorita] ?? "bg-paper"
      } rounded-sm p-3 hover:shadow-md hover:border-primary/40 transition-all`}
    >
      <div className="flex items-start gap-2">
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
            <h4 className="font-display text-sm font-semibold leading-tight break-words">
              {commessa.titolo}
              {commessa.tipo === "task" && (
                <span className="ml-1.5 inline-block px-1.5 py-0.5 bg-ink/10 text-ink/60 text-[8px] font-mono uppercase tracking-wider rounded-sm align-middle">
                  task
                </span>
              )}
            </h4>
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
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{commessa.cliente}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] font-mono uppercase tracking-wider">
            <span className="px-1.5 py-0.5 bg-ink/8 text-ink/70 rounded-sm border border-ink/10">
              <Briefcase className="w-2.5 h-2.5 inline mr-0.5" />
              {REPARTO_LABEL[commessa.reparto] ?? commessa.reparto}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-sm border ${
                commessa.priorita === "alta"
                  ? "border-destructive/30 text-destructive bg-destructive/5"
                  : commessa.priorita === "media"
                  ? "border-primary/30 text-primary bg-primary/5"
                  : "border-ink/15 text-ink/50"
              }`}
            >
              <Tag className="w-2.5 h-2.5 inline mr-0.5" />
              {PRIORITA_LABEL[commessa.priorita]}
            </span>
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

          {commessa.assegnatari && commessa.assegnatari.length > 0 && (
            <div className="flex items-center gap-1 mt-2">
              <div className="flex -space-x-1.5">
                {commessa.assegnatari.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    title={a.display_name ?? "Utente"}
                    className="w-5 h-5 rounded-full border-2 border-paper bg-ink text-paper text-[9px] font-mono font-bold grid place-items-center"
                  >
                    {(a.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                ))}
              </div>
              {commessa.assegnatari.length > 4 && (
                <span className="text-[9px] font-mono text-muted-foreground">
                  +{commessa.assegnatari.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};