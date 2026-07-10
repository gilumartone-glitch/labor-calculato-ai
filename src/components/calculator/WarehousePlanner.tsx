import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Package, Warehouse, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { NestingGroup, NestingMixedBin } from "@/lib/nesting";
import type { InvItem, ScrapPiece } from "@/lib/produzione/types";
import type { Catalog } from "./types";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";

/** Pianificatore MAGAZZINO GLOBALE per il nesting.
 *  Quando attivo: per ogni gruppo cerca in magazzino sfridi + lastre intere del materiale,
 *  li ordina dal più piccolo al più grande e assegna ogni pezzo al più piccolo bin che lo contiene.
 *  Se non basta, mostra i pezzi da ordinare e offre un flag "Bypassa" che completa la copertura
 *  con lastre standard di catalogo (fallback), così il nesting non si blocca. */

type BinPool = {
  scraps: { id: string; w: number; h: number; label: string }[]; // qty 1 ciascuno
  sheets: { id: string; w: number; h: number; label: string; qty: number }[];
  // catalog fallback: TUTTE le misure standard del materiale (stesso colore + spessore),
  // ordinate dalla più piccola alla più grande. Quantità illimitata ciascuna.
  fallbacks: { w: number; h: number; label: string }[];
};

type GroupPlan = {
  bins: NestingMixedBin[];
  covered: number;
  total: number;
  missing: { label: string; w: number; h: number }[];
  usedScrapCount: number;
  usedSheetCount: number;
  usedFallbackCount: number;
  materialLabel: string;
};

const fits = (r: { w: number; h: number }, b: { w: number; h: number }) =>
  (r.w <= b.w && r.h <= b.h) || (r.h <= b.w && r.w <= b.h);

