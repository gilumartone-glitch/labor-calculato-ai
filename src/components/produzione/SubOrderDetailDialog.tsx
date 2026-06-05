import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Lock, FileText, Package, Layers, Scissors, User, Calendar, AlertTriangle, Clock, CheckCircle2, Play, Upload, Loader2, X, ListChecks, Plus, Check, SkipForward, RotateCcw, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import {
  ProdSubOrder, ProdOrder, ProdSubStatus,
  DEPT_LABEL, PRIORITY_LABEL, SUB_STATUS_LABEL, DEPT_COLOR,
} from "@/lib/produzione/types";
import { logAction, notify } from "@/lib/produzione/helpers";
import { usePermissions } from "@/hooks/usePermissions";
import { fmtMm } from "@/lib/produzione/scrap";
import { CHECKLIST_TEMPLATES } from "@/lib/produzione/checklist-templates";
import {
  collectSnapshotDepartments,
  collectSnapshotPieces,
  aggregateSnapshotMaterials,
  type ProdSnapshot,
} from "@/lib/produzione/snapshot";
import { PieceDetail } from "@/components/shared/PieceDetail";
import { NestingPreview } from "@/components/calculator/NestingPreview";
import { mergeCatalogs } from "@/lib/nesting";

type FileItem = { name: string; type?: string; path?: string; size?: number };

type ChecklistItem = {
  id: string;
  sub_id: string;
  ordine: number;
  label: string;
  status: "todo" | "done" | "skipped";
  note: string | null;
  done_by: string | null;
  done_at: string | null;
};

const isImage = (f: FileItem) => /image\//.test(f.type ?? "") || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);

/** Estrae i codici magazzino citati nelle note (es. "(TAP-0001)"). */
const parseInvCodes = (note: string | null): string[] => {
  if (!note) return [];
  const out: string[] = [];
  const re = /\(([A-Z]{2,4}-\d{3,5})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(note))) out.push(m[1]);
  return Array.from(new Set(out));
};

