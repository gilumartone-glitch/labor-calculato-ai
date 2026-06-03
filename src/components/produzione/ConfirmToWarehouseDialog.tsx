import { useEffect, useMemo, useState } from "react";
import { Loader2, PackageCheck, ShoppingCart, Pencil, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ContactSelect } from "@/components/produzione/ContactSelect";
import { ProdDept, WORK_DEPTS, DEPT_LABEL, DEPT_COLOR } from "@/lib/produzione/types";

export type WarehouseMaterialItem = {
  key: string;
  label: string;
  detail?: string;
  /** Quantità da acquistare (es. 12.5). */
  qty?: number;
  /** Unità di misura (es. "m²", "m"). */
  unit?: string;
  /** Codice/identificativo materiale. */
  code?: string;
};

export type MissingMaterial = {
  key: string;
  label: string;
  detail?: string;
  supplier_name?: string | null;
  qty?: number;
  unit?: string;
  code?: string;
};

export type WarehouseConfirmData = {
  customer_order_ref: string;
  production_name: string;
  assignee_id: string;
  assignee_name: string;
  missing: MissingMaterial[];
  acquisti_assignee_id?: string | null;
  acquisti_assignee_name?: string | null;
  /** Reparto di LAVORAZIONE scelto (laboratorio / tappezzeria / grafica). */
  work_dept: ProdDept;
  /** Se true, viene creato anche un sub-ordine "Amministrazione" per la chiusura/bolla. */
  create_admin_closure: boolean;
};

type MagazzinoUser = { id: string; display_name: string | null };

