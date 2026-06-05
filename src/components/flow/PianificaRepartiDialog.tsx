import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { inferProdDeptsFromSnapshot } from "@/lib/produzione/snapshot";
import type { ProdDept } from "@/lib/produzione/types";

type Profile = { id: string; display_name: string | null; settori?: string[] | null };

type Plan = {
  startDate: string;
  endDate: string;
  deliveryDate: string;
  operatorIds: string[];
};

const DEPT_TO_REPARTO: Partial<Record<ProdDept, string>> = {
  montaggi: "montaggi",
  laboratorio: "laboratorio",
  tappezzeria: "tappezzeria",
  vendite: "vendite",
  falegnameria: "falegnameria",
  stampa: "stampa",
  taglio: "taglio",
  stampa_3d: "stampa_3d",
  assemblaggio: "assemblaggio",
  progettazione: "progettazione",
};

const DEPT_LABEL: Partial<Record<ProdDept, string>> = {
  montaggi: "Montaggi",
  laboratorio: "Laboratorio",
  tappezzeria: "Tappezzeria",
  vendite: "Vendite",
  falegnameria: "Falegnameria",
  stampa: "Stampa",
  taglio: "Taglio",
  stampa_3d: "Stampa 3D",
  assemblaggio: "Assemblaggio",
  progettazione: "Progettazione",
};

const eachWorkday = (start: string, end: string): string[] => {
  if (!start) return [];
  const last = end && end >= start ? end : start;
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const stop = new Date(`${last}T00:00:00`);
  while (cur <= stop) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out.length > 0 ? out : [start];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  commessaId: string;
  cantiereLabel: string;
  titolo?: string | null;
  snapshot: any;
  commessaReparto?: string;
  onSaved?: () => void;
}

