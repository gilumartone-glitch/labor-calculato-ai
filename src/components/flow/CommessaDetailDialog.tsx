import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Play, PackageCheck, Truck, Pencil, ExternalLink, Undo2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Commessa, CommessaStato, REPARTI, PRIORITA_LABEL } from "./types";
import { CommessaUpdatesTab } from "./CommessaUpdatesTab";
import { ConfirmToWarehouseDialog, WarehouseConfirmData } from "@/components/produzione/ConfirmToWarehouseDialog";
import { extractMaterialsFromSnapshot } from "@/lib/produzione/snapshot-materials";
import { nextOrderCode, subCode, logAction, notify } from "@/lib/produzione/helpers";
import { SUB_DEPT_SUFFIX, toWorkDept, toMacroDept, ProdDept } from "@/lib/produzione/types";
import { inferProdDeptsFromSnapshot } from "@/lib/produzione/snapshot";
import { TechnicalDrawing, DrawingSide } from "@/components/calculator/TechnicalDrawing";
import { PianificaRepartiDialog } from "./PianificaRepartiDialog";
import { CalendarClock } from "lucide-react";
import type { Catalog, DepartmentState, PieceLine, PerimeterSide } from "@/components/calculator/types";
import { autoMatchMaterial } from "@/lib/material-match";
import type { DimUnit } from "@/lib/perimeter";
import { computeNesting } from "@/lib/nesting";
import { aggregateWorkBreakdown } from "@/lib/piece";

const REPARTO_LABEL: Record<string, string> = Object.fromEntries(REPARTI.map((r) => [r.k, r.label]));

const eur = (n: number) =>
  n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
};

/** Snapshot generico salvato da DepartmentView o GeneralSummary */
type Snapshot = {
  source?: "summary" | "department";
  deptKey?: string;
  deptLabel?: string;
  state?: DepartmentState;
  catalog?: Catalog;
  customerType?: string;
  totals?: { materials?: number; pieces?: number; total?: number };
  // summary
  jobName?: string;
  quantity?: number;
  margin?: number;
  vat?: number;
  applyVat?: boolean;
  cost?: number;
  marginAmount?: number;
  net?: number;
  vatAmount?: number;
  total?: number;
  departments?: Array<{
    key: string;
    label: string;
    totals: { materials: number; operations?: number; perimeters?: number; pieces?: number; total: number };
    state?: DepartmentState;
    catalog?: Catalog;
    customerType?: string;
  }>;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  commessa: Commessa | null;
  onChanged: () => void;
  onEdit: () => void;
}

/** Costruisce drawSides per un pezzo a partire dalle perimeterOps del catalog. */
const drawSidesFor = (piece: PieceLine, catalog?: Catalog): DrawingSide[] => {
  if (!catalog) return [];
  return piece.perimeters.flatMap((pp) => {
    const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
    if (!op) return [];
    return pp.sides.map((s: PerimeterSide) => ({
      side: s,
      label: op.name,
      color: op.color || "hsl(220 14% 35%)",
    }));
  });
};

/** Restituisce tutti i sottoinsiemi (deptLabel, state, catalog) presenti nello snapshot. */
const collectDepartments = (snap: Snapshot | null) => {
  if (!snap) return [] as { label: string; key: string; state?: DepartmentState; catalog?: Catalog }[];
  if (snap.source === "summary" && snap.departments) {
    return snap.departments.map((d) => ({
      label: d.label,
      key: d.key,
      state: d.state,
      catalog: d.catalog,
    }));
  }
  return [
    {
      label: snap.deptLabel ?? snap.deptKey ?? "Reparto",
      key: snap.deptKey ?? "x",
      state: snap.state,
      catalog: snap.catalog,
    },
  ];
};

