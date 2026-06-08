import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Eye, Lock, Calendar, Truck, Package, FileText, PackageCheck, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { LaunchOrderDialog } from "@/components/produzione/LaunchOrderDialog";
import { CompleteSubDialog } from "@/components/produzione/CompleteSubDialog";
import { SubOrderDetailDialog } from "@/components/produzione/SubOrderDetailDialog";
import { RejectSubDialog, RejectScope } from "@/components/produzione/RejectSubDialog";
import { useProdStore } from "@/lib/produzione/store";
import { Button } from "@/components/ui/button";
import {
  DEPT_LABEL, PRIORITY_LABEL, SUB_STATUS_LABEL, DEPT_COLOR,
  ProdSubStatus, ProdDept, ProdOrder, ProdSubOrder, NotifType,
} from "@/lib/produzione/types";
import { orderProgress, logAction, notify, getProduzioneWriters, getMagazzinoUsers } from "@/lib/produzione/helpers";
import { DELIVERY_LABEL, DELIVERY_NEEDS_LOGISTICA } from "@/lib/produzione/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { collectSnapshotDepartments } from "@/lib/produzione/snapshot";
import { CantieriStrip } from "@/components/flow/CantieriStrip";
import { urgencyBadge } from "@/lib/urgency";

/** Conta pezzi dello snapshot per ProdDept. */
const piecesCountByDept = (order: ProdOrder): Partial<Record<ProdDept, number>> => {
  const out: Partial<Record<ProdDept, number>> = {};
  const depts = collectSnapshotDepartments(order.snapshot);
  for (const d of depts) {
    const baseKey = d.key.toLowerCase();
    const pieces = d.state?.pieces ?? [];
    const qtyOf = (p: any) => Math.max(1, Math.floor(Number(p?.quantity) || 1));
    const totalQty = pieces.reduce((s: number, p: any) => s + qtyOf(p), 0);
    if (totalQty === 0) continue;
    if (baseKey === "tappezzeria") out.tappezzeria = (out.tappezzeria ?? 0) + totalQty;
    else if (baseKey === "falegnameria") out.falegnameria = (out.falegnameria ?? 0) + totalQty;
    else if (baseKey === "stampa") {
      const cat = d.catalog;
      let stampa = 0, taglio = 0;
      for (const p of pieces) {
        const q = qtyOf(p);
        let hasStampa = !!p.printOpId;
        let hasTaglio = false;
        for (const pp of p.perimeters) {
          const op = cat?.perimeterOps.find((o: any) => o.id === pp.opId);
          const c = (op?.category ?? "").toLowerCase();
          if (c === "stampa") hasStampa = true;
          if (c === "taglio") hasTaglio = true;
        }
        if (hasStampa) stampa += q;
        if (hasTaglio) taglio += q;
        if (!hasStampa && !hasTaglio) stampa += q;
      }
      if (stampa) out.stampa = (out.stampa ?? 0) + stampa;
      if (taglio) out.taglio = (out.taglio ?? 0) + taglio;
    } else {
      out.altro = (out.altro ?? 0) + totalQty;
    }
  }
  return out;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }); } catch { return "—"; }
};

const STAGES: { key: string; label: string; match: (o: ProdOrder, subs: ProdSubOrder[]) => boolean }[] = [
  { key: "nuovo", label: "Nuovo", match: (o, s) => o.status === "nuovo" || (o.status === "in_corso" && s.every((x) => x.status === "in_attesa")) },
  { key: "reparti", label: "In reparti", match: (o, s) => o.status === "in_corso" && s.some((x) => x.status === "in_lavorazione" || x.status === "completato") && s.some((x) => x.status !== "completato") },
  { key: "pronto", label: "Pronto", match: (o, s) => s.length > 0 && s.every((x) => x.status === "completato") && o.status !== "spedito" && o.status !== "chiuso" },
  { key: "spedito", label: "Spedito · da fatturare", match: (o) => o.status === "spedito" },
  { key: "chiuso", label: "Chiuso · fatturato", match: (o) => o.status === "chiuso" },
];

const PROD_DEPT_KEYS = new Set<ProdDept>(Object.keys(DEPT_LABEL) as ProdDept[]);

