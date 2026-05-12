import { useEffect, useMemo, useState } from "react";
import { Search, Save, Loader2, Package, AlertTriangle, Plus, Scissors, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ProdLayout } from "@/components/produzione/ProdLayout";
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

const REPARTI: InvDept[] = ["tappezzeria", "stampa", "falegnameria"];

/** Chiave stabile di un materiale del listino. */
const matKey = (m: CatalogMaterial) =>
  [m.name, m.color, m.height, m.thickness ?? "", m.fireproof ?? "", m.finish ?? ""]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .join("|");

const matLabel = (m: CatalogMaterial) => {
  const bits = [m.color, m.height && `${m.height}${m.heightUnit ?? ""}`, m.thickness && `sp.${m.thickness}`, m.finish, m.fireproof].filter(Boolean);
  return bits.length ? `${m.name} · ${bits.join(" · ")}` : m.name;
};

type Row = {
  key: string;
  material?: CatalogMaterial;
  inv?: InvItem; // existing inventory record
  label: string;
  um: string;
};

const ProdInventory = () => {
  const { inventory, scraps, refreshInventory } = useProdStore();
  const [tab, setTab] = useState<InvDept>("tappezzeria");
  const [catalogs, setCatalogs] = useState<Record<DepartmentKey, Catalog | null>>({ tappezzeria: null, stampa: null, falegnameria: null });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, { qty_intera?: number; qty_sfrido?: number; posizione?: string; soglia_minima?: number; note?: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [scrapDialog, setScrapDialog] = useState<{ inv: InvItem; label: string } | null>(null);
  const [creatingScrapKey, setCreatingScrapKey] = useState<string | null>(null);

  // Carica i 3 cataloghi
  useEffect(() => {
    (async () => {
      const [t, s, f] = await Promise.all([
        loadCatalogCloud("tappezzeria"),
        loadCatalogCloud("stampa"),
        loadCatalogCloud("falegnameria"),
      ]);
      setCatalogs({ tappezzeria: t, stampa: s, falegnameria: f });
      setLoading(false);
    })();
  }, []);

  // Indice voci magazzino per (reparto + material_key)
  const invByKey = useMemo(() => {
    const m = new Map<string, InvItem>();
    for (const i of inventory) {
      if (i.material_key) m.set(`${i.reparto}|${i.material_key}`, i);
    }
    return m;
  }, [inventory]);

  // Voci extra (sfridi/voci manuali senza material_key) per reparto
  const extrasByDept = useMemo(() => {
    const m: Record<string, InvItem[]> = {};
    for (const i of inventory) {
      if (!i.material_key) (m[i.reparto] ??= []).push(i);
    }
    return m;
  }, [inventory]);

  const rows: Row[] = useMemo(() => {
    const cat = catalogs[tab as DepartmentKey];
    if (!cat) return [];
    const list: Row[] = cat.materials.map((mat) => {
      const key = matKey(mat);
      const inv = invByKey.get(`${tab}|${key}`);
      return { key, material: mat, inv, label: matLabel(mat), um: mat.unit || "pz" };
    });
    // ordina per nome
    list.sort((a, b) => a.label.localeCompare(b.label, "it"));
    return list;
  }, [catalogs, tab, invByKey]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const t = q.toLowerCase();
    return rows.filter((r) => r.label.toLowerCase().includes(t) || (r.inv?.code ?? "").toLowerCase().includes(t));
  }, [rows, q]);

  const extras = (extrasByDept[tab] ?? []).filter((e) =>
    !q.trim() || (e.code + " " + e.nome).toLowerCase().includes(q.toLowerCase())
  );

  /** Genera un codice se la voce non esiste ancora. */
  const codeFor = (mat: CatalogMaterial) => {
    const prefix = tab === "tappezzeria" ? "TAP-" : tab === "stampa" ? "LAB-" : "FAL-";
    const existing = inventory.filter((i) => i.code.startsWith(prefix)).map((i) => parseInt(i.code.replace(/\D/g, ""), 10) || 0);
    return `${prefix}${String((Math.max(0, ...existing)) + 1).padStart(4, "0")}`;
  };

  /** Crea la riga magazzino al volo (qty 0) se manca, e la restituisce. */
  const ensureInventory = async (row: Row): Promise<InvItem | null> => {
    if (row.inv) return row.inv;
    if (!row.material) return null;
    const code = codeFor(row.material);
    const { data, error } = await supabase.from("inventory_items").insert({
      code,
      kind: "nuovo",
      nome: row.material.name,
      descrizione: row.label,
      qty_intera: 0,
      qty_sfrido: 0,
      um: row.um,
      posizione: null,
      soglia_minima: 5,
      note: null,
      reparto: tab,
      material_key: row.key,
      material_name: row.material.name,
      material_color: row.material.color || null,
      material_height: row.material.height || null,
      material_attrs: {
        thickness: row.material.thickness ?? "",
        finish: row.material.finish ?? "",
        fireproof: row.material.fireproof ?? "",
        composition: row.material.composition ?? "",
        weight: row.material.weight ?? "",
        format: row.material.format ?? "",
      },
    }).select().single();
    if (error) { toast.error(error.message); return null; }
    await logAction({
      action: "MAGAZZINO_CREATO", entity_type: "inventory", entity_id: code,
      detail: `${code} · ${row.label} (auto, per gestione sfrido)`,
    });
    await refreshInventory();
    return data as InvItem;
  };

  const openScrapFor = async (row: Row) => {
    setCreatingScrapKey(row.key);
    try {
      const inv = await ensureInventory(row);
      if (inv) setScrapDialog({ inv, label: row.label });
    } finally {
      setCreatingScrapKey(null);
    }
  };

  const save = async (row: Row) => {
    const e = edits[row.key];
    if (!e || Object.keys(e).length === 0) return;
    setSavingKey(row.key);
    try {
      if (row.inv) {
        const { error } = await supabase.from("inventory_items").update(e).eq("id", row.inv.id);
        if (error) throw error;
        await logAction({
          action: "MAGAZZINO_AGGIORNATO", entity_type: "inventory", entity_id: row.inv.id,
          detail: `${row.inv.code} · ${row.label}`,
          prev_state: { qty_intera: row.inv.qty_intera, qty_sfrido: row.inv.qty_sfrido },
          new_state: e,
        });
      } else if (row.material) {
        const code = codeFor(row.material);
        const { error } = await supabase.from("inventory_items").insert({
          code,
          kind: "nuovo",
          nome: row.material.name,
          descrizione: row.label,
          qty_intera: e.qty_intera ?? 0,
          qty_sfrido: e.qty_sfrido ?? 0,
          um: row.um,
          posizione: e.posizione ?? null,
          soglia_minima: e.soglia_minima ?? 5,
          note: e.note ?? null,
          reparto: tab,
          material_key: row.key,
          material_name: row.material.name,
          material_color: row.material.color || null,
          material_height: row.material.height || null,
          material_attrs: {
            thickness: row.material.thickness ?? "",
            finish: row.material.finish ?? "",
            fireproof: row.material.fireproof ?? "",
            composition: row.material.composition ?? "",
            weight: row.material.weight ?? "",
            format: row.material.format ?? "",
          },
        });
        if (error) throw error;
        await logAction({
          action: "MAGAZZINO_CREATO", entity_type: "inventory", entity_id: code,
          detail: `${code} · ${row.label} (${INV_DEPT_LABEL[tab]})`,
        });
      }
      setEdits((p) => { const n = { ...p }; delete n[row.key]; return n; });
      await refreshInventory();
      toast.success("Salvato");
    } catch (err: any) {
      toast.error(err.message ?? "Errore salvataggio");
    } finally {
      setSavingKey(null);
    }
  };

  const update = (key: string, patch: Partial<NonNullable<typeof edits[string]>>) => {
    setEdits((p) => ({ ...p, [key]: { ...(p[key] ?? {}), ...patch } }));
  };

  const tabCat = catalogs[tab as DepartmentKey];
  const totals = useMemo(() => {
    const placed = rows.filter((r) => r.inv).length;
    const lowStock = rows.filter((r) => r.inv && r.inv.qty_intera < r.inv.soglia_minima).length;
    const totScraps = rows.reduce((acc, r) => acc + (r.inv ? scraps.filter((p) => p.inventory_id === r.inv!.id).length : 0), 0);
    return { total: rows.length, placed, lowStock, totScraps };
  }, [rows, scraps]);

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
              <Package className="w-6 h-6" /> Magazzino
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Le voci provengono dai listini di Tappezzeria, Laboratorio e Falegnameria.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/produzione/trova-materiale">
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Wand2 className="w-3.5 h-3.5" /> Trova materiale
              </Button>
            </Link>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink/40" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="pl-7 h-9 w-72" />
            </div>
          </div>
        </div>

        {/* Tabs reparto */}
        <div className="flex gap-1 border-b-2 border-ink/15">
          {REPARTI.map((d) => {
            const cat = catalogs[d as DepartmentKey];
            const count = cat?.materials.length ?? 0;
            const active = d === tab;
            return (
              <button
                key={d}
                onClick={() => setTab(d)}
                className={`px-4 py-2 text-[12px] uppercase tracking-wider font-bold border-b-2 -mb-[2px] transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-ink/50 hover:text-ink"
                }`}
              >
                {INV_DEPT_LABEL[d]} <span className="font-mono text-[10px] text-ink/40 ml-1">({count})</span>
              </button>
            );
          })}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3">
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-3">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Articoli a listino</div>
            <div className="font-display text-2xl font-bold">{totals.total}</div>
          </div>
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-3">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Tracciati in magazzino</div>
            <div className="font-display text-2xl font-bold text-primary">{totals.placed}</div>
          </div>
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-3">
            <div className="font-mono text-[10px] uppercase text-muted-foreground flex items-center gap-1">
              <Scissors className="w-3 h-3" /> Pezzi sfrido tracciati
            </div>
            <div className="font-display text-2xl font-bold">{totals.totScraps}</div>
          </div>
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-3">
            <div className="font-mono text-[10px] uppercase text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-600" /> Sotto soglia
            </div>
            <div className="font-display text-2xl font-bold text-amber-600">{totals.lowStock}</div>
          </div>
        </div>

        <div className="border-2 border-ink/15 rounded-sm bg-paper overflow-hidden">
          {loading ? (
            <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : !tabCat || tabCat.materials.length === 0 ? (
            <div className="p-10 text-center text-[12px] text-muted-foreground">
              Nessun materiale nel listino di <strong>{INV_DEPT_LABEL[tab]}</strong>.<br />
              Importa il listino dalla sezione Preventivi → {INV_DEPT_LABEL[tab]}.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50 text-[10px] uppercase tracking-wider font-bold sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 w-32">Codice</th>
                    <th className="text-left px-3 py-2">Materiale</th>
                    <th className="text-right px-3 py-2 w-28">Qty intera</th>
                    <th className="text-center px-3 py-2 w-24">Sfrido pz</th>
                    <th className="text-left px-3 py-2 w-14">UM</th>
                    <th className="text-left px-3 py-2 w-32">Lastra (mm)</th>
                    <th className="text-left px-3 py-2 w-32">Posizione</th>
                    <th className="text-right px-3 py-2 w-20">Soglia</th>
                    <th className="px-3 py-2 w-14"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
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
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{r.material?.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {[r.material?.color, r.material?.height && `${r.material.height}${r.material.heightUnit ?? ""}`, r.material?.thickness && `sp.${r.material.thickness}`, r.material?.finish, r.material?.fireproof].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input type="number" step="0.01"
                            defaultValue={r.inv?.qty_intera ?? ""}
                            onChange={(ev) => update(r.key, { qty_intera: Number(ev.target.value) })}
                            className={`h-7 w-20 text-[11px] text-right border rounded-sm px-1 bg-background ${lowStock ? "border-destructive text-destructive font-bold" : "border-ink/20"}`}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            onClick={() => openScrapFor(r)}
                            disabled={creatingScrapKey === r.key}
                            className={`inline-flex items-center gap-1 px-2 h-7 text-[11px] font-mono font-bold border rounded-sm transition-colors disabled:opacity-50 ${
                              myScraps.length > 0
                                ? "border-ink/20 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                                : "border-dashed border-ink/30 text-ink/50 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                            }`}
                            title="Gestisci pezzi di sfrido"
                          >
                            {creatingScrapKey === r.key ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Scissors className="w-3 h-3" /> {myScraps.length > 0 ? myScraps.length : "+ pezzo"}
                              </>
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-[11px] font-mono text-ink/60">{r.um}</td>
                        <td className="px-3 py-1.5 text-[11px] font-mono">
                          {sheet ? (
                            <span className="text-ink/70">{fmtMm(sheet.w, sheet.h)}</span>
                          ) : (
                            <span className="text-ink/30 italic">non def.</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="text"
                            defaultValue={r.inv?.posizione ?? ""}
                            onChange={(ev) => update(r.key, { posizione: ev.target.value })}
                            className="h-7 w-full text-[11px] border border-ink/20 rounded-sm px-1 bg-background"
                            placeholder="es. A3"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input type="number" step="0.5"
                            defaultValue={r.inv?.soglia_minima ?? 5}
                            onChange={(ev) => update(r.key, { soglia_minima: Number(ev.target.value) })}
                            className="h-7 w-16 text-[11px] text-right border border-ink/20 rounded-sm px-1 bg-background"
                          />
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
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Voci extra (sfridi/manuali senza material_key) */}
        {extras.length > 0 && (
          <div className="border-2 border-ink/15 rounded-sm bg-paper overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 border-b font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Sfridi e voci manuali ({extras.length})
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
                {extras.map((e) => (
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
      </div>
      <ScrapPiecesDialog
        open={!!scrapDialog}
        onOpenChange={(v) => !v && setScrapDialog(null)}
        inv={scrapDialog?.inv ?? null}
        matLabel={scrapDialog?.label}
      />
    </ProdLayout>
  );
};

export default ProdInventory;