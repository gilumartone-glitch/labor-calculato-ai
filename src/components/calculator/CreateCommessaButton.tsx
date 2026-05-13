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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  type FormState = {
    titolo: string; cliente: string; prodName: string; importo: number;
    reparto: CommessaReparto; priorita: CommessaPriorita; scadenza: string;
    note: string; warehouseOnly: boolean;
    materialOnlyDepts: ProdDept[];
  };
  const initialForm: FormState = {
    titolo: defaultTitle, cliente: "", prodName: "",
    importo: defaultAmount, reparto: defaultReparto, priorita: "media",
    scadenza: "", note: "", warehouseOnly: false, materialOnlyDepts: [],
  };
  const [form, setForm, clearForm] = useLocalStorageState<FormState>("calc:create-commessa", initialForm);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const { titolo, cliente, prodName, importo, reparto, priorita, scadenza, note, warehouseOnly, materialOnlyDepts } = form;
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

  const inferredDepts: ProdDept[] = useMemo(
    () => inferProdDeptsFromSnapshot(snapshot as any),
    [snapshot],
  );

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
      const designState = readDesignState();
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
        // Filtra fuori i reparti contrassegnati come "solo materiale" (no lavorazione, solo magazzino).
        const depts: ProdDept[] = allDepts.filter((d) => !materialOnlyDepts.includes(d));
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

        // Inserisce un sub per ogni reparto (sequenza lineare con depends_on).
        const insertedSubs: { id: string; dept: ProdDept }[] = [];
        for (let i = 0; i < depts.length; i++) {
          const d = depts[i];
          const prev = insertedSubs[i - 1] ?? null;
          const { data: sub, error: eSub } = await supabase
            .from("production_sub_orders")
            .insert({
              order_id: pord.id,
              code: subCode(prodCode, SUB_DEPT_SUFFIX[d], i + 1),
              dept: d,
              ordine: i,
              note: titolo.trim() || null,
              files: [],
              depends_on: prev?.id ?? null,
            })
            .select("id")
            .single();
          if (eSub) throw eSub;
          insertedSubs.push({ id: sub.id, dept: d });
        }

        await logAction({
          action: "FLOW_LANCIATO",
          entity_type: "order",
          entity_id: pord.id,
          detail: `Ordine ${prodCode} creato da preventivo per ${clienteName} — ${PRIORITY_LABEL[prodPrio]} (${depts.join(" → ")})`,
          new_state: { code: prodCode, depts, priorita: prodPrio, from: "preventivo" },
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
      setCliente(""); setNote(""); setScadenza(""); setPriorita("media"); setWarehouseOnly(false);
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
        </div>

        <DialogFooter>
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