import { useMemo } from "react";
import { PackageCheck, CheckCircle2, Truck, Package, User } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { useProdStore } from "@/lib/produzione/store";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";
import { DELIVERY_LABEL, DELIVERY_NEEDS_LOGISTICA, ProdSubOrder, ProdSubStatus } from "@/lib/produzione/types";

const ProdPreparazione = () => {
  const { orders, subs, refreshOrders } = useProdStore();

  const items = useMemo(() => {
    const list = subs
      .filter((s) => s.dept === "magazzino" && s.status !== "completato")
      .map((s) => ({ sub: s, order: orders.find((o) => o.id === s.order_id) }))
      .filter((x) => !!x.order);
    // ordinati per priorità ordine + data
    return list.sort((a, b) => {
      const pa = a.order!.priorita === "bloccante" ? 0 : a.order!.priorita === "urgente" ? 1 : 2;
      const pb = b.order!.priorita === "bloccante" ? 0 : b.order!.priorita === "urgente" ? 1 : 2;
      if (pa !== pb) return pa - pb;
      return (a.order!.data ?? "").localeCompare(b.order!.data ?? "");
    });
  }, [orders, subs]);

  const isLocked = (sub: ProdSubOrder): ProdSubOrder | null => {
    // 1) dipendenza esplicita
    if (sub.depends_on) {
      const pred = subs.find((s) => s.id === sub.depends_on);
      if (pred && pred.status !== "completato") return pred;
    }
    // 2) tutti i sub acquisti dello stesso ordine devono essere completati
    const pendingAcq = subs.find(
      (s) => s.order_id === sub.order_id && s.dept === "acquisti" && s.status !== "completato",
    );
    if (pendingAcq) return pendingAcq;
    return null;
  };

  const completaSub = async (sub: ProdSubOrder) => {
    const order = orders.find((o) => o.id === sub.order_id);
    if (!order) return;
    const blocked = isLocked(sub);
    if (blocked) { toast.error(`Blocccato: prima va completato ${blocked.code}`); return; }
    const patch = { status: "completato" as ProdSubStatus, completed_at: new Date().toISOString() };
    const { error } = await supabase.from("production_sub_orders").update(patch).eq("id", sub.id);
    if (error) { toast.error(error.message); return; }

    await logAction({
      action: "MAGAZZINO_PREPARATO",
      entity_type: "sub_order", entity_id: sub.id,
      detail: `${sub.code} preparato — ${order.code} pronto per ${DELIVERY_LABEL[order.delivery]}`,
    });

    // Verifica se è l'ultimo sub: se sì, ordine → pronto
    const others = subs.filter((s) => s.order_id === order.id && s.id !== sub.id && s.status !== "completato");
    if (others.length === 0) {
      await supabase.from("production_orders").update({ status: "pronto" }).eq("id", order.id);
      const writers = await getProduzioneWriters();
      const needsLog = DELIVERY_NEEDS_LOGISTICA.includes(order.delivery);
      await notify({
        userIds: writers,
        type: "ordine_pronto",
        message: needsLog
          ? `${order.code} preparato — passa a Logistica (${DELIVERY_LABEL[order.delivery]})`
          : `${order.code} preparato — pronto per ritiro cliente`,
        order_id: order.id,
        link: needsLog ? "/produzione/logistica" : "/produzione/amministrazione",
      });
    }
    toast.success("Materiale pronto");
    refreshOrders();
  };

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <PackageCheck className="w-6 h-6" /> Preparazione magazzino
          </h1>
          <div className="text-[12px] text-muted-foreground mt-1">
            Materiale da preparare per consegna o ritiro. Conferma quando è pronto e passa a Logistica/Amministrazione.
          </div>
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="border-2 border-ink/15 rounded-sm bg-paper p-8 text-center text-[12px] text-muted-foreground">
              Niente da preparare
            </div>
          ) : items.map(({ sub, order }) => {
            const locked = isLocked(sub);
            const urgent = order!.priorita !== "normale";
            return (
              <div key={sub.id} className={`border-2 rounded-sm bg-paper p-4 flex items-center gap-4 flex-wrap ${order!.priorita === "bloccante" ? "border-destructive" : urgent ? "border-amber-500" : "border-ink/15"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[12px] font-bold">{sub.code}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">/ {order!.code}</span>
                    {urgent && <span className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm bg-destructive text-destructive-foreground">{order!.priorita}</span>}
                  </div>
                  <div className="text-[13px] text-ink flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1"><User className="w-3 h-3 text-muted-foreground" /> {order!.cliente}</span>
                    {order!.production_name && <span className="text-ink/70 italic">· Prod. {order!.production_name}</span>}
                    {order!.customer_order_ref && <span className="font-mono text-[10px] text-muted-foreground">· cliente {order!.customer_order_ref}</span>}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1 flex items-center gap-2 flex-wrap">
                    {order!.delivery === "ritiro" ? <><Package className="w-3 h-3" /> {DELIVERY_LABEL[order!.delivery]}</> : <><Truck className="w-3 h-3" /> {DELIVERY_LABEL[order!.delivery]}</>}
                    <span>· {order!.data}</span>
                  </div>
                  {sub.note && <div className="mt-2 text-[12px] text-ink/80 italic">📝 {sub.note}</div>}
                  {order!.note && <div className="mt-1 text-[11px] text-muted-foreground">{order!.note}</div>}
                  {locked && (
                    <div className="mt-2 text-[11px] font-mono text-amber-700 bg-amber-50 border border-amber-300 rounded-sm px-2 py-1 inline-block">
                      ⏳ In attesa: {locked.code}
                    </div>
                  )}
                </div>
                <Button onClick={() => completaSub(sub)} disabled={!!locked} className="gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Materiale pronto
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdPreparazione;