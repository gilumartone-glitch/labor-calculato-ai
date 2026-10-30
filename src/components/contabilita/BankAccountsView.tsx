import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Check, Landmark, Link2, Loader2, RefreshCw, Upload, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BankBulkDialog } from "./BankBulkDialog";
import { BANK_START_DATE, currentBankAccounts } from "@/lib/bank-management";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { eur } from "@/lib/format";
import { bankImportRowSchema, bankRemaining, competenceRemaining, parseBankAmount, parseBankDate, validateAllocation, type BankAllocation, type BankTransaction, type CompetenceMovement } from "@/lib/bank-reconciliation";
import { BankBalances, type BankAccount } from "./BankBalances";
import { canonicalReference, fallbackTransactionId, consentExpiring } from "../../../supabase/functions/_shared/bank-identity";

type Props = { year: number; accountingKey: string; saving: boolean; onReconciled: () => Promise<void> };
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-base";

export function BankAccountsView({ year, accountingKey, saving, onReconciled }: Props) {
  const { can, isAmministrazione } = usePermissions();
  const canEdit = can("contabilita", "write") || isAmministrazione;
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [allocations, setAllocations] = useState<BankAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bank, setBank] = useState("all");
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(BANK_START_DATE);
  const [to, setTo] = useState("");
  const [active, setActive] = useState<BankTransaction | null>(null);
  const [candidates, setCandidates] = useState<CompetenceMovement[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [mode, setMode] = useState("match");
  const [selectedId, setSelectedId] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [importOpen, setImportOpen] = useState(false);
  const [importBank, setImportBank] = useState<"Credem" | "BNL" | "PayPal">("Credem");
  const [accountRef, setAccountRef] = useState("");
  const [sheetRows, setSheetRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState({ date: "", description: "", amount: "", incoming: "", outgoing: "", id: "" });
  const [splitAmounts, setSplitAmounts] = useState(false);
  const [fileName, setFileName] = useState("");
  const loadingRef = useRef(false);
  const reloadRequested = useRef(false);
  const [paypalBusy, setPaypalBusy] = useState(false);
  const [bankBusy, setBankBusy] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<"edit" | "delete" | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [direction, setDirection] = useState("all");
  const [logs, setLogs] = useState<{ id: string; bank: string; outcome: string; message: string; created_at: string }[]>([]);
  const [providerAccounts, setProviderAccounts] = useState<(Omit<BankAccount, "balance"> & { balance: string | null; currency: string; needs_reconnect: boolean; valid_until: string | null })[]>([]);
  const [providerReady, setProviderReady] = useState(false);
  const providerLoaded = useRef(false);
  const readProviderAccounts = useCallback(async () => {
    const { data, error: e } = await supabase.functions.invoke("obio-accounts", { body: {} });
    if (!e && data?.status === "ready" && Array.isArray(data.accounts)) {
      setProviderAccounts(data.accounts); setProviderReady(true);
    } else { setProviderReady(false); }
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) { reloadRequested.current = true; return; }
    loadingRef.current = true;
    try {
      const tx: BankTransaction[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error: e } = await supabase.from("bank_transactions").select("*").gte("booking_date", `${year}-01-01` > BANK_START_DATE ? `${year}-01-01` : BANK_START_DATE).lte("booking_date", `${year}-12-31`).order("booking_date", { ascending: false }).order("id").range(offset, offset + 999);
        if (e) throw e;
        tx.push(...(data ?? []) as BankTransaction[]);
        if ((data?.length ?? 0) < 1000) break;
      }
      const links: BankAllocation[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error: e } = await supabase.from("bank_allocations").select("*").eq("accounting_key", accountingKey).order("id").range(offset, offset + 999);
        if (e) throw e;
        links.push(...(data ?? []) as BankAllocation[]);
        if ((data?.length ?? 0) < 1000) break;
      }
      if (!providerLoaded.current) { providerLoaded.current = true; await readProviderAccounts(); }
      const [{ data: accountRows, error: accountError }, { data: logRows }] = await Promise.all([supabase.from("bank_accounts").select("*").eq("is_active", true).order("bank"), supabase.from("bank_sync_log").select("id,bank,outcome,message,created_at").order("created_at", { ascending: false }).limit(10)]);
      if (accountError) throw accountError;
      setAccounts((accountRows ?? []) as BankAccount[]);
      setLogs(logRows ?? []);
      const { data: schedule } = await supabase.rpc("get_bank_schedule_status");
      setScheduleEnabled(!!(schedule as { enabled?: boolean } | null)?.enabled);
      setTransactions(tx); setAllocations(links); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String((e as { message?: string }).message ?? e)); }
    finally {
      loadingRef.current = false; setLoading(false);
      if (reloadRequested.current) { reloadRequested.current = false; void load(); }
    }
  }, [year, accountingKey, readProviderAccounts]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !busy) void load(); }, 30000);
    return () => clearInterval(timer);
  }, [load, busy]);

  const openTransaction = async (t: BankTransaction) => {
    setActive(t); setMode("match"); setSelectedId(""); setCandidateSearch(""); setAmount(String(bankRemaining(t, allocations))); setDescription(t.description); setCategory(""); setRequestId(crypto.randomUUID()); setCandidates([]); setCandidateLoading(true);
    try {
      const { data, error: e } = await supabase.rpc("get_contabilita_state_public", { _key: accountingKey });
      if (e) throw e;
      const state = data?.[0]?.data as { movements?: CompetenceMovement[] } | undefined;
      setCandidates((state?.movements ?? []).filter((m) => m.status === "previsto" && m.type === (t.amount > 0 ? "entrata" : "uscita") && competenceRemaining(m) > 0).sort((a, b) => a.date.localeCompare(b.date)));
    } catch { toast.error("Non riesco a caricare le competenze. Aggiorna e riprova."); }
    finally { setCandidateLoading(false); }
  };

  const confirm = async () => {
    if (!active || busy || saving) return;
    setBusy(true);
    try {
      const selected = mode === "match" ? candidates.find((m) => m.id === selectedId) : undefined;
      if (mode === "match" && !selected) throw new Error("Scegli la voce di competenza.");
      const value = validateAllocation(active, allocations, parseBankAmount(amount), selected);
      if (mode === "direct" && !description.trim()) throw new Error("Inserisci la causale.");
      const { error: e } = await supabase.rpc("reconcile_bank_transaction", { _transaction_id: active.id, _request_id: requestId, _competence_id: selected?.id ?? null, _amount: value, _description: description, _category: category, _expected_amount: selected?.amount ?? null, _expected_acconto: selected ? Math.min(selected.amount, Math.max(0, selected.acconto ?? 0)) : null });
      if (e) throw e;
      await Promise.all([load(), onReconciled()]);
      setActive(null); toast.success("Movimento registrato in cassa");
    } catch (e) { toast.error(String((e as { message?: string }).message ?? e)); }
    finally { setBusy(false); }
  };

  const readFile = async (file: File) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, raw: true });
      const first = workbook.SheetNames[0];
      if (!first) throw new Error("File vuoto");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first], { defval: "" });
      if (!rows.length || rows.length > 2000) throw new Error("Scegli un file con da 1 a 2000 movimenti.");
      const cols = Object.keys(rows[0]);
      const find = (pattern: RegExp) => cols.find((c) => pattern.test(c)) ?? "";
      setColumns(cols); setSheetRows(rows); setFileName(file.name);
      setMapping({ date: find(/data.*(contab|oper|reg)|booking|^data$|^date$/i), description: find(/descri|causale|dettagl/i), amount: find(/^importo$|^amount$|^valore$/i), incoming: find(/entrata|entrate|accredit|avere/i), outgoing: find(/uscita|uscite|addebit|dare/i), id: find(/id.*mov|riferimento|identificativo|transaction.*id/i) });
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  const importRows = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!accountRef.trim()) throw new Error("Inserisci il nome del conto.");
      if (!mapping.date || !mapping.description || (!splitAmounts && !mapping.amount) || (splitAmounts && (!mapping.incoming || !mapping.outgoing))) throw new Error("Scegli le colonne per data, causale e importi.");
      const occurrences = new Map<string, number>();
      const rows = [];
      for (const [index, row] of sheetRows.entries()) {
        const rawDate = row[mapping.date];
        const date = rawDate instanceof Date ? `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,"0")}-${String(rawDate.getDate()).padStart(2,"0")}` : parseBankDate(rawDate);
        if (!date.startsWith(String(year))) throw new Error(`Riga ${index + 2}: scegli l’anno ${date.slice(0, 4)} in Contabilità.`);
        if (date < BANK_START_DATE) continue;
        const incoming = splitAmounts ? parseBankAmount(row[mapping.incoming]) : 0;
        const outgoing = splitAmounts ? parseBankAmount(row[mapping.outgoing]) : 0;
        if (splitAmounts && incoming !== 0 && outgoing !== 0) throw new Error(`Riga ${index+2}: entrata e uscita entrambe compilate.`);
        const value = splitAmounts ? Math.abs(incoming) - Math.abs(outgoing) : parseBankAmount(row[mapping.amount]);
        const desc = String(row[mapping.description] ?? "").trim();
        const fingerprint = `${date}|${value}|${desc}`;
        const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
        occurrences.set(fingerprint, occurrence);
        const externalId = mapping.id ? String(row[mapping.id] ?? "").trim() : "";
        if (mapping.id && !externalId) throw new Error(`Riga ${index+2}: riferimento bancario mancante.`);
        const fallback = await fallbackTransactionId(accountRef.trim(), date, value, desc, occurrence);
        const parsed = bankImportRowSchema.safeParse({ bank: importBank, account_ref: accountRef.trim(), external_id: externalId ? `eb-${canonicalReference(externalId)}` : fallback, booking_date: date, description: desc, amount: value, currency: "EUR" });
        if (!parsed.success) throw new Error(`Riga ${index+2}: controlla data, causale e importo.`);
        rows.push(parsed.data);
      }
      const { data, error: e } = await supabase.rpc("import_bank_transactions", { _rows: rows });
      if (e) throw e;
      await load(); setImportOpen(false); setSheetRows([]); toast.success(`${data} movimenti importati; ${rows.length - Number(data)} già presenti`);
    } catch (e) { toast.error(String((e as { message?: string }).message ?? e)); }
    finally { setBusy(false); }
  };

  const visibleAccounts = currentBankAccounts(accounts, providerAccounts, providerReady);
  const filtered = transactions.filter((t) => {
    const remaining = bankRemaining(t, allocations);
    return (accountFilter === "all" || t.account_ref === accountFilter) && (direction === "all" || (direction === "in" ? t.amount > 0 : t.amount < 0)) && (bank === "all" || bank === t.bank) && (status === "all" || (status === "suspended" ? t.status === "PDNG" : t.status !== "PDNG" && (status === "pending" ? remaining > 0 : remaining === 0))) && (!from || t.booking_date >= from) && (!to || t.booking_date <= to) && `${t.description} ${t.account_ref}`.toLocaleLowerCase("it-IT").includes(search.toLocaleLowerCase("it-IT"));
  });
  const selected = candidates.find((m) => m.id === selectedId);
  const syncPaypal = async () => {
    setPaypalBusy(true);
    try {
      const { data, error: e } = await supabase.functions.invoke("paypal-sync", { body: {} });
      if (e || data?.error) {
        let msg = data?.error as string | undefined;
        try { msg = msg ?? (await (e as { context?: Response }).context?.json())?.error; } catch { /* ignore */ }
        throw new Error(msg ?? "Importazione PayPal non riuscita.");
      }
      toast.success(`PayPal: ${data.imported} nuovi movimenti importati`);
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Importazione PayPal non riuscita."); }
    finally { setPaypalBusy(false); }
  };
  const pending = transactions.filter((t) => t.status !== "PDNG" && bankRemaining(t, allocations) > 0);
  const refreshProvider = async () => {
    if (bankBusy !== null) return;
    setBankBusy("accounts");
    try { await readProviderAccounts(); }
    catch { setProviderReady(false); }
    finally { setBankBusy(null); }
  };
  const syncProvider = async () => {
    if (bankBusy !== null) return;
    setBankBusy("sync"); setSyncNotice("");
    try {
      const { data, error: syncError } = await supabase.functions.invoke("obio-sync", { body: {} });
      if (syncError || data?.error) {
        let message = data?.error;
        try { message = message ?? (await (syncError as { context?: Response })?.context?.json())?.error; } catch { /* sanitized fallback */ }
        throw new Error(message ?? "Sincronizzazione non riuscita. Riprova.");
      }
      setSyncNotice(data.message ?? "Sincronizzazione completata.");
      if (data.status === "blocked") return;
      toast.success(`${data.imported ?? 0} nuovi movimenti importati`);
      await Promise.all([load(), readProviderAccounts()]);
    } catch (e) { setSyncNotice(e instanceof Error ? e.message : "Sincronizzazione non riuscita."); }
    finally { setBankBusy(null); }
  };
  const mappingSelect = (key: keyof typeof mapping, label: string, optional = false) => <div className="space-y-1" key={key}><Label htmlFor={`bank-column-${key}`} className="text-base">{label}</Label><select id={`bank-column-${key}`} className={selectClass} value={mapping[key]} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}><option value="">{optional ? "Non presente" : "Scegli colonna"}</option>{columns.map((c) => <option key={c}>{c}</option>)}</select></div>;

  return <section className="space-y-5" aria-label="Conti bancari">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl font-semibold">Conti</h2><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Aggiorna elenco</Button>{canEdit && <Button onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />Importa estratto conto</Button>}</div></div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4"><p className="text-lg font-semibold">open-banking.io · {providerReady ? `${providerAccounts.length} conti rilevati` : "Lettura conti non disponibile"}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={bankBusy !== null} onClick={() => void refreshProvider()}>{bankBusy === "accounts" ? <Loader2 className="animate-spin" /> : <RefreshCw />}Aggiorna conti open-banking.io</Button>{canEdit && <Button disabled={bankBusy !== null || !providerReady} onClick={() => void syncProvider()}>{bankBusy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />}Sincronizza ora</Button>}</div></div>
    <div className="grid gap-4 md:grid-cols-3">{(["Credem", "BNL", "PayPal"] as const).map((name) => {
      const live = providerAccounts.filter(a => a.bank === name);
      const renew = live.some(a => a.needs_reconnect || consentExpiring(a.valid_until));
      return <div key={name} className="border-b-2 border-dept pb-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xl font-semibold"><Landmark className="h-5 w-5" />{name}</h3>{name === "PayPal" && canEdit && <Button variant="outline" disabled={paypalBusy} onClick={() => void syncPaypal()}>{paypalBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Importa da PayPal</Button>}</div><p className="my-2 text-base text-muted-foreground">{name === "PayPal" ? "Collegamento diretto PayPal · ultimi 90 giorni" : providerReady ? `open-banking.io · ${live.length} ${live.length === 1 ? "conto rilevato" : "conti rilevati"}` : "open-banking.io · lettura non disponibile"}</p>{name !== "PayPal" && <Button variant="outline" asChild><a href="https://open-banking.io" target="_blank" rel="noopener noreferrer"><Link2 />{renew ? "Rinnova il collegamento" : "Gestisci collegamento"} su open-banking.io</a></Button>}<div className="mt-3 flex flex-wrap justify-between gap-2 text-base"><span>{transactions.filter(t => t.bank === name).length} movimenti importati</span><span className="font-semibold">Da associare: {eur(pending.filter(t => t.bank === name).reduce((s,t) => s + bankRemaining(t, allocations),0))}</span></div></div>;
    })}</div>
    <p className="text-base text-muted-foreground">{scheduleEnabled ? "Credem, BNL e PayPal · aggiornamento automatico ogni giorno alle 08:30 e alle 15:00 (ora italiana)." : "Aggiornamenti programmati disattivati."}</p>
    <BankBalances accounts={[...providerAccounts.map(a => ({ ...a, balance: a.balance === null ? null : Number(a.balance) })), ...accounts.filter(a => a.bank === "PayPal")]} />
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5"><Input aria-label="Cerca movimento bancario" placeholder="Cerca causale o conto" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 text-base" /><Select value={bank} onValueChange={setBank}><SelectTrigger aria-label="Banca" className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tutte le banche</SelectItem><SelectItem value="Credem">Credem</SelectItem><SelectItem value="BNL">BNL</SelectItem><SelectItem value="PayPal">PayPal</SelectItem></SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Stato associazione" className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Da associare</SelectItem><SelectItem value="done">Associati</SelectItem><SelectItem value="suspended">In sospeso in banca</SelectItem><SelectItem value="all">Tutti i movimenti</SelectItem></SelectContent></Select><Input aria-label="Movimenti dal" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 text-base" /><Input aria-label="Movimenti al" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 text-base" /></div>
    <div className="grid gap-3 md:grid-cols-2"><Select value={accountFilter} onValueChange={setAccountFilter}><SelectTrigger aria-label="Conto" className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tutti i conti</SelectItem>{visibleAccounts.map(a => <SelectItem key={a.id} value={a.account_ref}>{a.bank} · {a.display_name}</SelectItem>)}</SelectContent></Select><Select value={direction} onValueChange={setDirection}><SelectTrigger aria-label="Entrate e uscite" className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Entrate e uscite</SelectItem><SelectItem value="in">Entrate</SelectItem><SelectItem value="out">Uscite</SelectItem></SelectContent></Select></div>
    {error && <p role="alert" className="text-base text-destructive">{error}</p>}
    {syncNotice && <p role="status" className="border-y border-border py-4 text-base">{syncNotice}</p>}
    {canEdit && <div className="flex flex-wrap items-center gap-3 border-y border-border py-3"><span className="text-lg font-semibold">{checkedIds.length} selezionati</span><Button variant="outline" disabled={!checkedIds.length || busy} onClick={() => setBulkAction("edit")}><Pencil />Modifica selezionati</Button><Button variant="destructive" disabled={!checkedIds.length || busy} onClick={() => setBulkAction("delete")}><Trash2 />Elimina selezionati</Button>{checkedIds.length > 0 && <Button variant="ghost" onClick={() => setCheckedIds([])}>Deseleziona</Button>}</div>}
    {bulkAction && <BankBulkDialog action={bulkAction} rows={transactions.filter(t => checkedIds.includes(t.id))} onClose={() => setBulkAction(null)} onSaved={async () => { setCheckedIds([]); await load(); }} />}
    {loading ? <div className="flex items-center gap-2 py-8"><Loader2 className="h-5 w-5 animate-spin" />Caricamento movimenti…</div> : <div className="overflow-x-auto border-y border-border"><table className="w-full text-base"><thead className="bg-muted"><tr>{canEdit && <th className="px-3 py-3"><Checkbox aria-label="Seleziona tutti i movimenti visibili" checked={filtered.length > 0 && filtered.every(t => checkedIds.includes(t.id) || allocations.some(a => a.transaction_id === t.id))} onCheckedChange={value => setCheckedIds(value ? filtered.filter(t => !allocations.some(a => a.transaction_id === t.id)).slice(0, 500).map(t => t.id) : [])} /></th>}{["Data", "Banca / conto", "Causale", "Entrata", "Uscita", "Residuo", ""].map((h, i) => <th key={i} className="px-3 py-3 text-left font-semibold">{h}</th>)}</tr></thead><tbody>{filtered.map((t) => { const remainder = bankRemaining(t, allocations); return <tr key={t.id} className="border-t border-border">{canEdit && <td className="px-3 py-4"><Checkbox aria-label={`Seleziona movimento ${t.description}`} disabled={allocations.some(a => a.transaction_id === t.id)} checked={checkedIds.includes(t.id)} onCheckedChange={value => setCheckedIds(prev => value ? [...prev, t.id].slice(0, 500) : prev.filter(id => id !== t.id))} /></td>}<td className="whitespace-nowrap px-3 py-4">{t.booking_date.split("-").reverse().join("/")}</td><td className="px-3 py-4"><div className="font-semibold">{t.bank}</div>{accounts.find(a => a.id === t.account_id)?.display_name ?? t.account_ref}{t.status === "PDNG" && <div className="text-base text-muted-foreground">In sospeso in banca</div>}</td><td className="min-w-48 max-w-lg break-words px-3 py-4">{t.description}</td><td className="whitespace-nowrap px-3 py-4 font-mono">{t.amount > 0 ? eur(t.amount) : "—"}</td><td className="whitespace-nowrap px-3 py-4 font-mono">{t.amount < 0 ? eur(Math.abs(t.amount)) : "—"}</td><td className="whitespace-nowrap px-3 py-4 font-mono">{eur(remainder)}</td><td className="px-3 py-4"><Button variant="outline" disabled={t.status === "PDNG"} onClick={() => void openTransaction(t)}>{remainder === 0 ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}{remainder === 0 ? "Associato" : "Associa"}</Button></td></tr>; })}</tbody></table>{filtered.length === 0 && <p className="py-10 text-center text-lg text-muted-foreground">Nessun movimento {status === "pending" ? "da associare" : "presente"}</p>}</div>}
    <Dialog open={!!active} onOpenChange={(open) => { if (!open && !busy) setActive(null); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle className="text-2xl">Movimento {active?.bank}</DialogTitle><DialogDescription className="text-base">{active?.booking_date} · {active?.description}</DialogDescription></DialogHeader>{active && <>
      <div className="flex justify-between gap-3 text-lg font-semibold"><span>{active.amount > 0 ? "Entrata" : "Uscita"}: {eur(Math.abs(active.amount))}</span><span>Residuo: {eur(bankRemaining(active, allocations))}</span></div>
      {allocations.filter((a) => a.transaction_id === active.id).map((a) => <div key={a.id} className="border-b border-border py-2 text-base">{a.competence_id ? "Associato a competenza" : "Registrato direttamente in cassa"} · {eur(a.amount)} · {a.created_at.slice(0, 10)}</div>)}
      {active.status !== "PDNG" && bankRemaining(active, allocations) > 0 && canEdit && <>
        <div className="flex flex-wrap gap-2"><Button variant={mode === "match" ? "default" : "outline"} onClick={() => setMode("match")}>Associa a competenza</Button><Button variant={mode === "direct" ? "default" : "outline"} onClick={() => setMode("direct")}>Inserisci direttamente in cassa</Button></div>
        {mode === "match" ? <div className="space-y-3"><Input aria-label="Cerca competenza" placeholder="Cerca causale, categoria o fattura" value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} className="h-11 text-base" />{candidateLoading ? <p>Caricamento competenze…</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{candidates.filter((m) => `${m.description} ${m.category} ${m.invoiceNumber ?? ""}`.toLowerCase().includes(candidateSearch.toLowerCase())).map((m) => <Button key={m.id} variant={selectedId === m.id ? "default" : "outline"} className="h-auto w-full justify-between gap-3 whitespace-normal py-3 text-left text-base" onClick={() => { setSelectedId(m.id); setAmount(String(Math.min(competenceRemaining(m), bankRemaining(active, allocations)))); }}><span>{m.description}<span className="block">{m.date.split("-").reverse().join("/")} · Fatt. {m.invoiceNumber || "—"}</span></span><span className="shrink-0">{eur(competenceRemaining(m))}</span></Button>)}{candidates.length === 0 && <p className="text-base text-muted-foreground">Nessuna voce di competenza disponibile.</p>}</div>}</div> : <div className="grid gap-3"><Label htmlFor="bank-cash-description" className="text-base">Causale</Label><Input id="bank-cash-description" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value.toLocaleUpperCase("it-IT"))} className="h-11 text-base" /><Label htmlFor="bank-cash-category" className="text-base">Categoria</Label><Input id="bank-cash-category" value={category} maxLength={200} onChange={(e) => setCategory(e.target.value.toLocaleUpperCase("it-IT"))} className="h-11 text-base" /></div>}
        <div className="space-y-2"><Label htmlFor="bank-allocation-amount" className="text-base">Importo da portare in cassa</Label><Input id="bank-allocation-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-lg" />{selected && mode === "match" && <p className="text-base">Resterà in competenza: {eur(Math.max(0, competenceRemaining(selected) - (parseBankAmount(amount) || 0)))}</p>}</div>
        {saving && <p className="text-base text-muted-foreground">Attendi il salvataggio della contabilità prima di confermare.</p>}
        <Button disabled={busy || saving || candidateLoading || (mode === "match" && !selectedId)} onClick={() => void confirm()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Conferma associazione</Button>
      </>}
    </>}</DialogContent></Dialog>
    <Dialog open={importOpen} onOpenChange={(open) => { if (!busy) setImportOpen(open); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle className="text-2xl">Importa estratto conto</DialogTitle><DialogDescription className="text-base">CSV o Excel · importi in euro</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label htmlFor="bank-import-name" className="text-base">Banca</Label><select id="bank-import-name" className={selectClass} value={importBank} onChange={(e) => setImportBank(e.target.value as "Credem" | "BNL" | "PayPal")}><option>Credem</option><option>BNL</option><option>PayPal</option></select></div><div className="space-y-1"><Label htmlFor="bank-account-name" className="text-base">Nome conto</Label><select aria-label="Conto per importazione" className={selectClass} value={accounts.some(a => a.bank === importBank && a.account_ref === accountRef) ? accountRef : "new"} onChange={e => setAccountRef(e.target.value === "new" ? "" : e.target.value)}><option value="new">Nuovo conto manuale</option>{visibleAccounts.filter(a => a.bank === importBank).map(a => <option key={a.id} value={a.account_ref}>{a.display_name} {a.iban_last4 ? `•••• ${a.iban_last4}` : ""}</option>)}</select><Input id="bank-account-name" disabled={accounts.some(a => a.bank === importBank && a.account_ref === accountRef)} placeholder="CONTO AZIENDALE" maxLength={100} value={accountRef} onChange={(e) => setAccountRef(e.target.value.toLocaleUpperCase("it-IT"))} className="h-11 text-base" /></div></div><Input aria-label="File estratto conto" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file); }} className="h-12 text-base" />{sheetRows.length > 0 && <><p className="text-base font-semibold">{fileName} · {sheetRows.length} movimenti</p><Select value={splitAmounts ? "split" : "signed"} onValueChange={(v) => setSplitAmounts(v === "split")}><SelectTrigger aria-label="Formato importi" className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="signed">Importo unico: + entrate, − uscite</SelectItem><SelectItem value="split">Colonne separate entrate / uscite</SelectItem></SelectContent></Select><div className="grid gap-3 md:grid-cols-2">{mappingSelect("date", "Data contabile")}{mappingSelect("description", "Causale")}{splitAmounts ? <>{mappingSelect("incoming", "Entrate")}{mappingSelect("outgoing", "Uscite")}</> : mappingSelect("amount", "Importo con segno")}{mappingSelect("id", "Riferimento univoco bancario", true)}</div>{!mapping.id && <p role="alert" className="text-base text-destructive">Senza riferimento univoco, estratti sovrapposti con movimenti identici potrebbero non essere distinguibili. Controlla i movimenti prima di associarli.</p>}<Button disabled={busy} onClick={() => void importRows()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Importa {sheetRows.length} movimenti</Button></>}</DialogContent></Dialog>
    {logs.length > 0 && <section aria-label="Ultimi aggiornamenti" className="space-y-2 border-t border-border pt-4"><h3 className="text-xl font-semibold">Ultimi aggiornamenti</h3>{logs.map(log => <p key={log.id} className={`text-base ${log.outcome === "error" ? "text-destructive" : "text-muted-foreground"}`}>{new Date(log.created_at).toLocaleString("it-IT")} · {log.bank} · {log.message}</p>)}</section>}
  </section>;
}