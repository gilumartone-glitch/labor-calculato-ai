import { useState } from "react";
import { Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BANK_START_DATE } from "@/lib/bank-management";
import { parseBankAmount, type BankTransaction } from "@/lib/bank-reconciliation";

type Row = BankTransaction & { updated_at?: string };
export function BankBulkDialog({ rows, action, onClose, onSaved }: { rows: Row[]; action: "edit" | "delete"; onClose: () => void; onSaved: () => Promise<void> }) {
  const [edits, setEdits] = useState(() => rows.map(r => ({ ...r, amountText: String(r.amount) })));
  const [busy, setBusy] = useState(false);
  const change = (id: string, field: "booking_date" | "description" | "amountText", value: string) => setEdits(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = edits.map(r => ({ id: r.id, updated_at: r.updated_at, ...(action === "edit" ? { booking_date: r.booking_date, description: r.description, amount: String(parseBankAmount(r.amountText)) } : {}) }));
      const { data, error } = await supabase.rpc("manage_bank_transactions", { _action: action, _rows: payload });
      if (error) throw error;
      await onSaved(); toast.success(`${data} movimenti ${action === "edit" ? "modificati" : "eliminati"}`); onClose();
    } catch (e) { toast.error(String((e as { message?: string }).message ?? e)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle className="text-2xl">{action === "edit" ? "Modifica" : "Elimina"} {rows.length} movimenti</DialogTitle><DialogDescription className="text-base">{action === "delete" ? "I movimenti eliminati non torneranno con la sincronizzazione. Le voci già associate alla cassa sono protette." : "Data, causale e importo con segno. Le voci già associate alla cassa sono protette."}</DialogDescription></DialogHeader>{action === "edit" && <div className="space-y-4">{edits.map((r, i) => <div key={r.id} className="grid gap-3 border-b border-border pb-4 md:grid-cols-[150px_1fr_150px]"><Input aria-label={`Data movimento ${i + 1}`} type="date" min={BANK_START_DATE} value={r.booking_date} onChange={e => change(r.id, "booking_date", e.target.value)} className="h-11 text-base" /><Input aria-label={`Causale movimento ${i + 1}`} value={r.description} maxLength={2000} onChange={e => change(r.id, "description", e.target.value.toLocaleUpperCase("it-IT"))} className="h-11 text-base" /><Input aria-label={`Importo movimento ${i + 1}`} inputMode="decimal" value={r.amountText} onChange={e => change(r.id, "amountText", e.target.value)} className="h-11 text-base" /></div>)}</div>}<Button variant={action === "delete" ? "destructive" : "default"} disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="animate-spin" /> : action === "delete" ? <Trash2 /> : <Check />}{action === "delete" ? "Conferma eliminazione" : "Salva modifiche"}</Button></DialogContent></Dialog>;
}