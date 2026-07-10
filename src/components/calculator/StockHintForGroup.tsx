import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Link2, Minus, Package, Plus, Sparkles, Warehouse, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { NestingFormatOverride, NestingGroup, NestingMixedBin, NestingPieceItem } from "@/lib/nesting";
import type { InvItem, ScrapPiece } from "@/lib/produzione/types";
import { sheetSizeFromCatalog } from "@/lib/produzione/scrap";
import { mmToCm, mToCm } from "@/lib/fmt";

/* Suggerimenti magazzino per UN gruppo di nesting:
 * - cerca inventory_items dello stesso materiale (per nome/colore + spessore se presente)
 * - per ciascuno carica inventory_scrap_pieces "libero"
 * - confronta dimensioni (mm) con il bbox dei pezzi del gruppo: se uno sfrido contiene
 *   almeno un pezzo lo segnala come "usa questo sfrido"
 * - se la lastra intera dell'inventory ha un formato diverso da quello attualmente scelto
 *   nel nesting, lo segnala come alternativa
 * Tutto è solo suggerimento: il grafico decide manualmente. */

const fmtCm = (mm: number) => `${mmToCm(mm)} cm`;
const itemsBoundingMm = (items: NestingPieceItem[]): { w: number; h: number }[] =>
  items.map((it) => ({ w: Math.round(it.w * 1000), h: Math.round(it.h * 1000) }));

const fits = (req: { w: number; h: number }, src: { w: number; h: number }): boolean => {
  return (
    (req.w <= src.w && req.h <= src.h) ||
    (req.h <= src.w && req.w <= src.h)
  );
};

/** Token di selezione: scrap singolo (1 pezzo) o lastra intera (con quantità usata >=1). */
type PickToken =
  | { kind: "scrap"; id: string }
  | { kind: "sheet"; id: string; useQty: number };

/** Bin disponibile usato dall'algoritmo di combinazione. */
type Bin = {
  kind: "scrap" | "sheet";
  id: string;
  w: number;
  h: number;
  /** quante "copie" ho di questo bin (sfrido = 1, lastra intera = qty_intera) */
  qty: number;
  /** etichetta breve per UI */
  label: string;
};

type FR = { x: number; y: number; w: number; h: number };
const bssf = (free: FR[], w: number, h: number, used: FR[] = []) => {
  let best: { rect: FR; s1: number; s2: number } | null = null;
  for (const f of free) {
    if (f.w + 1e-6 < w || f.h + 1e-6 < h) continue;
    const rect = { x: f.x, y: f.y, w, h };
    if (used.some((u) => intersects(u, rect))) continue;
    const s1 = Math.min(f.w - w, f.h - h);
    const s2 = Math.max(f.w - w, f.h - h);
    if (!best || s1 < best.s1 - 1e-9 || (Math.abs(s1 - best.s1) < 1e-9 && s2 < best.s2)) {
      best = { rect, s1, s2 };
    }
  }
  return best;
};
const placeInto = (free: FR[], p: FR) => {
  const next: FR[] = [];
  for (const f of free) {
    if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) {
      next.push(f); continue;
    }
    if (p.x > f.x) next.push({ x: f.x, y: f.y, w: p.x - f.x, h: f.h });
    if (p.x + p.w < f.x + f.w) next.push({ x: p.x + p.w, y: f.y, w: f.x + f.w - (p.x + p.w), h: f.h });
    if (p.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: p.y - f.y });
    if (p.y + p.h < f.y + f.h) next.push({ x: f.x, y: p.y + p.h, w: f.w, h: f.y + f.h - (p.y + p.h) });
  }
  return next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h));
};
const intersects = (a: FR, b: FR) =>
  !(a.x >= b.x + b.w - 1e-6 || a.x + a.w <= b.x + 1e-6 || a.y >= b.y + b.h - 1e-6 || a.y + a.h <= b.y + 1e-6);
type OpenBin = Bin & { key: string; free: FR[]; used: FR[] };
const tryPlace = (bin: OpenBin, w: number, h: number): boolean => {
  const a = bssf(bin.free, w, h, bin.used);
  const b = w !== h ? bssf(bin.free, h, w, bin.used) : null;
  const pick = !a ? b : !b ? a : (b.s1 < a.s1 - 1e-9 || (Math.abs(b.s1 - a.s1) < 1e-9 && b.s2 < a.s2) ? b : a);
  if (!pick) return false;
  bin.free = placeInto(bin.free, pick.rect);
  bin.used.push(pick.rect);
  return true;
};