/** Palette riciclabile: ogni commessa attiva sul board ottiene un colore distinto.
 *  Quando l'ordine viene spedito/chiuso ed esce dalla vista, il colore torna
 *  disponibile per i nuovi ordini. */
const ORDER_PALETTE: { bg: string; border: string; chip: string }[] = [
  { bg: "bg-rose-50",     border: "border-l-rose-500",     chip: "bg-rose-500" },
  { bg: "bg-amber-50",    border: "border-l-amber-500",    chip: "bg-amber-500" },
  { bg: "bg-emerald-50",  border: "border-l-emerald-500",  chip: "bg-emerald-500" },
  { bg: "bg-sky-50",      border: "border-l-sky-500",      chip: "bg-sky-500" },
  { bg: "bg-violet-50",   border: "border-l-violet-500",   chip: "bg-violet-500" },
  { bg: "bg-fuchsia-50",  border: "border-l-fuchsia-500",  chip: "bg-fuchsia-500" },
  { bg: "bg-orange-50",   border: "border-l-orange-500",   chip: "bg-orange-500" },
  { bg: "bg-teal-50",     border: "border-l-teal-500",     chip: "bg-teal-500" },
  { bg: "bg-indigo-50",   border: "border-l-indigo-500",   chip: "bg-indigo-500" },
  { bg: "bg-lime-50",     border: "border-l-lime-600",     chip: "bg-lime-600" },
  { bg: "bg-cyan-50",     border: "border-l-cyan-500",     chip: "bg-cyan-500" },
  { bg: "bg-pink-50",     border: "border-l-pink-500",     chip: "bg-pink-500" },
];