export const PianificaRepartiDialog = ({
  open, onOpenChange, commessaId, cantiereLabel, titolo, snapshot, commessaReparto, onSaved,
}: Props) => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reparti rilevati dallo snapshot + reparto della commessa se applicabile.
  const depts = useMemo(() => {
    const inferred = inferProdDeptsFromSnapshot(snapshot ?? null);
    const set = new Set<ProdDept>();
    for (const d of inferred) if (DEPT_TO_REPARTO[d]) set.add(d);
    // Se la commessa è montaggi, includiamo sempre
    if (commessaReparto === "montaggi") set.add("montaggi" as ProdDept);
    // Se nulla è stato rilevato, prova a mappare il reparto della commessa
    if (set.size === 0 && commessaReparto) {
      const k = commessaReparto as ProdDept;
      if (DEPT_TO_REPARTO[k]) set.add(k);
    }
    return Array.from(set);
  }, [snapshot, commessaReparto]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Carica profili (per scegliere operai) + righe esistenti
      const [{ data: profs }, { data: existing }] = await Promise.all([
        supabase.from("profiles").select("id, display_name, settori").order("display_name"),
        supabase.from("montaggi_planning")
          .select("operator_id, date, reparto")
          .eq("commessa_id", commessaId),
      ]);
      if (cancelled) return;
      setProfiles((profs ?? []) as Profile[]);
      // Pre-popola dai dati esistenti per reparto
      const next: Record<string, Plan> = {};
      for (const d of depts) {
        const r = DEPT_TO_REPARTO[d]!;
        const rows = (existing ?? []).filter((x: any) => x.reparto === r);
        if (rows.length > 0) {
          const dates = rows.map((x: any) => x.date).sort();
          next[d] = {
            startDate: dates[0],
            endDate: dates[dates.length - 1],
            deliveryDate: dates[dates.length - 1],
            operatorIds: Array.from(new Set(rows.map((x: any) => x.operator_id))),
          };
        } else {
          next[d] = { startDate: "", endDate: "", deliveryDate: "", operatorIds: [] };
        }
      }
      setPlans(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, commessaId, depts]);

  const patch = (dept: string, p: Partial<Plan>) => {
    setPlans((s) => {
      const cur = s[dept] ?? { startDate: "", endDate: "", deliveryDate: "", operatorIds: [] };
      const next = { ...cur, ...p };
      if (p.startDate && !next.endDate) next.endDate = p.startDate;
      if (p.startDate && !next.deliveryDate) next.deliveryDate = p.startDate;
      return { ...s, [dept]: next };
    });
  };

  const toggleOp = (dept: string, opId: string) => {
    setPlans((s) => {
      const cur = s[dept] ?? { startDate: "", endDate: "", deliveryDate: "", operatorIds: [] };
      const ids = cur.operatorIds.includes(opId) ? cur.operatorIds.filter((x) => x !== opId) : [...cur.operatorIds, opId];
      return { ...s, [dept]: { ...cur, operatorIds: ids } };
    });
  };

  const opsForDept = (d: ProdDept) => {
    const reparto = DEPT_TO_REPARTO[d];
    if (!reparto) return [];
    return profiles.filter((p) => Array.isArray(p.settori) && (p.settori as string[]).includes(reparto));
  };

  const onSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Cancella le righe esistenti SOLO per i reparti che stiamo pianificando
      const repartiToReplace = depts.map((d) => DEPT_TO_REPARTO[d]!).filter(Boolean);
      if (repartiToReplace.length > 0) {
        await supabase.from("montaggi_planning")
          .delete()
          .eq("commessa_id", commessaId)
          .in("reparto", repartiToReplace);
      }
      const rows: any[] = [];
      for (const d of depts) {
        const reparto = DEPT_TO_REPARTO[d]!;
        const p = plans[d];
        if (!p || !p.startDate || p.operatorIds.length === 0) continue;
        const days = eachWorkday(p.startDate, p.endDate || p.startDate);
        for (const opId of p.operatorIds) {
          for (const day of days) {
            rows.push({
              operator_id: opId,
              date: day,
              hours: 8,
              commessa_id: commessaId,
              cantiere_label: cantiereLabel,
              notes: titolo || null,
              reparto,
              created_by: user.id,
            });
          }
        }
      }
      if (rows.length > 0) {
        const { error } = await supabase.from("montaggi_planning").insert(rows);
        if (error) throw error;
      }
      toast.success(`Pianificazione salvata · ${rows.length} impegni creati`);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error("Errore salvataggio: " + msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Pianifica reparti · {cantiereLabel}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Caricamento…
          </div>
        ) : depts.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nessun reparto pianificabile rilevato da questa commessa.
          </div>
        ) : (
          <div className="space-y-4">
            {depts.map((d) => {
              const p = plans[d] ?? { startDate: "", endDate: "", deliveryDate: "", operatorIds: [] };
              const ops = opsForDept(d);
              return (
                <div key={d} className="border border-ink/20 rounded-sm p-3 bg-paper">
                  <div className="font-display text-sm font-semibold mb-2 uppercase tracking-wider">
                    {DEPT_LABEL[d] ?? d}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div>
                      <Label className="text-[10px] uppercase">Inizio</Label>
                      <Input type="date" value={p.startDate} onChange={(e) => patch(d, { startDate: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase">Fine</Label>
                      <Input type="date" value={p.endDate} min={p.startDate || undefined}
                        onChange={(e) => patch(d, { endDate: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase">Consegna</Label>
                      <Input type="date" value={p.deliveryDate} min={p.endDate || p.startDate || undefined}
                        onChange={(e) => patch(d, { deliveryDate: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase block mb-1">Operai ({p.operatorIds.length} selezionati)</Label>
                    {ops.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic">
                        Nessun profilo con settore "{DEPT_TO_REPARTO[d]}". Assegna il settore in Dipendenti.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {ops.map((o) => {
                          const sel = p.operatorIds.includes(o.id);
                          return (
                            <button key={o.id} type="button" onClick={() => toggleOp(d, o.id)}
                              className={`px-2 py-1 text-xs border rounded-sm transition-colors ${
                                sel ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 bg-background hover:bg-muted"
                              }`}>
                              {o.display_name ?? o.id.slice(0, 6)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
          <Button onClick={onSave} disabled={saving || loading || depts.length === 0}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvataggio…</> : "Salva pianificazione"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