interface Props {
  group: NestingGroup;
  /** Override già applicato dall'utente sul gruppo (per evitare di sovrascrivere le scelte manuali). */
  currentOverride?: NestingFormatOverride | null;
  /** Callback per applicare un formato lastra alternativo come override del nesting. */
  onApplyOverride?: (override: NestingFormatOverride | null) => void;
  /** Callback per applicare BIN MISTI alla preview (sfridi + lastre con dimensioni diverse).
   *  Quando passata, ha priorità sull'override singolo: il rendering del nesting userà
   *  esattamente i bin selezionati come fogli reali. Passare `null` per resettare. */
  onApplyMixedBins?: (bins: NestingMixedBin[] | null) => void;
  /** Callback per agganciare definitivamente la scelta (lastra o sfrido) a tutti i pezzi del gruppo
   *  come prenotazione soft del preventivo (equivale a "Scegli da magazzino" per ogni pezzo). */
  onPickStock?: (pick: {
    kind: "item" | "scrap" | "mixed";
    id: string;
    label: string;
  }) => boolean | void;
  pickedStockIds?: string[];
  pickedStockLabel?: string | null;
  pickedStockConflict?: boolean;
}

export const StockHintForGroup = ({
  group, currentOverride, onApplyOverride, onApplyMixedBins, onPickStock, pickedStockIds = [], pickedStockLabel, pickedStockConflict = false,
}: Props) => {
  const [items, setItems] = useState<InvItem[]>([]);
  const [scraps, setScraps] = useState<ScrapPiece[]>([]);
  const [loading, setLoading] = useState(true);
  /** Selezione utente (lista di token, ordine di scelta). Supporta mix sfridi+lastre. */
  const [picked, setPicked] = useState<PickToken[]>([]);
  const autoPickedRef = useRef(false);

  const matName = group.material?.name ?? "";
  const matColor = group.material?.color ?? "";
  const matThickness = group.material?.thickness ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!matName) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      // 1) cerco righe magazzino per nome materiale (case-insensitive)
      const q = supabase.from("inventory_items").select("*").ilike("material_name", matName);
      const { data: invData } = await q;
      const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
      const matched = ((invData ?? []) as InvItem[]).filter((r) => {
        // se ho colore in catalogo, restringo (case-insensitive); altrimenti mantengo tutti
        if (matColor && norm(r.material_color) !== norm(matColor)) return false;
        const attrs = r.material_attrs ?? {};
        const rowThickness = norm((attrs as any).thickness ?? (attrs as any).spessore);
        return !matThickness || !rowThickness || rowThickness === norm(matThickness);
      }) as InvItem[];
      if (cancelled) return;
      setItems(matched);

      // 2) carico sfridi "libero" delle righe trovate
      if (matched.length > 0) {
        const ids = matched.map((m) => m.id);
        const { data: scrapData } = await supabase
          .from("inventory_scrap_pieces")
          .select("*")
          .in("inventory_id", ids)
          .eq("status", "libero");
        if (cancelled) return;
        setScraps((scrapData ?? []) as ScrapPiece[]);
      } else {
        setScraps([]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [matName, matColor, matThickness]);

  const reqs = useMemo(() => itemsBoundingMm(group.items), [group.items]);

  /** Tutti gli sfridi disponibili del materiale, con numero di pezzi del gruppo che ognuno
   *  riesce a contenere (0 se nessuno). Ordinati: prima quelli "utili" per copertura ↓,
   *  poi gli altri per area ↑. Manteniamo TUTTI gli sfridi così l'utente può comunque sceglierli. */
  const allScraps = useMemo(() => {
    if (scraps.length === 0) return [];
    const out: { scrap: ScrapPiece; coveredCount: number }[] = scraps.map((s) => {
      const src = { w: s.w_mm, h: s.h_mm };
      const coveredCount = reqs.length > 0 ? reqs.filter((r) => fits(r, src)).length : 0;
      return { scrap: s, coveredCount };
    });
    out.sort((a, b) => {
      if (a.coveredCount !== b.coveredCount) return b.coveredCount - a.coveredCount;
      return a.scrap.w_mm * a.scrap.h_mm - b.scrap.w_mm * b.scrap.h_mm;
    });
    return out.slice(0, 12);
  }, [scraps, reqs]);
  const usefulScraps = useMemo(() => allScraps.filter((x) => x.coveredCount > 0), [allScraps]);

  // Lastre intere alternative (formato diverso da quello attuale)
  const currentSheetMm = useMemo(() => {
    if (!group.material) return null;
    return sheetSizeFromCatalog(group.material);
  }, [group.material]);

  /** Tutte le lastre intere disponibili in magazzino per questo materiale (qty>0 e dimensioni note). */
  const allSheets = useMemo(() => {
    if (items.length === 0) return [];
    const out: { item: InvItem; w: number; h: number; isCurrent: boolean }[] = [];
    for (const it of items) {
      if ((it.qty_intera ?? 0) <= 0) continue;
      const attrs = it.material_attrs ?? {};
      let w = Number(attrs.base_mm ?? attrs.width_mm ?? attrs.w_mm ?? 0);
      let h = Number(attrs.height_mm ?? attrs.h_mm ?? 0);
      if (!(w > 0 && h > 0)) {
        const u = String(attrs.dimUnit ?? attrs.heightUnit ?? "cm").toLowerCase();
        const mul = u === "m" ? 1000 : u === "mm" ? 1 : 10; // default cm
        const bRaw = parseFloat(String(attrs.baseWidth ?? "").replace(",", "."));
        const hRaw = parseFloat(String(it.material_height ?? attrs.height ?? "").replace(",", "."));
        if (bRaw > 0 && hRaw > 0) { w = bRaw * mul; h = hRaw * mul; }
      }
      if (!(w > 0 && h > 0)) continue;
      const isCurrent = !!currentSheetMm
        && Math.abs(currentSheetMm.w - w) < 1
        && Math.abs(currentSheetMm.h - h) < 1;
      out.push({ item: it, w, h, isCurrent });
    }
    // ordina: corrente prima (è la "consigliata di default"), poi alternative per area ↑
    out.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return Number(b.isCurrent) - Number(a.isCurrent);
      return a.w * a.h - b.w * b.h;
    });
    return out.slice(0, 8);
  }, [items, currentSheetMm]);

  /** ============================================================
   *  ALGORITMO DI COMBINAZIONE CONSIGLIATA
   *  Greedy: ordina i pezzi richiesti per area decrescente; per ognuno
   *  prova ad assegnarlo al "miglior" bin disponibile (sfrido più piccolo
   *  che lo contenga; se nessuno → lastra intera). Rispetta le quantità
   *  reali di magazzino (sfridi: 1 a testa; lastre: qty_intera).
   *  Restituisce la lista di bin da usare (token) e la copertura.
   *  ============================================================ */
  const recommendation = useMemo(() => {
    if (reqs.length === 0) return null;
    // Pool bin: sfridi (qty 1 ciascuno) + lastre intere (qty = qty_intera)
    const scrapBins: Bin[] = allScraps.map(({ scrap }) => ({
      kind: "scrap",
      id: scrap.id,
      w: scrap.w_mm,
      h: scrap.h_mm,
      qty: 1,
      label: `${scrap.code} ${mmToCm(scrap.w_mm)}×${mmToCm(scrap.h_mm)} cm`,
    }));
    const sheetBins: Bin[] = allSheets.map(({ item, w, h }) => ({
      kind: "sheet",
      id: item.id,
      w, h,
      qty: Math.max(0, item.qty_intera ?? 0),
      label: `${item.code} ${mmToCm(w)}×${mmToCm(h)} cm`,
    }));
    // Pezzi ordinati per area ↓
    const reqsSorted = reqs
      .map((r, idx) => ({ ...r, idx }))
      .sort((a, b) => b.w * b.h - a.w * a.h);

    const scrapLeft = new Map<string, number>(scrapBins.map((b) => [b.id, b.qty]));
    const sheetLeft = new Map<string, number>(sheetBins.map((b) => [b.id, b.qty]));
    const openBins: OpenBin[] = [];
    const openNew = (b: Bin): OpenBin => {
      const ob: OpenBin = { ...b, key: `${b.kind}:${b.id}:${openBins.length}`, free: [{ x: 0, y: 0, w: b.w, h: b.h }], used: [] };
      openBins.push(ob);
      return ob;
    };
    let placed = 0;
    for (const r of reqsSorted) {
      const openCandidates = [...openBins].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "scrap" ? -1 : 1;
        return a.w * a.h - b.w * b.h;
      });
      let done = false;
      for (const b of openCandidates) {
        if (tryPlace(b, r.w, r.h)) { placed++; done = true; break; }
      }
      if (done) continue;
      const bestScrap = scrapBins.find((b) => (scrapLeft.get(b.id) ?? 0) > 0 && fits(r, b));
      if (bestScrap) {
        scrapLeft.set(bestScrap.id, (scrapLeft.get(bestScrap.id) ?? 0) - 1);
        const ob = openNew(bestScrap);
        if (tryPlace(ob, r.w, r.h)) { placed++; continue; }
      }
      const bestSheet = sheetBins.find((b) => (sheetLeft.get(b.id) ?? 0) > 0 && fits(r, b));
      if (bestSheet) {
        sheetLeft.set(bestSheet.id, (sheetLeft.get(bestSheet.id) ?? 0) - 1);
        const ob = openNew(bestSheet);
        if (tryPlace(ob, r.w, r.h)) placed++;
      }
    }
    const useScrap = new Map<string, number>();
    const useSheet = new Map<string, number>();
    for (const b of openBins) {
      if (b.used.length === 0) continue;
      if (b.kind === "scrap") useScrap.set(b.id, (useScrap.get(b.id) ?? 0) + 1);
      else useSheet.set(b.id, (useSheet.get(b.id) ?? 0) + 1);
    }
    const tokens: PickToken[] = [];
    for (const [id] of useScrap) tokens.push({ kind: "scrap", id });
    for (const [id, q] of useSheet) tokens.push({ kind: "sheet", id, useQty: q });
    return {
      tokens,
      placed,
      total: reqs.length,
      missing: reqs.length - placed,
    };
  }, [reqs, allScraps, allSheets]);

  // Auto-selezione: alla prima volta propongo la combinazione consigliata
  // (mix sfridi + lastre) calcolata sopra. Solo se l'utente non ha già impostato un override.
  useEffect(() => {
    if (autoPickedRef.current) return;
    if (loading) return;
    if (currentOverride) { autoPickedRef.current = true; return; }
    if (recommendation && recommendation.tokens.length > 0) {
      setPicked(recommendation.tokens);
      applyOverrideForTokens(recommendation.tokens);
      autoPickedRef.current = true;
    }
  }, [loading, recommendation, currentOverride]);

  /** Calcola un override del nesting che rappresenti la selezione corrente.
   *  Per più bin combinati usiamo il bin più grande (così il canvas mostra
   *  almeno la lastra "principale"); il numero `quantity` riflette il totale
   *  di bin usati. È solo un'indicazione visiva — l'aggancio resta puntuale. */
  const applyOverrideForTokens = (tokens: PickToken[]) => {
    // 1) Override legacy (formato dominante) — usato per costi/etichette
    if (onApplyOverride) {
      if (tokens.length === 0) {
        onApplyOverride(null);
      } else {
        type Dim = { w: number; h: number; qty: number; label: string };
        const dims: Dim[] = [];
        for (const t of tokens) {
          if (t.kind === "scrap") {
            const s = scraps.find((x) => x.id === t.id);
            if (s) dims.push({ w: s.w_mm, h: s.h_mm, qty: 1, label: `${s.code} ${mmToCm(s.w_mm)}×${mmToCm(s.h_mm)} cm` });
          } else {
            const sh = allSheets.find((x) => x.item.id === t.id);
            if (sh) dims.push({ w: sh.w, h: sh.h, qty: Math.max(1, t.useQty), label: `${sh.item.code} ${mmToCm(sh.w)}×${mmToCm(sh.h)} cm × ${t.useQty}` });
          }
        }
        if (dims.length === 0) {
          onApplyOverride(null);
        } else {
          dims.sort((a, b) => b.w * b.h - a.w * a.h);
          const main = dims[0];
          const totalQty = dims.reduce((s, d) => s + d.qty, 0);
          onApplyOverride({
            source: "custom",
            widthM: main.w / 1000,
            heightM: main.h / 1000,
            quantity: totalQty,
            label: dims.map((d) => d.label).join(" + "),
          });
        }
      }
    }
    // 2) Bin misti per la PREVIEW (rendering reale per-sfrido / per-lastra)
    if (onApplyMixedBins) {
      if (tokens.length === 0) { onApplyMixedBins(null); return; }
      const bins: NestingMixedBin[] = [];
      for (const t of tokens) {
        if (t.kind === "scrap") {
          const s = scraps.find((x) => x.id === t.id);
          if (!s) continue;
          bins.push({
            kind: "scrap",
            id: s.id,
            widthM: s.w_mm / 1000,
            heightM: s.h_mm / 1000,
            label: `${s.code} ${mmToCm(s.w_mm)}×${mmToCm(s.h_mm)} cm`,
          });
        } else {
          const sh = allSheets.find((x) => x.item.id === t.id);
          if (!sh) continue;
          for (let i = 0; i < Math.max(1, t.useQty); i++) {
            bins.push({
              kind: "sheet",
              id: sh.item.id,
              widthM: sh.w / 1000,
              heightM: sh.h / 1000,
              label: `${sh.item.code} ${mmToCm(sh.w)}×${mmToCm(sh.h)} cm`,
            });
          }
        }
      }
      onApplyMixedBins(bins.length > 0 ? bins : null);
    }
  };

  const clearPick = () => {
    setPicked([]);
    onApplyOverride?.(null);
  };

  /** Toggle di uno sfrido nella selezione mista. */
  const toggleScrap = (id: string) => {
    const present = picked.some((t) => t.kind === "scrap" && t.id === id);
    const next: PickToken[] = present
      ? picked.filter((t) => !(t.kind === "scrap" && t.id === id))
      : [...picked, { kind: "scrap", id }];
    setPicked(next);
    applyOverrideForTokens(next);
  };

  /** Toggle puro di una lastra intera (aggiunge/rimuove dalla selezione, qty=1 di default).
   *  Per cambiare la quantità ci sono i pulsanti +/− dedicati. */
  const toggleSheet = (sh: { item: InvItem; w: number; h: number }) => {
    const idx = picked.findIndex((t) => t.kind === "sheet" && t.id === sh.item.id);
    let next: PickToken[];
    if (idx === -1) {
      next = [...picked, { kind: "sheet", id: sh.item.id, useQty: 1 }];
    } else {
      next = picked.filter((_, i) => i !== idx);
    }
    setPicked(next);
    applyOverrideForTokens(next);
  };

  /** Modifica la quantità di una lastra intera nella selezione. delta = +1 o -1.
   *  Se la qty scende a 0, la rimuove. Limitata da `max` (qty_intera). */
  const adjustSheetQty = (sheetId: string, delta: number, max: number) => {
    const idx = picked.findIndex((t) => t.kind === "sheet" && t.id === sheetId);
    if (idx === -1) return;
    const cur = picked[idx] as Extract<PickToken, { kind: "sheet" }>;
    const nextQty = Math.min(max, Math.max(0, cur.useQty + delta));
    let next: PickToken[];
    if (nextQty <= 0) {
      next = picked.filter((_, i) => i !== idx);
    } else {
      next = [...picked];
      next[idx] = { ...cur, useQty: nextQty };
    }
    setPicked(next);
    applyOverrideForTokens(next);
  };

  /** Applica la combinazione consigliata sostituendo la selezione corrente. */
  const applyRecommendation = () => {
    if (!recommendation) return;
    setPicked(recommendation.tokens);
    applyOverrideForTokens(recommendation.tokens);
  };

  /** Aggancia la selezione corrente a TUTTI i pezzi del gruppo (prenotazione soft).
   *  Supporta selezioni miste (più sfridi + lastre intere) usando token "kind:id". */
  const confirmPick = () => {
    if (picked.length === 0 || !onPickStock) return;
    const labels: string[] = [];
    const tokens: string[] = [];
    let kindCounts = { item: 0, scrap: 0 };
    for (const t of picked) {
      if (t.kind === "scrap") {
        const s = scraps.find((x) => x.id === t.id);
        if (!s) continue;
        tokens.push(`scrap:${t.id}`);
        labels.push(`Sfrido ${s.code} · ${mmToCm(s.w_mm)}×${mmToCm(s.h_mm)} cm`);
        kindCounts.scrap++;
      } else {
        const sh = allSheets.find((x) => x.item.id === t.id);
        if (!sh) continue;
        const dim = `${mmToCm(sh.w)}×${mmToCm(sh.h)} cm`;
        // Aggancio una volta per "useQty"
        for (let q = 0; q < Math.max(1, t.useQty); q++) {
          tokens.push(`item:${t.id}`);
        }
        labels.push(`Lastra ${sh.item.code} · ${dim}${t.useQty > 1 ? ` × ${t.useQty}` : ""}`);
        kindCounts.item += Math.max(1, t.useQty);
      }
    }
    if (tokens.length === 0) return;
    const isMixed = kindCounts.item > 0 && kindCounts.scrap > 0;
    let kind: "item" | "scrap" | "mixed";
    let idStr: string;
    if (isMixed) {
      kind = "mixed";
      idStr = tokens.join(",");
    } else if (kindCounts.item > 0) {
      kind = "item";
      idStr = tokens.map((t) => t.replace(/^item:/, "")).join(",");
    } else {
      kind = "scrap";
      idStr = tokens.map((t) => t.replace(/^scrap:/, "")).join(",");
    }
    const label = labels.join(" + ");
    const didPick = onPickStock({ kind, id: idStr, label });
    if (didPick !== false) {
      toast.success(
        isMixed
          ? `Combinazione agganciata: ${kindCounts.scrap} sfrido/i + ${kindCounts.item} lastr${kindCounts.item === 1 ? "a" : "e"}`
          : `${tokens.length} ${kind === "scrap" ? "sfrido/i" : "lastra/e"} agganciat${tokens.length === 1 ? "a" : "e"}`,
      );
    }
  };

  if (loading) return null;
  // Mostriamo SEMPRE il pannello: anche senza alternative, l'utente può scegliere
  // manualmente quale lastra/sfrido del magazzino usare per questo nesting.
  if (allSheets.length === 0 && allScraps.length === 0) {
    return (
      <div className="border border-dashed border-ink/20 bg-muted/20 rounded-sm p-3">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <Warehouse className="w-3.5 h-3.5" />
          Scelta dal magazzino
        </div>
        <div className="font-mono text-[11px] text-muted-foreground italic mt-1">
          Nessuna lastra o sfrido di questo materiale è disponibile in magazzino.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-primary/40 bg-primary/5 rounded-sm p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary">
          <Warehouse className="w-3.5 h-3.5" />
          Scelta dal magazzino · automatica o manuale
        </div>
        <div className="flex items-center gap-2">
          {picked.length > 0 && onPickStock && (
            <button
              type="button"
              onClick={confirmPick}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title="Aggancia definitivamente la selezione a tutti i pezzi del gruppo"
            >
              <Link2 className="w-3 h-3" />
              Aggancia ai pezzi
            </button>
          )}
          {picked.length > 0 && (
            <button
              type="button"
              onClick={clearPick}
              className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink"
            >
              Annulla scelta
            </button>
          )}
        </div>
      </div>

      {pickedStockIds.length > 0 && (
        <div className={`font-mono text-[10px] uppercase tracking-wider inline-flex items-start gap-1 ${pickedStockConflict ? "text-destructive" : "text-primary"}`}>
          {pickedStockConflict ? <AlertTriangle className="w-3 h-3 mt-0.5" /> : <Link2 className="w-3 h-3 mt-0.5" />}
          <span>
            {pickedStockConflict
              ? "Il gruppo ha già agganci diversi: scegli una nuova opzione solo se vuoi sovrascriverli tutti."
              : `Già agganciato: ${pickedStockLabel ?? pickedStockIds.join(", ")}`}
          </span>
        </div>
      )}

      {recommendation && recommendation.tokens.length > 0 && (
        <div className="flex items-start justify-between gap-2 px-2 py-1.5 rounded-sm bg-primary/10 border border-primary/30">
          <div className="font-mono text-[10px] text-primary inline-flex items-start gap-1.5 min-w-0">
            <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="uppercase tracking-wider font-bold">Consigliato:</span>{" "}
              {recommendation.tokens.map((t) => {
                if (t.kind === "scrap") {
                  const s = scraps.find((x) => x.id === t.id);
                  return s ? `sfrido ${s.code}` : "";
                }
                const sh = allSheets.find((x) => x.item.id === t.id);
                return sh ? `${t.useQty}× lastra ${sh.item.code}` : "";
              }).filter(Boolean).join(" + ")}
              {" · copre "}{recommendation.placed}/{recommendation.total} pz
              {recommendation.missing > 0 ? ` · ${recommendation.missing} non coperti` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={applyRecommendation}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-sm border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
            title="Pre-seleziona la combinazione consigliata"
          >
            <Wand2 className="w-3 h-3" />
            Usa
          </button>
        </div>
      )}

      {allScraps.length > 0 && (
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Pezzi di sfrido disponibili ({allScraps.length})
          </div>
          <ul className="space-y-1">
            {allScraps.map(({ scrap, coveredCount }) => {
              const isSel = picked.some((t) => t.kind === "scrap" && t.id === scrap.id);
              const covers = coveredCount > 0;
              return (
                <li key={scrap.id}>
                  <button
                    type="button"
                    onClick={() => toggleScrap(scrap.id)}
                    className={`w-full flex items-center justify-between gap-3 font-mono text-[11px] px-2 py-1 rounded-sm border transition-colors text-left ${
                      isSel
                        ? "border-primary bg-primary/15"
                        : "border-transparent hover:bg-primary/10"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      {isSel ? (
                        <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : (
                        <Package className="w-3 h-3 text-primary shrink-0" />
                      )}
                      <span className="font-semibold text-ink truncate">{scrap.code}</span>
                      <span className="text-muted-foreground">
                        {fmtCm(scrap.w_mm)} × {fmtCm(scrap.h_mm)}
                        {scrap.posizione ? ` · ${scrap.posizione}` : ""}
                      </span>
                    </span>
                    <span className={`tabular-nums shrink-0 inline-flex items-center gap-1 ${covers ? "text-primary" : "text-muted-foreground"}`}>
                      {isSel && <Sparkles className="w-3 h-3" />}
                      {covers
                        ? <>copre {coveredCount}/{reqs.length} pz</>
                        : <>non copre i pezzi</>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {allSheets.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-dashed border-primary/30">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Lastre intere in magazzino ({allSheets.length})
          </div>
          <ul className="space-y-1">
            {allSheets.map((alt) => {
              const sel = picked.find((t) => t.kind === "sheet" && t.id === alt.item.id) as Extract<PickToken, { kind: "sheet" }> | undefined;
              const isSel = !!sel;
              const max = alt.item.qty_intera ?? 0;
              return (
                <li key={alt.item.id}>
                  <div
                    className={`w-full flex items-center justify-between gap-3 font-mono text-[11px] px-2 py-1 rounded-sm border transition-colors ${
                      isSel
                        ? "border-primary bg-primary/15"
                        : "border-transparent hover:bg-primary/10"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSheet(alt)}
                      className="inline-flex items-center gap-2 min-w-0 text-left flex-1"
                      title={isSel ? "Click per rimuovere dalla combinazione" : "Click per aggiungere alla combinazione"}
                    >
                      {isSel ? (
                        <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : (
                        <Package className="w-3 h-3 text-primary shrink-0" />
                      )}
                      <span className="font-semibold text-ink truncate">{alt.item.code}</span>
                      <span className="text-muted-foreground">
                        {fmtCm(alt.w)} × {fmtCm(alt.h)}
                        {alt.item.posizione ? ` · ${alt.item.posizione}` : ""}
                      </span>
                      {alt.isCurrent && (
                        <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded-sm bg-primary/15 text-primary border border-primary/30">
                          in uso
                        </span>
                      )}
                    </button>
                    <div className="tabular-nums shrink-0 inline-flex items-center gap-1">
                      {isSel ? (
                        <>
                          <button
                            type="button"
                            onClick={() => adjustSheetQty(alt.item.id, -1, max)}
                            className="w-5 h-5 inline-flex items-center justify-center rounded-sm border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-30"
                            disabled={sel!.useQty <= 1}
                            title="Diminuisci di 1"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-bold text-primary min-w-[2.5rem] text-center">
                            {sel!.useQty}/{max}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustSheetQty(alt.item.id, +1, max)}
                            className="w-5 h-5 inline-flex items-center justify-center rounded-sm border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-30"
                            disabled={sel!.useQty >= max}
                            title={sel!.useQty >= max ? `Massimo disponibile in magazzino: ${max}` : "Aumenta di 1"}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{max} ls disp.</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="font-mono text-[10px] text-muted-foreground italic pt-1">
        Il sistema propone la combinazione migliore mischiando sfridi e lastre intere
        (rispetta le quantità reali in magazzino). Clicca <strong>Usa</strong> per accettarla,
        oppure scegli manualmente: click sulla riga per aggiungere/rimuovere lo sfrido o la lastra;
        usa i pulsanti <strong>+</strong>/<strong>−</strong> per cambiare quante lastre intere
        vuoi usare (limite: quantità in magazzino). Premi
        <strong> Aggancia ai pezzi</strong> per legare la combinazione a tutti i pezzi del gruppo.
      </div>
    </div>
  );
};