/** Tabs per separare l'elenco pezzi dal nesting nel dialog produzione. */
const PiecesNestingTabs = ({
  pieces,
  mergedNesting,
  deptLabel,
  subDept,
}: {
  pieces: { piece: any; deptLabel: string; catalog: any }[];
  mergedNesting: { pieces: any[]; catalog: any; deptLabel: string; nestingState?: any } | null | undefined;
  deptLabel: string;
  subDept: any;
}) => {
  const [tab, setTab] = useState<"pezzi" | "nesting">("pezzi");
  const hasNesting = !!mergedNesting;
  return (
    <div className="border-2 border-ink/15 rounded-sm overflow-hidden">
      <div className="flex items-center gap-1 bg-muted/30 border-b border-ink/15 p-1">
        <button
          type="button"
          onClick={() => setTab("pezzi")}
          className={`px-3 py-1.5 rounded-sm text-[11px] uppercase tracking-wider font-semibold transition-colors flex items-center gap-1.5 ${
            tab === "pezzi" ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
          }`}
        >
          <Layers className="w-3 h-3" /> Pezzi ({pieces.length})
        </button>
        {hasNesting && (
          <button
            type="button"
            onClick={() => setTab("nesting")}
            className={`px-3 py-1.5 rounded-sm text-[11px] uppercase tracking-wider font-semibold transition-colors flex items-center gap-1.5 ${
              tab === "nesting" ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
            }`}
          >
            <Layers className="w-3 h-3" /> Nesting
          </button>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono uppercase tracking-widest pr-2">
          Reparto: {deptLabel}
        </span>
      </div>
      <div className="p-3">
        {tab === "pezzi" && (
          <div className="space-y-3">
            {pieces.map(({ piece, deptLabel: dl, catalog }, i) => (
              <PieceDetail
                key={(piece.id ?? i) + "-" + i}
                piece={piece}
                deptLabel={dl}
                catalog={catalog}
                index={i + 1}
                filterDept={subDept}
              />
            ))}
            {pieces.length === 0 && (
              <div className="text-[12px] text-muted-foreground text-center py-4">Nessun pezzo da lavorare.</div>
            )}
          </div>
        )}
        {tab === "nesting" && mergedNesting && (
          <NestingPreview
            pieces={mergedNesting.pieces}
            catalog={mergedNesting.catalog}
            nestingState={mergedNesting.nestingState}
            title={`Nesting globale · ${mergedNesting.deptLabel}`}
          />
        )}
      </div>
    </div>
  );
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sub: ProdSubOrder | null;
  order: ProdOrder | null;
  /** Predecessore (per messaggio di lock). */
  predecessor: ProdSubOrder | null;
  onStart: (sub: ProdSubOrder) => Promise<void> | void;
  onComplete: (sub: ProdSubOrder) => void;
};

export const SubOrderDetailDialog = ({ open, onOpenChange, sub, order, predecessor, onStart, onComplete }: Props) => {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const { inventory, scraps, profiles, refreshOrders } = useProdStore();
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loadingChk, setLoadingChk] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [savingAssignee, setSavingAssignee] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const orderFiles: FileItem[] = (order?.attachments as any[]) ?? [];
  const subFiles: FileItem[] = (sub?.files as any[]) ?? [];

  // Snapshot del preventivo (pezzi, materiali, catalog) — usato per "vedere tutto".
  const snapshot = (order?.snapshot as ProdSnapshot | null) ?? null;
  const snapshotDepts = useMemo(() => collectSnapshotDepartments(snapshot), [snapshot]);
  const allPieces = useMemo(() => collectSnapshotPieces(snapshotDepts), [snapshotDepts]);
  const aggregatedMaterials = useMemo(() => aggregateSnapshotMaterials(snapshotDepts), [snapshotDepts]);

  /** Filtra i pezzi pertinenti al reparto del sub corrente. */
  const relevantPieces = useMemo(() => {
    if (!sub) return [];
    if (allPieces.length === 0) return [];
    const dep = sub.dept;
    return allPieces.filter(({ piece, deptKey, catalog }) => {
      const k = (deptKey ?? "").toLowerCase();
      if (dep === "tappezzeria") return k === "tappezzeria";
      if (dep === "falegnameria") return k === "falegnameria";
      if (dep === "stampa") {
        if (k !== "stampa") return false;
        if (piece.printOpId) return true;
        for (const pp of piece.perimeters) {
          const op = catalog?.perimeterOps.find((o) => o.id === pp.opId);
          if ((op?.category ?? "").toLowerCase() === "stampa") return true;
        }
        // Se non c'è una lavorazione di stampa esplicita ma il reparto è stampa, mostriamo comunque
        const hasTaglio = piece.perimeters.some((pp) => {
          const op = catalog?.perimeterOps.find((o) => o.id === pp.opId);
          return (op?.category ?? "").toLowerCase() === "taglio";
        });
        return !hasTaglio;
      }
      if (dep === "taglio") {
        if (k !== "stampa") return false;
        return piece.perimeters.some((pp) => {
          const op = catalog?.perimeterOps.find((o) => o.id === pp.opId);
          return (op?.category ?? "").toLowerCase() === "taglio";
        });
      }
      // grafica / stampa_3d / altro: mostra tutto
      return true;
    });
  }, [sub, allPieces]);

  /** Pezzi raggruppati per catalog (di solito uno solo per reparto) per il nesting. */
  const mergedNesting = useMemo(() => {
    if (!sub) return null as null | { catalog: any; pieces: any[]; deptLabel: string; nestingState?: any };
    const nestingItems = sub.dept === "stampa" || sub.dept === "taglio"
      ? allPieces.filter(({ piece, deptKey, catalog }) => {
          const k = (deptKey ?? "").toLowerCase();
          if (k !== "stampa") return false;
          const hasTaglio = piece.perimeters.some((pp) =>
            (catalog?.perimeterOps.find((o) => o.id === pp.opId)?.category ?? "").toLowerCase() === "taglio",
          );
          const hasStampa = !!piece.printOpId || piece.perimeters.some((pp) =>
            (catalog?.perimeterOps.find((o) => o.id === pp.opId)?.category ?? "").toLowerCase() === "stampa",
          );
          return hasStampa || hasTaglio || (!hasStampa && !hasTaglio);
        })
      : relevantPieces;
    const items = nestingItems.filter((it) => it.catalog);
    if (items.length === 0) return null;
    // Dedup pezzi (stesso pezzo può comparire in più reparti / liste).
    const seenPieces = new Set<string>();
    const pieces: any[] = [];
    for (const it of items) {
      const key = it.piece.id ?? `${it.piece.productName}|${it.piece.width}|${it.piece.height}|${pieces.length}`;
      if (seenPieces.has(key)) continue;
      seenPieces.add(key);
      pieces.push(it.piece);
    }
    const catalogs = Array.from(new Set(items.map((it) => it.catalog)));
    const catalog = mergeCatalogs(catalogs as any[]);
    // Recupera nestingState dal primo reparto coinvolto (es. "stampa") per riprodurre
    // ESATTAMENTE il nesting deciso nel calcolatore.
    const firstDeptKey = items[0].deptKey;
    const srcDept = snapshotDepts.find((d) => d.key === firstDeptKey);
    const nestingState = (srcDept?.state as any)?.nestingState;
    return { catalog, pieces, deptLabel: items[0].deptLabel, nestingState };
  }, [sub, allPieces, relevantPieces, snapshotDepts]);

  const allFiles = useMemo(() => [
    ...orderFiles.map((f) => ({ ...f, _origin: "ordine" as const })),
    ...subFiles.map((f) => ({ ...f, _origin: "sub" as const })),
  ], [orderFiles, subFiles]);

  // Genera signed URLs per tutti i file con path
  useEffect(() => {
    if (!open) return;
    const paths = allFiles.map((f) => f.path).filter(Boolean) as string[];
    if (paths.length === 0) { setSignedUrls({}); return; }
    (async () => {
      const { data, error } = await supabase.storage.from("prod-files").createSignedUrls(paths, 60 * 60);
      if (error) return;
      const map: Record<string, string> = {};
      for (const r of data ?? []) if (r.path && r.signedUrl) map[r.path] = r.signedUrl;
      setSignedUrls(map);
    })();
  }, [open, allFiles]);

  const reservedPieces = useMemo(
    () => (sub ? scraps.filter((p) => p.reserved_for_sub === sub.id) : []),
    [scraps, sub],
  );

  const involvedInv = useMemo(() => {
    if (!sub) return [];
    const ids = new Set<string>();
    for (const p of reservedPieces) ids.add(p.inventory_id);
    for (const c of parseInvCodes(sub.note)) {
      const i = inventory.find((x) => x.code === c);
      if (i) ids.add(i.id);
    }
    return Array.from(ids).map((id) => inventory.find((i) => i.id === id)!).filter(Boolean);
  }, [sub, reservedPieces, inventory]);

  const creator = order ? profiles.find((p) => p.id === order.created_by) : null;
  const isLocked = !!(predecessor && predecessor.status !== "completato");

  /** Carica la checklist e la inizializza dal template se vuota. */
  const loadChecklist = useCallback(async () => {
    if (!sub) return;
    setLoadingChk(true);
    try {
      const { data, error } = await supabase
        .from("production_sub_checklist")
        .select("*")
        .eq("sub_id", sub.id)
        .order("ordine", { ascending: true });
      if (error) throw error;
      let items = (data ?? []) as ChecklistItem[];
      if (items.length === 0) {
        const template = CHECKLIST_TEMPLATES[sub.dept] ?? [];
        if (template.length > 0) {
          const rows = template.map((label, i) => ({
            sub_id: sub.id, ordine: i, label, status: "todo" as const,
          }));
          const { data: ins, error: e2 } = await supabase
            .from("production_sub_checklist")
            .insert(rows)
            .select("*");
          if (e2) throw e2;
          items = (ins ?? []) as ChecklistItem[];
        }
      }
      setChecklist(items);
    } catch (e: any) {
      toast.error(e.message ?? "Errore checklist");
    } finally {
      setLoadingChk(false);
    }
  }, [sub]);

  useEffect(() => {
    if (open && sub) loadChecklist();
    else setChecklist([]);
  }, [open, sub, loadChecklist]);

  const updateItem = async (item: ChecklistItem, patch: Partial<ChecklistItem>) => {
    const prev = checklist;
    const next = checklist.map((x) => x.id === item.id ? { ...x, ...patch } : x);
    setChecklist(next);
    const dbPatch: any = { ...patch };
    if (patch.status === "done") {
      dbPatch.done_by = user?.id ?? null;
      dbPatch.done_at = new Date().toISOString();
    } else if (patch.status === "todo") {
      dbPatch.done_by = null;
      dbPatch.done_at = null;
    }
    const { error } = await supabase.from("production_sub_checklist").update(dbPatch).eq("id", item.id);
    if (error) {
      setChecklist(prev);
      toast.error(error.message);
      return;
    }
    if (patch.status && patch.status !== item.status) {
      await logAction({
        action: "CHECKLIST_AGGIORNATA",
        entity_type: "sub_order", entity_id: item.sub_id,
        detail: `${sub?.code} · "${item.label}" → ${patch.status}`,
      });
    }
  };

  const addItem = async () => {
    if (!sub || !newItemLabel.trim()) return;
    const ordine = (checklist[checklist.length - 1]?.ordine ?? -1) + 1;
    const { data, error } = await supabase
      .from("production_sub_checklist")
      .insert({ sub_id: sub.id, label: newItemLabel.trim(), ordine, status: "todo" })
      .select("*")
      .single();
    if (error) { toast.error(error.message); return; }
    setChecklist((p) => [...p, data as ChecklistItem]);
    setNewItemLabel("");
  };

  const removeItem = async (item: ChecklistItem) => {
    const prev = checklist;
    setChecklist((p) => p.filter((x) => x.id !== item.id));
    const { error } = await supabase.from("production_sub_checklist").delete().eq("id", item.id);
    if (error) { setChecklist(prev); toast.error(error.message); }
  };

  const renameItem = async () => {
    if (!editing || !editing.label.trim()) { setEditing(null); return; }
    const cur = checklist.find((x) => x.id === editing.id);
    if (!cur) { setEditing(null); return; }
    await updateItem(cur, { label: editing.label.trim() });
    setEditing(null);
  };

  const doneCount = checklist.filter((x) => x.status === "done").length;
  const skipCount = checklist.filter((x) => x.status === "skipped").length;
  const allHandled = checklist.length > 0 && checklist.every((x) => x.status !== "todo");

  const handleDownload = async (f: FileItem & { _origin: string }) => {
    if (!f.path) {
      toast.info("File simulato — nessun contenuto da scaricare");
      return;
    }
    const url = signedUrls[f.path];
    if (!url) { toast.error("URL non pronto, riprova"); return; }
    window.open(url, "_blank");
  };

  const uploadSubFile = async (files: FileList | null) => {
    if (!files || !sub || !user) return;
    setUploading(true);
    try {
      const newFiles: FileItem[] = [];
      for (const f of Array.from(files)) {
        const ext = f.name.split(".").pop() ?? "bin";
        const path = `subs/${sub.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error } = await supabase.storage.from("prod-files").upload(path, f, { upsert: false, contentType: f.type });
        if (error) { toast.error(`${f.name}: ${error.message}`); continue; }
        newFiles.push({ name: f.name, type: f.type || ext, path, size: f.size });
      }
      if (newFiles.length === 0) return;
      const merged = [...subFiles, ...newFiles];
      const { error } = await supabase.from("production_sub_orders").update({ files: merged }).eq("id", sub.id);
      if (error) throw error;
      await logAction({
        action: "SUBORDINE_FILE_AGGIUNTO",
        entity_type: "sub_order", entity_id: sub.id,
        detail: `${sub.code} · +${newFiles.length} file`,
      });
      await refreshOrders();
      toast.success(`${newFiles.length} file caricato/i`);
    } catch (e: any) {
      toast.error(e.message ?? "Errore upload");
    } finally {
      setUploading(false);
    }
  };

  const removeSubFile = async (idx: number) => {
    if (!sub) return;
    const f = subFiles[idx];
    if (f.path) await supabase.storage.from("prod-files").remove([f.path]);
    const merged = subFiles.filter((_, i) => i !== idx);
    await supabase.from("production_sub_orders").update({ files: merged }).eq("id", sub.id);
    await refreshOrders();
  };

  if (!sub || !order) return null;

  const dc = DEPT_COLOR[sub.dept];
  const assignee = sub.assignee_id ? profiles.find((p) => p.id === sub.assignee_id) : null;
  const canEditAssignee = !!user && !!order && (user.id === order.created_by || isAdmin);
  const assigneeOptions = profiles;

  const changeAssignee = async (newId: string) => {
    if (!sub || !order) return;
    setSavingAssignee(true);
    try {
      const { error } = await supabase
        .from("production_sub_orders")
        .update({ assignee_id: newId || null })
        .eq("id", sub.id);
      if (error) throw error;
      const newName = profiles.find((p) => p.id === newId)?.display_name ?? "Nessuno";
      await logAction({
        action: "SUBORDINE_ASSEGNATARIO_MODIFICATO",
        entity_type: "sub_order",
        entity_id: sub.id,
        detail: `${sub.code} → ${newName}`,
        new_state: { assignee_id: newId || null },
      });
      if (newId && newId !== sub.assignee_id) {
        await notify({
          userIds: [newId],
          type: "magazzino_da_preparare",
          message: `Ti è stata assegnata: ${sub.code} · ${DEPT_LABEL[sub.dept]} (${order.code})`,
          order_id: order.id,
          link: "/produzione/board",
          is_urgent: order.priorita !== "normale",
        });
      }
      await refreshOrders();
      toast.success("Assegnatario aggiornato");
    } catch (e: any) {
      toast.error(e.message ?? "Errore aggiornamento assegnatario");
    } finally {
      setSavingAssignee(false);
    }
  };

  const canEditSub = canEditAssignee; // stessi diritti per data/note/elimina

  const changeOrderDate = async (newDate: string) => {
    if (!order || !newDate) return;
    setSavingDate(true);
    try {
      const { error } = await supabase
        .from("production_orders")
        .update({ data: newDate })
        .eq("id", order.id);
      if (error) throw error;
      await logAction({
        action: "ORDINE_DATA_MODIFICATA",
        entity_type: "order",
        entity_id: order.id,
        detail: `${order.code} → ${newDate}`,
        new_state: { data: newDate },
      });
      await refreshOrders();
      toast.success("Data aggiornata");
    } catch (e: any) {
      toast.error(e.message ?? "Errore aggiornamento data");
    } finally {
      setSavingDate(false);
    }
  };

  const saveNote = async () => {
    if (!sub || editNote === null) return;
    const trimmed = editNote.trim();
    setSavingNote(true);
    try {
      const { error } = await supabase
        .from("production_sub_orders")
        .update({ note: trimmed || null })
        .eq("id", sub.id);
      if (error) throw error;
      await refreshOrders();
      setEditNote(null);
      toast.success("Istruzioni aggiornate");
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setSavingNote(false);
    }
  };

  const deleteSub = async () => {
    if (!sub || !order) return;
    if (!window.confirm(
      `Eliminare la lavorazione ${sub.code} (${DEPT_LABEL[sub.dept]})?\n\nQuesta azione è irreversibile. Eventuali lavorazioni in sequenza che dipendevano da questa verranno sbloccate e torneranno "in attesa".`
    )) return;
    setDeleting(true);
    try {
      // Sblocca le sub dipendenti: le riporto a 'in_attesa' rimuovendo depends_on
      const { data: depRows } = await supabase
        .from("production_sub_orders")
        .select("id")
        .eq("depends_on", sub.id);
      if (depRows && depRows.length > 0) {
        await supabase
          .from("production_sub_orders")
          .update({ depends_on: null, status: "in_attesa" })
          .in("id", depRows.map((r) => r.id));
      }
      const { error } = await supabase
        .from("production_sub_orders")
        .delete()
        .eq("id", sub.id);
      if (error) throw error;
      await logAction({
        action: "SUBORDINE_ELIMINATO",
        entity_type: "sub_order",
        entity_id: sub.id,
        detail: `${sub.code} (${DEPT_LABEL[sub.dept]}) eliminato da ${order.code}`,
      });
      await refreshOrders();
      toast.success("Lavorazione eliminata");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Errore eliminazione");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
        {/* Banner reparto/ufficio — colorato, BEN VISIBILE: dice immediatamente
            a quale ufficio è destinata la lavorazione e a chi è assegnata. */}
        <div className={`${dc.chip} px-5 py-4 rounded-t-lg`}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-3xl leading-none" aria-hidden>{dc.emoji}</div>
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] opacity-80">Ufficio destinatario</div>
              <div className="font-display text-2xl font-bold leading-tight">{DEPT_LABEL[sub.dept]}</div>
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {canEditAssignee ? (
                <div className="bg-white/15 border border-white/30 rounded-sm pl-2 pr-1 py-0.5 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  <select
                    value={sub.assignee_id ?? ""}
                    disabled={savingAssignee}
                    onChange={(e) => changeAssignee(e.target.value)}
                    className="bg-transparent text-white font-bold uppercase text-[11px] outline-none cursor-pointer hover:bg-white/10 rounded-sm px-1 py-0.5"
                    title="Cambia assegnatario"
                  >
                    <option value="" className="text-ink">— Non assegnato —</option>
                    {assigneeOptions.map((p) => (
                      <option key={p.id} value={p.id} className="text-ink">{p.display_name ?? p.id.slice(0, 6)}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="bg-white/15 border border-white/30 rounded-sm px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  {assignee ? <span className="font-bold">{assignee.display_name ?? "—"}</span> : <span className="opacity-80">Non assegnato</span>}
                </div>
              )}
              {order.priorita !== "normale" && (
                <div className="bg-white/95 text-destructive border border-white rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {PRIORITY_LABEL[order.priorita]}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 flex-wrap pt-3">
            <Badge variant="outline" className={`font-mono ${dc.text} ${dc.border}`}>{sub.code}</Badge>
            <span className="font-mono text-sm text-primary">{order.code}</span>
            <span className="text-base">{order.cliente}</span>
          </DialogTitle>
          {(order.production_name || order.customer_order_ref) && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {order.production_name && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary border border-primary/30 rounded-sm text-[12px] font-bold">
                  {order.production_name}
                </span>
              )}
              {order.customer_order_ref && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-ink/70 border border-ink/15 rounded-sm text-[11px] font-mono">
                  Rif. cliente: {order.customer_order_ref}
                </span>
              )}
            </div>
          )}
          <DialogDescription className="text-[12px]">
            Dettaglio completo della lavorazione assegnata. Scarica i file, controlla materiali e istruzioni.
          </DialogDescription>
        </DialogHeader>


        {/* Banner LOCK */}
        {isLocked && predecessor && (
          <div className="border-2 border-amber-500 bg-amber-50 rounded-sm p-3 flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-[13px]">
              <div className="font-bold text-amber-900">Lavorazione bloccata</div>
              <div className="text-amber-800">
                Devi attendere il completamento di <span className="font-mono font-bold">{predecessor.code} — {DEPT_LABEL[predecessor.dept]}</span> (stato attuale: {SUB_STATUS_LABEL[predecessor.status]}).
              </div>
            </div>
          </div>
        )}

        {/* Banner: ordine manuale senza snapshot calcolatore */}
        {!snapshot && (
          <div className="border-2 border-primary/30 bg-primary/5 rounded-sm p-3 flex items-start gap-3 text-[12px]">
            <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-primary">Lavorazione manuale</div>
              <div className="text-ink/70">
                Questo ordine è stato lanciato senza preventivo dal calcolatore: non ci sono pezzi/nesting da mostrare. Controlla <strong>Nome produzione</strong>, <strong>Note generali</strong>, <strong>Istruzioni per te</strong> e gli <strong>Allegati</strong> qui sotto.
              </div>
            </div>
          </div>
        )}

        {/* Meta in due colonne */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="border-2 border-ink/15 rounded-sm p-3 space-y-1.5 text-[12px]">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Commessa</div>
            <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-muted-foreground" /><strong>{order.cliente}</strong></div>
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              Data ordine:
              {canEditSub ? (
                <input
                  type="date"
                  value={order.data ?? ""}
                  disabled={savingDate}
                  onChange={(e) => changeOrderDate(e.target.value)}
                  className="border border-ink/20 rounded-sm px-1.5 py-0.5 font-mono text-[12px] bg-paper"
                />
              ) : (
                <span>{order.data}</span>
              )}
            </div>
            <div className="flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-muted-foreground" />Consegna: {order.delivery === "ritiro" ? "Ritiro cliente" : order.delivery === "mezzo_proprio" ? "Mezzo proprio" : order.delivery === "corriere" ? "Corriere" : "Spedizione"}</div>
            {creator && <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-muted-foreground" />Lanciato da: <strong>{creator.display_name ?? "—"}</strong></div>}
            {order.note && (
              <div className="mt-2 pt-2 border-t border-ink/10">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Note generali</div>
                <div className="whitespace-pre-wrap font-mono text-[11px]">{order.note}</div>
              </div>
            )}
          </div>

          <div className="border-2 border-ink/15 rounded-sm p-3 space-y-1.5 text-[12px]">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Lavorazione</div>
            <div className="flex items-center gap-2">
              Reparto: <Badge variant="secondary" className="font-mono">{DEPT_LABEL[sub.dept]}</Badge>
            </div>
            <div className="flex items-center gap-2">
              Stato: <Badge variant={sub.status === "completato" ? "default" : "secondary"} className="font-mono">{SUB_STATUS_LABEL[sub.status]}</Badge>
            </div>
            <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-muted-foreground" />Posizione in sequenza: <strong>#{sub.ordine + 1}</strong></div>
            {predecessor && (
              <div className="flex items-center gap-2 text-[11px]">
                <Lock className="w-3 h-3 text-muted-foreground" />Dipende da: <span className="font-mono">{predecessor.code} ({DEPT_LABEL[predecessor.dept]})</span>
              </div>
            )}
            {order.nesting_included && (
              <div className="mt-2 pt-2 border-t border-ink/10 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold text-primary">Nesting incluso</span>
                <span className="text-muted-foreground text-[11px]">— controlla i file allegati</span>
              </div>
            )}
          </div>
        </div>

        {/* Istruzioni del sub — modificabili */}
        <div className="border-2 border-primary/30 bg-primary/5 rounded-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Istruzioni per te</div>
            {canEditSub && editNote === null && (
              <button
                onClick={() => setEditNote(sub.note ?? "")}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-primary hover:underline"
              >
                <Pencil className="w-3 h-3" /> Modifica
              </button>
            )}
          </div>
          {editNote !== null ? (
            <div className="space-y-2">
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                rows={3}
                className="w-full border border-ink/20 rounded-sm p-2 text-[12px] font-mono bg-paper resize-y"
                placeholder="Istruzioni per chi esegue questa lavorazione…"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditNote(null)} disabled={savingNote}>Annulla</Button>
                <Button size="sm" onClick={saveNote} disabled={savingNote}>
                  {savingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salva"}
                </Button>
              </div>
            </div>
          ) : sub.note ? (
            <div className="whitespace-pre-wrap font-mono text-[12px]">{sub.note}</div>
          ) : (
            <div className="text-[11px] text-muted-foreground italic">Nessuna istruzione</div>
          )}
        </div>

        {/* Pezzi da lavorare + Nesting (tabs separati) */}
        {(relevantPieces.length > 0 || mergedNesting) && (
          <PiecesNestingTabs
            pieces={relevantPieces}
            mergedNesting={mergedNesting}
            deptLabel={DEPT_LABEL[sub.dept]}
            subDept={sub.dept as any}
          />
        )}

        {/* Materiali necessari aggregati dal preventivo */}
        {aggregatedMaterials.length > 0 && (
          <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Package className="w-3 h-3" /> Materiali necessari (da preventivo)
            </div>
            <div className="border border-ink/15 rounded-sm overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-ink/5 text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5">Materiale</th>
                    <th className="text-left px-2 py-1.5">Colore</th>
                    <th className="text-left px-2 py-1.5">Base</th>
                    <th className="text-left px-2 py-1.5">Altezza</th>
                    <th className="text-left px-2 py-1.5">Pezzi</th>
                    <th className="text-right px-2 py-1.5">Quantità</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregatedMaterials.map((m, i) => (
                    <tr key={i} className="border-t border-ink/10">
                      <td className="px-2 py-1.5 font-semibold">{m.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{m.color || "—"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground font-mono">{m.base || "—"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{m.height || "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">
                        {m.pieceLabels.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {m.pieceLabels.map((pl, pi) => (
                              <span key={pi} className="inline-block px-1.5 py-0.5 bg-muted/60 rounded-sm font-bold">{pl}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {m.unit ? `${m.qty.toFixed(2)} ${m.unit}` : "—"}
                        {m.note && <div className="text-[10px] text-muted-foreground font-normal">{m.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Checklist */}
        <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <ListChecks className="w-3 h-3" /> Checklist lavorazione
              {checklist.length > 0 && (
                <span className="ml-2 text-ink/70">
                  {doneCount}/{checklist.length} fatti{skipCount > 0 ? ` · ${skipCount} saltati` : ""}
                </span>
              )}
            </div>
            {checklist.length > 0 && (
              <div className="h-1.5 bg-muted rounded-full overflow-hidden flex-1 max-w-[180px]">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round(((doneCount + skipCount) / checklist.length) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {loadingChk ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Caricamento…</div>
          ) : checklist.length === 0 ? (
            <div className="text-[11px] text-muted-foreground font-mono py-2">Nessun punto di controllo. Aggiungine uno qui sotto.</div>
          ) : (
            <ul className="divide-y divide-ink/10">
              {checklist.map((it) => {
                const doneByName = it.done_by ? (profiles.find((p) => p.id === it.done_by)?.display_name ?? "—") : null;
                const isEditing = editing?.id === it.id;
                return (
                  <li key={it.id} className="py-2 flex items-start gap-2">
                    <button
                      onClick={() => updateItem(it, { status: it.status === "done" ? "todo" : "done" })}
                      className={`mt-0.5 w-5 h-5 shrink-0 rounded-sm border-2 grid place-items-center transition-colors ${
                        it.status === "done"
                          ? "bg-emerald-500 border-emerald-600 text-white"
                          : it.status === "skipped"
                          ? "border-ink/30 bg-muted text-ink/40"
                          : "border-ink/40 hover:border-emerald-500"
                      }`}
                      title={it.status === "done" ? "Riapri" : "Conferma fatto"}
                    >
                      {it.status === "done" && <Check className="w-3 h-3" />}
                      {it.status === "skipped" && <SkipForward className="w-3 h-3" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editing!.label}
                            onChange={(e) => setEditing({ id: it.id, label: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") renameItem(); if (e.key === "Escape") setEditing(null); }}
                            autoFocus
                            className="h-7 text-[12px]"
                          />
                          <Button size="sm" variant="outline" onClick={renameItem} className="h-7 px-2"><Check className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-7 px-2"><X className="w-3 h-3" /></Button>
                        </div>
                      ) : (
                        <div className={`text-[12.5px] leading-tight ${it.status === "done" ? "line-through text-ink/50" : it.status === "skipped" ? "italic text-ink/50" : ""}`}>
                          {it.label}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <Input
                          value={it.note ?? ""}
                          onChange={(e) => setChecklist((p) => p.map((x) => x.id === it.id ? { ...x, note: e.target.value } : x))}
                          onBlur={(e) => { if ((e.target.value || "") !== (it.note ?? "")) updateItem(it, { note: e.target.value || null }); }}
                          placeholder="Nota (opzionale)"
                          className="h-6 text-[11px] flex-1 min-w-[140px]"
                        />
                        {it.status === "done" && doneByName && it.done_at && (
                          <span className="text-[10px] font-mono text-emerald-700">
                            ✓ {doneByName} · {new Date(it.done_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {it.status !== "skipped" ? (
                        <button onClick={() => updateItem(it, { status: "skipped" })} className="p-1 text-ink/40 hover:text-amber-600" title="Salta">
                          <SkipForward className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => updateItem(it, { status: "todo" })} className="p-1 text-ink/40 hover:text-primary" title="Riporta in da fare">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isEditing && (
                        <button onClick={() => setEditing({ id: it.id, label: it.label })} className="p-1 text-ink/40 hover:text-primary" title="Modifica">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => removeItem(it)} className="p-1 text-ink/40 hover:text-destructive" title="Elimina">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-ink/10">
            <Input
              value={newItemLabel}
              onChange={(e) => setNewItemLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
              placeholder="Aggiungi punto di controllo…"
              className="h-8 text-[12px]"
            />
            <Button size="sm" variant="outline" onClick={addItem} disabled={!newItemLabel.trim()} className="h-8 gap-1">
              <Plus className="w-3 h-3" /> Aggiungi
            </Button>
          </div>

          {sub.status === "in_lavorazione" && checklist.length > 0 && !allHandled && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-300 rounded-sm px-2 py-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Hai ancora {checklist.length - doneCount - skipCount} punti aperti: completali o saltali prima di chiudere.
            </div>
          )}
        </div>

        {/* Materiali */}
        {(involvedInv.length > 0 || reservedPieces.length > 0) && (
          <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Package className="w-3 h-3" /> Materiali da usare
            </div>
            {involvedInv.map((inv) => {
              const pieces = reservedPieces.filter((p) => p.inventory_id === inv.id);
              return (
                <div key={inv.id} className="border border-ink/10 rounded-sm p-2 text-[12px]">
                  <div className="font-medium">{inv.material_name ?? inv.nome}</div>
                  <div className="text-[10px] text-muted-foreground">
                    <span className="font-mono font-bold text-ink">{inv.code}</span>
                    {inv.material_color && <> · {inv.material_color}</>}
                    {inv.material_height && <> · {inv.material_height}</>}
                    {" · "}Posizione: <strong>{inv.posizione ?? "—"}</strong>
                    {" · "}Intere in stock: <strong>{inv.qty_intera}</strong>
                  </div>
                  {pieces.length > 0 && (
                    <div className="mt-2 border-l-2 border-amber-500 pl-2 space-y-0.5">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700 flex items-center gap-1">
                        <Scissors className="w-3 h-3" /> Sfridi riservati per te
                      </div>
                      {pieces.map((p) => (
                        <div key={p.id} className="text-[11px] font-mono">
                          <Badge variant="outline" className="font-mono text-[10px] mr-1">{p.code}</Badge>
                          {fmtMm(p.w_mm, p.h_mm)} {p.posizione && <>· pos {p.posizione}</>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Allegati */}
        <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <FileText className="w-3 h-3" /> Allegati ({allFiles.length})
            </div>
            <label className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 border-2 border-ink/30 hover:border-primary hover:text-primary rounded-sm cursor-pointer">
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Aggiungi file
              <input type="file" multiple className="hidden" onChange={(e) => uploadSubFile(e.target.files)} />
            </label>
          </div>
          {allFiles.length === 0 ? (
            <div className="text-center text-[11px] text-muted-foreground py-3 font-mono">Nessun allegato</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {allFiles.map((f, i) => {
                const url = f.path ? signedUrls[f.path] : null;
                return (
                  <div key={i} className="border border-ink/15 rounded-sm p-2 flex items-center gap-2">
                    {url && isImage(f) ? (
                      <img src={url} alt={f.name} className="w-12 h-12 object-cover border border-ink/10 rounded-sm" />
                    ) : (
                      <div className="w-12 h-12 grid place-items-center bg-muted rounded-sm">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate font-medium">{f.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {f._origin === "ordine" ? "Da ordine" : "Da sub-ordine"}
                        {f.size && <> · {Math.round(f.size / 1024)} KB</>}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleDownload(f)} className="gap-1 h-7" disabled={!f.path && !url}>
                      <Download className="w-3 h-3" />
                    </Button>
                    {f._origin === "sub" && (
                      <button onClick={() => removeSubFile(subFiles.findIndex((x) => x.path === f.path && x.name === f.name))} className="text-ink/30 hover:text-destructive p-1">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Azioni */}
        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-ink/10">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
          {sub.status === "in_attesa" && !isLocked && (
            <Button onClick={() => onStart(sub)} className="gap-1"><Play className="w-3 h-3" /> Inizia lavorazione</Button>
          )}
          {sub.status === "in_lavorazione" && (
            <Button onClick={() => onComplete(sub)} className="gap-1 bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle2 className="w-3 h-3" /> Completa
            </Button>
          )}
          {isLocked && (
            <Button disabled className="gap-1"><Lock className="w-3 h-3" /> Bloccato</Button>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