export const ConfirmToWarehouseDialog = ({
  open,
  onOpenChange,
  title = "Conferma e invia al magazzino",
  defaultRef = "",
  defaultProductionName = "",
  materials = [],
  onConfirm,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  defaultRef?: string;
  defaultProductionName?: string;
  materials?: WarehouseMaterialItem[];
  onConfirm: (data: WarehouseConfirmData) => Promise<void> | void;
  saving?: boolean;
}) => {
  const [users, setUsers] = useState<MagazzinoUser[]>([]);
  const [acquistiUsers, setAcquistiUsers] = useState<MagazzinoUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [ref, setRef] = useState(defaultRef);
  const [prodName, setProdName] = useState(defaultProductionName);
  const [assignee, setAssignee] = useState<string>("");
  const [acquistiAssignee, setAcquistiAssignee] = useState<string>("");
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});

  // Sezioni richiuse di default quando già valorizzate
  const [editRef, setEditRef] = useState(false);
  const [editAssignee, setEditAssignee] = useState(false);
  const [editAcquisti, setEditAcquisti] = useState(false);

  useEffect(() => {
    if (!open) return;
    const clear = () => { document.body.style.pointerEvents = ""; };
    clear();
    const raf = requestAnimationFrame(clear);
    const timers = [50, 120, 250, 400].map((d) => window.setTimeout(clear, d));
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRef(defaultRef);
    setProdName(defaultProductionName);
    setEditRef(!defaultRef);
    setEditAssignee(false);
    setEditAcquisti(false);
    const init: Record<string, boolean> = {};
    materials.forEach((m) => { init[m.key] = true; });
    setAvailable(init);
    setSuppliers({});
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: m }, { data: a }] = await Promise.all([
        supabase.from("profiles").select("id, display_name").contains("settori", ["magazzino"]).order("display_name", { ascending: true }),
        supabase.from("profiles").select("id, display_name").contains("settori", ["acquisti"]).order("display_name", { ascending: true }),
      ]);
      if (cancelled) return;
      const list = (m ?? []) as MagazzinoUser[];
      const aList = (a ?? []) as MagazzinoUser[];
      setUsers(list);
      setAcquistiUsers(aList);
      if (list.length > 0) setAssignee(list[0].id);
      if (aList.length > 0) setAcquistiAssignee(aList[0].id);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const missing: MissingMaterial[] = materials
    .filter((m) => !available[m.key])
    .map((m) => ({
      key: m.key, label: m.label, detail: m.detail, qty: m.qty, unit: m.unit, code: m.code,
      supplier_name: suppliers[m.key]?.trim() || null,
    }));
  const hasMissing = missing.length > 0;

  const assigneeName = useMemo(() => users.find((u) => u.id === assignee)?.display_name ?? "", [users, assignee]);
  const acquistiAssigneeName = useMemo(() => acquistiUsers.find((u) => u.id === acquistiAssignee)?.display_name ?? "", [acquistiUsers, acquistiAssignee]);

  const handle = async () => {
    if (!ref.trim()) { toast.error("Inserisci il numero ordine cliente"); setEditRef(true); return; }
    if (!assignee) { toast.error("Seleziona il responsabile magazzino"); return; }
    if (hasMissing && !acquistiAssignee) { toast.error("Seleziona il responsabile acquisti per i materiali mancanti"); return; }
    if (hasMissing) {
      const noSupplier = missing.find((m) => !m.supplier_name);
      if (noSupplier) { toast.error(`Indica il fornitore per: ${noSupplier.label}`); return; }
    }
    await onConfirm({
      customer_order_ref: ref.trim(),
      production_name: prodName.trim(),
      assignee_id: assignee,
      assignee_name: assigneeName,
      missing,
      acquisti_assignee_id: hasMissing ? acquistiAssignee : null,
      acquisti_assignee_name: hasMissing ? acquistiAssigneeName : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <PackageCheck className="w-5 h-5" /> {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Riepilogo compatto ordine + nome produzione */}
          {!editRef && (ref || prodName) ? (
            <div className="flex items-center justify-between gap-2 border border-ink/15 rounded-sm px-3 py-2 bg-muted/30">
              <div className="text-[11px] font-mono">
                <span className="text-muted-foreground uppercase tracking-wider">Ordine</span>{" "}
                <span className="font-bold text-ink">{ref || "—"}</span>
                {prodName && <> · <span className="text-muted-foreground">Prod.</span> <span className="font-semibold text-ink">{prodName}</span></>}
              </div>
              <button type="button" onClick={() => setEditRef(true)} className="text-[10px] uppercase tracking-wider text-primary hover:underline flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Modifica
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Numero ordine cliente *</Label>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="es. PO-12345" autoFocus />
              </div>
              <div>
                <Label>Prod. (nome progetto/film)</Label>
                <Input value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="es. Avatar 3" />
              </div>
            </div>
          )}

          {materials.length > 0 && (
            <div>
              <Label>Disponibilità materiali *</Label>
              <div className="text-[10px] font-mono text-muted-foreground mb-2">Spunta i materiali presenti in magazzino. Per quelli da ordinare indica il fornitore.</div>
              <div className="border-2 border-ink/15 rounded-sm divide-y divide-ink/10 max-h-56 overflow-y-auto">
                {materials.map((m) => {
                  const ok = !!available[m.key];
                  const qtyTxt = m.qty != null && m.unit ? `${m.qty.toFixed(2)} ${m.unit}` : null;
                  return (
                    <div key={m.key} className={`px-3 py-2 ${ok ? "" : "bg-amber-50/60"}`}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={ok} onChange={(e) => setAvailable((c) => ({ ...c, [m.key]: e.target.checked }))} className="mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-ink truncate flex items-center gap-2">
                            {m.label}
                            {qtyTxt && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-ink text-paper">{qtyTxt}</span>
                            )}
                          </div>
                          {m.detail && <div className="text-[10px] font-mono text-muted-foreground truncate">{m.detail}</div>}
                        </div>
                        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-200 text-amber-900"}`}>
                          {ok ? "In magazzino" : "Da ordinare"}
                        </span>
                      </label>
                      {!ok && (
                        <div className="mt-2 ml-6">
                          <div className="text-[9px] font-mono uppercase tracking-wider text-amber-900 mb-1">Fornitore *</div>
                          <ContactSelect size="sm" type="fornitore" value={suppliers[m.key] ?? ""} onChange={(v) => setSuppliers((s) => ({ ...s, [m.key]: v }))} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Responsabile magazzino: collapsed se già impostato */}
          {!editAssignee && assignee && !loading ? (
            <div className="flex items-center justify-between gap-2 border border-ink/15 rounded-sm px-3 py-2 bg-muted/30">
              <div className="text-[11px] font-mono">
                <span className="text-muted-foreground uppercase tracking-wider">Responsabile mag.</span>{" "}
                <span className="font-bold text-ink">{assigneeName || assignee.slice(0, 8)}</span>
              </div>
              <button type="button" onClick={() => setEditAssignee(true)} className="text-[10px] uppercase tracking-wider text-primary hover:underline flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Cambia
              </button>
            </div>
          ) : (
            <div>
              <Label>Responsabile magazzino *</Label>
              {loading ? (
                <div className="text-[11px] text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> Caricamento…</div>
              ) : users.length === 0 ? (
                <div className="text-[11px] text-destructive py-2 border border-destructive/30 bg-destructive/5 rounded-sm px-2">
                  Nessun utente con settore "magazzino". Vai in <a href="/admin/utenti" className="underline font-bold">Gestione utenti</a> → riga utente → colonna Settori → clicca "Magazzino".
                </div>
              ) : (
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="w-full h-10 px-3 border-2 border-input rounded-md bg-background text-sm"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name || u.id.slice(0, 8)}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {hasMissing && (
            <div className="border-2 border-amber-400 bg-amber-50/40 rounded-sm p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider font-bold text-amber-900">
                <ShoppingCart className="w-3.5 h-3.5" /> Acquisti — {missing.length} materiale/i da ordinare
              </div>
              {!editAcquisti && acquistiAssignee ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-mono">
                    <span className="text-muted-foreground uppercase tracking-wider">Resp. acquisti</span>{" "}
                    <span className="font-bold text-amber-900">{acquistiAssigneeName || acquistiAssignee.slice(0, 8)}</span>
                  </div>
                  <button type="button" onClick={() => setEditAcquisti(true)} className="text-[10px] uppercase tracking-wider text-amber-900 hover:underline flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> Cambia
                  </button>
                </div>
              ) : (
                <>
                  <Label>Responsabile acquisti *</Label>
                  {acquistiUsers.length === 0 ? (
                    <div className="text-[11px] text-destructive border border-destructive/30 bg-destructive/5 rounded-sm px-2 py-1">
                      Nessun utente con settore "acquisti". Vai in <a href="/admin/utenti" className="underline font-bold">Gestione utenti</a> e assegna il settore.
                    </div>
                  ) : (
                    <select
                      value={acquistiAssignee}
                      onChange={(e) => setAcquistiAssignee(e.target.value)}
                      className="w-full h-10 px-3 border-2 border-input rounded-md bg-background text-sm"
                    >
                      {acquistiUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.display_name || u.id.slice(0, 8)}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <div className="text-[10px] font-mono text-amber-900">
                La preparazione magazzino sarà sbloccata quando tutti i materiali risulteranno arrivati.
              </div>
            </div>
          )}

          <div className="text-[10px] font-mono text-muted-foreground border-t border-dashed border-ink/20 pt-2">
            I responsabili riceveranno una notifica con il dettaglio dell'ordine.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
          <Button onClick={handle} disabled={saving || loading || users.length === 0 || (hasMissing && acquistiUsers.length === 0)}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}
            Conferma e notifica
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
