import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Link2, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BankingBank } from "@/lib/open-banking";

export function BankLiveConnection({ bank, onClose }: { bank: BankingBank | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  useEffect(() => { setError(""); setVerified(false); }, [bank]);
  const invoke = async (name: string, body: unknown) => {
    const { data, error: e } = await supabase.functions.invoke(name, { body });
    if (e) {
      const details = e instanceof FunctionsHttpError ? await e.context.json().catch(() => null) : null;
      throw new Error([details?.error, details?.details].filter(Boolean).join(": ") || e.message);
    }
    return data;
  };
  return <Dialog open={bank !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-2xl text-base"><DialogHeader><DialogTitle className="text-2xl">Collega {bank} a Flow</DialogTitle></DialogHeader><p>Enable Banking · Conto aziendale · Solo saldi e movimenti</p><p>Il collegamento nell’area Enable Banking abilita il conto per l’applicazione. Serve anche il consenso per la lettura da Flow.</p><p>Importazione bloccata fino alla verifica delle condizioni economiche. Nessun pagamento e nessuna associazione automatica alla competenza.</p><p>Credem: Credito Emiliano · BNL: BNL Corporate · PayPal: PayPal (EU). Scadenza massima dichiarata: 180 giorni; il consenso richiesto dura al massimo 90 giorni e la banca può ridurlo.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<Button disabled={busy} variant="outline" onClick={async () => { setBusy(true); setError(""); try { const data = await invoke("bank-provider-status", {}); if (!data.active || !data.banks?.some((b: {business: boolean; name: string}) => b.business && (bank === "Credem" ? /emiliano/i : bank === "PayPal" ? /paypal/i : /bnl/i).test(b.name))) throw new Error("Servizio aziendale non disponibile."); setVerified(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Verifica collegamento</Button>{verified && <Button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const data = await invoke("bank-authorize", { action: "start", bank }); const w = window.open(data.url, "_blank", "noopener"); if (!w) { try { window.top!.location.href = data.url; } catch { window.location.assign(data.url); } } setBusy(false); } catch (e) { setError((e as Error).message); setBusy(false); } }}><Link2 />Autorizza lettura {bank}</Button>}</DialogContent></Dialog>;
}