// --- MaxRects Best-Short-Side-Fit con rotazione (in mm) per stimare correttamente
// quanti pezzi entrano in una lastra/sfrido: così lo shortage non conta 1 lastra per pezzo.
type FR = { x: number; y: number; w: number; h: number };
const bssf = (free: FR[], w: number, h: number) => {
  let best: { rect: FR; s1: number; s2: number } | null = null;
  for (const f of free) {
    if (f.w + 1e-6 < w || f.h + 1e-6 < h) continue;
    const leftover = [f.w - w, f.h - h];
    const s1 = Math.min(...leftover), s2 = Math.max(...leftover);
    if (!best || s1 < best.s1 - 1e-9 || (Math.abs(s1 - best.s1) < 1e-9 && s2 < best.s2)) {
      best = { rect: { x: f.x, y: f.y, w, h }, s1, s2 };
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
  // rimuovi contenuti
  const pruned: FR[] = [];
  for (let i = 0; i < next.length; i++) {
    let contained = false;
    for (let j = 0; j < next.length; j++) {
      if (i === j) continue;
      const a = next[i], b = next[j];
      if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
        contained = true; break;
      }
    }
    if (!contained) pruned.push(next[i]);
  }
  return pruned;
};
type OpenBin = { key: string; kind: "scrap" | "sheet"; id: string; w: number; h: number; label: string; free: FR[] };
const tryPlace = (bin: OpenBin, w: number, h: number): boolean => {
  const a = bssf(bin.free, w, h);
  const b = w !== h ? bssf(bin.free, h, w) : null;
  const pick = !a ? b : !b ? a : (b.s1 < a.s1 - 1e-9 || (Math.abs(b.s1 - a.s1) < 1e-9 && b.s2 < a.s2) ? b : a);
  if (!pick) return false;
  bin.free = placeInto(bin.free, pick.rect);
  return true;
};

import { mmToCm } from "@/lib/fmt";
const cm = (mm: number) => mmToCm(mm);
// Estrae il valore numerico da una stringa spessore (es. "8 mm" → 8, "8mm" → 8).
const normThickness = (s: unknown) => {
  const raw = String(s ?? "").trim().toLowerCase();
  if (!raw) return "";
  const m = raw.match(/[\d.,]+/);
  if (!m) return raw;
  return String(parseFloat(m[0].replace(",", ".")));
};

interface Props {
  groups: NestingGroup[];
  /** Catalogo del reparto: usato per generare i fallback standard multi-misura. */
  catalog?: Catalog;
  /** Applica i mixed-bins su tutti i gruppi contemporaneamente (o azzera). */
  onApplyAllMixedBins: (byGroup: Record<string, NestingMixedBin[] | null>) => void;
}

export const WarehousePlanner = ({ groups, catalog, onApplyAllMixedBins }: Props) => {
  // Default ON: il nesting deve suggerire automaticamente i pezzi migliori
  // (prima sfridi in magazzino, poi lastre standard). Bypass ON di default
  // così se il magazzino non basta si completa comunque con lastre nuove.
  const [enabled, setEnabled] = useLocalStorageState("nesting.useWarehouse.v2", true);
  const [bypass, setBypass] = useLocalStorageState("nesting.useWarehouse.bypass.v2", true);
  const [loading, setLoading] = useState(false);
  const [pools, setPools] = useState<Record<string, BinPool>>({});
  const lastAppliedRef = useRef<string>("");

  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

  // Estrae TUTTE le misure standard del materiale (stesso nome + colore + spessore),
  // così il fallback può considerare più formati (es. Policarbonato 305×205 e 610×205).
  const catalogFallbacksFor = (g: NestingGroup): { w: number; h: number; label: string }[] => {
    if (!catalog?.materials) return [];
    const mat = g.material;
    if (!mat) return [];
    const matches = catalog.materials.filter((m) => {
      if (norm(m.name) !== norm(mat.name)) return false;
      if (mat.color && norm(m.color) && norm(m.color) !== norm(mat.color)) return false;
      if (mat.thickness && normThickness(m.thickness) && normThickness(m.thickness) !== normThickness(mat.thickness)) return false;
      const fmA = m.format ?? "lastra";
      const fmB = mat.format ?? "lastra";
      return fmA === fmB;
    });
    const seen = new Set<string>();
    const out: { w: number; h: number; label: string }[] = [];
    for (const m of matches) {
      const u = String(m.dimUnit ?? m.heightUnit ?? "cm").toLowerCase();
      const mul = u === "m" ? 1000 : u === "mm" ? 1 : 10;
      const bRaw = parseFloat(String(m.baseWidth ?? "").replace(",", "."));
      const hRaw = parseFloat(String(m.height ?? "").replace(",", "."));
      if (!(bRaw > 0 && hRaw > 0)) continue;
      const w = Math.round(bRaw * mul);
      const h = Math.round(hRaw * mul);
      const key = `${w}x${h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ w, h, label: `Lastra standard ${cm(w)}×${cm(h)} cm` });
    }
    return out.sort((a, b) => a.w * a.h - b.w * b.h);
  };

  // Carica magazzino per ogni gruppo (una query per materiale distinto)
  useEffect(() => {
    if (!enabled || groups.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const nextPools: Record<string, BinPool> = {};
      for (const g of groups) {
        const name = g.material?.name ?? "";
        if (!name) { nextPools[g.key] = { scraps: [], sheets: [], fallbacks: catalogFallbacksFor(g) }; continue; }
        const { data: invData } = await supabase
          .from("inventory_items").select("*").ilike("material_name", name);
        const matched = ((invData ?? []) as InvItem[]).filter((r) => {
          if (g.material?.color && r.material_color && norm(r.material_color) !== norm(g.material.color)) return false;
          const attrs = (r.material_attrs ?? {}) as Record<string, any>;
          const rowT = normThickness(attrs.thickness ?? attrs.spessore);
          const gT = normThickness(g.material?.thickness);
          return !gT || !rowT || rowT === gT;
        });
        let scraps: ScrapPiece[] = [];
        if (matched.length > 0) {
          const ids = matched.map((m) => m.id);
          const { data: sd } = await supabase
            .from("inventory_scrap_pieces").select("*")
            .in("inventory_id", ids).eq("status", "libero");
          scraps = (sd ?? []) as ScrapPiece[];
        }
        const pool: BinPool = { scraps: [], sheets: [], fallbacks: [] };
        pool.scraps = scraps.map((s) => ({
          id: s.id, w: s.w_mm, h: s.h_mm,
          label: `${s.code} ${cm(s.w_mm)}×${cm(s.h_mm)} cm`,
        }));
        for (const it of matched) {
          if ((it.qty_intera ?? 0) <= 0) continue;
          const attrs = (it.material_attrs ?? {}) as Record<string, any>;
          let w = Number(attrs.base_mm ?? attrs.width_mm ?? attrs.w_mm ?? 0);
          let h = Number(attrs.height_mm ?? attrs.h_mm ?? 0);
          if (!(w > 0 && h > 0)) {
            const u = String(attrs.dimUnit ?? attrs.heightUnit ?? "cm").toLowerCase();
            const mul = u === "m" ? 1000 : u === "mm" ? 1 : 10;
            const bRaw = parseFloat(String(attrs.baseWidth ?? "").replace(",", "."));
            const hRaw = parseFloat(String(it.material_height ?? attrs.height ?? "").replace(",", "."));
            if (bRaw > 0 && hRaw > 0) { w = bRaw * mul; h = hRaw * mul; }
          }
          if (!(w > 0 && h > 0)) continue;
          pool.sheets.push({
            id: it.id, w, h, qty: it.qty_intera,
            label: `${it.code} ${cm(w)}×${cm(h)} cm`,
          });
        }
        // Fallback = TUTTE le misure standard di catalogo per stesso materiale + colore + spessore.
        // Include anche la lastra "di riferimento" del gruppo, per compatibilità.
        const catFbs = catalogFallbacksFor(g);
        const fbSeen = new Set(catFbs.map((f) => `${f.w}x${f.h}`));
        if (g.format === "lastra" && g.sheetWidthM && g.sheetHeightM) {
          const w = Math.round(g.sheetWidthM * 1000);
          const h = Math.round(g.sheetHeightM * 1000);
          if (!fbSeen.has(`${w}x${h}`)) {
            catFbs.push({ w, h, label: `Lastra standard ${cm(w)}×${cm(h)} cm` });
          }
        }
        pool.fallbacks = catFbs.sort((a, b) => a.w * a.h - b.w * b.h);
        nextPools[g.key] = pool;
      }
      if (!cancelled) { setPools(nextPools); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [enabled, groups, catalog]);

  // Calcolo del piano per ogni gruppo
  const plans = useMemo<Record<string, GroupPlan>>(() => {
    const out: Record<string, GroupPlan> = {};
    if (!enabled) return out;
    for (const g of groups) {
      const pool = pools[g.key] ?? { scraps: [], sheets: [], fallbacks: [] };
      // Pool ordinato PICCOLO → GRANDE (area crescente): sfridi + lastre di magazzino.
      const scraps = [...pool.scraps].map((b) => ({ ...b, left: 1 }))
        .sort((a, b) => a.w * a.h - b.w * b.h);
      const sheets = [...pool.sheets].map((b) => ({ ...b, left: b.qty }))
        .sort((a, b) => a.w * a.h - b.w * b.h);
      // Pezzi: assegno prima i grandi (Best-Fit-Decreasing) al più piccolo bin che li contiene
      const reqs = g.items.map((it, i) => ({
        idx: i, w: Math.round(it.w * 1000), h: Math.round(it.h * 1000), label: it.label,
      })).sort((a, b) => b.w * b.h - a.w * a.h);

      const bins: NestingMixedBin[] = [];
      const missing: { label: string; w: number; h: number }[] = [];
      let uScrap = 0, uSheet = 0, uFallback = 0;

      const pushBin = (kind: "scrap" | "sheet", id: string, w: number, h: number, label: string) => {
        bins.push({ kind, id, widthM: w / 1000, heightM: h / 1000, label });
        return bins.length - 1;
      };

      for (const r of reqs) {
        // 1) sfrido più piccolo che lo contenga (PRIORITÀ ASSOLUTA)
        const sIdx = scraps.findIndex((b) => b.left > 0 && fits(r, b));
        if (sIdx >= 0) {
          const b = scraps[sIdx]; b.left -= 1;
          pushBin("scrap", b.id, b.w, b.h, b.label); uScrap++; continue;
        }
        // 2) lastra intera più piccola che lo contenga (tra tutte le misure in magazzino)
        const shIdx = sheets.findIndex((b) => b.left > 0 && fits(r, b));
        if (shIdx >= 0) {
          const b = sheets[shIdx]; b.left -= 1;
          pushBin("sheet", b.id, b.w, b.h, b.label); uSheet++; continue;
        }
        // 3) fallback catalogo (SOLO se bypass attivo): scegli la più piccola misura
        //    standard che contiene il pezzo, tra TUTTE le varianti del prodotto.
        if (bypass && pool.fallbacks.length > 0) {
          const fb = pool.fallbacks.find((b) => fits(r, b));
          if (fb) {
            pushBin("sheet", `__fallback_${uFallback}`, fb.w, fb.h, fb.label);
            uFallback++; continue;
          }
        }
        // 4) mancante
        missing.push({ label: r.label, w: r.w, h: r.h });
      }

      out[g.key] = {
        bins, covered: reqs.length - missing.length, total: reqs.length, missing,
        usedScrapCount: uScrap, usedSheetCount: uSheet, usedFallbackCount: uFallback,
        materialLabel: [g.material?.name, g.material?.color, g.material?.thickness]
          .filter(Boolean).join(" · ") || "Materiale",
      };
    }
    return out;
  }, [enabled, groups, pools, bypass]);

  // Applica automaticamente i piani sui gruppi (solo quelli con copertura completa,
  // oppure tutti se bypass attivo).
  useEffect(() => {
    if (!enabled) {
      if (lastAppliedRef.current !== "") {
        onApplyAllMixedBins(Object.fromEntries(groups.map((g) => [g.key, null])));
        lastAppliedRef.current = "";
      }
      return;
    }
    const payload: Record<string, NestingMixedBin[] | null> = {};
    for (const g of groups) {
      const plan = plans[g.key];
      if (!plan || plan.bins.length === 0) { payload[g.key] = null; continue; }
      if (plan.missing.length === 0 || bypass) payload[g.key] = plan.bins;
      else payload[g.key] = null; // non completo e non bypassato: lascia nesting standard
    }
    const sig = JSON.stringify(payload);
    if (sig !== lastAppliedRef.current) {
      onApplyAllMixedBins(payload);
      lastAppliedRef.current = sig;
    }
  }, [enabled, plans, bypass, groups, onApplyAllMixedBins]);

  const totals = useMemo(() => {
    let total = 0, covered = 0, scrap = 0, sheet = 0, fallback = 0, missing = 0;
    for (const g of groups) {
      const p = plans[g.key]; if (!p) continue;
      total += p.total; covered += p.covered; missing += p.missing.length;
      scrap += p.usedScrapCount; sheet += p.usedSheetCount; fallback += p.usedFallbackCount;
    }
    return { total, covered, scrap, sheet, fallback, missing };
  }, [plans, groups]);

  const groupsWithShortage = useMemo(
    () => groups.filter((g) => (plans[g.key]?.missing.length ?? 0) > 0),
    [groups, plans],
  );

  const disable = () => {
    setEnabled(false);
    setBypass(false);
    onApplyAllMixedBins(Object.fromEntries(groups.map((g) => [g.key, null])));
    lastAppliedRef.current = "";
    toast.info("Nesting tornato al calcolo standard");
  };

  return (
    <div className="mb-5 border-2 border-primary/40 bg-primary/5 rounded-md p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); if (!e.target.checked) disable(); }}
            className="w-6 h-6 accent-primary"
          />
          <span className="inline-flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-primary" />
            <span className="font-display text-lg font-semibold">Usa magazzino nel nesting</span>
          </span>
        </label>
        <span className="text-sm text-muted-foreground">
          Ottimizza usando prima gli sfridi più piccoli, poi lastre più grandi.
        </span>
        {enabled && loading && (
          <span className="ml-auto inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Carico magazzino…
          </span>
        )}
      </div>

      {enabled && !loading && groups.length > 0 && (
        <div className="mt-4 space-y-3">
          {/* Riepilogo globale */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono text-sm">
            <div className="border border-ink/15 rounded-md p-2 bg-background">
              <div className="text-xs uppercase text-muted-foreground">Pezzi totali</div>
              <div className="text-lg font-bold tabular-nums">{totals.total}</div>
            </div>
            <div className="border border-ink/15 rounded-md p-2 bg-background">
              <div className="text-xs uppercase text-muted-foreground">Coperti da magazzino</div>
              <div className={`text-lg font-bold tabular-nums ${totals.covered === totals.total ? "text-primary" : "text-ink"}`}>
                {totals.covered}/{totals.total}
              </div>
            </div>
            <div className="border border-ink/15 rounded-md p-2 bg-background">
              <div className="text-xs uppercase text-muted-foreground">Sfridi usati</div>
              <div className="text-lg font-bold tabular-nums">{totals.scrap}</div>
            </div>
            <div className="border border-ink/15 rounded-md p-2 bg-background">
              <div className="text-xs uppercase text-muted-foreground">Lastre magazzino</div>
              <div className="text-lg font-bold tabular-nums">{totals.sheet}</div>
            </div>
            <div className={`border rounded-md p-2 bg-background ${totals.missing > 0 ? "border-destructive/60" : "border-ink/15"}`}>
              <div className="text-xs uppercase text-muted-foreground">Da ordinare</div>
              <div className={`text-lg font-bold tabular-nums ${totals.missing > 0 ? "text-destructive" : "text-primary"}`}>
                {totals.missing}
              </div>
            </div>
          </div>

          {/* Copertura completa */}
          {totals.missing === 0 && totals.total > 0 && (
            <div className="flex items-center gap-2 p-3 border-2 border-primary/50 bg-primary/10 rounded-md text-primary font-semibold text-base">
              <CheckCircle2 className="w-5 h-5" />
              Tutti i pezzi coperti dal magazzino: {totals.scrap} sfrido/i + {totals.sheet} lastra/e.
            </div>
          )}

          {/* Shortage: pezzi da ordinare */}
          {groupsWithShortage.length > 0 && (
            <div className="border-2 border-destructive/60 bg-destructive/10 rounded-md p-3 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-display text-base font-bold text-destructive">
                    Magazzino insufficiente — {totals.missing} pezzo/i da ordinare
                  </div>
                  <div className="text-sm text-ink/80">
                    Attiva "Bypassa mancanza" per completare il nesting con lastre standard di listino
                    per i pezzi non coperti.
                  </div>
                </div>
                <label className="flex items-center gap-2 h-10 px-3 border-2 border-destructive/60 bg-background rounded-md cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bypass}
                    onChange={(e) => setBypass(e.target.checked)}
                    className="w-5 h-5 accent-destructive"
                  />
                  <span className="text-sm font-bold text-destructive">Bypassa mancanza</span>
                </label>
              </div>

              {groupsWithShortage.map((g) => {
                const plan = plans[g.key]; if (!plan) return null;
                return (
                  <div key={g.key} className="border border-destructive/40 bg-background rounded-md p-3">
                    <div className="font-mono text-sm font-bold text-ink mb-2 flex items-center gap-2">
                      <Package className="w-4 h-4" /> {plan.materialLabel}
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs uppercase font-semibold text-primary mb-1 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Presenti in magazzino ({plan.covered})
                        </div>
                        <ul className="text-sm font-mono space-y-0.5">
                          {plan.usedScrapCount > 0 && (
                            <li>· {plan.usedScrapCount} sfrido/i usati</li>
                          )}
                          {plan.usedSheetCount > 0 && (
                            <li>· {plan.usedSheetCount} lastra/e intere usate</li>
                          )}
                          {plan.usedFallbackCount > 0 && (
                            <li className="text-destructive">· {plan.usedFallbackCount} lastra/e standard (bypass)</li>
                          )}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs uppercase font-semibold text-destructive mb-1 inline-flex items-center gap-1">
                          <ShoppingCart className="w-3.5 h-3.5" />
                          Da ordinare ({plan.missing.length})
                        </div>
                        <ul className="text-sm font-mono space-y-0.5 max-h-40 overflow-auto">
                          {plan.missing.map((m, i) => (
                            <li key={i}>
                              · <strong>{m.label}</strong> · {cm(m.w)}×{cm(m.h)} cm
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
