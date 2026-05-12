import { useState } from "react";
import { Truck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { useProdStore } from "@/lib/produzione/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";
import { DELIVERY_LABEL, DELIVERY_NEEDS_LOGISTICA } from "@/lib/produzione/types";

const CORRIERI = ["GLS", "BRT", "DHL", "TNT", "SDA", "Mezzo proprio"];

const ProdLogistica = () => {
  const { orders, refreshOrders } = useProdStore();
  const ready = orders.filter((o) => o.status === "pronto" && DELIVERY_NEEDS_LOGISTICA.includes(o.delivery));
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const confirm = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    // Se è corriere, serve la scelta. Per spedizione/mezzo_proprio è opzionale.
    let corriere = drafts[orderId] ?? "";
    if (order.delivery === "corriere" && !corriere) { toast.error("Seleziona corriere"); return; }
    if (!corriere) corriere = order.delivery === "mezzo_proprio" ? "Mezzo proprio" : "Spedizione";
    const { error } = await supabase.from("production_orders").update({
      corriere, spedizione_at: new Date().toISOString(), status: "spedito",
    }).eq("id", orderId);
    if (error) { toast.error(error.message); return; }
    await logAction({
      action: "SPEDIZIONE_CONFERMATA", entity_type: "order", entity_id: orderId,
      detail: `${order.code} consegnato (${DELIVERY_LABEL[order.delivery]}${corriere ? " · " + corriere : ""})`,
    });
    {
      const writers = await getProduzioneWriters();
      await notify({
        userIds: writers,
        type: "ordine_pronto",
        message: `${order.code} spedito — in attesa di fatturazione`,
        order_id: order.id,
        link: "/produzione/amministrazione",
      });
    }
    toast.success("Consegna registrata · passato ad Amministrazione");
    refreshOrders();
  };

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Truck className="w-6 h-6" /> Logistica</h1>
          <div className="text-[12px] text-muted-foreground mt-1">Spedizioni con corriere o mezzo proprio. I ritiri cliente passano direttamente ad Amministrazione.</div>
        </div>

        <div className="border-2 border-ink/15 rounded-sm bg-paper">
          <div className="px-3 py-2 border-b font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Ordini pronti da consegnare ({ready.length})
          </div>
          {ready.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-muted-foreground">Nulla da consegnare</div>
          ) : (
            <ul className="divide-y">
              {ready.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[12px] font-bold">{o.code}</div>
                    <div className="text-[12px] text-ink/70">{o.cliente} · {o.data}</div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-primary mt-0.5">{DELIVERY_LABEL[o.delivery]}</div>
                  </div>
                  {o.delivery === "corriere" && (
                    <select
                      value={drafts[o.id] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [o.id]: e.target.value })}
                      className="h-9 px-2 border-2 border-input rounded-sm text-[11px] bg-background"
                    >
                      <option value="">Corriere…</option>
                      {CORRIERI.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  {o.delivery === "mezzo_proprio" && (
                    <Input
                      placeholder="Autista (opz.)"
                      value={drafts[o.id] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [o.id]: e.target.value })}
                      className="w-40 h-9 text-[11px]"
                    />
                  )}
                  <Button size="sm" onClick={() => confirm(o.id)} className="gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Consegnato</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdLogistica;