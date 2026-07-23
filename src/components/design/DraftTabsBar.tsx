import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Plus, X, Send, Pencil, Loader2, Check, History, RotateCcw, Trash2, Users2 } from "lucide-react";
import { ShareDraftDialog } from "./ShareDraftDialog";
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
import { ProdDept, ProdPriority, SUB_DEPT_SUFFIX, PRIORITY_LABEL, DEPT_LABEL, toMacroDept } from "@/lib/produzione/types";
import {
  nextOrderCode,
  subCode,
  logAction,
  notify,
  getProduzioneWriters,
  throwFlowError,
  describeFlowLaunchError,
  readFlowLaunchDebug,
} from "@/lib/produzione/helpers";
import { inferProdDeptsFromSnapshot } from "@/lib/produzione/snapshot";
import { extractMaterialsFromSnapshot } from "@/lib/produzione/snapshot-materials";
import { ConfirmToWarehouseDialog, WarehouseConfirmData } from "@/components/produzione/ConfirmToWarehouseDialog";
import { CreateCommessaButton } from "@/components/calculator/CreateCommessaButton";

/**
 * Tab persistenti cloud per la sezione Progettazione.
 * - Ogni tab è un record in `design_drafts` per l'utente loggato.
 * - Lo stato corrente del preventivo vive in localStorage `STATE_KEY`.
 *   Cambiando tab si serializza lo stato corrente nella tab attiva e si carica quello della nuova.
 * - "Invia al Flow" crea una commessa con lo snapshot e chiude la tab.
 */

const STATE_KEY = "officina:state";
const ACTIVE_DRAFT_KEY = "officina:active-draft";
const ACTIVE_DRAFT_NAME_KEY = "officina:active-draft-name";
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
  falegnameria: "falegnameria",
  amministrazione: "altro",
  acquisti: "acquisti",
  logistica: "altro",
  generale: "altro",
  progettazione: "progettazione",
  lavorazione: "laboratorio",
  vendite: "vendite",
  montaggi: "altro",
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
  user_id: string;
};

type ShareRow = {
  id: string;
  draft_id: string;
  shared_with: string;
  created_by: string;
};

const CALC_DEPTS = [
  { key: "stampa", label: "Laboratorio" },
  { key: "tappezzeria", label: "Tappezzeria" },
  { key: "falegnameria", label: "Falegnameria" },
] as const;

/** Restituisce le macro-categorie effettivamente attive in un progetto.
 *  - Mappa i reparti tecnici inferiti dallo snapshot sulle 4 macro.
 *  - Verifica `montaggi` leggendo il modulo Montaggi salvato per la draft attiva. */
const deriveAvailableMacros = (depts: ProdDept[], draftId: string | null): ProdDept[] => {
  const macros = new Set<ProdDept>();
  for (const d of depts) macros.add(toMacroDept(d));
  if (draftId) {
    try {
      const raw = localStorage.getItem(`officina:montaggi-module:v2:${draftId}`);
      if (raw) {
        const p = JSON.parse(raw);
        const hasContent = (p?.labor?.length ?? 0) > 0
          || (p?.materials?.length ?? 0) > 0
          || (p?.tools?.length ?? 0) > 0
          || (p?.transports?.length ?? 0) > 0
          || (p?.elements?.length ?? 0) > 0;
        if (hasContent) macros.add("montaggi");
      }
    } catch { /* ignore */ }
  }
  return Array.from(macros);
};

const hasDeptContent = (state: any) =>
  (state?.pieces?.length ?? 0) > 0 ||
  (state?.materials?.length ?? 0) > 0 ||
  (state?.operations?.length ?? 0) > 0 ||
  (state?.perimeters?.length ?? 0) > 0 ||
  (state?.transports?.length ?? 0) > 0;

const SALES_CATEGORY_LABEL: Record<string, string> = {
  stampa: "Stampa (rivendita)",
  tessuti: "Tessuti (rivendita)",
};

