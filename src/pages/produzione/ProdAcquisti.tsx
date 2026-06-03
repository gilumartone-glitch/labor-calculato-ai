import { useMemo, useState } from "react";
import { ShoppingCart, CheckCircle2, User, Film, Calendar, Package, Truck, Building2 } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { useProdStore } from "@/lib/produzione/store";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { logAction, notify, getMagazzinoUsers } from "@/lib/produzione/helpers";
import { ProdSubOrder, ProdSubStatus, ORDER_STATUS_LABEL_ACQUISTI, ProdOrderStatusForAcquisti } from "@/lib/produzione/types";
import { ContactSelect } from "@/components/produzione/ContactSelect";

const STATUS_FLOW: ProdOrderStatusForAcquisti[] = ["da_ordinare", "ordinato", "in_transito", "arrivato"];

const ProdAcquisti = () => {
  const { orders, subs, refreshOrders } = useProdStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [supplierDraft, setSupplierDraft] = useState<string>("");

  const items = useMemo(() => {
    const list = subs
      .filter((s) => s.dept === "acquisti" && s.status !== "completato")
      .map((s) => ({ sub: s, order: orders.find((o) => o.id === s.order_id) }))
      .filter((x) => !!x.order);
    return list.sort((a, b) => {
      const pa = a.order!.priorita === "bloccante" ? 0 : a.order!.priorita === "urgente" ? 1 : 2;
      const pb = b.order!.priorita === "bloccante" ? 0 : b.order!.priorita === "urgente" ? 1 : 2;
      if (pa !== pb) return pa - pb;
      return (a.order!.data ?? "").localeCompare(b.order!.data ?? "");
    });
  }, [orders, subs]);

  const setOrderStatus = async (sub: ProdSubOrder, status: ProdOrderStatusForAcquisti) => {
    const { error } = await supabase.from("production_sub_orders").update({ order_status: status } as any).eq("id", sub.id);
    if (error) { toast.error(error.message); return; }
    refreshOrders();
  };

  const arrivato = async (sub: ProdSubOrder) => {
    const order = orders.find((o) => o.id === sub.order_id);
    if (!order) return;
    if (!sub.supplier_name?.trim()) {
      toast.error("Indica il fornitore prima di confermare l'arrivo");
      setEditing(sub.id); setSupplierDraft("");
      return;
    }
    const patch = { status: "completato" as ProdSubStatus, order_status: "arrivato" as ProdOrderStatusForAcquisti, completed_at: new Date().toISOString() };
    const { error } = await supabase.from("production_sub_orders").update(patch as any).eq("id", sub.id);
    if (error) { toast.error(error.message); return; }

    await logAction({
      action: "ACQUISTI_ARRIVATO",
      entity_type: "sub_order", entity_id: sub.id,
      detail: `${sub.code} arrivato — ${order.code}`,
    });

    // Sblocco lavorazioni dipendenti: se nessun altro acquisti pendente → notifica
    const otherAcq = subs.filter((s) => s.order_id === order.id && s.dept === "acquisti" && s.id !== sub.id && s.status !== "completato");
    if (otherAcq.length === 0) {
      // Notifica al magazzino
      const magazzinoIds = await getMagazzinoUsers();
      await notify({
        userIds: magazzinoIds,
        type: "magazzino_da_preparare",
        message: `${order.code} — tutti i materiali sono arrivati: pronto per la preparazione`,
        order_id: order.id,
        link: "/produzione/preparazione",
        is_urgent: order.priorita !== "normale",
      });
      // Notifica agli operatori di lavorazione bloccati su questo acquisto
      const blockedSubs = subs.filter((s) => s.order_id === order.id && s.dept !== "acquisti" && s.dept !== "magazzino" && s.assignee_id && s.status !== "completato");
      const assigneeIds = Array.from(new Set(blockedSubs.map((s) => s.assignee_id!).filter(Boolean)));
      if (assigneeIds.length > 0) {
        await notify({
          userIds: assigneeIds,
          type: "ordine_creato",
          message: `✅ Materiale arrivato per ${order.code} (${order.cliente}) — puoi iniziare la lavorazione`,
          order_id: order.id,
          link: `/produzione/board?order=${order.id}`,
          is_urgent: order.priorita !== "normale",
        });
      }
    }
    toast.success("Materiale registrato come arrivato");
    refreshOrders();
  };

  const saveSupplier = async (sub: ProdSubOrder) => {
    const v = supplierDraft.trim() || null;
    const { error } = await supabase
      .from("production_sub_orders")
      .update({ supplier_name: v } as any)
      .eq("id", sub.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Fornitore aggiornato");
    setEditing(null);
    refreshOrders();
  };

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <ShoppingCart className="w-6 h-6" /> Acquisti
          </h1>
          <div className="text-[12px] text-muted-foreground mt-1">
            Materiali da ordinare ai fornitori. Avanza lo stato fino ad "arrivato" per sbloccare la lavorazione.
          </div>
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="border-2 border-ink/15 rounded-sm bg-paper p-8 text-center text-[12px] text-muted-foreground">
              Nessun materiale da ordinare
            </div>
          ) : items.map(({ sub, order }) => {
            const urgent = order!.priorita !== "normale";
            const currentStatus: ProdOrderStatusForAcquisti = (sub.order_status as ProdOrderStatusForAcquisti) ?? "da_ordinare";
            const qty = sub.material_qty;
            const unit = sub.material_unit;
            const qtyTxt = qty != null && unit ? `${Number(qty).toFixed(2)} ${unit}` : null;
            const label = sub.material_label || sub.note?.replace(/^Da ordinare:\s*/, "").split(" · ")[0] || sub.code;
            return (
              <div key={sub.id} className={`border-2 rounded-sm bg-paper p-4 space-y-3 ${order!.priorita === "bloccante" ? "border-destructive" : urgent ? "border-amber-500" : "border-ink/15"}`}>
                {/* Header ordine */}
                <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
                  <span className="font-bold text-[12px]">{order!.code}</span>
                  {order!.customer_order_ref && <span className="text-muted-foreground">· cliente {order!.customer_order_ref}</span>}
                  <span className="text-muted-foreground">·</span>
                  <span className="flex items-center gap-1 text-ink"><User className="w-3 h-3" /> {order!.cliente}</span>
                  {order!.production_name && <span className="flex items-center gap-1 text-ink/70"><Film className="w-3 h-3" /> {order!.production_name}</span>}
                  {sub.due_date && <span className="flex items-center gap-1 text-amber-700 font-bold"><Calendar className="w-3 h-3" /> entro {sub.due_date}</span>}
                  {urgent && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-sm bg-destructive text-destructive-foreground">{order!.priorita}</span>}
                </div>

                {/* Comanda — quantità prominente */}
                <div className="border-2 border-ink/30 bg-muted/30 rounded-sm p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-shrink-0">
                    <div className="font-display text-3xl font-bold tabular-nums leading-none">
                      {qtyTxt ?? "—"}
                    </div>
                    <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mt-1">Quantità da ordinare</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-ink flex items-center gap-2 flex-wrap">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      {label}
                    </div>
                    {sub.material_code && (
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">cod. {sub.material_code}</div>
                    )}
                    {sub.note && !sub.material_label && (
                      <div className="text-[11px] text-ink/80 italic mt-1">{sub.note}</div>
                    )}
                  </div>
                </div>

                {/* Fornitore */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  {editing === sub.id ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <div className="w-64">
                        <ContactSelect size="sm" type="fornitore" value={supplierDraft || sub.supplier_name || ""} onChange={setSupplierDraft} autoFocus />
                      </div>
                      <Button size="sm" variant="outline" onClick={() => saveSupplier(sub)}>Salva</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Annulla</Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditing(sub.id); setSupplierDraft(sub.supplier_name || ""); }}
                      className="text-[12px] font-bold px-2 py-1 rounded-sm border-2 border-ink/20 hover:bg-muted/40"
                    >
                      {sub.supplier_name ? `Fornitore: ${sub.supplier_name}` : "+ Imposta fornitore"}
                    </button>
                  )}
                </div>

                {/* Pillole di stato */}
                <div className="flex items-center gap-1 flex-wrap">
                  {STATUS_FLOW.map((s, idx) => {
                    const isCurrent = s === currentStatus;
                    const isPast = STATUS_FLOW.indexOf(currentStatus) > idx;
                    return (
                      <button
                        key={s}
                        onClick={() => setOrderStatus(sub, s)}
                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border-2 transition-colors ${
                          isCurrent ? "bg-primary text-primary-foreground border-primary" :
                          isPast ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                          "border-ink/15 text-ink/50 hover:border-ink/40"
                        }`}
                      >
                        {idx + 1}. {ORDER_STATUS_LABEL_ACQUISTI[s]}
                      </button>
                    );
                  })}
                  <div className="flex-1" />
                  <Button onClick={() => arrivato(sub)} className="gap-1.5" size="sm">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Segna arrivato
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdAcquisti;
