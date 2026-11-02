import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { eur } from "@/lib/format";
import { bankCausale } from "@/lib/bank-causale";
import { allocationBalance, buildAllocationPlan, type ReconciliationEntry } from "@/lib/bank-allocation-plan";
import { bankRemaining, competenceRemaining, parseBankAmount, type BankAllocation, type BankTransaction, type CompetenceMovement } from "@/lib/bank-reconciliation";

type Props = { rows: BankTransaction[]; allocations: BankAllocation[]; accountingKey: string; saving: boolean; initialMode: "match" | "direct"; onClose: () => void; onSaved: () => Promise<void> };
export function BankReconcileDialog({ rows, allocations, accountingKey, saving, initialMode, onClose, onSaved }: Props) {
  const [mode, setMode] = useState(initialMode);
  const [candidates, setCandidates] = useState<CompetenceMovement[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState(rows.length === 1 ? bankCausale(rows[0]) : "");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState(String(rows.length === 1 ? bankRemaining(rows[0], allocations) : 0));
  const retryPlan = useRef<ReconciliationEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("get_contabilita_state_public", { _key: accountingKey });
        if (error) throw error;
        const state = data?.[0]?.data as { movements?: CompetenceMovement[] } | undefined;
        if (!cancelled) setCandidates((state?.movements ?? []).filter(m => m.status === "previsto" && m.type === (rows[0].amount > 0 ? "entrata" : "uscita") && competenceRemaining(m) > 0).sort((a,b) => a.date.localeCompare(b.date)));
      } catch { if (!cancelled) setLoadError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [accountingKey, rows]);
  const selections = candidates.filter(m => selected[m.id] !== undefined).map(movement => ({ movement, amount: parseBankAmount(selected[movement.id]) }));
  const balance = allocationBalance(rows, allocations, selections);
  const mixed = rows.some(t => Math.sign(t.amount) !== Math.sign(rows[0].amount));
  const visible = candidates.filter(m => `${m.description} ${m.category} ${m.invoiceNumber ?? ""}`.toLocaleLowerCase("it-IT").includes(search.toLocaleLowerCase("it-IT")));
  const change = () => { retryPlan.current = null; };
  const confirm = async () => {
    if (busy || saving) return;
    setBusy(true);
    try {
      const plan = retryPlan.current ?? buildAllocationPlan(rows, allocations, selections, mode === "direct" ? { description, category, amount: parseBankAmount(amount) } : undefined);
      retryPlan.current = plan;
      const client = supabase as unknown as { rpc: (name: "reconcile_bank_transactions", args: { _entries: ReconciliationEntry[] }) => Promise<{ error: { message: string } | null }> };
      const { error } = await client.rpc("reconcile_bank_transactions", { _entries: plan });
      if (error) throw error;
      await onSaved(); onClose(); toast.success("Movimenti registrati in cassa");
    } catch (error) { toast.error(String((error as { message?: string }).message ?? error)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="text-2xl">{rows.length === 1 ? `Movimento ${rows[0].bank}` : `${rows.length} movimenti selezionati`}</DialogTitle><DialogDescription className="text-base">{rows.length === 1 ? rows[0].description : "Registrazione in cassa"}</DialogDescription></DialogHeader>
    <div className="max-h-40 overflow-y-auto border-y border-border">{rows.map(t => <div key={t.id} className="flex flex-wrap justify-between gap-2 py-2 text-base"><span>{t.booking_date.split("-").reverse().join("/")} · {bankCausale(t)}</span><strong>{t.amount > 0 ? "+" : "−"}{eur(bankRemaining(t, allocations))}</strong></div>)}</div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || mixed} variant={mode === "match" ? "default" : "outline"} onClick={() => { change(); setMode("match"); }}>Associa a competenza</Button><Button disabled={busy} variant={mode === "direct" ? "default" : "outline"} onClick={() => { change(); setMode("direct"); }}>Inserisci direttamente in cassa</Button></div>
    <fieldset disabled={busy} className="space-y-4">
    {mode === "match" ? <>
      {mixed && <p role="alert" className="text-base text-destructive">Seleziona solo entrate oppure solo uscite per associare a competenza.</p>}
      <Input aria-label="Cerca competenza" placeholder="Cerca causale, categoria o fattura" value={search} onChange={e => setSearch(e.target.value)} className="h-11 text-base" />
      {loading ? <p>Caricamento competenze…</p> : loadError ? <p role="alert" className="text-destructive">Non riesco a caricare le competenze. Chiudi e riprova.</p> : <div className="max-h-60 overflow-y-auto">{visible.map(m => <label key={m.id} className="flex cursor-pointer items-start gap-3 border-b border-border py-3 text-base"><Checkbox aria-label={`Associa ${m.description} ${m.invoiceNumber ?? m.id}`} checked={selected[m.id] !== undefined} onCheckedChange={value => { change(); setSelected(previous => { const next = { ...previous }; if (value) next[m.id] = String(competenceRemaining(m)); else delete next[m.id]; return next; }); }} /><span className="min-w-0 flex-1 break-words">{m.description}<span className="block text-muted-foreground">{m.date.split("-").reverse().join("/")} · Fatt. {m.invoiceNumber || "—"}</span></span><strong className="shrink-0">{eur(competenceRemaining(m))}</strong></label>)}{!visible.length && <p className="py-3 text-base">Nessuna competenza trovata.</p>}</div>}
      {selections.map(s => <div key={s.movement.id} className="grid items-center gap-2 sm:grid-cols-[1fr_160px]"><Label htmlFor={`allocation-${s.movement.id}`} className="break-words text-base">{s.movement.description} · importo da associare</Label><Input id={`allocation-${s.movement.id}`} inputMode="decimal" value={selected[s.movement.id]} onChange={e => { change(); setSelected(prev => ({ ...prev, [s.movement.id]: e.target.value })); }} className="h-11 text-base" /></div>)}
      <div aria-label="Riepilogo associazione" className="space-y-2 border-y border-border py-3 text-lg"><p>Residuo movimenti: <strong>{eur(balance.bank)}</strong></p><p>Competenze selezionate: <strong>{eur(balance.competence)}</strong></p><p>Differenza (movimenti − competenze): <strong>{balance.difference === 0 ? "Pareggio · " : balance.difference > 0 ? "+" : ""}{eur(balance.difference)}</strong></p><p>Da associare: <strong>{eur(balance.allocated)}</strong></p><p>Residuo bancario dopo associazione: <strong>{eur(balance.bank - balance.allocated)}</strong></p></div>
    </> : <div className="space-y-3"><Label htmlFor="bank-cash-description" className="text-base">{rows.length === 1 ? "Causale" : "Causale comune (facoltativa)"}</Label><Input id="bank-cash-description" value={description} placeholder="Causale del singolo movimento" maxLength={2000} onChange={e => { change(); setDescription(e.target.value.toLocaleUpperCase("it-IT")); }} className="h-11 text-base" /><Label htmlFor="bank-cash-category" className="text-base">Categoria</Label><Input id="bank-cash-category" value={category} maxLength={200} onChange={e => { change(); setCategory(e.target.value.toLocaleUpperCase("it-IT")); }} className="h-11 text-base" />{rows.length === 1 ? <><Label htmlFor="bank-allocation-amount" className="text-base">Importo da portare in cassa</Label><Input id="bank-allocation-amount" value={amount} inputMode="decimal" onChange={e => { change(); setAmount(e.target.value); }} className="h-11 text-lg" /></> : <p className="text-lg">Totale da portare in cassa: <strong>{eur(balance.bank)}</strong></p>}</div>}
    </fieldset>
    {saving && <p className="text-base text-muted-foreground">Attendi il salvataggio della contabilità prima di confermare.</p>}
    <Button disabled={busy || saving || (mode === "match" && (loading || loadError || mixed || !selections.length || balance.allocated > balance.bank))} onClick={() => void confirm()}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Conferma associazione</Button>
  </DialogContent></Dialog>;
}