type SalesCartLine = {
  id?: string; materialId?: string; qty?: number;
  name?: string; variant?: string; unit?: string;
  priceSell?: number; pricePurchase?: number; category?: string;
};

const collectSalesItems = (snap: Record<string, unknown>): SalesCartLine[] => {
  const carts = (snap as any)?.salesCarts;
  if (!carts || typeof carts !== "object") return [];
  const out: SalesCartLine[] = [];
  for (const key of Object.keys(carts)) {
    const list = Array.isArray(carts[key]) ? carts[key] : [];
    for (const l of list) {
      if (!l) continue;
      out.push({ ...(l as SalesCartLine), category: (l as any).category || key });
    }
  }
  return out;
};

const buildSalesNote = (items: SalesCartLine[]): string => {
  if (!items.length) return "";
  const lines = items.map((l) => {
    const desc = [l.name, l.variant && `(${l.variant})`].filter(Boolean).join(" ") || "Vendita";
    const qty = Number(l.qty) || 0;
    const sell = (Number(l.priceSell) || 0) * qty;
    const price = sell > 0 ? ` · ${sell.toFixed(2)}€` : "";
    return `• ${desc} — ${qty} ${l.unit || ""}${price}`.trim();
  });
  return `Ordine:\n${lines.join("\n")}`;
};