const ProdBoard = () => {
  const { user } = useAuth();
  const { isAdmin, roles } = usePermissions();
  const { orders, subs, profiles, refreshOrders } = useProdStore();
  const [launch, setLaunch] = useState(false);
  const [launchWarehouse, setLaunchWarehouse] = useState(false);
  const [filterDept, setFilterDept] = useState<ProdDept | "all">("all");
  const [completing, setCompleting] = useState<ProdSubOrder | null>(null);
  const [detail, setDetail] = useState<ProdSubOrder | null>(null);
  const [rejecting, setRejecting] = useState<ProdSubOrder | null>(null);
  const [operatorDepts, setOperatorDepts] = useState<ProdDept[]>([]);
  const [commessaDeadlines, setCommessaDeadlines] = useState<Record<string, string | null>>({});
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-open SubOrderDetailDialog when arriving via ?sub=<id> (e.g. da notifiche)
  useEffect(() => {
    const subId = searchParams.get("sub");
    if (!subId || subs.length === 0) return;
    const target = subs.find((s) => s.id === subId);
    if (target) {
      setDetail(target);
      // pulisci l'URL così il dialog non si riapre al refresh
      const next = new URLSearchParams(searchParams);
      next.delete("sub");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, subs, setSearchParams]);

  const isCoordinator = isAdmin || roles.includes("coordinatore");

  useEffect(() => {
    if (!user || isCoordinator) {
      setOperatorDepts([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("settori")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const depts = ((data?.settori ?? []) as string[]).filter((s): s is ProdDept => PROD_DEPT_KEYS.has(s as ProdDept));
        setOperatorDepts(depts);
      });
    return () => { cancelled = true; };
  }, [user, isCoordinator]);

  const subsByOrder = useMemo(() => {
    const m: Record<string, ProdSubOrder[]> = {};
    for (const s of subs) (m[s.order_id] ??= []).push(s);
    return m;
  }, [subs]);

  const operatorDeptSet = useMemo(() => new Set(operatorDepts), [operatorDepts]);

  const displaySubsByOrder = useMemo(() => {
    const m: Record<string, ProdSubOrder[]> = {};
    const visibleSubs = isCoordinator ? subs : subs.filter((s) => operatorDeptSet.has(s.dept));
    for (const s of visibleSubs) (m[s.order_id] ??= []).push(s);
    return m;
  }, [subs, isCoordinator, operatorDeptSet]);

  const visibleOrders = useMemo(() => {
    if (!isCoordinator) return orders.filter((o) => (displaySubsByOrder[o.id] ?? []).length > 0);
    if (filterDept === "all") return orders;
    return orders.filter((o) => (subsByOrder[o.id] ?? []).some((s) => s.dept === filterDept));
  }, [orders, subsByOrder, displaySubsByOrder, filterDept, isCoordinator]);

  /** Assegna un colore stabile a ogni commessa ANCORA attiva sul board.
   *  Ordini "spedito"/"chiuso" non ricevono colore (lo "liberano" per i nuovi). */
  const orderColor = useMemo(() => {
    const m = new Map<string, typeof ORDER_PALETTE[number]>();
    const active = visibleOrders
      .filter((o) => o.status !== "spedito" && o.status !== "chiuso")
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code));
    active.forEach((o, i) => m.set(o.id, ORDER_PALETTE[i % ORDER_PALETTE.length]));
    return m;
  }, [visibleOrders]);

  const isSubLocked = (sub: ProdSubOrder): ProdSubOrder | null => {
    if (!sub.depends_on) return null;
    const pred = subs.find((s) => s.id === sub.depends_on);
    if (pred && pred.status !== "completato") return pred;
    return null;
  };

  const setSubStatus = async (sub: ProdSubOrder, status: ProdSubStatus) => {
    if (!user) return;
    if (!isCoordinator && !operatorDeptSet.has(sub.dept)) {
      toast.error("Puoi aggiornare solo le attività assegnate al tuo settore");
      return;
    }
    // "In revisione" non si setta direttamente: apri dialog motivo
    if (status === "rimandato") {
      setRejecting(sub);
      return;
    }
    // Lock: non si può iniziare/completare se il predecessore non è completato
    if (status !== "in_attesa" && status !== "bloccato") {
      const pred = isSubLocked(sub);
      if (pred) {
        toast.error(`Bloccato: prima completa ${pred.code} (${DEPT_LABEL[pred.dept]})`);
        return;
      }
    }
    // Se sta completando → apri dialog conferma (consumo + residui).
    // Lo status verrà aggiornato dopo la conferma.
    if (status === "completato" && sub.status !== "completato") {
      // L'ULTIMO sub dell'ordine apre il dialog di consumo magazzino.
      // Tutti gli altri vengono completati direttamente: chi chiude per ultimo
      // è responsabile della movimentazione (lastre scalate + sfridi residui).
      const others = (subsByOrder[sub.order_id] ?? []).filter(
        (x) => x.id !== sub.id && x.status !== "completato",
      );
      const isLastSub = others.length === 0;
      if (isLastSub) {
        setCompleting(sub);
        return;
      }
      // Sub intermedio: completa subito e basta.
      await finalizeCompletion(sub);
      return;
    }
    const patch: { status: ProdSubStatus; started_at?: string } = { status };
    if (status === "in_lavorazione" && !sub.started_at) patch.started_at = new Date().toISOString();
    const { error } = await supabase.from("production_sub_orders").update(patch).eq("id", sub.id);
    if (error) { toast.error(error.message); return; }

    await logAction({
      action: status === "in_lavorazione" ? "SUBORDINE_INIZIATO" : "SUBORDINE_AGGIORNATO",
      entity_type: "sub_order", entity_id: sub.id,
      detail: `${sub.code} → ${SUB_STATUS_LABEL[status]}`,
      prev_state: { status: sub.status }, new_state: { status },
    });

    await refreshOrders();
  };

  /** Chiamato dal dialog dopo che residui/consumi sono stati salvati. */
  const finalizeCompletion = async (sub: ProdSubOrder) => {
    const patch = { status: "completato" as ProdSubStatus, completed_at: new Date().toISOString() };
    const { error } = await supabase.from("production_sub_orders").update(patch).eq("id", sub.id);
    if (error) { toast.error(error.message); return; }

    await logAction({
      action: "SUBORDINE_COMPLETATO",
      entity_type: "sub_order", entity_id: sub.id,
      detail: `${sub.code} → ${SUB_STATUS_LABEL.completato}`,
      prev_state: { status: sub.status }, new_state: { status: "completato" },
    });

    const order = orders.find((o) => o.id === sub.order_id);
    const allSubs = (subsByOrder[sub.order_id] ?? []).map((s) => s.id === sub.id ? { ...s, status: "completato" as ProdSubStatus } : s);

    // Notifica magazzino quando il sub successivo (per ordine di sequenza) è 'magazzino'
    if (order) {
      const nextSub = allSubs.find((s) => s.depends_on === sub.id && s.status !== "completato");
      if (nextSub?.dept === "magazzino") {
        const magUsers = await getMagazzinoUsers();
        if (magUsers.length > 0) {
          await notify({
            userIds: magUsers,
            type: "magazzino_da_preparare" as any,
            message: `Da preparare: ${order.code} · ${order.cliente} (${DELIVERY_LABEL[order.delivery]})`,
            order_id: order.id,
            link: "/produzione/preparazione",
            is_urgent: order.priorita !== "normale",
          });
        }
      }
    }

    if (order && allSubs.every((s) => s.status === "completato")) {
      await supabase.from("production_orders").update({ status: "pronto" }).eq("id", order.id);
      const writers = await getProduzioneWriters();
      const needsLog = DELIVERY_NEEDS_LOGISTICA.includes(order.delivery);
      await notify({
        userIds: writers,
        type: "ordine_pronto",
        message: needsLog
          ? `${order.code} pronto — passa a Logistica (${DELIVERY_LABEL[order.delivery]})`
          : `${order.code} pronto — ritiro cliente · passa ad Amministrazione`,
        order_id: order.id,
        link: needsLog ? "/produzione/logistica" : "/produzione/amministrazione",
      });
    }
    await refreshOrders();
  };

  const stages = isCoordinator
    ? STAGES.map((st) => ({ ...st, items: visibleOrders.filter((o) => st.match(o, subsByOrder[o.id] ?? [])) }))
    : [{
        key: "reparti",
        label: "In reparti",
        match: STAGES[1].match,
        items: visibleOrders.filter((o) => (displaySubsByOrder[o.id] ?? []).some((s) => s.status !== "completato")),
      }];

  const detailOrder = detail ? orders.find((o) => o.id === detail.order_id) ?? null : null;
  const detailPredecessor = detail?.depends_on ? subs.find((s) => s.id === detail.depends_on) ?? null : null;
  const completingOrder = completing ? orders.find((o) => o.id === completing.order_id) ?? null : null;
  const rejectingOrder = rejecting ? orders.find((o) => o.id === rejecting.order_id) ?? null : null;

  /** Esegue il rimando (sub o intero ordine). */
  const handleReject = async (scope: RejectScope, reason: string) => {
    if (!user || !rejecting) return;
    const sub = rejecting;
    const order = orders.find((o) => o.id === sub.order_id);
    if (!order) { toast.error("Ordine non trovato"); return; }

    const now = new Date().toISOString();

    if (scope === "sub") {
      const { error } = await supabase.from("production_sub_orders").update({
        status: "rimandato",
        rejection_reason: reason,
        rejected_to: order.created_by,
        rejected_by: user.id,
        rejected_at: now,
      } as any).eq("id", sub.id);
      if (error) { toast.error(error.message); return; }

      await logAction({
        action: "SUBORDINE_RIMANDATO",
        entity_type: "sub_order", entity_id: sub.id,
        detail: `${sub.code} in revisione al creatore — motivo: ${reason}`,
        prev_state: { status: sub.status }, new_state: { status: "rimandato", reason },
      });

      await notify({
        userIds: [order.created_by],
        type: "subordine_rimandato" as NotifType,
        message: `${sub.code} (${DEPT_LABEL[sub.dept]}) in revisione — ${reason}`,
        order_id: order.id,
        link: `/produzione/board?sub=${sub.id}`,
        is_urgent: true,
      });

      toast.success("Lavorazione inviata in revisione al creatore");
      setRejecting(null);
      await refreshOrders();
      return;
    }

    // scope === "order": crea una nuova scheda progetto direttamente nella Progettazione del creatore.
    const { error: revErr } = await (supabase as any).rpc("return_order_to_revision", {
      _order_id: order.id,
      _sub_order_id: sub.id,
      _reason: reason,
    });
    if (revErr) { toast.error(`Impossibile creare revisione: ${revErr.message}`); return; }

    toast.success("Progetto tornato in revisione al creatore");
    setRejecting(null);
    await refreshOrders();
  };

  /** Elimina ordine + tutte le lavorazioni collegate. Solo admin. */
  const handleDeleteOrder = async (order: ProdOrder) => {
    if (!isAdmin) { toast.error("Solo gli admin possono eliminare gli ordini"); return; }
    if (!window.confirm(`Eliminare definitivamente l'ordine ${order.code} e tutte le sue lavorazioni?\n\nL'azione non è reversibile.`)) return;
    const subIds = (subsByOrder[order.id] ?? []).map((s) => s.id);
    try {
      if (subIds.length > 0) {
        await supabase.from("production_sub_checklist").delete().in("sub_id", subIds);
      }
      await supabase.from("inventory_reservations").delete().eq("order_id", order.id);
      await supabase.from("prod_notifications").delete().eq("order_id", order.id);
      // Rimuovi anche gli impegni di pianificazione legati alla commessa di origine
      const srcCommessaId = (order as any).source_commessa_id ?? null;
      if (srcCommessaId) {
        await supabase.from("montaggi_planning").delete().eq("commessa_id", srcCommessaId);
      }
      await supabase.from("production_sub_orders").delete().eq("order_id", order.id);
      const { error } = await supabase.from("production_orders").delete().eq("id", order.id);
      if (error) throw error;
      await logAction({
        action: "ORDINE_ELIMINATO",
        entity_type: "production_order", entity_id: order.id,
        detail: `${order.code} eliminato da admin`,
        prev_state: { status: order.status, cliente: order.cliente },
      });
      toast.success(`${order.code} eliminato`);
      await refreshOrders();
    } catch (e: any) {
      toast.error(e?.message ?? "Errore eliminazione");
    }
  };

  return (
    <ProdLayout>
      <div className="p-3 sm:p-6 space-y-4">
        <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold">Flow Board</h1>
            <div className="text-[10px] text-muted-foreground mt-1 hidden sm:block">
              Officina · sub-ordini per reparto, materiali, magazzino, bolle. Qui il lavoro viene eseguito.
            </div>
          </div>
          {isCoordinator && (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value as ProdDept | "all")} className="h-9 px-2 border-2 border-input rounded-sm text-[11px] uppercase tracking-wider font-bold bg-background flex-1 sm:flex-none min-w-0">
                <option value="all">Tutti i reparti</option>
                {(Object.keys(DEPT_LABEL) as ProdDept[]).map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={() => setLaunchWarehouse(true)} className="gap-2"><PackageCheck className="w-4 h-4" /><span className="hidden sm:inline">Solo magazzino</span><span className="sm:hidden">Magaz.</span></Button>
              <Button size="sm" onClick={() => setLaunch(true)} className="gap-2"><Plus className="w-4 h-4" />Lancia</Button>
            </div>
          )}
        </div>

        <CantieriStrip />

        <div className="flex flex-col md:flex-row gap-3 md:overflow-x-auto pb-2">
          {stages.map((st) => (
            <div key={st.key} className="w-full md:min-w-[340px] md:w-[340px] bg-muted/30 border-2 border-ink/15 rounded-sm flex flex-col">
              <div className="px-3 py-2.5 border-b-2 border-ink/15 flex items-center justify-between">
                <div className="font-display font-semibold text-base">{st.label}</div>
                <span className="font-mono text-xs text-muted-foreground">{st.items.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[120px] md:min-h-[200px] md:max-h-[calc(100vh-220px)] md:overflow-y-auto">
                {st.items.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-6 font-mono uppercase tracking-wider">Vuoto</div>
                ) : st.items.map((o) => {
                  const sb = isCoordinator ? (subsByOrder[o.id] ?? []) : (displaySubsByOrder[o.id] ?? []);
                  const prog = orderProgress(sb);
                  const urgent = o.priorita !== "normale";
                  const pcByDept = piecesCountByDept(o);
                  const totalPieces = Object.values(pcByDept).reduce((a, b) => a + (b ?? 0), 0);
                  const oc = orderColor.get(o.id);
                  const tintBg = oc?.bg ?? "bg-paper";
                  const leftBorder = oc?.border ?? "border-l-ink/30";
                  return (
                    <div
                      key={o.id}
                      className={`${tintBg} border-2 ${leftBorder} border-l-[6px] rounded-sm p-3 ${o.priorita === "bloccante" ? "border-destructive shadow-[0_0_0_2px_hsl(var(--destructive)/0.2)] animate-pulse" : urgent ? "border-amber-500" : "border-ink/15"}`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`font-mono text-sm font-bold text-white px-2 py-0.5 rounded-sm ${oc?.chip ?? "bg-ink"}`}>{o.code}</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-[11px] font-mono uppercase font-bold px-2 py-0.5 rounded-sm ${urgent ? "bg-destructive text-destructive-foreground" : "bg-muted text-ink/60"}`}>
                            {PRIORITY_LABEL[o.priorita]}
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDeleteOrder(o); }}
                              title="Elimina ordine (admin)"
                              aria-label="Elimina ordine (admin)"
                              className="w-6 h-6 grid place-items-center rounded-sm border border-ink/20 text-ink/50 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-[15px] font-semibold text-ink leading-snug mb-2">
                        {o.cliente}
                        {o.production_name && <span className="ml-1 text-ink/60 font-normal italic">· Prod. {o.production_name}</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-2.5 gap-y-1 mb-2 text-[12px] font-mono text-ink/75">
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{fmtDate(o.data)}</span>
                        <span className="inline-flex items-center gap-1">
                          {o.delivery === "ritiro" ? <Package className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}
                          {DELIVERY_LABEL[o.delivery]}
                        </span>
                        {totalPieces > 0 && (
                          <span className="inline-flex items-center gap-1 font-bold text-ink">
                            {totalPieces} {totalPieces === 1 ? "pezzo" : "pezzi"}
                          </span>
                        )}
                      </div>
                      {o.note && (
                        <div className="flex items-start gap-1 mb-2 text-[12px] text-ink/75 italic line-clamp-2">
                          <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />

                          <span className="leading-tight">{o.note}</span>
                        </div>
                      )}
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2.5">
                        <div className="h-full bg-primary transition-all" style={{ width: `${prog}%` }} />
                      </div>
                      <div className="space-y-1.5">
                        {(displaySubsByOrder[o.id] ?? []).map((s) => {
                          const pieceCount = pcByDept[s.dept] ?? 0;
                          const statusBg =
                            s.status === "completato" ? "bg-emerald-50 border-emerald-300 hover:bg-emerald-100" :
                            s.status === "in_lavorazione" ? "bg-amber-50 border-amber-300 hover:bg-amber-100" :
                            s.status === "rimandato" ? "bg-orange-50 border-orange-400 hover:bg-orange-100" :
                            s.status === "bloccato" ? "bg-destructive/10 border-destructive/40 hover:bg-destructive/15" :
                            "bg-muted/40 border-ink/15 hover:bg-muted/70";
                          const statusIcon =
                            s.status === "completato" ? "✓" :
                            s.status === "in_lavorazione" ? "◐" :
                            s.status === "rimandato" ? "↩" :
                            s.status === "bloccato" ? "✕" : "○";
                          const dc = DEPT_COLOR[s.dept];
                          const assignee = s.assignee_id ? profiles.find((p) => p.id === s.assignee_id) : null;
                          return (
                            <div
                              key={s.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setDetail(s)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(s); } }}
                              className={`group cursor-pointer border rounded-sm transition-colors overflow-hidden ${statusBg}`}
                              title="Apri dettaglio lavorazione"
                            >
                              {/* Header colorato del reparto */}
                              <div className={`${dc.chip} px-2.5 py-1.5 flex items-center justify-between gap-2`}>
                                <div className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wide min-w-0 text-[15px] leading-none">
                                  <span className="text-lg leading-none" aria-hidden>{dc.emoji}</span>
                                  <span className="truncate">{DEPT_LABEL[s.dept]}</span>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] font-mono opacity-90 shrink-0">
                                  <User className="w-3 h-3" />
                                  <span className="truncate max-w-[100px]">{assignee?.display_name ?? "Non assegnato"}</span>
                                </div>
                              </div>
                              <div className="p-2">
                              <div className="flex items-center justify-between gap-1.5 text-[12px] font-mono">
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  {isSubLocked(s) && <Lock className="w-3 h-3 text-amber-600 shrink-0" />}
                                  <Eye className="w-3 h-3 opacity-50 shrink-0 group-hover:opacity-100" />
                                  <span className="font-bold truncate">{s.code}</span>
                                  {pieceCount > 0 && (
                                    <span className="text-ink/60 shrink-0">({pieceCount}p)</span>
                                  )}
                                </div>
                                <select
                                  value={s.status}
                                  onChange={(e) => setSubStatus(s, e.target.value as ProdSubStatus)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] border border-ink/20 rounded-sm bg-background px-1.5 py-0.5 shrink-0"
                                >
                                  <option value="in_attesa">⏳ In attesa</option>
                                  <option value="in_lavorazione">◐ In lavorazione</option>
                                  <option value="completato">✓ Completato</option>
                                  <option value="rimandato">↩ Revisiona…</option>
                                  {s.status === "bloccato" && <option value="bloccato">✕ Bloccato</option>}
                                </select>
                              </div>

                              {s.note && (
                                <div className="text-[11px] text-ink/70 italic mt-1 truncate">{s.note}</div>
                              )}
                              {s.status === "rimandato" && s.rejection_reason && (
                                <div className="text-[11px] text-orange-700 mt-1 line-clamp-2 leading-snug">
                                  ↩ <span className="font-bold">Motivo:</span> {s.rejection_reason}
                                </div>
                              )}
                              <div className="text-[11px] font-mono text-ink/60 mt-1">
                                {statusIcon} {SUB_STATUS_LABEL[s.status]}
                                {s.started_at && ` · iniz. ${fmtDate(s.started_at)}`}
                                {s.completed_at && ` · compl. ${fmtDate(s.completed_at)}`}
                                {s.rejected_at && ` · rim. ${fmtDate(s.rejected_at)}`}
                              </div>
                              {(() => {
                                // Banner "in attesa materiali" per le lavorazioni bloccate da acquisti
                                if (s.dept === "acquisti" || s.status === "completato") return null;
                                const waitingAcq = subs.filter((x) => x.order_id === s.order_id && x.dept === "acquisti" && x.status !== "completato");
                                if (waitingAcq.length === 0) return null;
                                return (
                                  <div className="mt-1.5 border border-amber-300 bg-amber-50 rounded-sm px-2 py-1.5 text-[11px] text-amber-900">
                                    <div className="font-bold uppercase tracking-wider flex items-center gap-1">
                                      <Lock className="w-3 h-3" /> In attesa materiale ({waitingAcq.length})
                                    </div>
                                    {waitingAcq.slice(0, 3).map((w) => {
                                      const qtyTxt = w.material_qty != null && w.material_unit ? `${Number(w.material_qty).toFixed(1)} ${w.material_unit}` : null;
                                      const stateTxt = w.order_status ? ({ da_ordinare: "da ordinare", ordinato: "ordinato", in_transito: "in transito", arrivato: "arrivato" } as any)[w.order_status] : "da ordinare";
                                      return (
                                        <div key={w.id} className="font-mono truncate">
                                          • {qtyTxt && <span className="font-bold">{qtyTxt}</span>} {w.material_label || w.code}
                                          {w.supplier_name && <span className="text-amber-700"> · {w.supplier_name}</span>}
                                          <span className="text-amber-700"> · {stateTxt}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              </div>
                            </div>


                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <LaunchOrderDialog open={launch} onOpenChange={setLaunch} />
      <LaunchOrderDialog key={launchWarehouse ? "wh" : "wh-closed"} open={launchWarehouse} onOpenChange={setLaunchWarehouse} warehouseOnlyDefault />
      <CompleteSubDialog
        open={!!completing}
        onOpenChange={(v) => !v && setCompleting(null)}
        sub={completing}
        order={completingOrder}
        onConfirmed={async () => {
          if (completing) await finalizeCompletion(completing);
          setCompleting(null);
        }}
      />
      <SubOrderDetailDialog
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        sub={detail}
        order={detailOrder}
        predecessor={detailPredecessor}
        onStart={async (s) => { await setSubStatus(s, "in_lavorazione"); setDetail(null); }}
        onComplete={(s) => { setDetail(null); setCompleting(s); }}
      />
      <RejectSubDialog
        open={!!rejecting}
        onOpenChange={(v) => !v && setRejecting(null)}
        sub={rejecting}
        order={rejectingOrder}
        onConfirm={handleReject}
      />
    </ProdLayout>
  );
};

export default ProdBoard;