/** Helper per mostrare a colpo d'occhio quando una commessa va lavorata. */
export type UrgencyBadge = {
  label: string;
  /** Classi tailwind per il chip (sfondo + testo + bordo). */
  cls: string;
  /** Quanti giorni mancano (negativo = in ritardo). null se senza data. */
  days: number | null;
};

/** Restituisce un badge "OGGI / DOMANI / IN RITARDO / FRA Xg" per la data passata. */
export const urgencyBadge = (iso: string | null | undefined, opts?: { done?: boolean }): UrgencyBadge | null => {
  if (!iso) return null;
  if (opts?.done) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diff < 0) {
    return {
      days: diff,
      label: diff === -1 ? "IN RITARDO · ieri" : `IN RITARDO · ${Math.abs(diff)}g`,
      cls: "bg-destructive text-destructive-foreground border-destructive animate-pulse",
    };
  }
  if (diff === 0) {
    return { days: 0, label: "OGGI", cls: "bg-destructive text-destructive-foreground border-destructive" };
  }
  if (diff === 1) {
    return { days: 1, label: "DOMANI", cls: "bg-amber-500 text-white border-amber-600" };
  }
  if (diff <= 3) {
    return { days: diff, label: `FRA ${diff}g`, cls: "bg-amber-100 text-amber-800 border-amber-400" };
  }
  if (diff <= 7) {
    return { days: diff, label: `FRA ${diff}g`, cls: "bg-emerald-50 text-emerald-800 border-emerald-300" };
  }
  return { days: diff, label: `FRA ${diff}g`, cls: "bg-muted text-ink/60 border-ink/15" };
};