const snapshotForProduction = async (snap: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const rawDepartments = (snap as any).departments;
  const salesItems = collectSalesItems(snap);
  if (Array.isArray(rawDepartments)) return snap;
  if ((!rawDepartments || typeof rawDepartments !== "object") && salesItems.length === 0) return snap;

  const { data: catalogRows } = await supabase.from("catalogs").select("dept, data");
  const catalogs = new Map((catalogRows ?? []).map((row: any) => [row.dept, row.data]));
  const departments = CALC_DEPTS
    .map(({ key, label }) => ({
      key,
      label,
      totals: { materials: 0, operations: 0, perimeters: 0, pieces: 0, transports: 0, total: 0 },
      state: rawDepartments?.[key],
      catalog: catalogs.get(key),
      customerType: key === "stampa" ? (snap as any).customerType : "dealer",
    }))
    .filter((dept) => hasDeptContent(dept.state));

  if (salesItems.length > 0) {
    const totalSell = salesItems.reduce((s, l) => s + (Number(l.priceSell) || 0) * (Number(l.qty) || 0), 0);
    departments.push({
      key: "magazzino",
      label: "Magazzino · Vendite",
      totals: { materials: totalSell, operations: 0, perimeters: 0, pieces: 0, transports: 0, total: totalSell },
      state: {
        pieces: [],
        materials: salesItems.map((l) => ({
          name: l.name || "Vendita",
          color: l.variant || "",
          height: "",
          quantity: Number(l.qty) || 0,
          unit: l.unit || "pz",
          unitCost: Number(l.priceSell) || 0,
        })),
      } as any,
      catalog: undefined as any,
      customerType: "dealer",
    } as any);
  }

  return {
    source: "summary",
    jobName: (snap as any).jobName ?? "Progetto",
    quantity: (snap as any).quantity ?? 1,
    margin: (snap as any).margin ?? 0,
    vat: (snap as any).vat ?? 22,
    applyVat: (snap as any).applyVat ?? false,
    customerType: (snap as any).customerType,
    departments,
    salesCarts: (snap as any).salesCarts ?? undefined,
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

const writeLocalState = (snap: Record<string, unknown>, draftId?: string | null) => {
  try {
    if (snap && Object.keys(snap).length > 0) {
      localStorage.setItem(STATE_KEY, JSON.stringify(snap));
    } else {
      localStorage.removeItem(STATE_KEY);
    }
    // Restore Montaggi module payload (lives in a per-draft key)
    try {
      const id = draftId ?? localStorage.getItem(ACTIVE_DRAFT_KEY);
      if (id) {
        const key = `officina:montaggi-module:v2:${id}`;
        const ds = (snap as any)?.designState;
        const montaggi = ds && typeof ds === "object" ? (ds as any).montaggi : (snap as any)?.montaggi;
        if (montaggi && typeof montaggi === "object") {
          localStorage.setItem(key, JSON.stringify(montaggi));
        }
      }
    } catch { /* ignora */ }
    const event = () => window.dispatchEvent(new CustomEvent("officina:draft-state-loaded", { detail: snap ?? {} }));
    event();
    window.setTimeout(event, 0);
  } catch {
    /* ignore */
  }
};

export const DraftTabsBar = ({ secondaryRow }: { secondaryRow?: React.ReactNode } = {}) => {
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

  // Confirm-to-warehouse dialog (verifica materiali / acquisti propedeutici)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<null | {
    commessaId: string;
    clienteName: string;
    productionSnapshot: Record<string, unknown>;
    depts: ProdDept[];
    prodPrio: ProdPriority;
    titolo: string;
    scadenza: string;
    inferredFound: boolean;
  }>(null);

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
        // Nessuna scheda: non ne creiamo automaticamente.
        // L'utente userà il pulsante "Nuovo" per crearne una.
        // (Dopo "Invia al Flow" il progetto deve sparire e non riapparire da solo.)
        if (cancelled) return;
        setDrafts([]);
        setActiveId(null);
        localStorage.removeItem(ACTIVE_DRAFT_KEY);
        writeLocalState({});
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
        .eq("id", activeId);
    };
    const onUpdate = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(persist, 800);
    };
    // Salva su cambi localStorage interni alla pagina e su cambio tab
    window.addEventListener("storage", onUpdate);
    window.addEventListener("officina:draft-state-changed", onUpdate);
    return () => {
      window.removeEventListener("storage", onUpdate);
      window.removeEventListener("officina:draft-state-changed", onUpdate);
      if (timer) window.clearTimeout(timer);
    };
  }, [activeId, user]);

  // Cache nome della schedina attiva in localStorage (usato dal dialog "Crea commessa nel Flow")
  useEffect(() => {
    const active = drafts.find((d) => d.id === activeId);
    if (active?.name) localStorage.setItem(ACTIVE_DRAFT_NAME_KEY, active.name);
    else localStorage.removeItem(ACTIVE_DRAFT_NAME_KEY);
  }, [activeId, drafts]);

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
    writeLocalState((target as Draft).snapshot ?? {}, id);
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
    const maxProjectNumber = drafts.reduce((max, d) => {
      const match = d.name.match(/^Progetto\s+(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const name = `Progetto ${maxProjectNumber + 1}`;
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
    const d = drafts.find((x) => x.id === id);
    const isOwner = d?.user_id === user.id;
    const confirmMsg = isOwner
      ? "Chiudere questa scheda? I dati verranno eliminati."
      : "Rimuovere questo progetto condiviso dalle tue schede? Il proprietario e gli altri collaboratori continueranno a vederlo.";
    if (!window.confirm(confirmMsg)) return;
    if (isOwner) {
      await supabase.from("design_drafts").delete().eq("id", id);
    } else {
      // Solo unshare per me
      await supabase.from("design_draft_shares").delete().eq("draft_id", id).eq("shared_with", user.id);
    }
    const remaining = drafts.filter((x) => x.id !== id);
    setDrafts(remaining);
    if (id === activeId) {
      const next = remaining[0];
      writeLocalState(next.snapshot ?? {}, next.id);
      setActiveId(next.id);
      localStorage.setItem(ACTIVE_DRAFT_KEY, next.id);
      await supabase.from("design_drafts").update({ active: true }).eq("id", next.id);
      window.location.reload();
    }
  };

  const startRename = (d: Draft) => {
    setRenamingId(d.id);
    setRenameValue(d.name);
    setTimeout(() => {
      const el = renameInputRef.current;
      if (el) { el.focus(); el.select(); }
    }, 50);
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
    const snap = readLocalState() as any;
    // In caso di scheda nata da una "revisione" produzione, ripristiniamo titolo + cliente originali
    const revTitolo = snap?._revisionTitolo || snap?.revision?.titolo || snap?.jobName;
    const revCliente = snap?._revisionCliente || snap?.revision?.cliente;
    setSendTitolo((revTitolo as string) || active.name || "Progetto");
    setSendCliente((revCliente as string) || "");
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
      const { data: createdCommessa, error } = await supabase.from("commesse").insert({
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
      }).select("id").single();
      if (error) throwFlowError("creazione_commessa", "commesse", error);

      // 2) Prepara payload e apri il dialog di verifica materiali (acquisti propedeutici)
      const prodPrio = PRIO_TO_PROD[sendPriorita];
      const fallbackDept = REPARTO_TO_PROD[sendReparto];
      const inferred = inferProdDeptsFromSnapshot(productionSnapshot as any);
      const depts: ProdDept[] = inferred.length > 0 ? inferred : [fallbackDept];
      const clienteName = (sendCliente.trim() || sendTitolo.trim()).slice(0, 200);
      setPendingPayload({
        commessaId: createdCommessa.id,
        clienteName,
        productionSnapshot,
        depts,
        prodPrio,
        titolo: sendTitolo.trim(),
        scadenza: sendScadenza,
        inferredFound: inferred.length > 0,
      });
      setConfirmOpen(true);
      setSendOpen(false);
    } catch (err) {
      console.error("[DraftTabsBar] errore creazione commessa", err);
      const detail = describeFlowLaunchError(err);
      const debug = await readFlowLaunchDebug();
      toast.error(detail.title, {
        description: `${detail.description} · Permessi utente: ${JSON.stringify(debug)}`,
      });
    } finally {
      setSendBusy(false);
    }
  };

  const onWarehouseConfirm = async (d: WarehouseConfirmData) => {
    if (!user || !activeId || !pendingPayload) return;
    setSendBusy(true);
    let prodCode: string | null = null;
    let prodId: string | null = null;
    try {
      prodCode = await nextOrderCode();
      const { commessaId, clienteName, productionSnapshot, depts, prodPrio, titolo, scadenza, inferredFound } = pendingPayload;
      const flowDepts = Array.from(new Set([d.work_dept, ...depts]));
      const orderId = crypto.randomUUID();
      const orderRow = {
        id: orderId,
        code: prodCode,
        cliente: clienteName,
        data: scadenza || new Date().toISOString().slice(0, 10),
        note: `Da progettazione: ${titolo}`,
        priorita: prodPrio,
        delivery: "spedizione",
        status: "in_corso",
        attachments: [],
        nesting_included: inferredFound,
        created_by: user.id,
        coordinator_id: user.id,
        source_commessa_id: commessaId,
        snapshot: productionSnapshot as never,
        customer_order_ref: d.customer_order_ref,
        production_name: d.production_name || null,
      } as any;
      const { error: e1 } = await supabase.from("production_orders").insert(orderRow);
      if (e1) throwFlowError("creazione_ordine", "production_orders", e1);
      const pord = orderRow as { id: string } & Record<string, unknown>;
      prodId = pord.id;

      // Acquisti subs (propedeutici)
      let firstAcquistiId: string | null = null;
      if (d.missing && d.missing.length > 0 && d.acquisti_assignee_id) {
        const acquistiRows = d.missing.map((m, i) => ({
          order_id: pord.id,
          code: subCode(prodCode!, SUB_DEPT_SUFFIX["acquisti"], i + 1),
          dept: "acquisti" as const,
          ordine: i,
          note: `Da ordinare: ${m.label}${m.detail ? " · " + m.detail : ""} (rif. ${d.customer_order_ref})`,
          supplier_name: m.supplier_name || null,
          material_label: m.label,
          material_qty: m.qty ?? null,
          material_unit: m.unit ?? null,
          material_code: m.code ?? null,
          order_status: "da_ordinare",
          assignee_id: d.acquisti_assignee_id || null,
          files: [],
        }));
        const { data: acquistiSubs, error: ea } = await supabase
          .from("production_sub_orders")
          .insert(acquistiRows as any)
          .select("id");
        if (ea) throwFlowError("creazione_acquisti", "production_sub_orders", ea);
        firstAcquistiId = acquistiSubs?.[0]?.id ?? null;

        await notify({
          userIds: [d.acquisti_assignee_id],
          type: "magazzino_da_preparare",
          message: `Acquisti — ${prodCode}: ${d.missing.length} materiale/i da ordinare per ${clienteName}`,
          order_id: pord.id,
          link: "/produzione/acquisti",
          is_urgent: prodPrio !== "normale",
        });
      }

      // Sub di reparto: bloccati finché acquisti non arrivati
      const baseOrdine = d.missing?.length ?? 0;
      const salesItems = collectSalesItems(
        ((productionSnapshot as any)?.designState as any) ?? (productionSnapshot as any),
      );
      const salesNote = buildSalesNote(salesItems);
      const insertedSubs: { id?: string; dept: ProdDept; assignee: string | null }[] = [];
      for (let i = 0; i < flowDepts.length; i++) {
        const dept = flowDepts[i];
        const subAssignee = toMacroDept(dept) === toMacroDept(d.work_dept) ? d.assignee_id : null;
        const subNote = dept === "magazzino" && salesNote
          ? salesNote
          : (titolo || null);
        const { data: sub, error: eSub } = await supabase.from("production_sub_orders").insert({
          order_id: pord.id,
          code: subCode(prodCode, SUB_DEPT_SUFFIX[dept], i + 1),
          dept,
          ordine: baseOrdine + i,
          note: subNote,
          files: [],
          depends_on: firstAcquistiId,
          assignee_id: subAssignee,
          operator_ids: subAssignee ? [subAssignee] : [],
        } as any).select("id").single();
        if (eSub) throwFlowError("creazione_lavorazione", "production_sub_orders", eSub);
        insertedSubs.push({ id: sub?.id, dept, assignee: subAssignee });
      }

      await logAction({
        action: "FLOW_LANCIATO",
        entity_type: "order",
        entity_id: pord.id,
        detail: `Ordine ${prodCode} da Progettazione per ${clienteName} (${flowDepts.join(" → ")}) — rif. ${d.customer_order_ref}`,
        new_state: { code: prodCode, depts: flowDepts, priorita: prodPrio, from: "progettazione", customer_order_ref: d.customer_order_ref, missing_count: d.missing?.length ?? 0 },
      });

      const writers = await getProduzioneWriters(flowDepts);
      const assignees = insertedSubs.map((s) => s.assignee).filter((x): x is string => !!x);
      const targets = Array.from(new Set([...writers, ...assignees])).filter((u) => u !== user.id);
      if (targets.length > 0) {
        await notify({
          userIds: targets,
          type: "ordine_creato",
          message: d.missing?.length
            ? `Nuovo ordine ${prodCode} per ${clienteName} — in attesa acquisti (${d.missing.length})`
            : `Nuovo ordine ${prodCode} per ${clienteName} — ${PRIORITY_LABEL[prodPrio]}`,
          order_id: pord.id,
          link: `/produzione/board?order=${pord.id}`,
          is_urgent: prodPrio !== "normale",
        });
      }

      for (const s of insertedSubs) {
        if (!s.assignee) continue;
        await notify({
          userIds: [s.assignee],
          type: "ordine_creato",
          message: `Assegnato a te: ${prodCode} · ${DEPT_LABEL[s.dept]} (${clienteName})`,
          order_id: pord.id,
          link: s.id ? `/produzione/board?sub=${s.id}` : `/produzione/board?order=${pord.id}`,
          is_urgent: prodPrio !== "normale",
        });
      }

      // === Auto-pianificazione Montaggi ===
      // Se nel progetto sono state definite squadre/giorni di montaggio,
      // creiamo automaticamente le caselle in calendario (montaggi_planning)
      // per ciascun addetto e notifichiamo gli interessati.
      try {
        const mraw = localStorage.getItem(`officina:montaggi-module:v2:${activeId}`);
        const mproj = mraw ? JSON.parse(mraw) : null;
        const labor: Array<{ workerId?: string; hours?: number }> = mproj?.labor ?? [];
        const startDateStr: string | undefined = mproj?.date;
        const giorni: number = Math.max(1, Math.min(60, Number(mproj?.trasferte?.days ?? 1) || 1));
        const dipIds = Array.from(new Set(labor
          .map((l) => (typeof l.workerId === "string" && l.workerId.startsWith("dip:") ? l.workerId.slice(4) : null))
          .filter((x): x is string => !!x)));
        if (dipIds.length > 0 && startDateStr) {
          const { data: dips } = await supabase
            .from("dipendenti")
            .select("id, nome, profile_id")
            .in("id", dipIds);
          // Genera la sequenza di giorni (escludendo sabato/domenica)
          const dates: string[] = [];
          const cur = new Date(startDateStr);
          if (!Number.isNaN(cur.getTime())) {
            while (dates.length < giorni) {
              const dow = cur.getDay();
              if (dow !== 0 && dow !== 6) dates.push(cur.toISOString().slice(0, 10));
              cur.setDate(cur.getDate() + 1);
              if (dates.length === 0 && cur.getTime() - new Date(startDateStr).getTime() > 1000 * 60 * 60 * 24 * 180) break;
            }
          }
          const cantiere = (mproj?.address?.trim()) || (mproj?.customer?.trim()) || clienteName || prodCode || "Cantiere";
          const hoursPerDay = Math.min(12, Math.max(1, Math.round((labor.reduce((s, l) => s + (Number(l.hours) || 0), 0) / Math.max(1, labor.length)) || 8)));
          const rows: any[] = [];
          for (const d of (dips ?? [])) {
            for (const date of dates) {
              rows.push({
                operator_id: d.profile_id ?? d.id, // profile_id = auth uid per filtraggio MyActivities
                date,
                hours: hoursPerDay,
                commessa_id: null, // sopravvive alla cancellazione del draft
                cantiere_label: cantiere,
                notes: `Auto da Flow · ${prodCode}`,
                reparto: "montaggi",
                created_by: user.id,
              });
            }
          }
          if (rows.length > 0) {
            const { error: pErr } = await supabase.from("montaggi_planning").insert(rows);
            if (pErr) console.error("[montaggi_planning auto]", pErr);
          }
          // Notifica gli addetti con profilo collegato
          const targetUserIds = Array.from(new Set((dips ?? [])
            .map((d) => d.profile_id)
            .filter((x): x is string => !!x && x !== user.id)));
          if (targetUserIds.length > 0 && dates.length > 0) {
            const dateList = dates.map((d) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })).join(", ");
            await notify({
              userIds: targetUserIds,
              type: "chat_messaggio",
              message: `📅 Nuovo cantiere ${cantiere} (${prodCode}) — ${dates.length} giornat${dates.length === 1 ? "a" : "e"} (${hoursPerDay}h): ${dateList}`,
              order_id: pord.id,
              link: "/montaggi",
              is_urgent: prodPrio !== "normale",
            });
          }
          if (rows.length > 0) {
            toast.message(`Calendario montaggi aggiornato: ${rows.length} turn${rows.length === 1 ? "o" : "i"} creat${rows.length === 1 ? "o" : "i"}`);
          }
        }
      } catch (mErr) {
        console.error("[auto-pianificazione montaggi]", mErr);
      }



      // Reset UI: chiude la tab corrente. Se era l'ultima, NON ne creiamo una
      // nuova automaticamente: il progetto deve "sparire" dalla Progettazione una
      // volta inviato al Flow. Tornerà a comparire solo se la Produzione lo
      // rimanda in revisione (return_order_to_revision crea una nuova draft).
      const { error: deleteDraftError } = await supabase.from("design_drafts").delete().eq("id", activeId);
      if (deleteDraftError) throwFlowError("chiusura_draft", "design_drafts", deleteDraftError);
      const remaining = drafts.filter((dr) => dr.id !== activeId);
      writeLocalState({});
      localStorage.removeItem(ACTIVE_DRAFT_KEY);

      if (remaining.length === 0) {
        setDrafts([]);
        setActiveId(null);
      } else {
        const next = remaining[0];
        const { error: activateDraftError } = await supabase.from("design_drafts").update({ active: true }).eq("id", next.id);
        if (activateDraftError) throwFlowError("chiusura_draft", "design_drafts", activateDraftError);
        setDrafts(remaining);
        setActiveId(next.id);
        localStorage.setItem(ACTIVE_DRAFT_KEY, next.id);
        writeLocalState(next.snapshot ?? {}, next.id);
      }

      toast.success(`Inviato al Flow + Produzione ${prodCode}${d.missing?.length ? " — in attesa acquisti" : ""}`, {
        action: { label: "Apri Flow", onClick: () => navigate("/flow") },
      });
      setConfirmOpen(false);
      setPendingPayload(null);
      navigate("/flow");
    } catch (err) {
      console.error("[DraftTabsBar] errore creazione ordine", err);
      const detail = describeFlowLaunchError(err);
      const debug = await readFlowLaunchDebug();
      toast.error(detail.title, {
        description: `${detail.description} · Permessi utente: ${JSON.stringify(debug)}`,
      });
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
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 py-2 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground mr-2">
            // Schede progetto
          </span>

          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex items-center gap-1 flex-wrap max-h-[96px] overflow-y-auto pr-1">
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
        </div>

        {/* Seconda riga: tab reparti + Storico + Invia al Flow */}
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 pb-2 flex items-center gap-2 flex-wrap border-t border-ink/10 pt-2">
          {secondaryRow}

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

          <CreateCommessaButton
            label="Invia al Flow"
            defaultTitle={(() => {
              const snap = readLocalState() as any;
              const tabName = drafts.find((d) => d.id === activeId)?.name;
              return tabName || snap?._revisionTitolo || snap?.revision?.titolo || snap?.jobName || "Progetto";
            })()}
            defaultAmount={(() => {
              const s: any = readLocalState();
              return Number(s?.total ?? s?.totals?.total ?? 0) || 0;
            })()}
            defaultReparto="generale"
            snapshot={readLocalState()}
            getSnapshot={async () => await snapshotForProduction(readLocalState())}
            onAfterSubmit={async () => {
              if (!activeId) return;
              await supabase.from("design_drafts").delete().eq("id", activeId);
              writeLocalState({});
              localStorage.removeItem(ACTIVE_DRAFT_KEY);
            }}
            triggerClassName="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold shadow-md hover:bg-primary/90 disabled:opacity-40 transition-all"
            hideWarehouseShortcut
            disabled={!activeId || loading}
          />
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

      <ConfirmToWarehouseDialog
        open={confirmOpen}
        onOpenChange={(v) => { setConfirmOpen(v); if (!v) setPendingPayload(null); }}
        title="Verifica materiali prima di lanciare in produzione"
        defaultRef={pendingPayload?.titolo ?? ""}
        defaultProductionName={pendingPayload?.titolo ?? ""}
        materials={pendingPayload ? extractMaterialsFromSnapshot(pendingPayload.productionSnapshot) : []}
        availableMacros={pendingPayload ? deriveAvailableMacros(pendingPayload.depts, activeId) : undefined}
        onConfirm={onWarehouseConfirm}
        saving={sendBusy}
      />
    </>
  );
};