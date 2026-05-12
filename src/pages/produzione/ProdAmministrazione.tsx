import { FileText, CheckCircle2, Truck, Package } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { useProdStore } from "@/lib/produzione/store";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";
import { DELIVERY_LABEL } from "@/lib/produzione/types";

const ProdAmministrazione = () => {
  const { orders, refreshOrders } = useProdStore();
  // Da fatturare: ordini SPEDITI (per spedizione) o PRONTI con ritiro in sede.
  const ready = orders.filter(
    (o) => o.status === "spedito" || (o.status === "pronto" && o.delivery === "ritiro"),
  );

  const closeOrder = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const { error } = await supabase
      .from("production_orders")
      .update({ status: "chiuso" })
      .eq("id", orderId);
    if (error) { toast.error(error.message); return; }
    await logAction({
      action: "ORDINE_CHIUSO",
      entity_type: "order",
      entity_id: orderId,
      detail: `${order.code} fatturato e chiuso`,
    });
    const writers = await getProduzioneWriters();
    await notify({
      userIds: writers,
      type: "ordine_chiuso",
      message: `${order.code} fatturato e chiuso ✅`,
      order_id: order.id,
    });
    toast.success("Fatturato e chiuso");
    refreshOrders();
  };

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <FileText className="w-6 h-6" /> Amministrazione
          </h1>
          <div className="text-[12px] text-muted-foreground mt-1">
            Conferma la fatturazione degli ordini già spediti o ritirati per chiuderli definitivamente.
          </div>
        </div>

        <div className="space-y-3">
          {ready.length === 0 ? (
            <div className="border-2 border-ink/15 rounded-sm bg-paper p-8 text-center text-[12px] text-muted-foreground">
              Nessun ordine in attesa di fatturazione
            </div>
          ) : ready.map((o) => (
            <div key={o.id} className="border-2 border-ink/15 rounded-sm bg-paper p-4 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] font-bold">{o.code}</div>
                <div className="text-[13px] text-ink">{o.cliente}</div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center gap-2">
                  {o.delivery === "ritiro" ? (
                    <><Package className="w-3 h-3" /> Ritiro cliente</>
                  ) : (
                    <><Truck className="w-3 h-3" /> {DELIVERY_LABEL[o.delivery]}{o.corriere ? ` · ${o.corriere}` : ""}{o.spedizione_at ? ` · ${new Date(o.spedizione_at).toLocaleDateString("it-IT")}` : ""}</>
                  )}
                </div>
              </div>
              <Button onClick={() => closeOrder(o.id)} className="gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Fatturato e chiuso
              </Button>
            </div>
          ))}
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdAmministrazione;