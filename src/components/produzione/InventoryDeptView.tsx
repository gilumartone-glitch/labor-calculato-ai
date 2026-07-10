import { Fragment, useEffect, useMemo, useState } from "react";
import { Search, Save, Loader2, AlertTriangle, Scissors, ChevronRight, ChevronDown, Plus, Minus, PackagePlus } from "lucide-react";
import { AddInventoryDialog } from "@/components/produzione/AddInventoryDialog";
import { toast } from "sonner";
import { useProdStore } from "@/lib/produzione/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { logAction } from "@/lib/produzione/helpers";
import { InvDept, INV_DEPT_LABEL, InvItem } from "@/lib/produzione/types";
import { Catalog, CatalogMaterial, DepartmentKey } from "@/components/calculator/types";
import { loadCatalogCloud } from "@/lib/catalog";
import { ScrapPiecesDialog } from "@/components/produzione/ScrapPiecesDialog";
import { sheetSizeFromCatalog, fmtMm } from "@/lib/produzione/scrap";

/** Vista magazzino di un singolo reparto, riusabile fuori da /produzione. */

const matKey = (m: CatalogMaterial) =>
  [m.name, m.color, m.baseWidth ?? "", m.height, m.thickness ?? "", m.fireproof ?? "", m.finish ?? ""]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .join("|");

/** Etichetta dimensione: per le LASTRE mostra base×altezza (es. "305×205cm"),
 *  per i ROTOLI solo l'altezza rullo (es. "205cm"). */
const dimLabel = (m: CatalogMaterial): string | null => {
  const u = m.heightUnit ?? m.dimUnit ?? "";
  if (m.format === "lastra") {
    if (m.baseWidth && m.height) return `${m.baseWidth}×${m.height}${u}`;
    if (m.height) return `${m.height}${u}`;
    return null;
  }
  return m.height ? `${m.height}${u}` : null;
};

const matLabel = (m: CatalogMaterial) => {
  const bits = [m.color, dimLabel(m), m.thickness && `sp.${m.thickness}`, m.finish, m.fireproof].filter(Boolean);
  return bits.length ? `${m.name} · ${bits.join(" · ")}` : m.name;
};

type Row = {
  key: string;
  material?: CatalogMaterial;
  inv?: InvItem;
  label: string;
  um: string;
};

interface Props {
  /** Reparto da mostrare (corrisponde a InvDept). */
  dept: InvDept;
  /** Catalogo già disponibile in pagina (evita un secondo fetch). Se assente lo carica. */
  catalog?: Catalog | null;
}

export const InventoryDeptView = ({ dept, catalog: catalogProp }: Props) => {
  const { inventory, scraps, loaded, loadAll, refreshInventory } = useProdStore();
  const [catalog, setCatalog] = useState<Catalog | null>(catalogProp ?? null);
  const [loadingCat, setLoadingCat] = useState(!catalogProp);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, { qty_intera?: number; qty_sfrido?: number; posizione?: string; soglia_minima?: number; note?: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [scrapDialog, setScrapDialog] = useState<{ inv: InvItem; label: string } | null>(null);
  const [creatingScrapKey, setCreatingScrapKey] = useState<string | null>(null);
  /** Quantità da aggiungere per ogni riga (+N). Indipendente dall'edit del totale. */
  const [addQty, setAddQty] = useState<Record<string, string>>({});
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Carica i dati di magazzino se non sono già stati caricati dallo store.
  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Carica il catalog del reparto se non passato come prop.
  useEffect(() => {
    if (catalogProp) { setCatalog(catalogProp); setLoadingCat(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingCat(true);
      const c = await loadCatalogCloud(dept as DepartmentKey);
      if (!cancelled) { setCatalog(c); setLoadingCat(false); }
    })();
    return () => { cancelled = true; };
  }, [dept, catalogProp]);

  const invByKey = useMemo(() => {
    const m = new Map<string, InvItem>();
    for (const i of inventory) {
      if (i.material_key) m.set(`${i.reparto}|${i.material_key}`, i);
    }
    return m;
  }, [inventory]);

  const extras = useMemo(
    () => inventory.filter((i) => i.reparto === dept && !i.material_key),
    [inventory, dept],
  );

  /** UM mostrata: per le LASTRE l'unità di stock è "ls" (numero di lastre intere),
   *  non "mq". Lasciamo "mq" per i rotoli/altri formati come da listino. */
  const stockUm = (mat: CatalogMaterial): string => {
    if ((mat.format ?? "") === "lastra") return "ls";
    return mat.unit || "pz";
  };

  const rows: Row[] = useMemo(() => {
    if (!catalog) return [];
    const list: Row[] = catalog.materials.map((mat) => {
      const key = matKey(mat);
      const inv = invByKey.get(`${dept}|${key}`);
      return { key, material: mat, inv, label: matLabel(mat), um: stockUm(mat) };
    });
    list.sort((a, b) => a.label.localeCompare(b.label, "it"));
    return list;
  }, [catalog, dept, invByKey]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const t = q.toLowerCase();
    return rows.filter((r) => r.label.toLowerCase().includes(t) || (r.inv?.code ?? "").toLowerCase().includes(t));
  }, [rows, q]);

  const filteredExtras = extras.filter((e) =>
    !q.trim() || (e.code + " " + e.nome).toLowerCase().includes(q.toLowerCase()),
  );

  /** Righe raggruppate per nome materiale (es. "Forex" → tutte le sue varianti). */
  type Group = { name: string; variants: Row[]; tracked: number; lowStock: number; totalQty: number; um: string };
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const k = (r.material?.name ?? "").trim().toLowerCase() || "—";
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return Array.from(m.entries())
      .map(([, variants]) => {
        const name = variants[0].material?.name ?? "—";
        const tracked = variants.filter((v) => v.inv).length;
        const lowStock = variants.filter((v) => v.inv && v.inv.qty_intera < v.inv.soglia_minima).length;
        const totalQty = variants.reduce((s, v) => s + (v.inv?.qty_intera ?? 0), 0);
        const um = variants[0].um;
        return { name, variants, tracked, lowStock, totalQty, um };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [filtered]);

  // Espansione automatica quando l'utente cerca qualcosa di specifico.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) => setExpanded((p) => {
    const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n;
  });
  const isExpanded = (name: string) => !!q.trim() || expanded.has(name);

  const codeFor = (mat: CatalogMaterial) => {
    const prefix = dept === "tappezzeria" ? "TAP-" : dept === "stampa" ? "LAB-" : dept === "falegnameria" ? "FAL-" : "GEN-";
    const existing = inventory.filter((i) => i.code.startsWith(prefix)).map((i) => parseInt(i.code.replace(/\D/g, ""), 10) || 0);
    return `${prefix}${String((Math.max(0, ...existing)) + 1).padStart(4, "0")}`;
  };

  const ensureInventory = async (row: Row): Promise<InvItem | null> => {
    if (row.inv) return row.inv;
    if (!row.material) return null;
    const code = codeFor(row.material);
    const { data, error } = await supabase.from("inventory_items").insert({
      code, kind: "nuovo", nome: row.material.name, descrizione: row.label,
      qty_intera: 0, qty_sfrido: 0, um: row.um,
      posizione: null, soglia_minima: 5, note: null, reparto: dept,
      material_key: row.key, material_name: row.material.name,
      material_color: row.material.color || null, material_height: row.material.height || null,
      material_attrs: {
        thickness: row.material.thickness ?? "", finish: row.material.finish ?? "",
        fireproof: row.material.fireproof ?? "", composition: row.material.composition ?? "",
        weight: row.material.weight ?? "", format: row.material.format ?? "",
        baseWidth: row.material.baseWidth ?? "", dimUnit: row.material.dimUnit ?? row.material.heightUnit ?? "",
        heightUnit: row.material.heightUnit ?? "",
      },
    }).select().single();
    if (error) { toast.error(error.message); return null; }
    await logAction({ action: "MAGAZZINO_CREATO", entity_type: "inventory", entity_id: code, detail: `${code} · ${row.label} (auto)` });
    await refreshInventory();
    return data as InvItem;
  };

  const openScrapFor = async (row: Row) => {
    setCreatingScrapKey(row.key);
    try {
      const inv = await ensureInventory(row);
      if (inv) setScrapDialog({ inv, label: row.label });
    } finally { setCreatingScrapKey(null); }
  };

  const save = async (row: Row) => {
    const e = edits[row.key];
    if (!e || Object.keys(e).length === 0) return;
    setSavingKey(row.key);
    try {
      if (row.inv) {
        const { error } = await supabase.from("inventory_items").update(e).eq("id", row.inv.id);
        if (error) throw error;
        await logAction({ action: "MAGAZZINO_AGGIORNATO", entity_type: "inventory", entity_id: row.inv.id, detail: `${row.inv.code} · ${row.label}`, prev_state: { qty_intera: row.inv.qty_intera, qty_sfrido: row.inv.qty_sfrido }, new_state: e });
      } else if (row.material) {
        const code = codeFor(row.material);
        const { error } = await supabase.from("inventory_items").insert({
          code, kind: "nuovo", nome: row.material.name, descrizione: row.label,
          qty_intera: e.qty_intera ?? 0, qty_sfrido: e.qty_sfrido ?? 0, um: row.um,
          posizione: e.posizione ?? null, soglia_minima: e.soglia_minima ?? 5, note: e.note ?? null,
          reparto: dept, material_key: row.key, material_name: row.material.name,
          material_color: row.material.color || null, material_height: row.material.height || null,
          material_attrs: {
            thickness: row.material.thickness ?? "", finish: row.material.finish ?? "",
            fireproof: row.material.fireproof ?? "", composition: row.material.composition ?? "",
            weight: row.material.weight ?? "", format: row.material.format ?? "",
            baseWidth: row.material.baseWidth ?? "", dimUnit: row.material.dimUnit ?? row.material.heightUnit ?? "",
            heightUnit: row.material.heightUnit ?? "",
          },
        });
        if (error) throw error;
        await logAction({ action: "MAGAZZINO_CREATO", entity_type: "inventory", entity_id: code, detail: `${code} · ${row.label} (${INV_DEPT_LABEL[dept]})` });
      }
      setEdits((p) => { const n = { ...p }; delete n[row.key]; return n; });
      await refreshInventory();
      toast.success("Salvato");
    } catch (err: any) {
      toast.error(err.message ?? "Errore salvataggio");
    } finally { setSavingKey(null); }
  };

  const update = (key: string, patch: Partial<NonNullable<typeof edits[string]>>) =>
    setEdits((p) => ({ ...p, [key]: { ...(p[key] ?? {}), ...patch } }));

  /** Aggiunge N lastre alla giacenza esistente, creando la riga se serve. Logga l'aggiunta. */
  const addStock = async (row: Row) => {
    const raw = addQty[row.key] ?? "";
    const n = parseFloat(raw.replace(",", "."));
    if (!n || n <= 0) { toast.error("Inserisci una quantità positiva"); return; }
    setAddingKey(row.key);
    try {
      const inv = await ensureInventory(row);
      if (!inv) return;
      const newQty = Number(inv.qty_intera) + n;
      const { error } = await supabase
        .from("inventory_items")
        .update({ qty_intera: newQty })
        .eq("id", inv.id);
      if (error) throw error;
      await logAction({
        action: "MAGAZZINO_CARICO",
        entity_type: "inventory",
        entity_id: inv.id,
        detail: `${inv.code} · +${n} ${row.um} · ${row.label}`,
        prev_state: { qty_intera: inv.qty_intera },
        new_state: { qty_intera: newQty },
      });
      setAddQty((p) => ({ ...p, [row.key]: "" }));
      await refreshInventory();
      toast.success(`+${n} → totale ${newQty} ${row.um}`);
    } catch (e: any) {
      toast.error(e.message ?? "Errore aggiunta");
    } finally {
      setAddingKey(null);
    }
  };

  /** Scarica N lastre dalla giacenza esistente. Non scende sotto 0. */
  const removeStock = async (row: Row) => {
    const raw = addQty[row.key] ?? "";
    const n = parseFloat(raw.replace(",", "."));
    if (!n || n <= 0) { toast.error("Inserisci una quantità positiva"); return; }
    if (!row.inv) { toast.error("Nessuna giacenza da scaricare"); return; }
    const current = Number(row.inv.qty_intera);
    if (n > current) { toast.error(`Disponibili solo ${current} ${row.um}`); return; }
    setAddingKey(row.key);
    try {
      const newQty = current - n;
      const { error } = await supabase
        .from("inventory_items")
        .update({ qty_intera: newQty })
        .eq("id", row.inv.id);
      if (error) throw error;
      await logAction({
        action: "MAGAZZINO_SCARICO",
        entity_type: "inventory",
        entity_id: row.inv.id,
        detail: `${row.inv.code} · −${n} ${row.um} · ${row.label}`,
        prev_state: { qty_intera: current },
        new_state: { qty_intera: newQty },
      });
      setAddQty((p) => ({ ...p, [row.key]: "" }));
      await refreshInventory();
      toast.success(`−${n} → totale ${newQty} ${row.um}`);
    } catch (e: any) {
      toast.error(e.message ?? "Errore scarico");
    } finally {
      setAddingKey(null);
    }
  };

  const totals = useMemo(() => {
    const placed = rows.filter((r) => r.inv).length;
    const lowStock = rows.filter((r) => r.inv && r.inv.qty_intera < r.inv.soglia_minima).length;
    const totScraps = rows.reduce((acc, r) => acc + (r.inv ? scraps.filter((p) => p.inventory_id === r.inv!.id).length : 0), 0);
    return { total: rows.length, placed, lowStock, totScraps };
  }, [rows, scraps]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button
          onClick={() => setAddDialogOpen(true)}
          className="h-12 px-5 text-base font-bold gap-2"
          disabled={!catalog}
        >
          <PackagePlus className="w-5 h-5" />
          Aggiungi a magazzino
        </Button>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
          <Stat label="Articoli" value={totals.total} />
          <Stat label="Tracciati" value={totals.placed} accent="primary" />
          <Stat label="Sfridi" value={totals.totScraps} icon={<Scissors className="w-3 h-3" />} />
          <Stat label="Sotto soglia" value={totals.lowStock} accent="warn" icon={<AlertTriangle className="w-3 h-3" />} />
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="pl-7 h-9 w-64" />
        </div>
      </div>



      <div className="border-2 border-ink/15 rounded-sm bg-paper overflow-hidden">
        {loadingCat ? (
          <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !catalog || catalog.materials.length === 0 ? (
          <div className="p-10 text-center text-[12px] text-muted-foreground">
            Nessun materiale a listino per <strong>{INV_DEPT_LABEL[dept]}</strong>.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wider font-bold sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 w-28">Codice</th>
                  <th className="text-left px-3 py-2">Materiale</th>
                  <th className="text-right px-3 py-2 w-44">Giacenza · aggiungi</th>
                  <th className="text-center px-3 py-2 w-24">Sfrido pz</th>
                  <th className="text-left px-3 py-2 w-12">UM</th>
                  <th className="text-left px-3 py-2 w-28">Lastra</th>
                  <th className="text-left px-3 py-2 w-28">Posizione</th>
                  <th className="text-right px-3 py-2 w-16">Soglia</th>
                  <th className="px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.name}>
                    {/* Riga master del materiale (es. "Forex") */}
                    <tr
                      onClick={() => toggleGroup(g.name)}
                      className="border-t-2 border-ink/15 bg-muted/30 hover:bg-muted/60 cursor-pointer select-none"
                    >
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-ink/60">
                        <span className="inline-flex items-center gap-1">
                          {isExpanded(g.name) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-display font-semibold text-[13px]">{g.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {g.variants.length} variant{g.variants.length === 1 ? "e" : "i"}
                          {g.tracked > 0 && <> · {g.tracked} tracciat{g.tracked === 1 ? "a" : "e"}</>}
                          {g.lowStock > 0 && <> · <span className="text-amber-700 font-bold">{g.lowStock} sotto soglia</span></>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] font-bold">
                        {g.totalQty > 0 ? `${g.totalQty.toLocaleString("it-IT")} ${g.um}` : <span className="text-ink/30">—</span>}
                      </td>
                      <td colSpan={6} className="px-3 py-2 text-[10px] text-ink/40 italic">
                        {isExpanded(g.name) ? "" : "Click per vedere spessori e colori"}
                      </td>
                    </tr>

                    {/* Varianti */}
                    {isExpanded(g.name) && g.variants.map((r) => {
                  const e = edits[r.key] ?? {};
                  const dirty = Object.keys(e).length > 0;
                  const qty = e.qty_intera ?? r.inv?.qty_intera ?? 0;
                  const soglia = e.soglia_minima ?? r.inv?.soglia_minima ?? 5;
                  const lowStock = r.inv && qty < soglia;
                  const tracked = !!r.inv;
                  const sheet = sheetSizeFromCatalog(r.material);
                  const myScraps = r.inv ? scraps.filter((p) => p.inventory_id === r.inv!.id) : [];
                  return (
                    <tr key={r.key} className={`border-t hover:bg-muted/30 ${lowStock ? "bg-amber-50/40" : !tracked ? "bg-muted/10" : ""}`}>
                      <td className="px-3 py-1.5 font-mono text-[11px] font-bold">
                        {r.inv?.code ?? <span className="text-ink/30">—</span>}
                      </td>
                      <td className="px-3 py-1.5 pl-8">
                        <div className="text-[11px] text-ink/80">
                          {[r.material?.color, r.material?.thickness && `sp.${r.material.thickness}`, r.material ? dimLabel(r.material) : null, r.material?.finish, r.material?.fireproof].filter(Boolean).join(" · ") || <span className="italic text-ink/40">variante base</span>}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {/* Totale corrente, sempre visibile */}
                          <span
                            className={`font-mono font-bold tabular-nums text-[12px] min-w-[3ch] text-right ${
                              lowStock ? "text-destructive" : "text-ink"
                            }`}
                            title="Giacenza attuale"
                          >
                            {r.inv?.qty_intera ?? 0}
                          </span>
                          <span className="text-[10px] font-mono text-ink/40">{r.um}</span>
                          {/* Quick-add: +N */}
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={addQty[r.key] ?? ""}
                            onChange={(ev) => setAddQty((p) => ({ ...p, [r.key]: ev.target.value }))}
                            onKeyDown={(ev) => { if (ev.key === "Enter") addStock(r); }}
                            placeholder="+N"
                            className="h-7 w-14 text-[11px] text-right border border-ink/20 rounded-sm px-1 bg-background"
                            title="Quantità da aggiungere alla giacenza"
                          />
                          <button
                            onClick={() => addStock(r)}
                            disabled={addingKey === r.key || !addQty[r.key]}
                            className="inline-flex items-center justify-center h-7 w-7 border border-primary/40 text-primary rounded-sm hover:bg-primary hover:text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Aggiungi alla giacenza"
                          >
                            {addingKey === r.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={() => openScrapFor(r)} disabled={creatingScrapKey === r.key}
                          className={`inline-flex items-center gap-1 px-2 h-7 text-[11px] font-mono font-bold border rounded-sm transition-colors disabled:opacity-50 ${myScraps.length > 0 ? "border-ink/20 hover:bg-primary hover:text-primary-foreground hover:border-primary" : "border-dashed border-ink/30 text-ink/50 hover:bg-primary hover:text-primary-foreground hover:border-primary"}`}
                          title="Gestisci pezzi di sfrido">
                          {creatingScrapKey === r.key ? <Loader2 className="w-3 h-3 animate-spin" /> : (<><Scissors className="w-3 h-3" /> {myScraps.length > 0 ? myScraps.length : "+ pezzo"}</>)}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-[11px] font-mono text-ink/60">{r.um}</td>
                      <td className="px-3 py-1.5 text-[11px] font-mono">
                        {sheet ? <span className="text-ink/70">{fmtMm(sheet.w, sheet.h)}</span> : <span className="text-ink/30 italic">non def.</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="text" defaultValue={r.inv?.posizione ?? ""}
                          onChange={(ev) => update(r.key, { posizione: ev.target.value })}
                          className="h-7 w-full text-[11px] border border-ink/20 rounded-sm px-1 bg-background"
                          placeholder="es. A3" />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" step="0.5" defaultValue={r.inv?.soglia_minima ?? 5}
                          onChange={(ev) => update(r.key, { soglia_minima: Number(ev.target.value) })}
                          className="h-7 w-14 text-[11px] text-right border border-ink/20 rounded-sm px-1 bg-background" />
                      </td>
                      <td className="px-3 py-1.5">
                        {dirty && (
                          <Button size="sm" onClick={() => save(r)} disabled={savingKey === r.key} className="h-7 px-2">
                            {savingKey === r.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filteredExtras.length > 0 && (
        <div className="border-2 border-ink/15 rounded-sm bg-paper overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 border-b font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Sfridi e voci manuali ({filteredExtras.length})
          </div>
          <table className="w-full text-[12px]">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider font-bold">
              <tr>
                <th className="text-left px-3 py-2">Codice</th>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Sfrido</th>
                <th className="text-left px-3 py-2">Posizione</th>
              </tr>
            </thead>
            <tbody>
              {filteredExtras.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-[11px] font-bold">{e.code}</td>
                  <td className="px-3 py-1.5">{e.nome}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px]">{e.qty_intera} {e.um}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px]">{e.qty_sfrido} {e.um}</td>
                  <td className="px-3 py-1.5 text-[11px] text-ink/60">{e.posizione ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ScrapPiecesDialog
        open={!!scrapDialog}
        onOpenChange={(v) => !v && setScrapDialog(null)}
        inv={scrapDialog?.inv ?? null}
        matLabel={scrapDialog?.label}
      />
      <AddInventoryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        dept={dept}
        catalog={catalog}
      />
    </div>
  );
};

const Stat = ({ label, value, accent, icon }: { label: string; value: number; accent?: "primary" | "warn"; icon?: React.ReactNode }) => (
  <div className="border-2 border-ink/15 bg-paper rounded-sm p-2">
    <div className="font-mono text-[10px] uppercase text-muted-foreground flex items-center gap-1">{icon}{label}</div>
    <div className={`font-display text-xl font-bold ${accent === "primary" ? "text-primary" : accent === "warn" ? "text-amber-600" : ""}`}>{value}</div>
  </div>
);