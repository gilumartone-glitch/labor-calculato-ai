import { useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { CommessaPriorita, CommessaReparto } from "@/components/flow/types";
import { ProdDept, ProdPriority, SUB_DEPT_SUFFIX, PRIORITY_LABEL, DEPT_LABEL } from "@/lib/produzione/types";
import { nextOrderCode, subCode, logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";
import { ConfirmToWarehouseDialog, WarehouseConfirmData } from "@/components/produzione/ConfirmToWarehouseDialog";
import { inferProdDeptsFromSnapshot } from "@/lib/produzione/snapshot";
import { extractMaterialsFromSnapshot } from "@/lib/produzione/snapshot-materials";
import { ContactSelect } from "@/components/produzione/ContactSelect";


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

type Snapshot = Record<string, unknown>;

const readDesignState = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem("officina:state");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
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
}

export const CreateCommessaButton = ({
  label = "Crea commessa",
  defaultTitle,
  defaultAmount,
  defaultReparto,
  snapshot,
  variant = "primary",
  disabled = false,
}: CreateCommessaButtonProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Array<{ id: string; display_name: string | null; settori: string[] | null }>>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  type FormState = {
    titolo: string; cliente: string; prodName: string; importo: number;
    reparto: CommessaReparto; priorita: CommessaPriorita; scadenza: string;
    note: string; warehouseOnly: boolean;
    materialOnlyDepts: ProdDept[];
    excludedDepts: ProdDept[];
    deptAssignees: Record<string, string>;
  };
  const initialForm: FormState = {
    titolo: defaultTitle, cliente: "", prodName: "",
    importo: defaultAmount, reparto: defaultReparto, priorita: "media",
    scadenza: "", note: "", warehouseOnly: false, materialOnlyDepts: [],
    excludedDepts: [],
    deptAssignees: {},
  };
  const [form, setForm, clearForm] = useLocalStorageState<FormState>("calc:create-commessa", initialForm);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const { titolo, cliente, prodName, importo, reparto, priorita, scadenza, note, warehouseOnly, materialOnlyDepts, excludedDepts, deptAssignees } = form;
  const setTitolo = (v: string) => patch({ titolo: v });
  const setCliente = (v: string) => patch({ cliente: v });
  const setProdName = (v: string) => patch({ prodName: v });
  const setImporto = (v: number) => patch({ importo: v });
  const setReparto = (v: CommessaReparto) => patch({ reparto: v });
  const setPriorita = (v: CommessaPriorita) => patch({ priorita: v });
  const setScadenza = (v: string) => patch({ scadenza: v });
  const setNote = (v: string) => patch({ note: v });
  const setWarehouseOnly = (v: boolean) => patch({ warehouseOnly: v });
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

  const inferredDepts: ProdDept[] = useMemo(
    () => inferProdDeptsFromSnapshot(snapshot as any),
    [snapshot],
  );
  const fallbackDept: ProdDept = REPARTO_TO_PROD[reparto];
  const activeDepts: ProdDept[] = useMemo(() => {
    const base = inferredDepts.length > 0 ? inferredDepts : [fallbackDept];
    return base.filter((d) => !materialOnlyDepts.includes(d) && !excludedDepts.includes(d));
  }, [inferredDepts, fallbackDept, materialOnlyDepts, excludedDepts]);
  const operatorsForDept = (d: ProdDept) =>
    profiles.filter((p) => Array.isArray((p as any).settori) && ((p as any).settori as string[]).includes(d));

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<null | { clienteName: string; productionSnapshot: Snapshot }>(null);

  // Re-sync defaults quando si riapre il dialog (solo se i campi sono ai default vuoti)
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setForm((f) => ({
        ...f,
        titolo: f.titolo || defaultTitle,
        importo: f.importo || defaultAmount,
        reparto: f.reparto || defaultReparto,
      }));
      // carica profili (per selettori operatore per reparto)
      supabase.from("profiles").select("id, display_name, settori").then(({ data }) => {
        setProfiles((data ?? []) as any);
      });
    }
    setOpen(v);
  };

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
    setSaving(true);
    try {
      const designStateRaw = readDesignState();
      // Se il lancio parte da un singolo reparto, NON includere lo stato
      // degli altri reparti nello snapshot (altrimenti la commessa porta in
      // Flow anche lavorazioni di altri reparti).
      const designState: Record<string, unknown> =
        (snapshot as any)?.source === "department" && (snapshot as any)?.deptKey
          ? (() => {
              const k = (snapshot as any).deptKey as string;
              const only: Record<string, unknown> = {};
              if (designStateRaw && (designStateRaw as any)[k] !== undefined) {
                (only as any)[k] = (designStateRaw as any)[k];
              }
              return only;
            })()
          : designStateRaw;
      const productionSnapshot: Snapshot = Object.keys(designState).length > 0
        ? { ...snapshot, designState }
        : snapshot;
      const stato = warehouseOnly ? "da_fare" : "preventivo";
      // 1) Commessa nel flow
      const { error } = await supabase.from("commesse").insert({
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
      });
      if (error) throw error;

      // Se senza lavorazione: chiedo dati magazzino e creo solo l'ordine magazzino, niente sub di reparto
      if (warehouseOnly) {
        const clienteName = (cliente.trim() || titolo.trim()).slice(0, 200);
        setPendingPayload({ clienteName, productionSnapshot });
        setConfirmOpen(true);
        // teniamo open il dialog principale per riaprire in caso di annullo
        setSaving(false);
        return;
      }

      // 2) Production order + sub-ordine per il reparto
      let prodCode: string | null = null;
      let prodId: string | null = null;
      try {
        prodCode = await nextOrderCode();
        const prodPrio = PRIO_TO_PROD[priorita];
        const fallbackDept = REPARTO_TO_PROD[reparto];
        // Determina i reparti reali dai pezzi dello snapshot (es. stampa+taglio).
        const inferred = inferProdDeptsFromSnapshot(productionSnapshot as any);
        const allDepts: ProdDept[] = inferred.length > 0 ? inferred : [fallbackDept];
        // Filtra fuori i reparti esclusi dall'utente e quelli contrassegnati come "solo materiale".
        const depts: ProdDept[] = allDepts.filter((d) => !materialOnlyDepts.includes(d) && !excludedDepts.includes(d));
        if (depts.length === 0) {
          toast.error("Seleziona almeno un reparto da lanciare");
          setSaving(false);
          return;
        }
        const clienteName = (cliente.trim() || titolo.trim()).slice(0, 200);
        const { data: pord, error: e1 } = await supabase.from("production_orders").insert({
          code: prodCode,
          cliente: clienteName,
          data: scadenza || new Date().toISOString().slice(0, 10),
          note: [titolo.trim() && `Da preventivo: ${titolo.trim()}`, note.trim() || null].filter(Boolean).join(" — ") || null,
          priorita: prodPrio,
          delivery: "spedizione",
          status: "in_corso",
          attachments: [],
          nesting_included: false,
          created_by: user.id,
          snapshot: productionSnapshot as never,
          production_name: prodName.trim() || null,
        } as any).select().single();
        if (e1) throw e1;
        prodId = pord.id;

        // Inserisce un sub per ogni reparto in PARALLELO (depends_on=null) cosicché
        // ogni reparto lavori indipendentemente e chiuda il proprio cerchio;
        // l'ordine si chiude quando tutti i sub sono completati.
        const insertedSubs: { id: string; dept: ProdDept; assignee: string | null }[] = [];
        for (let i = 0; i < depts.length; i++) {
          const d = depts[i];
          const assignee = deptAssignees[d] || null;
          const { data: sub, error: eSub } = await supabase
            .from("production_sub_orders")
            .insert({
              order_id: pord.id,
              code: subCode(prodCode, SUB_DEPT_SUFFIX[d], i + 1),
              dept: d,
              ordine: i,
              note: titolo.trim() || null,
              files: [],
              depends_on: null,
              assignee_id: assignee,
            } as any)
            .select("id")
            .single();
          if (eSub) throw eSub;
          insertedSubs.push({ id: sub.id, dept: d, assignee });
        }

        await logAction({
          action: "FLOW_LANCIATO",
          entity_type: "order",
          entity_id: pord.id,
          detail: `Ordine ${prodCode} creato da preventivo per ${clienteName} — ${PRIORITY_LABEL[prodPrio]} (${depts.join(" → ")})`,
          new_state: { code: prodCode, depts, priorita: prodPrio, from: "preventivo", assignees: deptAssignees },
        });

        const writers = await getProduzioneWriters(depts);
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
        // Notifica diretta agli operatori assegnati
        for (const s of insertedSubs) {
          if (s.assignee && s.assignee !== user.id) {
            await notify({
              userIds: [s.assignee],
              type: "ordine_creato",
              message: `Assegnato a te: ${prodCode} · ${DEPT_LABEL[s.dept]} (${clienteName})`,
              order_id: pord.id,
              link: `/produzione/board?order=${pord.id}`,
              is_urgent: prodPrio !== "normale",
            });
          }
        }
      } catch (prodErr) {
        // Non blocco la commessa se la creazione produzione fallisce: la commessa è già salvata.
        console.error("Errore creazione production order:", prodErr);
        toast.warning("Commessa creata, ma l'ordine di Produzione non è stato lanciato. Riprova dal modulo Produzione.");
      }

      toast.success(prodCode ? `Commessa + Ordine ${prodCode} creati` : "Commessa creata nel Flow", {
        description: prodCode ? `In Flow (Preventivo) e in Produzione (In corso).` : `"${titolo}" è ora in colonna Preventivo.`,
        action: {
          label: prodId ? "Apri Produzione" : "Apri Flow",
          onClick: () => navigate(prodId ? `/produzione/board?order=${prodId}` : "/flow"),
        },
      });
      setOpen(false);
      // Reset campi e cancella la persistenza
      setForm({ ...initialForm, titolo: defaultTitle, importo: defaultAmount, reparto: defaultReparto });
      clearForm();
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
      const { data: pord, error: e1 } = await supabase
        .from("production_orders")
        .insert({
          code,
          cliente: pendingPayload.clienteName,
          data: scadenza || new Date().toISOString().slice(0, 10),
          note: `Senza lavorazione — da preventivo: ${titolo.trim()}`,
          priorita: prodPrio,
          delivery: "corriere",
          status: "in_corso",
          attachments: [],
          nesting_included: false,
          created_by: user.id,
          snapshot: pendingPayload.productionSnapshot as never,
          customer_order_ref: d.customer_order_ref,
          production_name: d.production_name || null,
        } as any)
        .select()
        .single();
      if (e1) throw e1;

      // acquisti subs (one per missing material)
      let firstAcquistiId: string | null = null;
      if (d.missing && d.missing.length > 0 && d.acquisti_assignee_id) {
        const acquistiRows = d.missing.map((m, i) => ({
          order_id: pord.id,
          code: subCode(code, SUB_DEPT_SUFFIX["acquisti"], i + 1),
          dept: "acquisti" as const,
          ordine: i,
          note: `Da ordinare: ${m.label}${m.detail ? " · " + m.detail : ""} (rif. ${d.customer_order_ref})`,
          supplier_name: m.supplier_name || null,
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

      const { error: e2 } = await supabase.from("production_sub_orders").insert({
        order_id: pord.id,
        code: subCode(code, SUB_DEPT_SUFFIX["magazzino"], 1),
        dept: "magazzino",
        ordine: (d.missing?.length ?? 0),
        note: `Ordine cliente: ${d.customer_order_ref}` + (d.missing?.length ? ` · in attesa acquisti (${d.missing.length})` : ""),
        files: [],
        depends_on: firstAcquistiId,
      });
      if (e2) throw e2;

      await notify({
        userIds: [d.assignee_id],
        type: "magazzino_da_preparare",
        message: d.missing?.length
          ? `In attesa acquisti — ${code} · ${pendingPayload.clienteName} (${d.missing.length} materiali)`
          : `Da preparare: ${code} · ${pendingPayload.clienteName} (Ordine ${d.customer_order_ref})`,
        order_id: pord.id,
        link: "/produzione/preparazione",
        is_urgent: prodPrio !== "normale",
      });

      await logAction({
        action: "FLOW_LANCIATO",
        entity_type: "order",
        entity_id: pord.id,
        detail: `Ordine ${code} (senza lavorazione) per ${pendingPayload.clienteName} — rif. cliente ${d.customer_order_ref}`,
        new_state: { code, warehouseOnly: true, customer_order_ref: d.customer_order_ref, assignee_id: d.assignee_id },
      });

      toast.success(`Ordine ${code} creato e inviato al magazzino`);
      setConfirmOpen(false);
      setOpen(false);
      setPendingPayload(null);
      setForm({ ...initialForm, titolo: defaultTitle, importo: defaultAmount, reparto: defaultReparto });
      clearForm();
      navigate(`/produzione/board?order=${pord.id}`);
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
        className={triggerClass}
        title={label}
        onClick={() => { setWarehouseOnly(false); handleOpenChange(true); }}
      >
        <Workflow className={variant === "primary" ? "w-3.5 h-3.5" : "w-3 h-3"} />
        {label}
      </button>
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
    </div>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{warehouseOnly ? "Solo magazzino" : "Crea commessa nel Flow"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between border-2 border-primary/30 bg-primary/5 rounded-sm px-3 py-2">
            <div>
              <Label className="m-0">Senza lavorazione (solo magazzino)</Label>
              <div className="text-[10px] text-muted-foreground">Prodotti già pronti — il magazzino li prepara per la consegna</div>
            </div>
            <Switch checked={warehouseOnly} onCheckedChange={setWarehouseOnly} />
          </div>

          <div>
            <Label htmlFor="titolo">Titolo</Label>
            <Input
              id="titolo"
              value={titolo}
              onChange={(e) => setTitolo(e.target.value)}
              placeholder="es. Tende su misura sala riunioni"
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
          <div>
            <Label htmlFor="prod">Prod. (nome progetto/film)</Label>
            <Input id="prod" value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="es. Avatar 3" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Reparto</Label>
              <Select value={reparto} onValueChange={(v) => setReparto(v as CommessaReparto)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tappezzeria">Tappezzeria</SelectItem>
                  <SelectItem value="stampa">Laboratorio</SelectItem>
                  <SelectItem value="falegnameria">Falegnameria</SelectItem>
                  <SelectItem value="generale">Generale</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

          <div className="text-[10px] font-mono text-muted-foreground border-t border-dashed border-ink/20 pt-2">
            ✓ Il dettaglio del calcolo verrà salvato come snapshot nella commessa.
          </div>

          {!warehouseOnly && activeDepts.length > 0 && (
            <div className="border-2 border-primary/30 bg-primary/5 rounded-sm p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">
                Assegna operatore per reparto
              </div>
              <div className="text-[10px] text-muted-foreground">
                Indica chi, all'interno di ciascun reparto, deve eseguire la lavorazione (facoltativo).
              </div>
              <div className="space-y-2 pt-1">
                {activeDepts.map((d) => {
                  const ops = operatorsForDept(d);
                  return (
                    <div key={d} className="grid grid-cols-3 gap-2 items-center">
                      <div className="font-mono text-[11px] font-bold uppercase tracking-wider">{DEPT_LABEL[d]}</div>
                      <select
                        value={deptAssignees[d] ?? ""}
                        onChange={(e) => setDeptAssignee(d, e.target.value)}
                        className="col-span-2 h-9 px-2 border-2 border-input rounded-md bg-background text-sm"
                      >
                        <option value="">Operatore (facoltativo)…</option>
                        {ops.map((o) => (
                          <option key={o.id} value={o.id}>{o.display_name ?? o.id.slice(0, 8)}</option>
                        ))}
                        {ops.length === 0 && (
                          <option disabled value="__none">Nessun operatore con settore {DEPT_LABEL[d]}</option>
                        )}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!warehouseOnly && inferredDepts.length > 1 && (
            <div className="border-2 border-primary/40 bg-primary/5 rounded-sm p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">
                Reparti da lanciare in Flow
              </div>
              <div className="text-[10px] text-muted-foreground">
                Tutti i reparti rilevati sono attivi. Clicca per escludere quelli che NON vuoi lanciare ora.
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

          {!warehouseOnly && inferredDepts.length > 0 && (
            <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Solo materiale per reparto
              </div>
              <div className="text-[10px] text-muted-foreground">
                Spunta i reparti per cui NON serve la lavorazione: il materiale verrà gestito direttamente dal magazzino.
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {inferredDepts.filter((d) => !excludedDepts.includes(d)).map((d) => {
                  const on = materialOnlyDepts.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleMaterialOnlyDept(d)}
                      className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold border-2 rounded-sm transition-colors ${
                        on ? "bg-amber-100 text-amber-900 border-amber-500" : "border-ink/20 text-ink/60 hover:border-ink"
                      }`}
                    >
                      {DEPT_LABEL[d]} {on ? "· solo materiale" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => { setForm({ ...initialForm, titolo: defaultTitle, importo: defaultAmount, reparto: defaultReparto }); clearForm(); }}
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
      title="Solo magazzino — dettagli ordine"
      materials={pendingPayload ? extractMaterialsFromSnapshot(pendingPayload.productionSnapshot) : []}
      defaultProductionName={prodName}
      onConfirm={onWarehouseConfirm}
      saving={saving}
    />
    </>
  );
};