export const CommessaDetailDialog = ({ open, onOpenChange, commessa, onChanged, onEdit }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  /** id del production_order collegato a questa commessa (se esiste) */
  const [linkedProdOrderId, setLinkedProdOrderId] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planReloadTick, setPlanReloadTick] = useState(0);

  // Verifica se esiste già un production_order collegato (source_commessa_id)
  useEffect(() => {
    if (!commessa) {
      setLinkedProdOrderId(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("production_orders")
      .select("id")
      .eq("source_commessa_id", commessa.id)
      .neq("status", "annullato")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setLinkedProdOrderId(data?.id ?? null);
      });
    return () => { cancelled = true; };
  }, [commessa?.id, open]);

  /** Pianificazione montaggi/lavorazioni collegata a questa commessa */
  type PlanRow = { id: string; operator_id: string; date: string; hours: number; reparto: string | null; notes: string | null };
  const [planning, setPlanning] = useState<PlanRow[]>([]);
  const [operatorNames, setOperatorNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!commessa || !open) { setPlanning([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("montaggi_planning")
        .select("id, operator_id, date, hours, reparto, notes")
        .eq("commessa_id", commessa.id)
        .order("date");
      if (cancelled) return;
      const rows = (data ?? []) as PlanRow[];
      setPlanning(rows);
      // Risolvi nomi: profili (uuid) + dipendenti (profile_id match)
      const ids = Array.from(new Set(rows.map((r) => r.operator_id))).filter(Boolean);
      const uuidIds = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      const map: Record<string, string> = {};
      if (uuidIds.length > 0) {
        const [{ data: profs }, { data: dips }] = await Promise.all([
          supabase.from("profiles").select("id, display_name").in("id", uuidIds),
          supabase.from("dipendenti").select("nome, profile_id").in("profile_id", uuidIds),
        ]);
        (profs ?? []).forEach((p: any) => { if (p?.id && p?.display_name) map[p.id] = p.display_name; });
        (dips ?? []).forEach((d: any) => { if (d?.profile_id && d?.nome) map[d.profile_id] = d.nome; });
      }
      // operatori "proj:slug" → ricostruisci dal nome dello slug
      ids.filter((x) => x.startsWith("proj:")).forEach((x) => {
        map[x] = x.replace(/^proj:/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      });
      if (!cancelled) setOperatorNames(map);
    })();
    return () => { cancelled = true; };
  }, [commessa?.id, open, planReloadTick]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!cancelled) setIsAdmin(!!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const snapshot = (commessa?.["snapshot" as keyof Commessa] as unknown as Snapshot | null) ?? null;
  const departments = useMemo(() => collectDepartments(snapshot), [snapshot]);

  // Permessi azioni: assegnatario o admin
  const canAct = useMemo(() => {
    if (!commessa || !user) return false;
    if (isAdmin) return true;
    return (commessa.assegnatari ?? []).some((a) => a.id === user.id);
  }, [commessa, user, isAdmin]);

  const setStato = async (next: CommessaStato, label: string) => {
    if (!commessa) return;
    // Conferma preventivo → richiede dati per il magazzino
    if (next === "da_fare" && commessa.stato === "preventivo") {
      setConfirmLabel(label);
      setConfirmOpen(true);
      return;
    }
    // "Inizia produzione" su una commessa NON ancora lanciata in Flow Board
    // → apri lo stesso dialog di lancio così l'ordine appare in produzione
    if (next === "in_produzione" && !linkedProdOrderId) {
      setConfirmLabel(label);
      setConfirmOpen(true);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("commesse").update({ stato: next }).eq("id", commessa.id);
      if (error) throw error;
      toast.success(label);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  };

  // Stato per il dialog di conferma preventivo
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState("Preventivo confermato");

  const handleConfirmToWarehouse = async (d: WarehouseConfirmData) => {
    if (!commessa || !user) return;
    setConfirmBusy(true);
    try {
      // 1) Aggiorna stato commessa: se era già "da_fare" (lancio diretto via "Inizia produzione")
      //    porta direttamente a "in_produzione"; altrimenti standard "da_fare".
      const nextStato: CommessaStato = commessa.stato === "da_fare" ? "in_produzione" : "da_fare";
      const { error: e0 } = await supabase
        .from("commesse")
        .update({ stato: nextStato })
        .eq("id", commessa.id);
      if (e0) throw e0;

      // 2) Crea ordine di produzione "solo magazzino" con riferimento ordine cliente
      const code = await nextOrderCode();
      const clienteName = (commessa.cliente?.trim() || commessa.titolo).slice(0, 200);
      const { data: order, error: e1 } = await supabase
        .from("production_orders")
        .insert({
          code,
          cliente: clienteName,
          data: new Date().toISOString().slice(0, 10),
          note: `Da preventivo confermato: ${commessa.titolo}`,
          priorita: commessa.priorita === "alta" ? "urgente" : "normale",
          delivery: "corriere",
          status: "in_corso",
          attachments: [],
          nesting_included: false,
          created_by: user.id,
          source_commessa_id: commessa.id,
          customer_order_ref: d.customer_order_ref,
          production_name: d.production_name || null,
        } as any)
        .select()
        .single();
      if (e1) throw e1;

      // 3) Sub-ordine magazzino
      // Se ci sono materiali da ordinare → crea prima i sub acquisti, poi il sub magazzino dipendente.
      let firstAcquistiId: string | null = null;
      if (d.missing && d.missing.length > 0 && d.acquisti_assignee_id) {
        const acquistiRows = d.missing.map((m, i) => ({
          order_id: order.id,
          code: subCode(code, SUB_DEPT_SUFFIX["acquisti"], i + 1),
          dept: "acquisti" as const,
          ordine: i,
          note: `Da ordinare: ${m.label}${m.detail ? " · " + m.detail : ""} (rif. ${d.customer_order_ref})`,
          supplier_name: m.supplier_name || null,
          material_label: m.label,
          material_qty: m.qty ?? null,
          material_unit: m.unit ?? null,
          material_code: m.code ?? null,
          order_status: "da_ordinare",
          assignee_id: d.acquisti_assignee_id || null,
          files: [],
        }));
        const { data: acquistiSubs, error: ea } = await supabase
          .from("production_sub_orders")
          .insert(acquistiRows as any)
          .select("id");
        if (ea) throw ea;
        firstAcquistiId = acquistiSubs?.[0]?.id ?? null;

        await notify({
          userIds: [d.acquisti_assignee_id],
          type: "magazzino_da_preparare",
          message: `Acquisti — ${code}: ${d.missing.length} materiale/i da ordinare per ${clienteName}`,
          order_id: order.id,
          link: "/produzione/acquisti",
          is_urgent: commessa.priorita === "alta",
        });
      }

      // Sub-ordine principale di LAVORAZIONE (reparto scelto dall'utente)
      const baseOrdine = d.missing?.length ?? 0;
      const workSuffix = SUB_DEPT_SUFFIX[d.work_dept] ?? "L";
      const { error: e2 } = await supabase.from("production_sub_orders").insert({
        order_id: order.id,
        code: subCode(code, workSuffix, 1),
        dept: d.work_dept,
        ordine: baseOrdine,
        note: `Ordine cliente: ${d.customer_order_ref}` + (d.missing?.length ? ` · in attesa materiali (${d.missing.length})` : ""),
        files: [],
        depends_on: firstAcquistiId,
        assignee_id: d.assignee_id || null,
      });
      if (e2) throw e2;

      const flowAssigneeIds = Array.from(new Set([
        d.acquisti_assignee_id || null,
        d.assignee_id || null,
      ].filter((id): id is string => !!id)));
      if (flowAssigneeIds.length > 0) {
        const { error: assErr } = await supabase
          .from("commessa_assegnatari")
          .upsert(
            flowAssigneeIds.map((uid) => ({ commessa_id: commessa.id, user_id: uid })),
            { onConflict: "commessa_id,user_id", ignoreDuplicates: true },
          );
        if (assErr) throw assErr;
      }

      // Sub-ordine opzionale di chiusura Amministrazione (bolla/spedizione)
      if (d.create_admin_closure) {
        await supabase.from("production_sub_orders").insert({
          order_id: order.id,
          code: subCode(code, SUB_DEPT_SUFFIX["magazzino"], 2),
          dept: "magazzino",
          ordine: baseOrdine + 1,
          note: `Chiusura/bolla — ordine cliente ${d.customer_order_ref}`,
          files: [],
        });
      }

      // 4) Notifica al responsabile della lavorazione
      await notify({
        userIds: [d.assignee_id],
        type: "magazzino_da_preparare",
        message: d.missing?.length
          ? `In attesa materiali — ${code} · ${clienteName} (${d.missing.length} da ricevere)`
          : `Da lavorare: ${code} · ${clienteName} (Ordine ${d.customer_order_ref})`,
        order_id: order.id,
        link: "/produzione/board",
        is_urgent: commessa.priorita === "alta",
      });

      await logAction({
        action: "PREVENTIVO_CONFERMATO",
        entity_type: "commessa",
        entity_id: commessa.id,
        detail: `Preventivo confermato → ordine ${code} (rif. cliente ${d.customer_order_ref}) assegnato a ${d.assignee_name}`,
        new_state: { code, customer_order_ref: d.customer_order_ref, assignee_id: d.assignee_id },
      });

      toast.success(confirmLabel, { description: `Ordine ${code} inviato al magazzino` });
      setConfirmOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore conferma");
    } finally {
      setConfirmBusy(false);
    }
  };

  const recallToDesign = async () => {
    if (!commessa || !user) return;
    if (!window.confirm(
      "Richiamare questa commessa in Progettazione?\n\nLa commessa verrà rimossa dal Flow e riaperta come scheda modificabile."
    )) return;
    setBusy(true);
    try {
      const fullSnap = (commessa as any).snapshot ?? {};
      // Lo snapshot della commessa è un wrapper { ...summary, designState: <stato STATE_KEY> }.
      // Per ripristinare la scheda di progettazione dobbiamo usare il designState nidificato.
      const snap =
        fullSnap && typeof fullSnap === "object" && fullSnap.designState && Object.keys(fullSnap.designState).length > 0
          ? fullSnap.designState
          : fullSnap;
      // 1) Crea nuova bozza per l'utente
      const { data: created, error: e1 } = await supabase
        .from("design_drafts")
        .insert({
          user_id: user.id,
          name: commessa.titolo || "Progetto",
          snapshot: snap as never,
          ordine: 999,
          active: true,
        })
        .select()
        .single();
      if (e1 || !created) throw e1 ?? new Error("Errore creazione bozza");
      // 2) Disattiva eventuali altre bozze attive
      await supabase
        .from("design_drafts")
        .update({ active: false })
        .eq("user_id", user.id)
        .neq("id", created.id);
      // 3) Elimina la commessa dal Flow
      const { error: e2 } = await supabase.from("commesse").delete().eq("id", commessa.id);
      if (e2) throw e2;
      // 4) Imposta come tab attiva e svuota stato locale (la pagina Progettazione lo ricaricherà)
      try {
        localStorage.setItem("officina:active-draft", created.id);
        localStorage.setItem("officina:state", JSON.stringify(snap));
      } catch { /* ignore */ }
      toast.success("Richiamata in Progettazione");
      onChanged();
      onOpenChange(false);
      navigate("/preventivi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore richiamo");
    } finally {
      setBusy(false);
    }
  };

  if (!commessa) return null;

  // Materiali necessari = materiali risultanti dal nesting (variante reale +
  // metri/m² di tessuto necessari) + eventuali materiali manuali.
  const aggregateMaterials = () => {
    const map = new Map<
      string,
      {
        name: string;
        color: string;
        height: string;
        base: string;
        qty: number;
        unit: string;
        note?: string;
        unitPrice: number;
        priceUnit: string;
        cost: number;
        pieceLabels: string[];
      }
    >();
    for (const d of departments) {
      const cat = d.catalog;
      if (!d.state || !cat) continue;
      try {
        const groups = computeNesting(d.state.pieces ?? [], cat);
        for (const g of groups) {
          if (!g.material) continue;
          // Per i rotoli mostriamo l'altezza del rullo (è l'unica
          // dimensione rilevante: la lunghezza del rotolo è "infinita").
          // Per le lastre mostriamo l'altezza della variante.
          const heightLabel =
            g.format === "rotolo"
              ? `${(g.rollWidthM * 100).toFixed(0)} cm`
              : g.material.height
                ? `${g.material.height} ${g.material.heightUnit || "cm"}`
                : "—";
          const baseLabel =
            g.format === "lastra"
              ? g.sheetWidthM && g.sheetWidthM > 0
                ? `${(g.sheetWidthM * 100).toFixed(0)} cm`
                : g.material.baseWidth
                  ? `${g.material.baseWidth} cm`
                  : "—"
              : "— (rotolo)";
          const key = `${g.material.name}|${g.material.color}|${g.material.height}`;
          const prev = map.get(key);
          // Per il rotolo non mostriamo "lunghezza da acquistare":
          // il tessuto è venduto a metratura, basta l'altezza del rullo.
          // Per la lastra mostriamo l'area totale necessaria.
          const qty = g.format === "lastra" ? g.totalAreaM2 : g.totalLengthM;
          const unit = g.format === "lastra" ? "m²" : "m";
          const cost = g.materialCostOptimized;
          const labelCount = new Map<string, number>();
          for (const it of g.items ?? []) {
            labelCount.set(it.label, (labelCount.get(it.label) ?? 0) + 1);
          }
          const pieceLabels = Array.from(labelCount.entries()).map(([l, n]) => (n > 1 ? `${l} ×${n}` : l));
          if (prev) {
            prev.qty += qty;
            prev.cost += cost;
            for (const pl of pieceLabels) if (!prev.pieceLabels.includes(pl)) prev.pieceLabels.push(pl);
          } else
            map.set(key, {
              name: g.material.name,
              color: g.material.color,
              height: heightLabel,
              base: baseLabel,
              qty,
              unit,
              unitPrice: g.unitPrice,
              priceUnit: g.format === "lastra" ? "m²" : "m",
              cost,
              pieceLabels,
              note:
                g.format === "lastra" && g.sheetsNeeded
                  ? `${g.sheetsNeeded} lastr${g.sheetsNeeded === 1 ? "a" : "e"}`
                  : g.format === "rotolo"
                    ? "rotolo (a metratura)"
                    : undefined,
            });
        }
      } catch {
        /* ignore nesting errors and fall back to manual list */
      }
      for (const m of d.state.materials ?? []) {
        const key = `manual:${m.name}|${m.color}|${m.height}`;
        const prev = map.get(key);
        const qty = m.quantity ?? 0;
        const cost = qty * (m.unitCost ?? 0);
        if (prev) {
          prev.qty += qty;
          prev.cost += cost;
        } else
          map.set(key, {
            name: m.name,
            color: m.color,
            height: m.height,
            base: "—",
            qty,
            unit: m.unit,
            unitPrice: m.unitCost ?? 0,
            priceUnit: m.unit,
            cost,
            pieceLabels: [],
            note: "manuale",
          });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  const aggregated = aggregateMaterials();
  const allPieces = departments.flatMap((d) =>
    (d.state?.pieces ?? []).map((p) => ({ piece: p, deptLabel: d.label, catalog: d.catalog })),
  );

  // Totale materiali = somma costi materiali aggregati (nesting + manuali)
  const totalMaterials = aggregated.reduce((s, m) => s + m.cost, 0);

  // Totale lavorazioni = somma di tutte le lavorazioni applicate ai pezzi di
  // tutti i reparti (perimetrali, taglio, stampa, cuciture, custom, ecc.)
  // + costo righe "operations" libere del reparto.
  const totalWorks = departments.reduce((sum, d) => {
    if (!d.state || !d.catalog) return sum;
    const wb = aggregateWorkBreakdown(d.state.pieces ?? [], d.catalog);
    const operations = (d.state.operations ?? []).reduce(
      (s, op) => s + (op.quantity ?? 0) * (op.rate ?? 0),
      0,
    );
    return sum + wb.total + operations;
  }, 0);

  const grandTotal = totalMaterials + totalWorks;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-sm bg-ink/10 text-ink/70">
                  {REPARTO_LABEL[commessa.reparto] ?? commessa.reparto}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  · {PRIORITA_LABEL[commessa.priorita]} · {fmtDate(commessa.data_scadenza)}
                </span>
              </div>
              <DialogTitle className="font-display text-2xl break-words">{commessa.titolo}</DialogTitle>
              {commessa.cliente && (
                <div className="text-sm text-muted-foreground mt-1">{commessa.cliente}</div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={recallToDesign}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-primary/40 bg-primary/5 text-primary rounded-sm text-[10px] uppercase tracking-wider font-bold hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40"
                title="Riapri questa commessa come scheda in Progettazione (verrà rimossa dal Flow)"
              >
                <Undo2 className="w-3 h-3" />
                Richiama in Progettazione
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-ink/30 rounded-sm text-[10px] uppercase tracking-wider font-bold text-ink/70 hover:bg-ink hover:text-paper transition-colors"
                title="Modifica commessa"
              >
                <Pencil className="w-3 h-3" />
                Modifica
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!commessa) return;
                    if (!window.confirm("Eliminare definitivamente questa commessa dal Flow?\n\nL'azione non è reversibile.")) return;
                    setBusy(true);
                    try {
                      await supabase.from("montaggi_planning").delete().eq("commessa_id", commessa.id);
                      const { error } = await supabase.from("commesse").delete().eq("id", commessa.id);
                      if (error) throw error;
                      toast.success("Commessa eliminata");
                      onChanged();
                      onOpenChange(false);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Errore eliminazione");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-destructive/40 bg-destructive/5 text-destructive rounded-sm text-[10px] uppercase tracking-wider font-bold hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-40"
                  title="Elimina (admin)"
                >
                  <Trash2 className="w-3 h-3" />
                  Elimina
                </button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Stato collegamento con Flow Board */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-2 rounded-sm text-xs"
             style={{ borderColor: linkedProdOrderId ? "hsl(var(--primary))" : "hsl(var(--border))" }}>
          {linkedProdOrderId ? (
            <>
              <div className="flex items-center gap-2 text-primary">
                <span className="text-base leading-none">✓</span>
                <span className="font-bold uppercase tracking-wider text-[10px]">
                  Collegata a Flow Board
                </span>
                <span className="text-muted-foreground normal-case font-normal">
                  · La produzione è già stata lanciata
                </span>
              </div>
              <button
                type="button"
                onClick={() => { onOpenChange(false); navigate("/produzione/board"); }}
                className="text-[10px] uppercase tracking-wider font-bold underline hover:text-primary"
              >
                Apri in Flow Board →
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-amber-700">
              <span className="text-base leading-none">⚠</span>
              <span className="font-bold uppercase tracking-wider text-[10px]">
                Non ancora in Flow Board
              </span>
              <span className="text-muted-foreground normal-case font-normal">
                · Premi "Inizia produzione" per lanciarla a reparti e assegnatari
              </span>
            </div>
          )}
        </div>

        {/* Bottoni di transizione di stato */}
        <StateActions
          stato={commessa.stato}
          canAct={canAct}
          busy={busy}
          onAction={setStato}
        />


        <Tabs defaultValue="overview" className="mt-2">
          <TabsList className={`grid w-full ${commessa.tipo === "task" ? "grid-cols-2" : "grid-cols-4"}`}>
            <TabsTrigger value="overview">Dettaglio</TabsTrigger>
            {commessa.tipo !== "task" && (
              <>
                <TabsTrigger value="pieces">Pezzi ({allPieces.length})</TabsTrigger>
                <TabsTrigger value="materials">Materiali ({aggregated.length})</TabsTrigger>
              </>
            )}
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Importo" value={typeof commessa.importo === "number" ? eur(commessa.importo) : "—"} />
              <Stat label="Reparto" value={REPARTO_LABEL[commessa.reparto] ?? commessa.reparto} />
              <Stat label="Stato" value={commessa.stato.replace("_", " ")} />
              <div className="border-2 border-ink/15 rounded-sm p-2.5 bg-paper">
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Data lavorazione / scadenza</div>
                {canAct ? (
                  <input
                    type="date"
                    value={commessa.data_scadenza ?? ""}
                    disabled={busy}
                    onChange={async (e) => {
                      const v = e.target.value || null;
                      setBusy(true);
                      try {
                        const { error } = await supabase.from("commesse").update({ data_scadenza: v }).eq("id", commessa.id);
                        if (error) throw error;
                        toast.success("Data aggiornata");
                        onChanged();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Errore");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full text-[13px] font-semibold bg-transparent border border-ink/15 rounded-sm px-2 py-1 focus:outline-none focus:border-primary"
                  />
                ) : (
                  <div className="text-sm font-semibold">{fmtDate(commessa.data_scadenza)}</div>
                )}
              </div>
            </div>
            {commessa.descrizione ? (
              <div className="border-2 border-primary/30 bg-primary/5 rounded-sm p-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-1">
                  {commessa.tipo === "task" ? "Cosa fare" : "Descrizione"}
                </div>
                <div className="text-sm whitespace-pre-wrap">{commessa.descrizione}</div>
              </div>
            ) : commessa.tipo === "task" && (
              <div className="border border-dashed border-ink/20 rounded-sm p-3 text-xs text-muted-foreground italic">
                Nessuna descrizione. Chi ha creato il task non ha specificato cosa fare — chiedi di modificarlo aggiungendo i dettagli nel campo "Descrizione".
              </div>
            )}
            {commessa.note && (
              <div className="border border-dashed border-ink/30 rounded-sm p-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                  Note interne
                </div>
                <div className="text-sm whitespace-pre-wrap">{commessa.note}</div>
              </div>
            )}
            {(commessa.assegnatari ?? []).length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Assegnata a
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(commessa.assegnatari ?? []).map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 px-2 py-1 border border-ink/20 rounded-sm text-xs"
                    >
                      <span className="w-5 h-5 rounded-full bg-ink text-paper text-[9px] font-mono font-bold grid place-items-center">
                        {(a.display_name ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                      {a.display_name ?? "Utente"}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Pianificazione operai (montaggi/lavorazioni) collegata a questa commessa */}
            {planning.length > 0 && (() => {
              const byOp = new Map<string, PlanRow[]>();
              planning.forEach((r) => {
                const k = r.operator_id;
                if (!byOp.has(k)) byOp.set(k, []);
                byOp.get(k)!.push(r);
              });
              const totHours = planning.reduce((s, r) => s + (Number(r.hours) || 0), 0);
              return (
                <div className="border border-ink/20 rounded-sm p-3 bg-paper">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Operai pianificati · {totHours.toLocaleString("it-IT")} h totali
                    </div>
                    <button
                      type="button"
                      onClick={() => setPlanOpen(true)}
                      className="text-[10px] uppercase tracking-wider font-bold text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <CalendarClock className="h-3 w-3" /> Modifica pianificazione →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {Array.from(byOp.entries()).map(([opId, rows]) => {
                      const name = operatorNames[opId] ?? opId;
                      const h = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);
                      return (
                        <div key={opId} className="text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{name}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">{h} h</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {rows.map((r) => (
                              <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-ink/15 rounded-sm font-mono text-[10px]">
                                {new Date(r.date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}
                                <span className="text-muted-foreground">· {r.hours}h</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {snapshot?.source === "summary" && (
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <Stat label="Costo" value={eur(snapshot.cost ?? 0)} small />
                <Stat label={`Margine ${snapshot.margin ?? 0}%`} value={eur(snapshot.marginAmount ?? 0)} small />
                <Stat
                  label={`IVA ${snapshot.applyVat ? snapshot.vat ?? 0 : 0}%`}
                  value={eur(snapshot.vatAmount ?? 0)}
                  small
                />
              </div>
            )}

            {/* Riepilogo costi: materiali + lavorazioni + totale */}
            {(totalMaterials > 0 || totalWorks > 0) && (
              <div className="border-2 border-ink rounded-sm p-4 bg-paper">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
                  Riepilogo preventivo
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-baseline">
                    <span>Totale materiali</span>
                    <span className="font-mono tabular-nums font-semibold">{eur(totalMaterials)}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span>Totale lavorazioni</span>
                    <span className="font-mono tabular-nums font-semibold">{eur(totalWorks)}</span>
                  </div>
                  <div className="flex justify-between items-baseline pt-2 border-t border-ink/20">
                    <span className="font-display text-base uppercase tracking-wider font-bold">
                      Totale preventivo
                    </span>
                    <span className="font-mono tabular-nums font-bold text-lg text-primary">
                      {eur(grandTotal)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* PIECES */}
          <TabsContent value="pieces" className="space-y-4">
            {allPieces.length === 0 ? (
              <EmptyState text="Nessun pezzo nel calcolo." />
            ) : (
              allPieces.map(({ piece, deptLabel, catalog }, i) => (
                <PieceDetail key={piece.id ?? i} piece={piece} deptLabel={deptLabel} catalog={catalog} index={i + 1} />
              ))
            )}
          </TabsContent>

          {/* MATERIALS */}
          <TabsContent value="materials">
            {aggregated.length === 0 ? (
              <EmptyState text="Nessun materiale registrato." />
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Materiali da utilizzare per la produzione
                </div>
                <div className="border border-ink/15 rounded-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-ink/5 text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2">Materiale</th>
                        <th className="text-left px-3 py-2">Colore</th>
                        <th className="text-left px-3 py-2">Base</th>
                        <th className="text-left px-3 py-2">Altezza</th>
                        <th className="text-left px-3 py-2">Pezzi</th>
                        <th className="text-right px-3 py-2">Da acquistare</th>
                        <th className="text-right px-3 py-2">€ / unità</th>
                        <th className="text-right px-3 py-2">Totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregated.map((m, i) => (
                        <tr key={i} className="border-t border-ink/10">
                          <td className="px-3 py-2 font-semibold">{m.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{m.color || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground font-mono">{m.base || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{m.height || "—"}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            {m.pieceLabels.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {m.pieceLabels.map((pl, pi) => (
                                  <span key={pi} className="inline-block px-1.5 py-0.5 bg-muted/60 rounded-sm font-bold">{pl}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            <div>
                              {m.unit ? `${m.qty.toFixed(2)} ${m.unit}` : "—"}
                            </div>
                            {m.note && (
                              <div className="text-[10px] text-muted-foreground font-normal">
                                {m.note}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {m.unitPrice > 0
                              ? `${eur(m.unitPrice)}/${m.priceUnit}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                            {m.cost > 0 ? eur(m.cost) : "—"}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-ink/30 bg-ink/5">
                        <td className="px-3 py-2 font-bold uppercase tracking-wider text-[11px]" colSpan={7}>
                          Totale materiali
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">
                          {eur(aggregated.reduce((s, m) => s + m.cost, 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="timeline">
            <CommessaUpdatesTab commessaId={commessa.id} onCommessaChanged={onChanged} />
          </TabsContent>

        </Tabs>
      </DialogContent>
    </Dialog>
    <ConfirmToWarehouseDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Conferma preventivo → Lavorazione"
      materials={extractMaterialsFromSnapshot(snapshot)}
      defaultRef={commessa ? `CM-${commessa.id.slice(0, 8).toUpperCase()}` : ""}
      defaultProductionName={commessa?.titolo ?? ""}
      suggestedWorkDept={toWorkDept((commessa as any)?.reparto ?? (snapshot as any)?.departments?.[0]?.key)}
      availableMacros={(() => {
        const inferred = inferProdDeptsFromSnapshot(snapshot as any);
        const macros = new Set<ProdDept>(inferred.map(toMacroDept));
        if ((commessa as any)?.reparto === "montaggi") macros.add("montaggi");
        return macros.size > 0 ? Array.from(macros) : undefined;
      })()}
      onConfirm={handleConfirmToWarehouse}
      saving={confirmBusy}
    />
    </>
  );
};

/* -------------------- Sub-components -------------------- */

const StateActions = ({
  stato,
  canAct,
  busy,
  onAction,
}: {
  stato: CommessaStato;
  canAct: boolean;
  busy: boolean;
  onAction: (next: CommessaStato, label: string) => void;
}) => {
  const buttons: { next: CommessaStato; label: string; toast: string; Icon: typeof CheckCircle2 }[] = [];
  if (stato === "preventivo")
    buttons.push({ next: "da_fare", label: "Conferma preventivo", toast: "Preventivo confermato", Icon: CheckCircle2 });
  if (stato === "da_fare")
    buttons.push({ next: "in_produzione", label: "Inizia produzione", toast: "Produzione avviata", Icon: Play });
  if (stato === "in_produzione")
    buttons.push({ next: "pronto", label: "Segna come pronto", toast: "Pronto per consegna", Icon: PackageCheck });
  if (stato === "pronto")
    buttons.push({ next: "consegnato", label: "Segna come consegnato", toast: "Consegnato", Icon: Truck });

  if (buttons.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-ink/15 py-3 my-2">
      {!canAct ? (
        <div className="text-xs text-muted-foreground italic">
          Solo gli assegnatari o gli admin possono cambiare stato.
        </div>
      ) : (
        buttons.map(({ next, label, toast: t, Icon }) => (
          <Button
            key={next}
            onClick={() => onAction(next, t)}
            disabled={busy}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />}
            {label}
          </Button>
        ))
      )}
    </div>
  );
};

const Stat = ({ label, value, small }: { label: string; value: string; small?: boolean }) => (
  <div className={`border border-ink/15 rounded-sm p-3 ${small ? "p-2" : ""}`}>
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">
      {label}
    </div>
    <div className={`font-display ${small ? "text-base" : "text-lg"} font-semibold tabular-nums`}>
      {value}
    </div>
  </div>
);

const EmptyState = ({ text }: { text: string }) => (
  <div className="text-center text-sm text-muted-foreground py-12 border border-dashed border-ink/20 rounded-sm">
    {text}
  </div>
);

const PieceDetail = ({
  piece,
  deptLabel,
  catalog,
  index,
}: {
  piece: PieceLine;
  deptLabel: string;
  catalog?: Catalog;
  index: number;
}) => {
  const sides = drawSidesFor(piece, catalog);
  // Replica la logica del calcolatore: la variante usata è quella con altezza
  // minima sufficiente a coprire l'altezza del pezzo (non quella id-salvata,
  // che potrebbe non essere abbastanza alta).
  const explicitVariant =
    catalog?.materials.find((m) => m.id === (piece.variantId ?? piece.catalogMaterialId)) ?? null;
  const autoMatched = catalog
    ? autoMatchMaterial(
        catalog.materials,
        piece.productName ?? explicitVariant?.name ?? "",
        piece.color ?? "",
        piece.fireproof ?? "",
        piece.height ?? 0,
        (piece.dimUnit ?? "cm") as DimUnit,
      )
    : null;
  const variant =
    autoMatched?.material ??
    explicitVariant ??
    catalog?.materials.find(
      (m) =>
        (m.name ?? "").trim().toLowerCase() === (piece.productName ?? "").trim().toLowerCase() &&
        (!piece.color || (m.color ?? "").trim().toLowerCase() === piece.color.trim().toLowerCase()) &&
        (!piece.thickness || (m.thickness ?? "").trim() === piece.thickness.trim()) &&
        (!piece.finish || (m.finish ?? "").trim().toLowerCase() === piece.finish.trim().toLowerCase()),
    );
  const printOp = piece.printOpId ? catalog?.printOps?.find((p) => p.id === piece.printOpId) : undefined;

  const fabricHeight =
    variant?.height
      ? `${variant.height} ${variant.heightUnit || variant.dimUnit || "cm"}`
      : piece.matchedHeight
        ? `${piece.matchedHeight} ${piece.matchedHeightUnit || "cm"}`
        : "—";

  return (
    <div className="border border-ink/15 rounded-sm p-4 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      <div className="bg-ink/5 rounded-sm p-2 grid place-items-center">
        <TechnicalDrawing
          width={piece.width}
          height={piece.height}
          unit={piece.dimUnit}
          sides={sides}
          shape={piece.shape ?? "rect"}
          widthBottom={piece.widthBottom}
          canvasWidth={260}
          canvasHeight={200}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-display text-base font-semibold">
            #{index} · {piece.productName || "Pezzo"}
            {(piece.quantity ?? 1) > 1 && (
              <span className="ml-2 text-xs font-mono text-muted-foreground">
                × {piece.quantity}
              </span>
            )}
          </h4>
          <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 bg-ink/10 text-ink/70 rounded-sm">
            {deptLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <KV k="Dimensioni" v={`${piece.width} × ${piece.height} ${piece.dimUnit}`} />
          <KV k="Altezza tessuto" v={fabricHeight} />
          {piece.color && <KV k="Colore" v={piece.color} />}
          {piece.fireproof && <KV k="Ignifugo" v={piece.fireproof} />}
          {piece.thickness && <KV k="Spessore" v={piece.thickness} />}
          {piece.finish && <KV k="Finitura" v={piece.finish} />}
          {variant && (
            <KV
              k="Variante"
              v={`${variant.name}${variant.height ? ` h${variant.height}${variant.heightUnit ?? ""}` : ""}`}
            />
          )}
          {printOp && <KV k="Stampa" v={`${printOp.type} · ${printOp.mode}`} />}
        </div>

        {piece.perimeters.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2 mb-1">
              Lavorazioni perimetrali
            </div>
            <ul className="space-y-1">
              {piece.perimeters.map((pp) => {
                const op = catalog?.perimeterOps.find((o) => o.id === pp.opId);
                return (
                  <li key={pp.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-3 h-3 rounded-sm border border-ink/30"
                      style={{ background: op?.color ?? "transparent" }}
                    />
                    <span className="font-semibold">{op?.name ?? "?"}</span>
                    <span className="text-muted-foreground">
                      → {pp.sides.length > 0 ? pp.sides.join(", ") : "intera"}
                      {pp.quantity ? ` × ${pp.quantity}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {(piece.customWorks ?? []).length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2 mb-1">
              Lavorazioni libere
            </div>
            <ul className="space-y-0.5 text-xs">
              {(piece.customWorks ?? []).map((cw) => (
                <li key={cw.id} className="flex justify-between">
                  <span>{cw.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{eur(cw.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {piece.note && (
          <div className="text-xs italic text-muted-foreground border-l-2 border-ink/20 pl-2 mt-2">
            {piece.note}
          </div>
        )}
      </div>
    </div>
  );
};

const KV = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-2 border-b border-dashed border-ink/10 py-0.5">
    <span className="text-muted-foreground">{k}</span>
    <span className="font-mono">{v}</span>
  </div>
);