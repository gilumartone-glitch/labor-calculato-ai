import { useEffect, useMemo, useState } from "react";
import { Workflow, Loader2, PackageCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { CommessaPriorita, CommessaReparto } from "@/components/flow/types";
import { ProdDept, ProdPriority, SUB_DEPT_SUFFIX, PRIORITY_LABEL, DEPT_LABEL, toMacroDept } from "@/lib/produzione/types";
import { nextOrderCode, subCode, logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";
import { ConfirmToWarehouseDialog, WarehouseConfirmData } from "@/components/produzione/ConfirmToWarehouseDialog";
import { inferProdDeptsFromSnapshot } from "@/lib/produzione/snapshot";
import { extractMaterialsFromSnapshot } from "@/lib/produzione/snapshot-materials";
import { ContactSelect } from "@/components/produzione/ContactSelect";


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

type Snapshot = Record<string, unknown>;

const readDesignState = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem("officina:state");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

/** Restituisce true se per la draft attiva esiste contenuto nel modulo Montaggi. */
const hasMontaggiContentForActiveDraft = (): boolean => {
  try {
    const draftId = localStorage.getItem("officina:active-draft");
    if (!draftId) return false;
    const raw = localStorage.getItem(`officina:montaggi-module:v2:${draftId}`);
    if (!raw) return false;
    const p = JSON.parse(raw);
    return (p?.labor?.length ?? 0) > 0
      || (p?.materials?.length ?? 0) > 0
      || (p?.tools?.length ?? 0) > 0
      || (p?.transports?.length ?? 0) > 0
      || (p?.elements?.length ?? 0) > 0;
  } catch { return false; }
};

interface CreateCommessaButtonProps {
  /** Etichetta del bottone (es. "Crea commessa") */
  label?: string;
  /** Titolo proposto per la commessa (es. nome lavorazione o reparto) */
  defaultTitle: string;
  /** Importo proposto (totale del calcolo) */
  defaultAmount: number;
  /** Reparto associato: 'tappezzeria'|'stampa'|'falegnameria'|'generale' */
  defaultReparto: CommessaReparto;
  /** Snapshot completo del calcolo da salvare nella commessa (jsonb) */
  snapshot: Snapshot;
  /** Stile del bottone trigger */
  variant?: "primary" | "subtle";
  /** Disabilita il bottone (es. totale a 0) */
  disabled?: boolean;
  /** Se presente, viene chiamata al submit per produrre lo snapshot effettivo da salvare (sovrascrive la prop snapshot). */
  getSnapshot?: () => Promise<Snapshot> | Snapshot;
  /** Callback eseguita dopo la creazione effettiva dell'ordine in produzione (es. cleanup draft Progettazione). */
  onAfterSubmit?: () => Promise<void> | void;
  /** Classe CSS custom per il trigger button (sovrascrive lo stile di variant). */
  triggerClassName?: string;
  /** Nasconde il pulsante "Solo magazzino" affiancato. */
  hideWarehouseShortcut?: boolean;
}

export const CreateCommessaButton = ({
  label = "Crea commessa",
  defaultTitle,
  defaultAmount,
  defaultReparto,
  snapshot,
  variant = "primary",
  disabled = false,
  getSnapshot,
  onAfterSubmit,
  triggerClassName,
  hideWarehouseShortcut = false,
}: CreateCommessaButtonProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Array<{ id: string; display_name: string | null; settori: string[] | null }>>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  type RefType = "OC" | "PR" | "FT";
  type DeptPlanning = {
    startDate: string;
    endDate: string;
    deliveryDate: string;
    responsabile: string;
    operatorIds: string[];
  };
  type FormState = {
    titolo: string; cliente: string; prodName: string; importo: number;
    reparto: CommessaReparto; priorita: CommessaPriorita; scadenza: string;
    note: string; warehouseOnly: boolean;
    materialOnlyDepts: ProdDept[];
    excludedDepts: ProdDept[];
    deptAssignees: Record<string, string>;
    deptPlanning: Record<string, DeptPlanning>;
    generalManager: string;
    refType: RefType;
    refNumber: string;
  };
  const initialForm: FormState = {
    titolo: "", cliente: "", prodName: "",
    importo: defaultAmount, reparto: defaultReparto, priorita: "media",
    scadenza: "", note: "", warehouseOnly: false, materialOnlyDepts: [],
    excludedDepts: [],
    deptAssignees: {},
    deptPlanning: {},
    generalManager: "",
    refType: "OC",
    refNumber: "",
  };
  const [form, setForm, clearForm] = useLocalStorageState<FormState>("calc:create-commessa", initialForm);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const { titolo, cliente, prodName, importo, reparto, priorita, scadenza, note, warehouseOnly, materialOnlyDepts, excludedDepts, deptAssignees, deptPlanning, refType, refNumber } = form;
  const setTitolo = (v: string) => patch({ titolo: v });
  const setCliente = (v: string) => patch({ cliente: v });
  const setProdName = (v: string) => patch({ prodName: v });
  const setImporto = (v: number) => patch({ importo: v });
  const setPriorita = (v: CommessaPriorita) => patch({ priorita: v });
  const setScadenza = (v: string) => patch({ scadenza: v });
  const setNote = (v: string) => patch({ note: v });
  const setWarehouseOnly = (v: boolean) => patch({ warehouseOnly: v });
  const setRefType = (v: RefType) => patch({ refType: v });
  const setRefNumber = (v: string) => patch({ refNumber: v });
  const toggleMaterialOnlyDept = (d: ProdDept) =>
    setForm((f) => ({
      ...f,
      materialOnlyDepts: f.materialOnlyDepts.includes(d) ? f.materialOnlyDepts.filter((x) => x !== d) : [...f.materialOnlyDepts, d],
    }));
  const toggleExcludedDept = (d: ProdDept) =>
    setForm((f) => ({
      ...f,
      excludedDepts: f.excludedDepts.includes(d) ? f.excludedDepts.filter((x) => x !== d) : [...f.excludedDepts, d],
      materialOnlyDepts: f.materialOnlyDepts.filter((x) => x !== d),
    }));
  const setDeptAssignee = (d: ProdDept, v: string) =>
    setForm((f) => ({ ...f, deptAssignees: { ...f.deptAssignees, [d]: v } }));
  const emptyPlanning: DeptPlanning = { startDate: "", endDate: "", deliveryDate: "", responsabile: "", operatorIds: [] };
  const planningFor = (d: ProdDept): DeptPlanning => deptPlanning[d] ?? emptyPlanning;
  const patchPlanning = (d: ProdDept, p: Partial<DeptPlanning>) =>
    setForm((f) => {
      const cur = (f.deptPlanning[d] ?? emptyPlanning) as DeptPlanning;
      const next = { ...cur, ...p };
      // Smart fill date:
      // - se imposti SOLO la data di consegna → inizio e fine = consegna
      // - se imposti SOLO inizio lavorazione → fine e consegna = inizio
      if ("deliveryDate" in p && p.deliveryDate) {
        if (!cur.startDate) next.startDate = p.deliveryDate;
        if (!cur.endDate) next.endDate = p.deliveryDate;
      }
      if ("startDate" in p && p.startDate) {
        if (!cur.endDate) next.endDate = p.startDate;
        if (!cur.deliveryDate) next.deliveryDate = p.startDate;
      }
      return {
        ...f,
        deptPlanning: { ...f.deptPlanning, [d]: next },
        deptAssignees: { ...f.deptAssignees, [d]: next.responsabile },
      };
    });
  const toggleOperator = (d: ProdDept, uid: string) => {
    const cur = planningFor(d);
    const ids = cur.operatorIds.includes(uid) ? cur.operatorIds.filter((x) => x !== uid) : [...cur.operatorIds, uid];
    patchPlanning(d, { operatorIds: ids });
  };
  type PlanningMode = "lavorazioni" | "montaggi";
  const [planningMode, setPlanningMode] = useState<PlanningMode>("lavorazioni");
  const LAVORAZIONI_DEPTS: ProdDept[] = ["laboratorio", "tappezzeria", "falegnameria", "vendite"];

  // Reparti che richiedono pianificazione obbligatoria (date, responsabile, operatori)
  const PLANNED_DEPTS: ProdDept[] = ["laboratorio", "tappezzeria", "falegnameria", "vendite", "montaggi"];

  const [inferenceSnapshot, setInferenceSnapshot] = useState<Snapshot>(snapshot);
  const [montaggiActive, setMontaggiActive] = useState<boolean>(false);
  const inferredDepts: ProdDept[] = useMemo(() => {
    const base = inferProdDeptsFromSnapshot(inferenceSnapshot as any);
    if (montaggiActive && !base.includes("montaggi")) base.push("montaggi");
    return base;
  }, [inferenceSnapshot, montaggiActive]);
  const fallbackDept: ProdDept = REPARTO_TO_PROD[reparto];
  const activeDepts: ProdDept[] = useMemo(() => {
    // Solo reparti realmente rilevati (con lavorazioni/materiali). Niente fallback
    // se lo snapshot non ha contenuto per quel reparto.
    return inferredDepts.filter((d) => !materialOnlyDepts.includes(d) && !excludedDepts.includes(d));
  }, [inferredDepts, materialOnlyDepts, excludedDepts]);
  const operatorsForDept = (d: ProdDept) => {
    const filtered = profiles.filter((p) => Array.isArray((p as any).settori) && ((p as any).settori as string[]).includes(d));
    // Fallback: se nessuno ha il settore (es. "montaggi" non ancora assegnato),
    // mostra comunque tutti i profili approvati per non bloccare il flusso.
    return filtered.length > 0 ? filtered : profiles;
  };

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<null | {
    mode: "warehouse" | "normal";
    commessaId: string;
    clienteName: string;
    productionSnapshot: Snapshot;
    depts?: ProdDept[];
  }>(null);

  // Re-sync defaults quando si riapre il dialog (solo se i campi sono ai default vuoti)
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setForm((f) => ({
        ...f,
        importo: f.importo || defaultAmount,
        reparto: f.reparto || defaultReparto,
      }));
      // carica profili (per selettori operatore per reparto)
      supabase.from("profiles").select("id, display_name, settori").then(({ data }) => {
        setProfiles((data ?? []) as any);
      });
      // se è fornita una factory di snapshot (es. da Progettazione), aggiorna
      // l'inferenza dei reparti rilevati con lo snapshot live.
      if (getSnapshot) {
        (async () => {
          try {
            const live = await getSnapshot();
            setInferenceSnapshot(live);
          } catch {
            /* ignore: useremo lo snapshot statico */
          }
        })();
      } else {
        setInferenceSnapshot(snapshot);
      }
      setMontaggiActive(hasMontaggiContentForActiveDraft());
      if (defaultTitle && defaultTitle.trim()) {
        // Auto-sync titolo con il nome della schedina (Progetto N) ad ogni apertura.
        // L'utente può comunque modificarlo successivamente.
        setForm((f) => ({ ...f, titolo: defaultTitle }));
      }
    }
    setOpen(v);
  };

  // Mantieni il titolo allineato al nome della schedina mentre il dialog è
  // aperto: se l'utente rinomina il "Progetto N", l'aggiornamento si
  // propaga in automatico (può comunque sovrascrivere manualmente dopo).
  useEffect(() => {
    if (!open) return;
    if (!defaultTitle || !defaultTitle.trim()) return;
    setForm((f) => (f.titolo === defaultTitle ? f : { ...f, titolo: defaultTitle }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTitle, open]);

  const submit = async () => {
    if (!user) {
      toast.error("Devi accedere per creare una commessa");
      navigate("/auth");
      return;
    }
    if (!titolo.trim()) {
      toast.error("Inserisci un titolo");
      return;
    }
    if (!scadenza) {
      toast.error("Imposta una data di lavorazione prima di inviare al Flow", {
        description: "Seleziona la data prevista per la lavorazione: senza data la commessa non può essere pianificata.",
      });
      return;
    }
    // Validazione pianificazione per reparto (laboratorio/tappezzeria/falegnameria/vendite/montaggi)
    if (!warehouseOnly) {
      const modeDepts = planningMode === "montaggi" ? ["montaggi"] : LAVORAZIONI_DEPTS;
      const toPlan = activeDepts.filter((d) => PLANNED_DEPTS.includes(d) && modeDepts.includes(d));
      for (const d of toPlan) {
        const p = planningFor(d);
        if (!p.startDate || !p.endDate || !p.deliveryDate || !p.responsabile || p.operatorIds.length === 0) {
          toast.error(`${DEPT_LABEL[d]}: completa la pianificazione`, {
            description: "Servono date inizio/fine lavorazione, data di consegna, responsabile e almeno un operatore.",
          });
          return;
        }
        if (p.endDate < p.startDate) {
          toast.error(`${DEPT_LABEL[d]}: la data fine è precedente all'inizio`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      // Snapshot effettivo: se è fornita una factory async (es. da Progettazione)
      // usala, altrimenti usa la prop snapshot statica.
      const baseSnapshot: Snapshot = getSnapshot ? await getSnapshot() : snapshot;
      const designStateRaw = readDesignState();
      // Se il lancio parte da un singolo reparto, NON includere lo stato
      // degli altri reparti nello snapshot (altrimenti la commessa porta in
      // Flow anche lavorazioni di altri reparti).
      const designState: Record<string, unknown> =
        (baseSnapshot as any)?.source === "department" && (baseSnapshot as any)?.deptKey
          ? (() => {
              const k = (baseSnapshot as any).deptKey as string;
              const only: Record<string, unknown> = {};
              if (designStateRaw && (designStateRaw as any)[k] !== undefined) {
                (only as any)[k] = (designStateRaw as any)[k];
              }
              return only;
            })()
          : designStateRaw;
      // Includi la draft attiva del modulo Montaggi (vive in una chiave separata)
      try {
        const draftId = localStorage.getItem("officina:active-draft");
        if (draftId) {
          const rawM = localStorage.getItem(`officina:montaggi-module:v2:${draftId}`);
          if (rawM) {
            const parsed = JSON.parse(rawM);
            if (parsed && typeof parsed === "object") {
              (designState as any).montaggi = parsed;
            }
          }
        }
      } catch { /* ignora: montaggi opzionale */ }
      const productionSnapshot: Snapshot = Object.keys(designState).length > 0
        ? { ...baseSnapshot, designState }
        : baseSnapshot;
      const stato = warehouseOnly ? "da_fare" : "preventivo";
      // 1) Commessa nel flow
      const { data: createdCommessa, error } = await supabase.from("commesse").insert({
        titolo: titolo.trim(),
        cliente: cliente.trim() || null,
        importo: importo || null,
        reparto,
        priorita,
        stato,
        tipo: "commessa",
        data_scadenza: scadenza || null,
        note: note.trim() || null,
        snapshot: productionSnapshot as never,
        created_by: user.id,
      }).select("id").single();
      if (error) throw error;
      const commessaId = createdCommessa.id;

      // Se senza lavorazione: chiedo dati magazzino e creo solo l'ordine magazzino, niente sub di reparto
      if (warehouseOnly) {
        const clienteName = (cliente.trim() || titolo.trim()).slice(0, 200);
        setPendingPayload({ mode: "warehouse", commessaId, clienteName, productionSnapshot });
        setConfirmOpen(true);
        // teniamo open il dialog principale per riaprire in caso di annullo
        setSaving(false);
        return;
      }

      // Flusso normale: usa i reparti rilevati; se nessuno, fallback al reparto scelto nel form.
      const inferred = inferProdDeptsFromSnapshot(productionSnapshot as any);
      const hasMontaggi = hasMontaggiContentForActiveDraft();
      let depts: ProdDept[] = inferred.filter((d) => !materialOnlyDepts.includes(d) && !excludedDepts.includes(d));
      if (hasMontaggi && !depts.includes("montaggi") && !excludedDepts.includes("montaggi")) {
        depts.push("montaggi");
      }
      if (depts.length === 0) {
        const manual = REPARTO_TO_PROD[reparto];
        if (manual && manual !== "altro") {
          depts = [manual];
        } else {
          toast.error("Nessun reparto con lavorazioni o prodotti da lanciare");
          setSaving(false);
          return;
        }
      }

      const clienteName = (cliente.trim() || titolo.trim()).slice(0, 200);
      setPendingPayload({ mode: "normal", commessaId, clienteName, productionSnapshot, depts });
      setConfirmOpen(true);
      setSaving(false);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      toast.error("Errore creazione commessa", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const onWarehouseConfirm = async (d: WarehouseConfirmData) => {
    if (!user || !pendingPayload) return;
    setSaving(true);
    try {
      const code = await nextOrderCode();
      const prodPrio = PRIO_TO_PROD[priorita];
      const isWarehouse = pendingPayload.mode === "warehouse";
      const orderNote = isWarehouse
        ? `Senza lavorazione — da preventivo: ${titolo.trim()}`
        : ([titolo.trim() && `Da preventivo: ${titolo.trim()}`, note.trim() || null].filter(Boolean).join(" — ") || null);

      const { data: pord, error: e1 } = await supabase
        .from("production_orders")
        .insert({
          code,
          cliente: pendingPayload.clienteName,
          data: scadenza || new Date().toISOString().slice(0, 10),
          note: orderNote,
          priorita: prodPrio,
          delivery: isWarehouse ? "corriere" : "spedizione",
          status: "in_corso",
          attachments: [],
          nesting_included: false,
          created_by: user.id,
          source_commessa_id: pendingPayload.commessaId,
          snapshot: pendingPayload.productionSnapshot as never,
          customer_order_ref: d.customer_order_ref,
          production_name: d.production_name || prodName.trim() || null,
        } as any)
        .select()
        .single();
      if (e1) throw e1;

      // acquisti subs (one per missing material) — propedeutici alle lavorazioni/magazzino
      let firstAcquistiId: string | null = null;
      if (d.missing && d.missing.length > 0 && d.acquisti_assignee_id) {
        const acquistiRows = d.missing.map((m, i) => ({
          order_id: pord.id,
          code: subCode(code, SUB_DEPT_SUFFIX["acquisti"], i + 1),
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
        if (ea) throw ea;
        firstAcquistiId = acquistiSubs?.[0]?.id ?? null;

        await notify({
          userIds: [d.acquisti_assignee_id],
          type: "magazzino_da_preparare",
          message: `Acquisti — ${code}: ${d.missing.length} materiale/i da ordinare per ${pendingPayload.clienteName}`,
          order_id: pord.id,
          link: "/produzione/acquisti",
          is_urgent: prodPrio !== "normale",
        });
      }

      const insertedSubs: { id: string; dept: ProdDept; assignee: string | null }[] = [];

      if (isWarehouse) {
        // Solo lavorazione: un unico sub del reparto scelto, dipendente dagli acquisti
        const baseOrdine = d.missing?.length ?? 0;
        const workSuffix = SUB_DEPT_SUFFIX[d.work_dept] ?? "L";
        const { data: workSub, error: e2 } = await supabase.from("production_sub_orders").insert({
          order_id: pord.id,
          code: subCode(code, workSuffix, 1),
          dept: d.work_dept,
          ordine: baseOrdine,
          note: `Ordine cliente: ${d.customer_order_ref}` + (d.missing?.length ? ` · in attesa materiali (${d.missing.length})` : ""),
          files: [],
          depends_on: firstAcquistiId,
          assignee_id: d.assignee_id || null,
        } as any).select("id").single();
        if (e2) throw e2;
        if (d.assignee_id) insertedSubs.push({ id: workSub.id, dept: d.work_dept, assignee: d.assignee_id });

        // Sub Amministrazione opzionale (chiusura/bolla)
        if (d.create_admin_closure) {
          await supabase.from("production_sub_orders").insert({
            order_id: pord.id,
            code: subCode(code, SUB_DEPT_SUFFIX["magazzino"], 2),
            dept: "magazzino",
            ordine: baseOrdine + 1,
            note: `Chiusura/bolla — ordine cliente ${d.customer_order_ref}`,
            files: [],
          } as any);
        }

        await notify({
          userIds: [d.assignee_id],
          type: "magazzino_da_preparare",
          message: d.missing?.length
            ? `In attesa materiali — ${code} · ${pendingPayload.clienteName} (${d.missing.length})`
            : `Da lavorare: ${code} · ${pendingPayload.clienteName} (Ordine ${d.customer_order_ref})`,
          order_id: pord.id,
          link: "/produzione/board",
          is_urgent: prodPrio !== "normale",
        });
      } else {
        // Flusso normale: un sub per ogni reparto, in attesa che gli acquisti arrivino
        const depts = pendingPayload.depts ?? [];
        const baseOrdine = d.missing?.length ?? 0;
        // Carrello vendite (per arricchire la nota del sub magazzino).
        const ps: any = pendingPayload.productionSnapshot;
        const carts: Record<string, any[]> = (ps?.salesCarts && typeof ps.salesCarts === "object")
          ? ps.salesCarts
          : (ps?.designState?.salesCarts && typeof ps.designState.salesCarts === "object" ? ps.designState.salesCarts : {});
        const salesLines: string[] = [];
        for (const k of Object.keys(carts || {})) {
          for (const l of (carts[k] || [])) {
            const desc = [l.name, l.variant && `(${l.variant})`].filter(Boolean).join(" ") || "Vendita";
            const q = Number(l.qty) || 0;
            const sell = (Number(l.priceSell) || 0) * q;
            salesLines.push(`• ${desc} — ${q} ${l.unit || ""}${sell > 0 ? ` · ${sell.toFixed(2)}€` : ""}`.trim());
          }
        }
        const salesNote = salesLines.length ? `Vendite da preparare:\n${salesLines.join("\n")}` : "";
        for (let i = 0; i < depts.length; i++) {
          const dept = depts[i];
          const plan = planningFor(dept);
          const assignee = (plan.responsabile || deptAssignees[dept]) || null;
          const opIds = Array.from(new Set([...(plan.operatorIds || []), ...(assignee ? [assignee] : [])]));
          const noteForSub = dept === "magazzino" && salesNote
            ? `${titolo.trim()}${titolo.trim() ? " — " : ""}${salesNote}`
            : (titolo.trim() || null);
          const { data: sub, error: eSub } = await supabase
            .from("production_sub_orders")
            .insert({
              order_id: pord.id,
              code: subCode(code, SUB_DEPT_SUFFIX[dept], i + 1),
              dept,
              ordine: baseOrdine + i,
              note: noteForSub,
              files: [],
              depends_on: firstAcquistiId, // bloccato finché gli acquisti non sono arrivati
              assignee_id: assignee,
              operator_ids: opIds,
              start_date: plan.startDate || null,
              end_date: plan.endDate || null,
              due_date: plan.deliveryDate || null,
            } as any)
            .select("id")
            .single();
          if (eSub) throw eSub;
          insertedSubs.push({ id: sub.id, dept, assignee });
        }

        const writers = await getProduzioneWriters(depts);
        const targets = writers.filter((u) => u !== user.id);
        if (targets.length > 0) {
          await notify({
            userIds: targets,
            type: "ordine_creato",
            message: d.missing?.length
              ? `Nuovo ordine ${code} per ${pendingPayload.clienteName} — in attesa acquisti (${d.missing.length})`
              : `Nuovo ordine ${code} per ${pendingPayload.clienteName} — ${PRIORITY_LABEL[prodPrio]}`,
            order_id: pord.id,
            link: `/produzione/board?order=${pord.id}`,
            is_urgent: prodPrio !== "normale",
          });
        }
        for (const s of insertedSubs) {
          if (s.assignee && s.assignee !== user.id) {
            await notify({
              userIds: [s.assignee],
              type: "ordine_creato",
              message: `Assegnato a te: ${code} · ${DEPT_LABEL[s.dept]} (${pendingPayload.clienteName})`,
              order_id: pord.id,
              link: `/produzione/board?order=${pord.id}`,
              is_urgent: prodPrio !== "normale",
            });
          }
        }
      }

      const flowAssigneeIds = Array.from(new Set([
        d.missing?.length ? d.acquisti_assignee_id : null,
        ...insertedSubs.map((s) => s.assignee),
      ].filter((id): id is string => !!id)));
      if (flowAssigneeIds.length > 0) {
        const { error: assErr } = await supabase
          .from("commessa_assegnatari")
          .upsert(
            flowAssigneeIds.map((uid) => ({ commessa_id: pendingPayload.commessaId, user_id: uid })),
            { onConflict: "commessa_id,user_id", ignoreDuplicates: true },
          );
        if (assErr) throw assErr;
      }

      await logAction({
        action: "FLOW_LANCIATO",
        entity_type: "order",
        entity_id: pord.id,
        detail: isWarehouse
          ? `Ordine ${code} (senza lavorazione) per ${pendingPayload.clienteName} — rif. cliente ${d.customer_order_ref}`
          : `Ordine ${code} per ${pendingPayload.clienteName} — ${(pendingPayload.depts ?? []).join(" + ")} (rif. ${d.customer_order_ref})`,
        new_state: {
          code, warehouseOnly: isWarehouse,
          customer_order_ref: d.customer_order_ref,
          depts: pendingPayload.depts ?? [],
          missing_count: d.missing?.length ?? 0,
        },
      });

      toast.success(isWarehouse
        ? `Ordine ${code} creato e inviato al magazzino`
        : `Commessa + Ordine ${code} creati${d.missing?.length ? " — in attesa acquisti" : ""}`);
      setConfirmOpen(false);
      setOpen(false);
      setPendingPayload(null);
      setForm({ ...initialForm, importo: defaultAmount, reparto: defaultReparto });
      clearForm();
      if (onAfterSubmit) {
        try { await onAfterSubmit(); } catch (e) { console.warn("[CreateCommessaButton] onAfterSubmit error", e); }
      }
      navigate("/flow");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore creazione ordine");
    } finally {
      setSaving(false);
    }
  };

  const triggerClass =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      : "inline-flex items-center gap-1.5 px-2 py-1 border border-ink/30 rounded-sm text-[10px] uppercase tracking-wider font-semibold text-ink/70 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <>
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        className={triggerClassName ?? triggerClass}
        title={label}
        onClick={() => { setWarehouseOnly(false); handleOpenChange(true); }}
      >
        <Workflow className={variant === "primary" ? "w-3.5 h-3.5" : "w-3 h-3"} />
        {label}
      </button>
      {!hideWarehouseShortcut && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setWarehouseOnly(true); handleOpenChange(true); }}
          className="inline-flex items-center gap-1.5 px-2 py-1 border border-ink/30 rounded-sm text-[10px] uppercase tracking-wider font-semibold text-ink/70 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Crea ordine senza lavorazione (solo magazzino)"
        >
          <PackageCheck className="w-3 h-3" />
          Solo magazzino
        </button>
      )}
    </div>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-1">
          <DialogTitle className="font-display text-xl">{warehouseOnly ? "Solo magazzino" : "Crea commessa nel Flow"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label htmlFor="titolo">Titolo</Label>
            <Input
              id="titolo"
              value={titolo}
              onChange={(e) => setTitolo(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label>Cliente</Label>
              <ContactSelect type="cliente" value={cliente} onChange={setCliente} />
            </div>
            <div>
              <Label htmlFor="importo">Importo €</Label>
              <Input
                id="importo"
                type="number"
                value={importo === 0 ? "" : importo}
                onChange={(e) => setImporto(parseFloat(e.target.value) || 0)}
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Tipo rif.</Label>
              <Select value={refType} onValueChange={(v) => setRefType(v as RefType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OC">OC — Ordine cliente</SelectItem>
                  <SelectItem value="PR">PR — Preventivo</SelectItem>
                  <SelectItem value="FT">FT — Fattura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="refnum">Numero riferimento</Label>
              <Input id="refnum" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} placeholder="es. 12345" />
            </div>
          </div>

          <div>
            <Label htmlFor="prod">Prod. (nome progetto/film)</Label>
            <Input id="prod" value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="es. Avatar 3" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priorità</Label>
              <Select value={priorita} onValueChange={(v) => setPriorita(v as CommessaPriorita)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bassa">Bassa</SelectItem>
                  <SelectItem value="media">Media</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="scadenza">Scadenza</Label>
              <Input
                id="scadenza"
                type="date"
                value={scadenza}
                onChange={(e) => setScadenza(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note interne, indicazioni di lavorazione..."
              rows={2}
            />
          </div>

          {/* Sezione "Assegna operatore per reparto" rimossa: gli operatori si scelgono direttamente nella pagina Flow. */}

          {!warehouseOnly && inferredDepts.length > 1 && (
            <div className="border-2 border-primary/40 bg-primary/5 rounded-sm p-2.5 space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">
                Reparti da lanciare in Flow
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {inferredDepts.map((d) => {
                  const excluded = excludedDepts.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleExcludedDept(d)}
                      className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold border-2 rounded-sm transition-colors ${
                        excluded
                          ? "border-ink/20 text-ink/40 line-through bg-muted"
                          : "bg-primary text-primary-foreground border-primary"
                      }`}
                    >
                      {DEPT_LABEL[d]} {excluded ? "· escluso" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!warehouseOnly && activeDepts.filter((d) => PLANNED_DEPTS.includes(d)).length > 0 && (
            <div className="border-2 border-destructive/40 bg-destructive/5 rounded-sm p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-mono text-[10px] uppercase tracking-widest text-destructive font-bold">
                  Pianificazione obbligatoria · date, responsabile, operatori
                </div>
                <div className="inline-flex border-2 border-ink rounded-sm overflow-hidden">
                  {(["lavorazioni", "montaggi"] as PlanningMode[]).map((m) => {
                    const active = planningMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPlanningMode(m)}
                        className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                          active ? "bg-ink text-paper" : "bg-paper text-ink/60 hover:text-ink"
                        }`}
                      >
                        {m === "lavorazioni" ? "Lavorazioni" : "Montaggi"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                Selezionando un tipo, l'altro viene escluso da questa pianificazione.
              </div>
              {(() => {
                const modeDepts = planningMode === "montaggi" ? (["montaggi"] as ProdDept[]) : LAVORAZIONI_DEPTS;
                const visible = activeDepts.filter((d) => PLANNED_DEPTS.includes(d) && modeDepts.includes(d));
                if (visible.length === 0) {
                  return (
                    <div className="text-[11px] text-muted-foreground italic px-1 py-2">
                      Nessun reparto di tipo "{planningMode}" rilevato in questa commessa.
                    </div>
                  );
                }
                return null;
              })()}
              {(planningMode === "montaggi" ? (["montaggi"] as ProdDept[]) : LAVORAZIONI_DEPTS)
                .filter((d) => activeDepts.includes(d) && PLANNED_DEPTS.includes(d))
                .map((d) => {
                const p = planningFor(d);
                const ops = operatorsForDept(d);
                return (
                  <div key={d} className="border border-ink/20 rounded-sm p-2 space-y-2 bg-background">
                    <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-primary">
                      {DEPT_LABEL[d]}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[10px]">Inizio lavorazione *</Label>
                        <Input type="date" value={p.startDate}
                          onChange={(e) => patchPlanning(d, { startDate: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-[10px]">Fine lavorazione *</Label>
                        <Input type="date" value={p.endDate}
                          onChange={(e) => patchPlanning(d, { endDate: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-[10px]">Data consegna *</Label>
                        <Input type="date" value={p.deliveryDate}
                          onChange={(e) => patchPlanning(d, { deliveryDate: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px]">Responsabile di progetto *</Label>
                      <Select value={p.responsabile || ""} onValueChange={(v) => patchPlanning(d, { responsabile: v })}>
                        <SelectTrigger><SelectValue placeholder="Seleziona responsabile…" /></SelectTrigger>
                        <SelectContent>
                          {ops.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.display_name ?? o.id.slice(0, 8)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Operatori impiegati *</Label>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {ops.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">Nessun operatore disponibile</span>
                        )}
                        {ops.map((o) => {
                          const sel = p.operatorIds.includes(o.id);
                          return (
                            <button key={o.id} type="button"
                              onClick={() => toggleOperator(d, o.id)}
                              className={`px-2 py-1 text-[11px] border-2 rounded-sm transition-colors ${
                                sel ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 text-ink/70 hover:border-ink"
                              }`}>
                              {o.display_name ?? o.id.slice(0, 8)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => { setForm({ ...initialForm, importo: defaultAmount, reparto: defaultReparto }); clearForm(); }}
            className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-destructive font-mono mr-auto"
          >
            Pulisci modulo
          </button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Annulla
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : warehouseOnly ? <PackageCheck className="w-4 h-4 mr-2" /> : <Workflow className="w-4 h-4 mr-2" />}
            {warehouseOnly ? "Avanti → Magazzino" : "Crea nel Flow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmToWarehouseDialog
      open={confirmOpen}
      onOpenChange={(v) => { setConfirmOpen(v); if (!v) setPendingPayload(null); }}
      title={pendingPayload?.mode === "warehouse" ? "Solo magazzino — dettagli ordine" : "Verifica materiali prima di lanciare in produzione"}
      materials={pendingPayload ? extractMaterialsFromSnapshot(pendingPayload.productionSnapshot) : []}
      defaultRef={refNumber ? `${refType}-${refNumber}` : ""}
      defaultProductionName={prodName}
      availableMacros={pendingPayload?.depts && pendingPayload.depts.length > 0
        ? Array.from(new Set(pendingPayload.depts.map(toMacroDept)))
        : undefined}
      onConfirm={onWarehouseConfirm}
      saving={saving}
    />
    </>
  );
};