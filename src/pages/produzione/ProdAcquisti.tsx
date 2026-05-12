import { useMemo, useState } from "react";
import { ShoppingCart, CheckCircle2, User, Truck, Film } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { useProdStore } from "@/lib/produzione/store";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { logAction, notify, getMagazzinoUsers } from "@/lib/produzione/helpers";
import { ProdSubOrder, ProdSubStatus } from "@/lib/produzione/types";
import { ContactSelect } from "@/components/produzione/ContactSelect";

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

  const arrivato = async (sub: ProdSubOrder) => {
    const order = orders.find((o) => o.id === sub.order_id);
    if (!order) return;
    if (!sub.supplier_name?.trim()) {
      toast.error("Indica il fornitore prima di confermare l'arrivo");
      setEditing(sub.id); setSupplierDraft("");
      return;
    }
    const patch = { status: "completato" as ProdSubStatus, completed_at: new Date().toISOString() };
    const { error } = await supabase.from("production_sub_orders").update(patch).eq("id", sub.id);
    if (error) { toast.error(error.message); return; }

    await logAction({
      action: "ACQUISTI_ARRIVATO",
      entity_type: "sub_order", entity_id: sub.id,
      detail: `${sub.code} arrivato — ${order.code}`,
    });

    // Se questo era l'ultimo sub acquisti dell'ordine → notifica magazzino
    const otherAcq = subs.filter((s) => s.order_id === order.id && s.dept === "acquisti" && s.id !== sub.id && s.status !== "completato");
    if (otherAcq.length === 0) {
      const magazzinoIds = await getMagazzinoUsers();
      await notify({
        userIds: magazzinoIds,
        type: "magazzino_da_preparare",
        message: `${order.code} — tutti i materiali sono arrivati: pronto per la preparazione`,
        order_id: order.id,
        link: "/produzione/preparazione",
        is_urgent: order.priorita !== "normale",
      });
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
            Materiali mancanti da ordinare ai fornitori. Conferma "arrivato" per sbloccare la preparazione magazzino.
          </div>
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="border-2 border-ink/15 rounded-sm bg-paper p-8 text-center text-[12px] text-muted-foreground">
              Nessun materiale da ordinare
            </div>
          ) : items.map(({ sub, order }) => {
            const urgent = order!.priorita !== "normale";
            return (
              <div key={sub.id} className={`border-2 rounded-sm bg-paper p-4 flex items-center gap-4 flex-wrap ${order!.priorita === "bloccante" ? "border-destructive" : urgent ? "border-amber-500" : "border-ink/15"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[12px] font-bold">{sub.code}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">/ {order!.code}</span>
                    {order!.customer_order_ref && <span className="font-mono text-[10px] text-muted-foreground">· cliente {order!.customer_order_ref}</span>}
                    {urgent && <span className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm bg-destructive text-destructive-foreground">{order!.priorita}</span>}
                  </div>
                  <div className="text-[13px] text-ink flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1"><User className="w-3 h-3 text-muted-foreground" /> {order!.cliente}</span>
                    {order!.production_name && <span className="flex items-center gap-1 text-ink/70"><Film className="w-3 h-3" /> Prod. {order!.production_name}</span>}
                  </div>
                  {sub.note && <div className="mt-2 text-[12px] text-ink/80 italic">📝 {sub.note}</div>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                    {editing === sub.id ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-64">
                          <ContactSelect size="sm" type="fornitore" value={supplierDraft || sub.supplier_name || ""} onChange={setSupplierDraft} autoFocus />
                        </div>
                        <Button size="sm" variant="outline" onClick={() => saveSupplier(sub)}>Salva</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Annulla</Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditing(sub.id); setSupplierDraft(sub.supplier_name || ""); }}
                        className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border border-ink/20 hover:bg-muted/40"
                      >
                        {sub.supplier_name ? `Fornitore: ${sub.supplier_name}` : "+ Imposta fornitore"}
                      </button>
                    )}
                  </div>
                </div>
                <Button onClick={() => arrivato(sub)} className="gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Arrivato
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdAcquisti;