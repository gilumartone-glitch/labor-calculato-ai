import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Plus, X, Send, Pencil, Loader2, Check, History, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CommessaPriorita, CommessaReparto } from "@/components/flow/types";
import { ProdDept, ProdPriority, SUB_DEPT_SUFFIX, PRIORITY_LABEL } from "@/lib/produzione/types";
import { nextOrderCode, subCode, logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";
import { inferProdDeptsFromSnapshot } from "@/lib/produzione/snapshot";

/**
 * Tab persistenti cloud per la sezione Progettazione.
 * - Ogni tab è un record in `design_drafts` per l'utente loggato.
 * - Lo stato corrente del preventivo vive in localStorage `STATE_KEY`.
 *   Cambiando tab si serializza lo stato corrente nella tab attiva e si carica quello della nuova.
 * - "Invia al Flow" crea una commessa con lo snapshot e chiude la tab.
 */

const STATE_KEY = "officina:state";
const ACTIVE_DRAFT_KEY = "officina:active-draft";
const VERSION_INTERVAL_MS = 5 * 60 * 1000; // snapshot ogni 5 minuti se ci sono modifiche

type DraftVersion = {
  id: string;
  draft_id: string;
  name: string;
  snapshot: Record<string, unknown>;
  created_at: string;
};

const REPARTO_TO_PROD: Record<CommessaReparto, ProdDept> = {
  tappezzeria: "tappezzeria",
  stampa: "stampa",
  falegnameria: "taglio",
  amministrazione: "altro",
  logistica: "altro",
  generale: "altro",
};
const PRIO_TO_PROD: Record<CommessaPriorita, ProdPriority> = {
  bassa: "normale",
  media: "normale",
  alta: "urgente",
};

type Draft = {
  id: string;
  name: string;
  ordine: number;
  active: boolean;
  snapshot: Record<string, unknown>;
};

const CALC_DEPTS = [
  { key: "stampa", label: "Laboratorio" },
  { key: "tappezzeria", label: "Tappezzeria" },
  { key: "falegnameria", label: "Falegnameria" },
] as const;

const hasDeptContent = (state: any) =>
  (state?.pieces?.length ?? 0) > 0 ||
  (state?.materials?.length ?? 0) > 0 ||
  (state?.operations?.length ?? 0) > 0 ||
  (state?.perimeters?.length ?? 0) > 0 ||
  (state?.transports?.length ?? 0) > 0;

const snapshotForProduction = async (snap: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const rawDepartments = (snap as any).departments;
  if (Array.isArray(rawDepartments)) return snap;
  if (!rawDepartments || typeof rawDepartments !== "object") return snap;

  const { data: catalogRows } = await supabase.from("catalogs").select("dept, data");
  const catalogs = new Map((catalogRows ?? []).map((row: any) => [row.dept, row.data]));
  const departments = CALC_DEPTS
    .map(({ key, label }) => ({
      key,
      label,
      totals: { materials: 0, operations: 0, perimeters: 0, pieces: 0, transports: 0, total: 0 },
      state: rawDepartments[key],
      catalog: catalogs.get(key),
      customerType: key === "stampa" ? (snap as any).customerType : "dealer",
    }))
    .filter((dept) => hasDeptContent(dept.state));

  return {
    source: "summary",
    jobName: (snap as any).jobName ?? "Progetto",
    quantity: (snap as any).quantity ?? 1,
    margin: (snap as any).margin ?? 0,
    vat: (snap as any).vat ?? 22,
    applyVat: (snap as any).applyVat ?? false,
    customerType: (snap as any).customerType,
    departments,
    designState: snap,
  };
};

const readLocalState = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeLocalState = (snap: Record<string, unknown>) => {
  try {
    if (snap && Object.keys(snap).length > 0) {
      localStorage.setItem(STATE_KEY, JSON.stringify(snap));
    } else {
      localStorage.removeItem(STATE_KEY);
    }
  } catch {
    /* ignore */
  }
};

export const DraftTabsBar = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedDraftParam = searchParams.get("draft");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Send-to-flow dialog
  const [sendOpen, setSendOpen] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendTitolo, setSendTitolo] = useState("");
  const [sendCliente, setSendCliente] = useState("");
  const [sendImporto, setSendImporto] = useState<number>(0);
  const [sendReparto, setSendReparto] = useState<CommessaReparto>("tappezzeria");
  const [sendPriorita, setSendPriorita] = useState<CommessaPriorita>("media");
  const [sendScadenza, setSendScadenza] = useState("");
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  // History dialog
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const lastVersionSnapRef = useRef<string>("");

  // Carica drafts iniziali e migra eventuale stato corrente
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("design_drafts")
        .select("*")
        .eq("user_id", user.id)
        .order("ordine", { ascending: true });
      if (error) {
        toast.error("Errore caricamento bozze: " + error.message);
        setLoading(false);
        return;
      }
      if (cancelled) return;
      const list = (data ?? []) as Draft[];
      const lastActive = localStorage.getItem(ACTIVE_DRAFT_KEY);
      const requestedDraft = requestedDraftParam;
      const currentLocal = readLocalState();

      if (list.length === 0) {
        // Prima volta: se esiste stato locale lo migro come Progetto 1
        const initialSnap = currentLocal && Object.keys(currentLocal).length > 0 ? currentLocal : {};
        const { data: created, error: cErr } = await supabase
          .from("design_drafts")
          .insert({
            user_id: user.id,
            name: "Progetto 1",
            snapshot: initialSnap as never,
            ordine: 0,
            active: true,
          })
          .select()
          .single();
        if (cErr || !created) {
          toast.error("Errore creazione prima bozza");
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setDrafts([created as Draft]);
        setActiveId(created.id);
        localStorage.setItem(ACTIVE_DRAFT_KEY, created.id);
        writeLocalState(initialSnap);
        setLoading(false);
        return;
      }

      // Determina la tab attiva: ultima salvata localmente, oppure flag DB, oppure prima
      const wantId = requestedDraft && list.some((d) => d.id === requestedDraft) ? requestedDraft
        : lastActive && list.some((d) => d.id === lastActive) ? lastActive
        : (list.find((d) => d.active)?.id ?? list[0].id);
      const activeDraft = list.find((d) => d.id === wantId)!;

      // Migra eventuale stato locale "orfano" non mappato a nessuna draft
      // Se lo stato locale è ≠ snapshot della draft attiva, lo persisto nella draft attiva
      // (così non perdiamo i dati dell'utente che era in piena modifica).
      const localKeys = Object.keys(currentLocal || {});
      const draftKeys = Object.keys(activeDraft.snapshot || {});
      const localHasContent = localKeys.length > 0;
      const sameSnapshot = JSON.stringify(currentLocal) === JSON.stringify(activeDraft.snapshot);
      if (localHasContent && !sameSnapshot && draftKeys.length === 0) {
        // Draft attiva è vuota ma c'è stato locale: salvo nella draft attiva
        await supabase
          .from("design_drafts")
          .update({ snapshot: currentLocal as never })
          .eq("id", activeDraft.id);
        activeDraft.snapshot = currentLocal;
      }
      writeLocalState(activeDraft.snapshot);
      setDrafts(list);
      setActiveId(activeDraft.id);
      localStorage.setItem(ACTIVE_DRAFT_KEY, activeDraft.id);
      if (requestedDraft && requestedDraft === activeDraft.id) {
        window.location.replace(window.location.pathname);
        return;
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, requestedDraftParam]);

  // Auto-save draft attiva quando lo stato locale cambia
  useEffect(() => {
    if (!activeId || !user) return;
    let timer: number | null = null;
    const persist = async () => {
      const snap = readLocalState();
      await supabase
        .from("design_drafts")
        .update({ snapshot: snap as never })
        .eq("id", activeId)
        .eq("user_id", user.id);
    };
    const onUpdate = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(persist, 800);
    };
    // Salva su cambi localStorage interni alla pagina e su cambio tab
    window.addEventListener("storage", onUpdate);
    const interval = window.setInterval(onUpdate, 4000); // safety net
    return () => {
      window.removeEventListener("storage", onUpdate);
      window.clearInterval(interval);
      if (timer) {
        window.clearTimeout(timer);
        // Persistenza finale
        void persist();
      }
    };
  }, [activeId, user]);

  // Auto-versioning: ogni VERSION_INTERVAL_MS controlla se lo snapshot è cambiato
  // rispetto all'ultima versione e in tal caso ne salva una nuova.
  useEffect(() => {
    if (!activeId || !user) return;
    let cancelled = false;
    const active = drafts.find((d) => d.id === activeId);
    const draftName = active?.name ?? "Progetto";

    // Inizializza il riferimento all'ultima versione conosciuta
    (async () => {
      const { data } = await supabase
        .from("design_draft_versions")
        .select("snapshot")
        .eq("draft_id", activeId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled) {
        const last = data?.[0]?.snapshot;
        lastVersionSnapRef.current = last ? JSON.stringify(last) : "";
      }
    })();

    const tick = async () => {
      const snap = readLocalState();
      if (!snap || Object.keys(snap).length === 0) return;
      const serialized = JSON.stringify(snap);
      if (serialized === lastVersionSnapRef.current) return;
      const { error } = await supabase.from("design_draft_versions").insert({
        draft_id: activeId,
        user_id: user.id,
        name: draftName,
        snapshot: snap as never,
      });
      if (!error) lastVersionSnapRef.current = serialized;
    };
    const handle = window.setInterval(tick, VERSION_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [activeId, user, drafts]);

  const openHistory = async () => {
    if (!activeId || !user) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from("design_draft_versions")
      .select("*")
      .eq("draft_id", activeId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast.error("Errore caricamento storico: " + error.message);
    } else {
      setVersions((data ?? []) as DraftVersion[]);
    }
    setHistoryLoading(false);
  };

  const restoreVersion = async (v: DraftVersion) => {
    if (!activeId || !user) return;
    if (!window.confirm(`Ripristinare la versione del ${new Date(v.created_at).toLocaleString("it-IT")}?\nLo stato attuale verrà salvato come nuova versione.`)) return;
    // Salva versione corrente prima di sovrascrivere
    const current = readLocalState();
    if (current && Object.keys(current).length > 0) {
      await supabase.from("design_draft_versions").insert({
        draft_id: activeId,
        user_id: user.id,
        name: drafts.find((d) => d.id === activeId)?.name ?? "Progetto",
        snapshot: current as never,
      });
    }
    // Applica versione selezionata
    await supabase
      .from("design_drafts")
      .update({ snapshot: v.snapshot as never })
      .eq("id", activeId);
    writeLocalState(v.snapshot ?? {});
    lastVersionSnapRef.current = JSON.stringify(v.snapshot ?? {});
    toast.success("Versione ripristinata");
    setHistoryOpen(false);
    window.location.reload();
  };

  const deleteVersion = async (id: string) => {
    if (!window.confirm("Eliminare questa versione dallo storico?")) return;
    const { error } = await supabase.from("design_draft_versions").delete().eq("id", id);
    if (error) {
      toast.error("Errore: " + error.message);
      return;
    }
    setVersions((prev) => prev.filter((x) => x.id !== id));
  };

  const switchTo = async (id: string) => {
    if (!user || id === activeId) return;
    // 1) Salva lo stato corrente nella tab attiva
    if (activeId) {
      const currentSnap = readLocalState();
      await supabase
        .from("design_drafts")
        .update({ snapshot: currentSnap as never, active: false })
        .eq("id", activeId);
    }
    // 2) Carica la nuova tab
    const { data: target, error } = await supabase
      .from("design_drafts")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !target) {
      toast.error("Errore apertura scheda");
      return;
    }
    await supabase.from("design_drafts").update({ active: true }).eq("id", id);
    writeLocalState((target as Draft).snapshot ?? {});
    setActiveId(id);
    localStorage.setItem(ACTIVE_DRAFT_KEY, id);
    // Aggiorna lista locale
    setDrafts((prev) => prev.map((d) => ({ ...d, active: d.id === id, snapshot: d.id === id ? (target as Draft).snapshot : d.snapshot })));
    // Forza ricarica per rimontare i componenti che leggono STATE_KEY a mount
    window.location.reload();
  };

  const addDraft = async () => {
    if (!user) return;
    // Salva stato corrente nella tab attiva
    if (activeId) {
      const currentSnap = readLocalState();
      await supabase
        .from("design_drafts")
        .update({ snapshot: currentSnap as never, active: false })
        .eq("id", activeId);
    }
    const ordine = drafts.length;
    const name = `Progetto ${ordine + 1}`;
    const { data, error } = await supabase
      .from("design_drafts")
      .insert({ user_id: user.id, name, snapshot: {} as never, ordine, active: true })
      .select()
      .single();
    if (error || !data) {
      toast.error("Errore creazione scheda");
      return;
    }
    writeLocalState({});
    setDrafts((prev) => [...prev.map((d) => ({ ...d, active: false })), data as Draft]);
    setActiveId(data.id);
    localStorage.setItem(ACTIVE_DRAFT_KEY, data.id);
    window.location.reload();
  };

  const closeDraft = async (id: string) => {
    if (!user) return;
    if (drafts.length <= 1) {
      toast.info("Almeno una scheda deve restare aperta");
      return;
    }
    if (!window.confirm("Chiudere questa scheda? I dati verranno eliminati.")) return;
    await supabase.from("design_drafts").delete().eq("id", id);
    const remaining = drafts.filter((d) => d.id !== id);
    setDrafts(remaining);
    if (id === activeId) {
      const next = remaining[0];
      writeLocalState(next.snapshot ?? {});
      setActiveId(next.id);
      localStorage.setItem(ACTIVE_DRAFT_KEY, next.id);
      await supabase.from("design_drafts").update({ active: true }).eq("id", next.id);
      window.location.reload();
    }
  };

  const startRename = (d: Draft) => {
    setRenamingId(d.id);
    setRenameValue(d.name);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const name = renameValue.trim() || "Progetto";
    await supabase.from("design_drafts").update({ name }).eq("id", renamingId);
    setDrafts((prev) => prev.map((d) => (d.id === renamingId ? { ...d, name } : d)));
    setRenamingId(null);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
  };

  // Importo predefinito = totale snapshot se presente
  const computeDefaultAmount = (snap: Record<string, unknown>): number => {
    try {
      const s: any = snap;
      const total =
        s?.total ?? s?.totals?.total ??
        (s?.departments ? s.departments.reduce((acc: number, d: any) => acc + (d?.totals?.total ?? 0), 0) : 0);
      return Number(total) || 0;
    } catch { return 0; }
  };

  const openSendDialog = () => {
    const active = drafts.find((d) => d.id === activeId);
    if (!active) return;
    const snap = readLocalState();
    setSendTitolo(active.name || "Progetto");
    setSendCliente("");
    setSendImporto(computeDefaultAmount(snap));
    setSendReparto("tappezzeria");
    setSendPriorita("media");
    setSendScadenza("");
    setSendOpen(true);
    setTimeout(() => sendBtnRef.current?.focus(), 100);
  };

  const submitSend = async () => {
    if (!user || !activeId) return;
    if (!sendTitolo.trim()) { toast.error("Inserisci un titolo"); return; }
    const snap = readLocalState();
    setSendBusy(true);
    try {
      const productionSnapshot = await snapshotForProduction(snap);
      // 1) Crea commessa nel Flow
      const { error } = await supabase.from("commesse").insert({
        titolo: sendTitolo.trim(),
        cliente: sendCliente.trim() || null,
        importo: sendImporto || null,
        reparto: sendReparto,
        priorita: sendPriorita,
        stato: "preventivo",
        tipo: "commessa",
        data_scadenza: sendScadenza || null,
        snapshot: productionSnapshot as never,
        created_by: user.id,
      });
      if (error) throw error;

      // 2) Production order (best-effort)
      let prodCode: string | null = null;
      let prodId: string | null = null;
      try {
        prodCode = await nextOrderCode();
        const prodPrio = PRIO_TO_PROD[sendPriorita];
        const fallbackDept = REPARTO_TO_PROD[sendReparto];
        const inferred = inferProdDeptsFromSnapshot(productionSnapshot as any);
        const depts: ProdDept[] = inferred.length > 0 ? inferred : [fallbackDept];
        const clienteName = (sendCliente.trim() || sendTitolo.trim()).slice(0, 200);
        const { data: pord, error: e1 } = await supabase.from("production_orders").insert({
          code: prodCode,
          cliente: clienteName,
          data: sendScadenza || new Date().toISOString().slice(0, 10),
          note: `Da progettazione: ${sendTitolo.trim()}`,
          priorita: prodPrio,
          delivery: "spedizione",
          status: "in_corso",
          attachments: [],
          nesting_included: inferred.length > 0,
          created_by: user.id,
          snapshot: productionSnapshot as never,
        }).select().single();
        if (e1) throw e1;
        prodId = pord.id;
        // Subs in PARALLELO: ogni reparto chiude il proprio cerchio in modo indipendente.
        const inserted: { id: string }[] = [];
        for (let i = 0; i < depts.length; i++) {
          const d = depts[i];
          const { data: sub, error: eSub } = await supabase
            .from("production_sub_orders")
            .insert({
              order_id: pord.id,
              code: subCode(prodCode, SUB_DEPT_SUFFIX[d], i + 1),
              dept: d,
              ordine: i,
              note: sendTitolo.trim() || null,
              files: [],
              depends_on: null,
            })
            .select("id")
            .single();
          if (eSub) throw eSub;
          inserted.push({ id: sub.id });
        }
        await logAction({
          action: "FLOW_LANCIATO",
          entity_type: "order",
          entity_id: pord.id,
          detail: `Ordine ${prodCode} da Progettazione per ${clienteName} (${depts.join(" → ")})`,
          new_state: { code: prodCode, depts, priorita: prodPrio, from: "progettazione" },
        });
        const writers = await getProduzioneWriters();
        const targets = writers.filter((u) => u !== user.id);
        if (targets.length > 0) {
          await notify({
            userIds: targets,
            type: "ordine_creato",
            message: `Nuovo ordine ${prodCode} per ${clienteName} — ${PRIORITY_LABEL[prodPrio]}`,
            order_id: pord.id,
            link: `/produzione/board?order=${pord.id}`,
            is_urgent: prodPrio !== "normale",
          });
        }
      } catch (prodErr) {
        console.error("Errore production order:", prodErr);
        toast.warning("Commessa nel Flow creata, ma ordine Produzione fallito.");
      }

      // 3) Reset UI: chiude la tab corrente
      await supabase.from("design_drafts").delete().eq("id", activeId);
      const remaining = drafts.filter((d) => d.id !== activeId);
      writeLocalState({});

      if (remaining.length === 0) {
        // Crea nuova tab vuota
        const { data: created } = await supabase
          .from("design_drafts")
          .insert({ user_id: user.id, name: "Progetto 1", snapshot: {} as never, ordine: 0, active: true })
          .select()
          .single();
        if (created) {
          setDrafts([created as Draft]);
          setActiveId(created.id);
          localStorage.setItem(ACTIVE_DRAFT_KEY, created.id);
        }
      } else {
        const next = remaining[0];
        await supabase.from("design_drafts").update({ active: true }).eq("id", next.id);
        setDrafts(remaining);
        setActiveId(next.id);
        localStorage.setItem(ACTIVE_DRAFT_KEY, next.id);
        writeLocalState(next.snapshot ?? {});
      }

      toast.success(prodCode ? `Inviato al Flow + Produzione ${prodCode}` : "Inviato al Flow", {
        action: {
          label: prodId ? "Apri Produzione" : "Apri Flow",
          onClick: () => navigate(prodId ? `/produzione/board?order=${prodId}` : "/flow"),
        },
      });
      setSendOpen(false);
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error("Errore invio: " + msg);
    } finally {
      setSendBusy(false);
    }
  };

  // Conferma con Invio nel dialog
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !sendBusy) {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      // Evita doppio invio se sta scrivendo in textarea
      if (tag !== "textarea") {
        e.preventDefault();
        submitSend();
      }
    }
  };

  if (!user) return null;

  return (
    <>
      <div className="border-b-2 border-ink/20 bg-paper">
        <div className="container py-2 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground mr-2">
            // Schede progetto
          </span>

          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {drafts.map((d) => {
                const isActive = d.id === activeId;
                const isRenaming = renamingId === d.id;
                return (
                  <div
                    key={d.id}
                    className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-sm border-2 transition-colors ${
                      isActive
                        ? "bg-ink text-paper border-ink"
                        : "bg-background border-ink/20 text-ink/70 hover:border-ink/50"
                    }`}
                  >
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={onRenameKey}
                        className="bg-transparent border-b border-current text-xs font-semibold px-1 w-32 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => switchTo(d.id)}
                        onDoubleClick={() => startRename(d)}
                        title="Doppio click per rinominare"
                        className="text-xs font-semibold px-1"
                      >
                        {d.name}
                      </button>
                    )}
                    {!isRenaming && (
                      <button
                        type="button"
                        onClick={() => startRename(d)}
                        title="Rinomina"
                        className="w-5 h-5 grid place-items-center opacity-60 hover:opacity-100"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => closeDraft(d.id)}
                      title="Chiudi scheda"
                      className="w-5 h-5 grid place-items-center opacity-60 hover:opacity-100 hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addDraft}
                title="Nuova scheda"
                className="inline-flex items-center gap-1 px-2 py-1 border-2 border-dashed border-ink/30 rounded-sm text-[11px] uppercase tracking-wider font-bold text-ink/60 hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" /> Nuovo
              </button>
            </div>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={openHistory}
            disabled={!activeId || loading}
            className="inline-flex items-center gap-2 px-3 py-2 border-2 border-ink/20 rounded-sm text-xs uppercase tracking-wider font-bold text-ink/70 hover:border-ink hover:text-ink disabled:opacity-40 transition-all"
            title="Storico modifiche del progetto attivo"
          >
            <History className="w-3.5 h-3.5" />
            Storico
          </button>

          <button
            type="button"
            onClick={openSendDialog}
            disabled={!activeId || loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold shadow-md hover:bg-primary/90 disabled:opacity-40 transition-all"
            title="Invia il progetto attivo al Flow (Invio per confermare)"
          >
            <Send className="w-3.5 h-3.5" />
            Invia al Flow
          </button>
        </div>
      </div>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-lg" onKeyDown={onDialogKeyDown}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Invia al Flow</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="d-titolo">Titolo</Label>
              <Input id="d-titolo" value={sendTitolo} onChange={(e) => setSendTitolo(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="d-cliente">Cliente</Label>
                <Input id="d-cliente" value={sendCliente} onChange={(e) => setSendCliente(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="d-importo">Importo €</Label>
                <Input
                  id="d-importo"
                  type="number"
                  value={sendImporto === 0 ? "" : sendImporto}
                  onChange={(e) => setSendImporto(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Reparto</Label>
                <Select value={sendReparto} onValueChange={(v) => setSendReparto(v as CommessaReparto)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stampa">Laboratorio</SelectItem>
                    <SelectItem value="tappezzeria">Tappezzeria</SelectItem>
                    <SelectItem value="falegnameria">Falegnameria</SelectItem>
                    <SelectItem value="generale">Generale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priorità</Label>
                <Select value={sendPriorita} onValueChange={(v) => setSendPriorita(v as CommessaPriorita)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bassa">Bassa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="d-scadenza">Scadenza</Label>
                <Input id="d-scadenza" type="date" value={sendScadenza} onChange={(e) => setSendScadenza(e.target.value)} />
              </div>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground border-t border-dashed border-ink/20 pt-2">
              Premi <span className="font-bold">Invio</span> per confermare. La scheda di Progettazione verrà chiusa.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sendBusy}>Annulla</Button>
            <Button ref={sendBtnRef} onClick={submitSend} disabled={sendBusy}>
              {sendBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Conferma invio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl flex items-center gap-2">
              <History className="w-5 h-5" /> Storico modifiche
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 max-h-[60vh] overflow-y-auto">
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nessuna versione salvata.<br />
                <span className="text-[11px] font-mono">Le versioni vengono create automaticamente ogni 5 minuti se ci sono modifiche.</span>
              </div>
            ) : (
              <ul className="divide-y divide-ink/10">
                {versions.map((v) => (
                  <li key={v.id} className="py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{v.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {new Date(v.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => restoreVersion(v)} title="Ripristina questa versione">
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Ripristina
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteVersion(v.id)} title="Elimina">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};