import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Calculator as CalcIcon, Layers, Droplets, ChevronDown, ChevronRight, RotateCw, Printer, Scissors, PackageCheck, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSharedCloudState } from "@/hooks/useSharedCloudState";
import { uid } from "@/lib/format";
import { SelectWithAdd } from "@/components/calculator/SelectWithAdd";
import { ContactSelect } from "@/components/produzione/ContactSelect";
import { ConfirmToWarehouseDialog, WarehouseConfirmData } from "@/components/produzione/ConfirmToWarehouseDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { nextOrderCode, subCode, logAction, notify } from "@/lib/produzione/helpers";
import { SUB_DEPT_SUFFIX } from "@/lib/produzione/types";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { CUSTOMER_LABEL, type CustomerType, type PriceMode, priceMultiplier, sellPrice } from "@/lib/pricing";

/* ============== Tipi ============== */
type DanceRoll = {
  id: string;
  name: string;
  thicknessMm: number;
  rollWidth: number;
  rollLength: number;
  /** Altre lunghezze pezza disponibili per lo stesso articolo (es. 20 e 15 m). */
  rollLengths?: number[];

  colors: string[];
  pricePerSqm?: number;
  note?: string;
};

type TapeKind = "danza" | "biadesivo" | "altro";
type TapeRoll = {
  id: string;
  name: string;
  kind: TapeKind;
  rollLength: number; // m per rotolo
  widthMm?: number;   // larghezza nastro
  colors: string[];
  pricePerRoll?: number;
  note?: string;
};

type FireBaseType = "base" | "base_finitura";
type FireComponent = "mono" | "bi";
type FireFinish = "opaca" | "satinata" | "lucida";
type FireClass = { id: string; className: string; consumptionKgPerM2: number };
/** Una latta del listino. `label` mantiene l'espressione originale (es. "10+3"),
 *  `kg` è la somma effettiva utilizzata per i calcoli (es. 13). */
type FireCan = { id: string; kg: number; label: string; price: number };
type FireProduct = {
  id: string;
  name: string;
  treatedMaterials: string;
  colors: string[];
  base: string;
  baseType: FireBaseType;
  component: FireComponent;
  coats: number;
  cans: FireCan[];
  classes: FireClass[];
  finishes: FireFinish[];
  /** Solo se baseType === "base_finitura": prezzi e consumi della finitura,
   *  in aggiunta a quelli della base (cans/classes). */
  finishCans?: FireCan[];
  finishClasses?: FireClass[];
  finishCoats?: number;
  /** Maggiorazione % per colore (es. 15 = +15% su tutti i formati di latta).
   *  Default 0 (= prezzo base). */
  colorSurcharges?: Record<string, number>;
  colorFinishSurcharges?: Record<string, number>;
  /** @deprecated vecchio formato matrice colore×latta, ignorato. */
  colorCanPrices?: Record<string, Record<string, number>>;
  colorFinishCanPrices?: Record<string, Record<string, number>>;
  note?: string;
};

type Point = { x: number; y: number };
type Segment = { id: string; length: number; angle: number };
type StripDirection = "vertical" | "horizontal";

type SaleUnit = "m" | "m²" | "pz" | "kg";
type SaleProduct = {
  id: string;
  name: string;
  detail?: string;
  variants: string[];
  unit: SaleUnit;
  pricePurchase?: number;
  priceSell?: number;
  note?: string;
};

type MagState = {
  version: 5;
  danceRolls: DanceRoll[];
  tapeRolls: TapeRoll[];
  fireProducts: FireProduct[];
  printProducts: SaleProduct[];
  fabricProducts: SaleProduct[];
};
const initial: MagState = { version: 5, danceRolls: [], tapeRolls: [], fireProducts: [], printProducts: [], fabricProducts: [] };
const MAGAZZINO_LOCAL_KEYS = ["officina:magazzino-calc:v5", "officina:magazzino-calc:v4", "officina:magazzino-calc:v3"];

const hydrate = (raw: unknown): MagState => {
  const p = raw as any;
  if (!p || typeof p !== "object") return initial;
  const danceRolls: DanceRoll[] = Array.isArray(p.danceRolls)
    ? p.danceRolls.map((r: any) => ({
        id: r.id ?? uid(),
        name: r.name ?? "",
        thicknessMm: Number(r.thicknessMm ?? 0),
        rollWidth: Number(r.rollWidth ?? 0),
        rollLength: Number(r.rollLength ?? 0),
        rollLengths: Array.isArray(r.rollLengths)
          ? r.rollLengths.map((n: any) => Number(n)).filter((n: number) => n > 0)
          : [],

        colors: Array.isArray(r.colors) ? r.colors : (r.color ? [String(r.color)] : []),
        pricePerSqm: r.pricePerSqm != null
          ? Number(r.pricePerSqm)
          : (r.pricePerRoll != null && Number(r.rollLength) > 0 && Number(r.rollWidth) > 0
              ? Number(r.pricePerRoll) / (Number(r.rollLength) * Number(r.rollWidth))
              : undefined),
        note: r.note,
      }))
    : [];
  const fireProducts: FireProduct[] = Array.isArray(p.fireProducts)
    ? p.fireProducts.map((f: any) => ({
        id: f.id ?? uid(),
        name: f.name ?? "",
        treatedMaterials: f.treatedMaterials ?? "",
        colors: Array.isArray(f.colors)
          ? f.colors.map(String).filter(Boolean)
          : (f.color ? splitTags(String(f.color)) : []),
        base: f.base ?? (f.baseType === "base_finitura" ? "Base + finitura" : "Base"),
        baseType: (f.baseType ?? "base") as FireBaseType,
        component: (f.component ?? "mono") as FireComponent,
        coats: Math.max(1, Number(f.coats ?? f.mani ?? 1)),
        cans: Array.isArray(f.cans)
          ? f.cans
              .map((c: any) => {
                const label = String(c?.label ?? c?.kg ?? "").trim();
                const kg = Number.isFinite(Number(c?.kg)) && Number(c?.kg) > 0 ? Number(c.kg) : parseKgExpr(label);
                return { id: c?.id ?? uid(), kg, label: label || (kg ? String(kg) : ""), price: Number(c?.price ?? 0) || 0 };
              })
              .filter((c: FireCan) => c.kg > 0)
          : Array.isArray(f.canSizesKg)
            ? f.canSizesKg
                .map(Number)
                .filter((n: number) => n > 0)
                .map((kg: number) => ({
                  id: uid(),
                  kg,
                  label: String(kg),
                  price: Number(f.canPrices?.[String(kg)] ?? 0) || 0,
                }))
            : [],
        classes: Array.isArray(f.classes)
          ? f.classes.map((c: any) => ({ id: c.id ?? uid(), className: c.className ?? "", consumptionKgPerM2: Number(c.consumptionKgPerM2 ?? 0) }))
          : [],
        finishes: Array.isArray(f.finishes) ? f.finishes : [],
        finishCans: Array.isArray(f.finishCans)
          ? f.finishCans
              .map((c: any) => {
                const label = String(c?.label ?? c?.kg ?? "").trim();
                const kg = Number.isFinite(Number(c?.kg)) && Number(c?.kg) > 0 ? Number(c.kg) : parseKgExpr(label);
                return { id: c?.id ?? uid(), kg, label: label || (kg ? String(kg) : ""), price: Number(c?.price ?? 0) || 0 };
              })
              .filter((c: FireCan) => c.kg > 0)
          : undefined,
        finishClasses: Array.isArray(f.finishClasses)
          ? f.finishClasses.map((c: any) => ({ id: c.id ?? uid(), className: c.className ?? "", consumptionKgPerM2: Number(c.consumptionKgPerM2 ?? 0) }))
          : undefined,
        finishCoats: f.finishCoats != null ? Math.max(1, Number(f.finishCoats)) : undefined,
        colorCanPrices: (f.colorCanPrices && typeof f.colorCanPrices === "object") ? f.colorCanPrices : undefined,
        colorFinishCanPrices: (f.colorFinishCanPrices && typeof f.colorFinishCanPrices === "object") ? f.colorFinishCanPrices : undefined,
        colorSurcharges: (f.colorSurcharges && typeof f.colorSurcharges === "object") ? f.colorSurcharges : undefined,
        colorFinishSurcharges: (f.colorFinishSurcharges && typeof f.colorFinishSurcharges === "object") ? f.colorFinishSurcharges : undefined,
        note: f.note,
      }))
    : [];
  const hydrateSale = (arr: any): SaleProduct[] => Array.isArray(arr) ? arr.map((s: any) => ({
    id: s?.id ?? uid(),
    name: String(s?.name ?? ""),
    detail: s?.detail ?? "",
    variants: Array.isArray(s?.variants) ? s.variants.map(String).filter(Boolean) : [],
    unit: (["m", "m²", "pz", "kg"] as SaleUnit[]).includes(s?.unit) ? s.unit : "pz",
    pricePurchase: s?.pricePurchase != null ? Number(s.pricePurchase) : undefined,
    priceSell: s?.priceSell != null ? Number(s.priceSell) : undefined,
    note: s?.note,
  })) : [];
  const tapeRolls: TapeRoll[] = Array.isArray(p.tapeRolls)
    ? p.tapeRolls.map((t: any) => ({
        id: t.id ?? uid(),
        name: String(t.name ?? ""),
        kind: (["danza", "biadesivo", "altro"] as TapeKind[]).includes(t.kind) ? t.kind : "danza",
        rollLength: Number(t.rollLength ?? 0),
        widthMm: t.widthMm != null ? Number(t.widthMm) : undefined,
        colors: Array.isArray(t.colors) ? t.colors.map(String).filter(Boolean) : [],
        pricePerRoll: t.pricePerRoll != null ? Number(t.pricePerRoll) : undefined,
        note: t.note,
      }))
    : [];
  return {
    version: 5,
    danceRolls,
    tapeRolls,
    fireProducts,
    printProducts: hydrateSale(p.printProducts),
    fabricProducts: hydrateSale(p.fabricProducts),
  };
};

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("it-IT", { maximumFractionDigits: d }) : "—";
const eur = (n: number) => Number.isFinite(n) ? n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }) : "—";
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const includesLoose = (h: string, n: string) => !n.trim() || norm(h).includes(norm(n));

/** Valuta espressioni tipo "10+3" o "5+2-1". Ritorna 0 se non valida. */
const parseKgExpr = (expr: string): number => {
  if (!expr) return 0;
  const s = String(expr).replace(/,/g, ".").replace(/\s+/g, "");
  if (!/^[-+]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  // somma/sottrazione di numeri
  const tokens: string[] = s.match(/[+-]?\d+(\.\d+)?/g) ?? [];
  return tokens.reduce<number>((a, t) => a + Number(t), 0);
};

/** Splitta "legno, mdf; tessuto" in tag puliti. */
const splitTags = (s: string): string[] =>
  String(s || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);

/** Sceglie automaticamente il miglior MIX di latte (anche di formati diversi)
 *  per coprire `kgNeeded`. Obiettivo principale: minimizzare il costo totale.
 *  Tie-break: minimo avanzo (kg di vernice in più), poi minor numero di latte.
 *  Se mancano i prezzi, ottimizza solo l'avanzo (e quindi le latte aperte).
 */
type CanPlanItem = { can: FireCan; count: number };
type CanPlan = { items: CanPlanItem[]; totalKg: number; totalCost: number; totalCans: number; leftoverKg: number };
const planCans = (cans: FireCan[], kgNeeded: number): CanPlan | null => {
  const usable = (cans ?? []).filter((c) => c.kg > 0);
  if (usable.length === 0 || kgNeeded <= 0) return null;
  // Lavoriamo in "decagrammi" = 0,1 kg (precisione sufficiente per le ricette)
  const STEP = 10;
  const need = Math.max(1, Math.ceil(kgNeeded * STEP));
  const maxCan = Math.max(...usable.map((c) => Math.ceil(c.kg * STEP)));
  const cap = need + maxCan; // overshoot massimo
  const INF = Infinity;
  const cost: number[] = new Array(cap + 1).fill(INF);
  const cans_n: number[] = new Array(cap + 1).fill(0);
  const back: (number | null)[] = new Array(cap + 1).fill(null); // indice del can usato per arrivare qui
  const prev: number[] = new Array(cap + 1).fill(-1);
  cost[0] = 0;
  const anyPrice = usable.some((c) => c.price > 0);
  // bias minuscolo per preferire meno avanzo e meno latte quando il costo coincide
  const SCORE = (i: number, c: number, n: number) =>
    c + (anyPrice ? 0 : 0) + i * 1e-7 + n * 1e-9;
  const score: number[] = new Array(cap + 1).fill(INF);
  score[0] = 0;
  for (let i = 0; i <= cap; i++) {
    if (score[i] === INF) continue;
    for (let k = 0; k < usable.length; k++) {
      const c = usable[k];
      const w = Math.round(c.kg * STEP);
      const j = i + w;
      if (j > cap) continue;
      const newCost = cost[i] + (c.price || 0);
      const newN = cans_n[i] + 1;
      const s = SCORE(j, newCost, newN);
      if (s < score[j]) {
        score[j] = s;
        cost[j] = newCost;
        cans_n[j] = newN;
        back[j] = k;
        prev[j] = i;
      }
    }
  }
  let bestI = -1;
  let bestS = INF;
  for (let i = need; i <= cap; i++) {
    if (score[i] < bestS) { bestS = score[i]; bestI = i; }
  }
  if (bestI < 0) return null;
  const counts = new Map<string, { can: FireCan; count: number }>();
  let cur = bestI;
  while (cur > 0 && back[cur] != null) {
    const c = usable[back[cur] as number];
    const e = counts.get(c.id);
    if (e) e.count += 1; else counts.set(c.id, { can: c, count: 1 });
    cur = prev[cur];
  }
  const items = Array.from(counts.values()).sort((a, b) => b.can.kg - a.can.kg);
  const totalKg = bestI / STEP;
  return {
    items,
    totalKg,
    totalCost: cost[bestI],
    totalCans: cans_n[bestI],
    leftoverKg: Math.max(0, totalKg - kgNeeded),
  };
};

const polygonArea = (points: Point[]) => {
  if (points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
};
const roomBounds = (points: Point[], fW: number, fH: number) => {
  if (points.length < 2) return { w: fW, h: fH, minX: 0, minY: 0 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), minX: Math.min(...xs), minY: Math.min(...ys) };
};

/** Calcolo ANALITICO dei teli: per ogni fascia (banda larga `rollWidth`) misura
 *  l'estensione reale del poligono della sala lungo il verso del telo, invece di
 *  usare il "vuoto per pieno" del rettangolo di ingombro. */
const stripSpans = (points: Point[], direction: "vertical" | "horizontal", rollWidth: number, fW: number, fH: number): number[] => {
  const b = roomBounds(points, fW, fH);
  const across = direction === "vertical" ? b.w : b.h;
  if (!(rollWidth > 0) || !(across > 0)) return [];
  const n = Math.ceil(across - 1e-9 > 0 ? across / rollWidth : 0);
  if (points.length < 3) {
    const along = direction === "vertical" ? b.h : b.w;
    return Array.from({ length: n }, () => along);
  }
  const minAcross = direction === "vertical" ? b.minX : b.minY;
  // intersezioni della retta (perpendicolare alle fasce) col poligono
  const crossings = (c: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], d = points[(i + 1) % points.length];
      const a1 = direction === "vertical" ? a.x : a.y;
      const d1 = direction === "vertical" ? d.x : d.y;
      const a2 = direction === "vertical" ? a.y : a.x;
      const d2 = direction === "vertical" ? d.y : d.x;
      if (a1 === d1) { if (Math.abs(a1 - c) < 1e-9) { out.push(a2, d2); } continue; }
      const t = (c - a1) / (d1 - a1);
      if (t >= -1e-9 && t <= 1 + 1e-9) out.push(a2 + t * (d2 - a2));
    }
    return out;
  };
  const SAMPLES = 25;
  const spans: number[] = [];
  for (let i = 0; i < n; i++) {
    const c0 = minAcross + i * rollWidth;
    const c1 = Math.min(minAcross + (i + 1) * rollWidth, minAcross + across);
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s <= SAMPLES; s++) {
      const c = c0 + ((c1 - c0) * s) / SAMPLES;
      const cc = Math.min(Math.max(c, c0 + 1e-6), c1 - 1e-6);
      const xs = crossings(cc);
      if (xs.length === 0) continue;
      lo = Math.min(lo, Math.min(...xs));
      hi = Math.max(hi, Math.max(...xs));
    }
    spans.push(hi > lo ? Number((hi - lo).toFixed(3)) : 0);
  }
  return spans.filter((v) => v > 0.001);
};
const segmentsToPoints = (segs: Segment[]): Point[] => {
  if (segs.length === 0) return [];
  const pts: Point[] = [{ x: 0, y: 0 }];
  let x = 0, y = 0, heading = 0;
  for (const s of segs) {
    heading += (s.angle || 0);
    const rad = (heading * Math.PI) / 180;
    x += (s.length || 0) * Math.cos(rad);
    y += (s.length || 0) * Math.sin(rad);
    pts.push({ x, y });
  }
  return pts;
};

/* ============== Pagina ============== */
export default function MagazzinoCalc({ scopeKey }: { scopeKey?: string } = {}) {
  const { state, setState, ready, status } = useSharedCloudState<MagState>("magazzino_calc", initial, {
    hydrate,
    localStorageKeys: MAGAZZINO_LOCAL_KEYS,
  });
  const [sub, setSub] = useState<"danza" | "ignifugo" | "stampa" | "tessuti">(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("sub");
    if (v === "ignifugo" || v === "stampa" || v === "tessuti") return v;
    return "danza";
  });
  const update = (patch: Partial<MagState>) => setState({ ...state, ...patch, version: 5 });

  return (
    <div className="space-y-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-dept">// Vendite</div>
        <h2 className="font-display text-2xl font-semibold">Vendite · Calcolo & schede magazzino</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {status === "saving" ? "Salvataggio listini…" : status === "error" ? "Errore salvataggio: non chiudere la pagina" : "Listini salvati"}
        </p>
      </div>

      <div className="flex gap-1 border-b-2 border-ink/15 flex-wrap">
        {([
          { key: "danza", label: "Tappeto danza", Icon: Layers },
          { key: "ignifugo", label: "Vernice ignifuga", Icon: Droplets },
          { key: "stampa", label: "Prodotti stampa", Icon: Printer },
          { key: "tessuti", label: "Tessuti", Icon: Scissors },
        ] as const).map(({ key, label, Icon }) => {
          const active = sub === key;
          return (
            <button key={key} onClick={() => { setSub(key); const url = new URL(window.location.href); url.searchParams.set("sub", key); window.history.replaceState(null, "", url); }} className={`px-4 py-2 text-[12px] uppercase tracking-wider font-bold border-b-2 -mb-[2px] transition-colors inline-flex items-center gap-2 ${active ? "border-dept text-dept" : "border-transparent text-ink/50 hover:text-ink"}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
      </div>

      {!ready ? (
        <div className="p-10 text-center text-[12px] text-muted-foreground">Caricamento…</div>
      ) : sub === "danza" ? (
        <DanceSection
          rolls={state.danceRolls ?? []}
          setRolls={(danceRolls) => update({ danceRolls })}
          tapes={state.tapeRolls ?? []}
          setTapes={(tapeRolls) => update({ tapeRolls })}
          scopeKey={scopeKey}
        />
      ) : sub === "ignifugo" ? (
        <FireSection products={state.fireProducts ?? []} setProducts={(fireProducts) => update({ fireProducts })} />
      ) : sub === "stampa" ? (
        <SaleProductSection
          title="Prodotti stampa"
          categoryKey="stampa"
          sourceDept="stampa"
          sourceLabel="Listino Laboratorio"
          variantLabel="Variante"
          defaultUnit="m²"
        />
      ) : (
        <SaleProductSection
          title="Tessuti"
          categoryKey="tessuti"
          sourceDept="tappezzeria"
          sourceLabel="Listino Tappezzeria"
          variantLabel="Colore / variante"
          defaultUnit="m"
        />
      )}
    </div>
  );
}

/* ============== Form ordine manuale → magazzino (riusabile) ============== */
type ManualLine = { id: string; descrizione: string; qty: string; um: string; note: string; price: string };

type PickedItem = { label: string; um: string };

/* ============== Picker dialogs (selezione prodotto dal listino) ============== */
function DancePickerDialog({ rolls, tapes, onPick, onClose }: {
  rolls: DanceRoll[]; tapes: TapeRoll[]; onPick: (i: PickedItem) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [thickness, setThickness] = useState<number>(0);
  const allNames = useMemo(() => Array.from(new Set(rolls.map((r) => r.name).filter(Boolean))), [rolls]);
  // Colori filtrati per nome selezionato (se scelto), altrimenti tutti
  const allColors = useMemo(() => {
    const src = name ? rolls.filter((r) => includesLoose(r.name, name)) : rolls;
    return Array.from(new Set(src.flatMap((r) => r.colors ?? []).filter(Boolean)));
  }, [rolls, name]);
  // Reset colore se non più disponibile
  useEffect(() => { if (color && !allColors.includes(color)) setColor(""); }, [allColors, color]);

  const filtered = useMemo(() => rolls.filter((r) => {
    const nOk = !name || includesLoose(r.name, name);
    const cOk = !color || (r.colors ?? []).some((c) => includesLoose(c, color));
    const tOk = !thickness || r.thicknessMm >= thickness;
    return nOk && cOk && tOk;
  }), [rolls, name, color, thickness]);

  const pick = (r: DanceRoll, c: string, kind: "rotolo" | "taglio") => {
    const base = `Tappeto ${r.name}${r.thicknessMm ? ` ${fmt(r.thicknessMm)}mm` : ""}${c ? ` · ${c}` : ""}`;
    const label = kind === "rotolo"
      ? `${base} (rotolo intero ${fmt(r.rollLength)}×${fmt(r.rollWidth)}m)`
      : `${base} (taglio)`;
    onPick({ label, um: kind === "rotolo" ? "rt" : "mq" });
  };

  const pickTape = (t: TapeRoll, c: string) => {
    const base = `Nastro ${t.name || t.kind}${t.widthMm ? ` ${t.widthMm}mm` : ""}${c ? ` · ${c}` : ""}`;
    onPick({ label: `${base} (rotolo ${fmt(t.rollLength)}m)`, um: "rt" });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Scegli dal listino tappeti danza</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Nome"><SelectWithAdd value={name} onChange={setName} options={allNames} placeholder="Tutti" emptyLabel="Tutti" /></Field>
            <Field label={name ? `Colore (${allColors.length} per "${name}")` : "Colore"}>
              <SelectWithAdd value={color} onChange={setColor} options={allColors} placeholder={allColors.length === 0 ? "—" : "Tutti"} emptyLabel="Tutti" />
            </Field>
            <Field label="Spessore min (mm)"><Input type="number" step="0.1" value={thickness || ""} onChange={(e) => setThickness(Number(e.target.value))} /></Field>
          </div>
          <div className="border border-ink/15 rounded-sm divide-y max-h-[40vh] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-[12px] text-muted-foreground">Nessun tappeto coi filtri.</div>
            ) : filtered.map((r) => {
              // Se c'è un colore selezionato, mostra solo quel colore per questo prodotto
              const baseColors = (r.colors ?? []).length ? r.colors : [""];
              const colors = color ? baseColors.filter((c) => includesLoose(c, color)) : baseColors;
              if (colors.length === 0) return null;
              return (
                <div key={r.id} className="p-2.5">
                  <div className="text-sm font-semibold">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground mb-2">
                    spess. {fmt(r.thicknessMm)} mm · rotolo {fmt(r.rollLength)} × {fmt(r.rollWidth)} m
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {colors.map((c, i) => (
                      <div key={i} className="flex gap-1 items-center border border-ink/10 rounded-sm pl-2">
                        <span className="text-[11px]">{c || "—"}</span>
                        <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => pick(r, c, "rotolo")}>Rotolo intero</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => pick(r, c, "taglio")}>Al taglio</Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t pt-2">
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1.5">Listino nastri</div>
            {tapes.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">Nessun nastro nel listino. Aggiungili dalla tab "Listino nastri".</div>
            ) : (
              <div className="border border-ink/15 rounded-sm divide-y max-h-[28vh] overflow-auto">
                {tapes.map((t) => {
                  const cs = (t.colors ?? []).length ? t.colors : [""];
                  return (
                    <div key={t.id} className="p-2">
                      <div className="text-[12px] font-semibold">{t.name || `Nastro ${t.kind}`} <span className="text-[10px] font-normal text-muted-foreground">· {t.kind}{t.widthMm ? ` · ${t.widthMm} mm` : ""} · {fmt(t.rollLength)} m/rotolo</span></div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {cs.map((c, i) => (
                          <Button key={i} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => pickTape(t, c)}>{c || "Aggiungi"} · rotolo</Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TapePickerDialog({ tapes, onPick, onClose }: {
  tapes: TapeRoll[]; onPick: (i: PickedItem) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const allNames = useMemo(() => Array.from(new Set(tapes.map((t) => t.name).filter(Boolean))), [tapes]);
  const allColors = useMemo(() => {
    const src = name ? tapes.filter((t) => includesLoose(t.name || "", name)) : tapes;
    return Array.from(new Set(src.flatMap((t) => t.colors ?? []).filter(Boolean)));
  }, [tapes, name]);
  useEffect(() => { if (color && !allColors.includes(color)) setColor(""); }, [allColors, color]);

  const filtered = useMemo(() => tapes.filter((t) => {
    const nOk = !name || includesLoose(t.name || "", name);
    const cOk = !color || (t.colors ?? []).some((c) => includesLoose(c, color));
    return nOk && cOk;
  }), [tapes, name, color]);

  const pickTape = (t: TapeRoll, c: string) => {
    const base = `Nastro ${t.name || t.kind}${t.widthMm ? ` ${t.widthMm}mm` : ""}${c ? ` · ${c}` : ""}`;
    onPick({ label: `${base} (rotolo ${fmt(t.rollLength)}m)`, um: "rt" });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Scegli dal listino nastri</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nome"><SelectWithAdd value={name} onChange={setName} options={allNames} placeholder="Tutti" emptyLabel="Tutti" /></Field>
            <Field label="Colore"><SelectWithAdd value={color} onChange={setColor} options={allColors} placeholder={allColors.length === 0 ? "—" : "Tutti"} emptyLabel="Tutti" /></Field>
          </div>
          <div className="border border-ink/15 rounded-sm divide-y max-h-[50vh] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-[12px] text-muted-foreground">Nessun nastro coi filtri.</div>
            ) : filtered.map((t) => {
              const baseColors = (t.colors ?? []).length ? t.colors : [""];
              const colors = color ? baseColors.filter((c) => includesLoose(c, color)) : baseColors;
              if (colors.length === 0) return null;
              return (
                <div key={t.id} className="p-2.5">
                  <div className="text-sm font-semibold">{t.name || `Nastro ${t.kind}`}</div>
                  <div className="text-[11px] text-muted-foreground mb-2">
                    {t.kind}{t.widthMm ? ` · ${t.widthMm} mm` : ""} · {fmt(t.rollLength)} m/rotolo
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {colors.map((c, i) => (
                      <Button key={i} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => pickTape(t, c)}>{c || "Aggiungi"} · rotolo</Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FirePickerDialog({ products, onPick, onClose }: {
  products: FireProduct[]; onPick: (i: PickedItem) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [material, setMaterial] = useState("");
  const [klass, setKlass] = useState("");
  const [base, setBase] = useState("");
  const allNames = useMemo(() => Array.from(new Set(products.map((p) => p.name).filter(Boolean))), [products]);
  const allColors = useMemo(() => {
    const src = name ? products.filter((p) => includesLoose(p.name, name)) : products;
    return Array.from(new Set(src.flatMap((p) => p.colors ?? []).filter(Boolean)));
  }, [products, name]);
  const allMaterials = useMemo(() => Array.from(new Set(products.flatMap((p) => splitTags(p.treatedMaterials)))), [products]);
  const allClasses = useMemo(() => Array.from(new Set(products.flatMap((p) => (p.classes ?? []).map((c) => c.className).filter(Boolean)))), [products]);
  const allBases = useMemo(() => Array.from(new Set(products.map((p) => p.base).filter(Boolean))), [products]);

  const filtered = useMemo(() => products.filter((p) => {
    const nOk = !name || includesLoose(p.name, name);
    const cOk = !color || (p.colors ?? []).some((c) => includesLoose(c, color));
    const mOk = !material || includesLoose(p.treatedMaterials, material);
    const kOk = !klass || (p.classes ?? []).some((c) => includesLoose(c.className, klass));
    const bOk = !base || includesLoose(p.base, base);
    return nOk && cOk && mOk && kOk && bOk;
  }), [products, name, color, material, klass, base]);

  const pick = (p: FireProduct, c: string, can?: { label: string; kg: number }) => {
    const baseLabel = `${p.name}${c ? ` · ${c}` : ""}${p.base ? ` · ${p.base}` : ""}`;
    if (can) onPick({ label: `${baseLabel} — latta ${can.label} kg`, um: "latte" });
    else onPick({ label: baseLabel, um: "kg" });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Scegli dal listino vernici ignifughe</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            <Field label="Nome"><SelectWithAdd value={name} onChange={setName} options={allNames} placeholder="Tutti" emptyLabel="Tutti" /></Field>
            <Field label="Colore"><SelectWithAdd value={color} onChange={setColor} options={allColors} placeholder="Tutti" emptyLabel="Tutti" /></Field>
            <Field label="Materiale"><SelectWithAdd value={material} onChange={setMaterial} options={allMaterials} placeholder="Tutti" emptyLabel="Tutti" /></Field>
            <Field label="Classe"><SelectWithAdd value={klass} onChange={setKlass} options={allClasses} placeholder="Tutte" emptyLabel="Tutte" /></Field>
            <Field label="Base"><SelectWithAdd value={base} onChange={setBase} options={allBases} placeholder="Tutte" emptyLabel="Tutte" /></Field>
          </div>
          <div className="border border-ink/15 rounded-sm divide-y max-h-[50vh] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-[12px] text-muted-foreground">Nessun prodotto coi filtri.</div>
            ) : filtered.map((p) => {
              const colors = (p.colors ?? []).length ? p.colors : [""];
              return (
                <div key={p.id} className="p-2.5">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground mb-2">
                    {p.base}{p.treatedMaterials ? ` · ${p.treatedMaterials}` : ""}
                    {(p.classes ?? []).length ? ` · ${(p.classes ?? []).map((c) => c.className).join(", ")}` : ""}
                  </div>
                  <div className="space-y-1">
                    {colors.map((c, i) => (
                      <div key={i} className="flex flex-wrap gap-1 items-center border border-ink/10 rounded-sm pl-2 py-1">
                        <span className="text-[11px] min-w-[60px]">{c || "—"}</span>
                        {(p.cans ?? []).length === 0 ? (
                          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => pick(p, c)}>kg</Button>
                        ) : (p.cans ?? []).map((can) => (
                          <Button key={can.id} size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => pick(p, c, can)}>
                            Latta {can.label} kg
                          </Button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t pt-2 flex flex-wrap gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground self-center">Accessori:</span>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onPick({ label: "Diluente / additivo", um: "lt" })}>Diluente / additivo</Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualMagazzinoOrderForm({
  sourceLabel,
  categoryKey,
  suggestions,
  picker,
}: {
  sourceLabel: string;
  categoryKey: SaleCategory;
  suggestions: { descrizione: string; um: string }[];
  picker?: (onPick: (item: PickedItem) => void, onClose: () => void) => React.ReactNode;
}) {
  // Le righe vivono nel draft di progetto (officina:state.salesCarts[<key>]):
  // cliente, riferimento ordine e responsabile magazzino vengono scelti una
  // sola volta in "Crea commessa nel Flow" (DraftTabsBar in alto).
  const [lines, setLines] = useState<ManualLine[]>(() => {
    const cart = readDraftSalesCart(categoryKey);
    if (cart.length === 0) return [{ id: uid(), descrizione: "", qty: "", um: suggestions[0]?.um ?? "pz", note: "", price: "" }];
    return cart.map((l) => ({
      id: l.id || uid(),
      descrizione: l.name || "",
      qty: l.qty != null ? String(l.qty) : "",
      um: l.unit || suggestions[0]?.um || "pz",
      note: l.variant || "",
      price: l.priceSell != null && l.priceSell > 0 ? String(l.priceSell) : "",
    }));
  });
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);
  const [manualEdit, setManualEdit] = useState<Record<string, boolean>>({});

  // Sync verso il draft a ogni cambio.
  useEffect(() => {
    const valid = lines.filter((l) => l.descrizione.trim() && Number(l.qty) > 0);
    const cart: CartLine[] = valid.map((l) => ({
      id: l.id,
      materialId: "",
      qty: Number(l.qty) || 0,
      name: l.descrizione.trim(),
      variant: l.note?.trim() || "",
      unit: (l.um as SaleUnit) || "pz",
      priceSell: Number(l.price) || 0,
      pricePurchase: 0,
      category: categoryKey,
    }));
    writeDraftSalesCart(categoryKey, cart);
  }, [lines, categoryKey]);

  // Ricarica quando si cambia scheda progetto.
  useEffect(() => {
    const onLoaded = () => {
      const cart = readDraftSalesCart(categoryKey);
      setLines(
        cart.length === 0
          ? [{ id: uid(), descrizione: "", qty: "", um: suggestions[0]?.um ?? "pz", note: "", price: "" }]
          : cart.map((l) => ({
              id: l.id || uid(),
              descrizione: l.name || "",
              qty: l.qty != null ? String(l.qty) : "",
              um: l.unit || suggestions[0]?.um || "pz",
              note: l.variant || "",
              price: l.priceSell != null && l.priceSell > 0 ? String(l.priceSell) : "",
            })),
      );
    };
    window.addEventListener("officina:draft-state-loaded", onLoaded);
    return () => window.removeEventListener("officina:draft-state-loaded", onLoaded);
  }, [categoryKey, suggestions]);

  const addLine = (preset?: { descrizione: string; um: string }) => {
    const id = uid();
    setLines((ls) => [...ls, { id, descrizione: preset?.descrizione ?? "", qty: "", um: preset?.um ?? "pz", note: "", price: "" }]);
    return id;
  };
  const addAndPick = () => { const id = addLine(); setPickerLineId(id); };
  const updLine = (id: string, patch: Partial<ManualLine>) => setLines((ls) => ls.map((l) => l.id === id ? { ...l, ...patch } : l));
  const rmLine = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));

  const validCount = lines.filter((l) => l.descrizione.trim() && Number(l.qty) > 0).length;

  return (
    <div className="border-2 border-ink/15 rounded-sm bg-paper">
      <div className="px-3 py-2 bg-muted/40 border-b flex items-center gap-2 flex-wrap">
        <PackageCheck className="w-3.5 h-3.5" />
        <div className="font-mono text-[10px] uppercase tracking-widest">{sourceLabel} · ordine manuale → magazzino</div>
        <div className="flex-1" />
        {validCount > 0 && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
            {validCount} vo{validCount === 1 ? "ce" : "ci"} · usa <strong>Invia al Flow</strong> in alto
          </div>
        )}
      </div>
      <div className="p-4 space-y-4">
        <div className="border-2 border-ink/15 rounded-sm bg-background">
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
            <div className="font-mono text-[10px] uppercase tracking-widest">Voci ordine ({lines.length})</div>
            <div className="flex gap-1 flex-wrap">
              {picker && (
                <Button size="sm" className="h-7 text-[11px]" onClick={addAndPick}>
                  <Plus className="w-3 h-3 mr-1" />Scegli dal listino
                </Button>
              )}
              <Button size="sm" className="h-7 text-[11px]" onClick={() => addLine()}>
                <Plus className="w-3 h-3 mr-1" />Aggiungi all'ordine
              </Button>

            </div>
          </div>
          <div className="divide-y">
            {lines.length === 0 && <div className="p-3 text-[12px] text-muted-foreground">Aggiungi almeno una voce.</div>}
            {lines.map((l) => {
              const isManual = manualEdit[l.id] || !picker;
              return (
                <div key={l.id} className="p-2 grid grid-cols-[1fr,80px,60px,110px,1fr,32px] gap-2 items-start">
                  <div className="flex flex-col gap-1 min-w-0">
                    {isManual ? (
                      <Input value={l.descrizione} onChange={(e) => updLine(l.id, { descrizione: e.target.value })} placeholder="Descrizione articolo" className="h-8 text-[12px]" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerLineId(l.id)}
                        className={`h-8 px-2 text-left text-[12px] border-2 rounded-sm truncate ${l.descrizione ? "border-ink/20 bg-paper" : "border-dashed border-primary/50 text-primary hover:bg-primary/5"}`}
                        title={l.descrizione || "Scegli dal listino…"}
                      >
                        {l.descrizione || "Scegli dal listino…"}
                      </button>
                    )}
                    {picker && (
                      <button
                        type="button"
                        onClick={() => setManualEdit({ ...manualEdit, [l.id]: !isManual })}
                        className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground hover:text-ink underline self-start"
                      >
                        {isManual ? "← Torna al listino" : "✎ Modifica manualmente"}
                      </button>
                    )}
                  </div>
                  <Input type="number" step="0.01" value={l.qty} onChange={(e) => updLine(l.id, { qty: e.target.value })} placeholder="Q.tà" className="h-8 text-[12px]" />
                  <Input value={l.um} readOnly tabIndex={-1} placeholder="um" className="h-8 text-[12px] bg-muted/40 cursor-not-allowed text-center font-mono" title="Unità di misura impostata dal listino" />
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" value={l.price} onChange={(e) => updLine(l.id, { price: e.target.value })} placeholder="Prezzo" className="h-8 text-[12px] pr-10 text-right font-mono" title={`Prezzo unitario di vendita (€/${l.um})`} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground pointer-events-none">€/{l.um}</span>
                  </div>
                  <Input value={l.note} onChange={(e) => updLine(l.id, { note: e.target.value })} placeholder="Note (opz.)" className="h-8 text-[12px]" />
                  <button onClick={() => rmLine(l.id)} className="text-ink/40 hover:text-destructive p-1 mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </div>
        </div>

        {picker && pickerLineId && picker(
          (item) => { updLine(pickerLineId, { descrizione: item.label, um: item.um }); setPickerLineId(null); },
          () => setPickerLineId(null),
        )}
      </div>
    </div>
  );
}


/* ============== Sezione Listino nastri ============== */
function TapeListSection({ tapes, setTapes }: { tapes: TapeRoll[]; setTapes: (t: TapeRoll[]) => void }) {
  const add = () => {
    const t: TapeRoll = { id: uid(), name: "Nuovo nastro", kind: "danza", rollLength: 33, widthMm: 50, colors: [] };
    setTapes([...tapes, t]);
  };
  const upd = (id: string, patch: Partial<TapeRoll>) => setTapes(tapes.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const del = (id: string) => setTapes(tapes.filter((t) => t.id !== id));
  return (
    <div className="border-2 border-ink/15 rounded-sm bg-paper">
      <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest">Listino nastri ({tapes.length})</div>
        <Button size="sm" onClick={add} className="h-7 px-2"><Plus className="w-3 h-3 mr-1" />Aggiungi</Button>
      </div>
      {tapes.length === 0 ? (
        <div className="p-6 text-center text-[12px] text-muted-foreground">Nessun nastro. Aggiungi il primo per iniziare.</div>
      ) : (
        <div className="divide-y max-h-[72vh] overflow-y-auto">
          {tapes.map((t) => (
            <div key={t.id} className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input value={t.name} onChange={(e) => upd(t.id, { name: e.target.value })} className="h-8 text-[12px] flex-1" placeholder="Nome (es. Nastro danza)" />
                <select value={t.kind} onChange={(e) => upd(t.id, { kind: e.target.value as TapeKind })} className="h-8 px-2 border border-input rounded-sm bg-background text-[12px]">
                  <option value="danza">Danza</option>
                  <option value="biadesivo">Biadesivo</option>
                  <option value="altro">Altro</option>
                </select>
                <button onClick={() => del(t.id)} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Field label="Lunghezza rotolo (m)"><Input type="number" step="0.1" value={t.rollLength || ""} onChange={(e) => upd(t.id, { rollLength: Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                <Field label="Larghezza (mm)"><Input type="number" value={t.widthMm ?? ""} onChange={(e) => upd(t.id, { widthMm: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                <Field label="Prezzo / rotolo (€)"><Input type="number" step="0.01" value={t.pricePerRoll ?? ""} onChange={(e) => upd(t.id, { pricePerRoll: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                <div className="col-span-full"><ChipsEditor label="Colori disponibili" values={t.colors ?? []} onChange={(colors) => upd(t.id, { colors })} placeholder="es. Nero, Bianco, Trasparente" /></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============== Sezione Tappeto danza ============== */
function DanceSection({ rolls, setRolls, tapes, setTapes, scopeKey }: { rolls: DanceRoll[]; setRolls: (r: DanceRoll[]) => void; tapes: TapeRoll[]; setTapes: (t: TapeRoll[]) => void; scopeKey?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // mode default = calcolo (catalogo dopo)
  const [mode, setMode] = useState<"calcolo" | "catalogo" | "ordine" | "nastri" | "ordine_nastri">("calcolo");
  const [selectedId, setSelectedId] = useState<string>("");
  // Nessuna precompilazione: i campi partono sempre vuoti. Nessuna persistenza
  // cross-progetto/sub-progetto per evitare che compaiano valori di default.
  const [needThickness, setNeedThickness] = useState<number>(0);
  const [needColor, setNeedColor] = useState<string>("");
  const [stageW, setStageW] = useState<number>(0);
  const [stageH, setStageH] = useState<number>(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [verts, setVerts] = useState<Point[]>([]);
  const [shapeMode, setShapeMode] = useState<"lati" | "punti">("punti");
  const [direction, setDirection] = useState<StripDirection>("vertical");
  const [chosenColor, setChosenColor] = useState<string>("");
  const [tapeType, setTapeType] = useState<"danza" | "biadesivo">("danza");
  const [chosenOptionKey, setChosenOptionKey] = useState<string | null>(null);

  const resetDanceCalculation = () => {
    setSelectedId("");
    setNeedThickness(0);
    setNeedColor("");
    setStageW(0);
    setStageH(0);
    setSegments([]);
    setVerts([]);
    setDirection("vertical");
    setChosenColor("");
    setTapeType("danza");
    setChosenOptionKey(null);
  };

  // Reset totale anche al primo mount: evita valori rimasti in memoria/HMR.
  const lastScopeRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    resetDanceCalculation();
  }, [scopeKey]);


  // Dialog "Invia al Flow"
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowCliente, setFlowCliente] = useState("");
  const [flowRef, setFlowRef] = useState("");
  const [flowTappetoMeters, setFlowTappetoMeters] = useState<number>(0);
  const [flowTappetoRolls, setFlowTappetoRolls] = useState<number>(0);
  const [flowTapeMeters, setFlowTapeMeters] = useState<number>(0);
  const [flowTapeRolls, setFlowTapeRolls] = useState<number>(0);
  const [flowNote, setFlowNote] = useState("");
  const [flowAssignee, setFlowAssignee] = useState<string>("");
  const [magazzinoUsers, setMagazzinoUsers] = useState<{ id: string; display_name: string | null }[]>([]);

  useEffect(() => {
    if (!flowOpen) return;
    supabase.from("profiles").select("id, display_name").contains("settori", ["magazzino"]).order("display_name", { ascending: true })
      .then(({ data }) => setMagazzinoUsers(data ?? []));
  }, [flowOpen]);

  const allColors = useMemo(() => Array.from(new Set(rolls.flatMap((r) => r.colors ?? []))), [rolls]);

  const filtered = useMemo(() => rolls.filter((r) => {
    const tOk = !needThickness || r.thicknessMm >= needThickness;
    const cOk = !needColor || (r.colors ?? []).some((c) => includesLoose(c, needColor));
    return tOk && cOk;
  }), [rolls, needThickness, needColor]);
  // Nessuna auto-selezione del prodotto: mostrato solo se l'utente sceglie esplicitamente
  const selected = selectedId ? rolls.find((r) => r.id === selectedId) : undefined;


  const segPoints = segmentsToPoints(segments);
  const customPoints = verts.length >= 3 ? verts : segPoints;
  const activePoints = customPoints.length >= 3
    ? customPoints
    : [{ x: 0, y: 0 }, { x: stageW, y: 0 }, { x: stageW, y: stageH }, { x: 0, y: stageH }];

  const addRoll = () => {
    const r: DanceRoll = { id: uid(), name: "Nuovo tappeto", thicknessMm: 2, rollWidth: 2, rollLength: 25, colors: [] };
    setRolls([...rolls, r]); setSelectedId(r.id); setMode("catalogo");
  };
  const updateRoll = (id: string, patch: Partial<DanceRoll>) => setRolls(rolls.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRoll = (id: string) => { setRolls(rolls.filter((r) => r.id !== id)); if (selectedId === id) setSelectedId(""); };

  const calc = useMemo(() => {
    if (!selected || selected.rollWidth <= 0 || selected.rollLength <= 0) return null;
    const b = roomBounds(activePoints, stageW, stageH);
    if (b.w <= 0 || b.h <= 0) return null;
    const surface = customPoints.length >= 3 ? polygonArea(customPoints) : b.w * b.h;
    const along = direction === "vertical" ? b.h : b.w;
    // Calcolo ANALITICO: lunghezza reale di OGNI telo (no vuoto per pieno)
    const spans = stripSpans(activePoints, direction, selected.rollWidth, stageW, stageH);
    const stripLens = spans.length > 0 ? spans : [];
    const strips = stripLens.length;
    const totalLen = stripLens.reduce((a, c) => a + c, 0);
    const maxStrip = strips > 0 ? Math.max(...stripLens) : 0;
    const unit = Number(selected.pricePerSqm ?? 0);
    const cutSurcharge = 1.2;
    const cutStep = 5;
    const w = selected.rollWidth;
    /** Lunghezze rotolo disponibili per questo prodotto (alcuni articoli sono
     *  forniti in pezze diverse: es. 20 m oppure 15 m). */
    const lengths = Array.from(
      new Set([selected.rollLength, ...(selected.rollLengths ?? [])].map(Number).filter((n) => n > 0)),
    ).sort((a, c) => a - c);

    const ceilToStep = (m: number) => (m > 0 ? Math.ceil(m / cutStep) * cutStep : 0);

    type Opt = {
      key: string; label: string; rollLen: number;
      wholeRolls: number; cutMeters: number;
      purchasedM: number; purchasedSqm: number; price: number;
      wholePrice: number; cutPrice: number;
      wholeUnit: number; cutUnit: number;
    };
    const options: Opt[] = [];
    const wholeUnit = unit;
    const cutUnit = unit * cutSurcharge;
    const makeOpt = (L: number, key: string, label: string, wholeRolls: number, cutMeters: number): Opt => {
      const wholePrice = wholeRolls * L * w * wholeUnit;
      const cutPrice = cutMeters * w * cutUnit;
      const purchasedM = wholeRolls * L + cutMeters;
      return {
        key, label, rollLen: L, wholeRolls, cutMeters,
        purchasedM, purchasedSqm: purchasedM * w,
        price: wholePrice + cutPrice,
        wholePrice, cutPrice, wholeUnit, cutUnit,
      };
    };

    // Vincolo fisico: un singolo pezzo "al taglio" non può superare la lunghezza
    // del rotolo (L). Una fascia non si può spezzare tra due pezzi.
    // Ogni fascia ha la sua lunghezza REALE (stripLens) → bin packing FFD.
    const sortedStrips = [...stripLens].sort((a, c) => c - a);
    const packRolls = (lens: number[], L: number): number => {
      const bins: number[] = [];
      for (const len of lens) {
        if (len > L) { bins.push(0); continue; } // fascia più lunga del rotolo
        let placed = false;
        for (let i = 0; i < bins.length; i++) { if (bins[i] >= len - 1e-9) { bins[i] -= len; placed = true; break; } }
        if (!placed) bins.push(L - len);
      }
      return bins.length;
    };
    let stripsPerRoll = 0;
    for (const L of lengths) {
      const suffix = lengths.length > 1 ? ` · pezza ${fmt(L)} m` : "";
      const spr = maxStrip > 0 && maxStrip <= L ? Math.floor(L / maxStrip) : 0;
      if (spr > stripsPerRoll) stripsPerRoll = spr;
      if (strips === 0) continue;
      const oversize = sortedStrips.filter((s) => s > L);
      if (oversize.length > 0) {
        // Almeno una fascia supera la pezza: serve più di un rotolo per fascia
        const wholeRolls = oversize.reduce((a, s) => a + Math.ceil(s / L), 0) + packRolls(sortedStrips.filter((s) => s <= L), L);
        options.push(makeOpt(L, `whole-${L}`, `${wholeRolls} rotoli interi${suffix}`, wholeRolls, 0));
        continue;
      }
      // A) Solo rotoli interi (packing reale delle fasce)
      {
        const wholeRolls = packRolls(sortedStrips, L);
        options.push(makeOpt(L, `whole-${L}`, `${wholeRolls} rotolo${wholeRolls === 1 ? "" : "i"} inter${wholeRolls === 1 ? "o" : "i"}${suffix}`, wholeRolls, 0));
      }
      // B) Solo al taglio: tutte le fasce su un unico pezzo, valido solo se ≤ L
      {
        const cutMeters = ceilToStep(totalLen);
        if (cutMeters > 0 && cutMeters <= L) {
          options.push(makeOpt(L, `cut-${L}`, `${fmt(cutMeters)} m al taglio${suffix}`, 0, cutMeters));
        }
      }
      // C) Mix: K rotoli interi (fasce più lunghe) + 1 pezzo al taglio per il resto
      const maxWholeRolls = packRolls(sortedStrips, L);
      for (let K = 1; K < maxWholeRolls; K++) {
        // riempi K rotoli con le fasce più lunghe possibili
        const bins: number[] = Array.from({ length: K }, () => L);
        const remain: number[] = [];
        for (const len of sortedStrips) {
          let placed = false;
          for (let i = 0; i < K; i++) { if (bins[i] >= len - 1e-9) { bins[i] -= len; placed = true; break; } }
          if (!placed) remain.push(len);
        }
        if (remain.length === 0) continue;
        const cutMeters = ceilToStep(remain.reduce((a, c) => a + c, 0));
        if (cutMeters > L) continue; // pezzo unico al taglio non può superare L
        options.push(makeOpt(
          L,
          `mix-${L}-${K}`,
          `${K} rotolo${K === 1 ? "" : "i"} intero${K === 1 ? "" : "i"} + ${fmt(cutMeters)} m al taglio${suffix}`,
          K, cutMeters,
        ));
      }
    }


    const cheapest = options.length > 0 ? options.reduce((a, c) => (c.price < a.price ? c : a)) : null;
    const chosen = chosenOptionKey ? options.find((o) => o.key === chosenOptionKey) ?? cheapest : cheapest;
    const best = chosen;
    const rollsNeeded = best ? best.wholeRolls + (best.cutMeters > 0 ? 1 : 0) : 0;
    const totalCovered = best ? best.purchasedM : 0;

    // Nastro: ogni lato del perimetro + ogni giunzione tra teli = pezzo intero
    // (non si può giuntare nastro: ogni pezzo deve stare in un solo rotolo)
    const sideLengths: number[] = activePoints.map((p, i) => {
      const n = activePoints[(i + 1) % activePoints.length];
      return Math.hypot(n.x - p.x, n.y - p.y);
    });
    const perimeter = sideLengths.reduce((a, b) => a + b, 0);
    const junctionCount = Math.max(0, strips - 1);
    const tapeJunctions = junctionCount * along;
    const tapeMeters = perimeter + tapeJunctions;
    const tapeRollLen = tapeType === "danza" ? 33 : 25;
    // Pezzi da tagliare: lati + giunzioni (ognuna lunga `along`)
    const tapePieces: number[] = [
      ...sideLengths.filter((s) => s > 0),
      ...Array(junctionCount).fill(along),
    ];
    // First-Fit Decreasing bin packing nei rotoli
    const sortedPieces = [...tapePieces].sort((a, b) => b - a);
    const bins: number[] = []; // spazio rimanente per rotolo
    for (const piece of sortedPieces) {
      if (piece > tapeRollLen) {
        // pezzo più lungo del rotolo: serve comunque un rotolo dedicato (lo segnaliamo)
        bins.push(0);
        continue;
      }
      let placed = false;
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] >= piece) { bins[i] -= piece; placed = true; break; }
      }
      if (!placed) bins.push(tapeRollLen - piece);
    }
    const tapeRolls = bins.length;
    const tapeOversize = sortedPieces.some((p) => p > tapeRollLen);

    return {
      strips, totalLen, along, rollsNeeded,
      leftover: Math.max(0, totalCovered - totalLen),
      surface, bounds: b,
      unitPrice: unit,
      purchasedSqm: best?.purchasedSqm ?? 0, totalPrice: best?.price ?? 0,
      options, best, cheapest,
      cutSurcharge, cutStep,
      stripsPerRoll,
      perimeter, tapeJunctions, tapeMeters, tapeRollLen, tapeRolls,
      tapePieces, tapeOversize,
    };
  }, [selected, activePoints, customPoints, stageW, stageH, direction, tapeType, chosenOptionKey]);

  /** "Aggiungi all'ordine": come per Tessuti/Ignifughe, scrive nel carrello vendite
   *  (salesCarts.danza) della draft attiva. Il Flow lo legge tramite CreateCommessaButton. */
  const addToCart = () => {
    if (!selected || !calc?.best) {
      toast.error("Calcolo non disponibile");
      return;
    }
    const cart = readDraftSalesCart("danza");
    const colorTag = chosenColor || needColor.trim();
    const baseLabel = `Tappeto ${selected.name}${colorTag ? ` · ${colorTag}` : ""}${selected.thicknessMm ? ` · ${fmt(selected.thicknessMm)}mm` : ""}`;
    const unitPrice = Number(selected.pricePerSqm ?? 0);
    const cutSurcharge = 1.2;
    const w = selected.rollWidth;
    const L = calc.best.rollLen || selected.rollLength;
    const newLines: CartLine[] = [];
    if (calc.best.wholeRolls > 0) {
      // prezzo per rotolo intero = L × w × prezzo/m²
      const perRoll = L * w * unitPrice;
      newLines.push({
        id: uid(),
        materialId: "",
        qty: calc.best.wholeRolls,
        name: `${baseLabel} — rotolo intero`,
        variant: `${fmt(L)} × ${fmt(w)} m`,
        unit: "rotoli" as any,
        priceSell: perRoll,
        pricePurchase: perRoll,
        category: "danza",
      });
    }
    if (calc.best.cutMeters > 0) {
      // €/m al taglio = w × prezzo/m² × cutSurcharge
      const perMeter = w * unitPrice * cutSurcharge;
      newLines.push({
        id: uid(),
        materialId: "",
        qty: calc.best.cutMeters,
        name: `${baseLabel} — al taglio`,
        variant: `larghezza ${fmt(w)} m`,
        unit: "m" as any,
        priceSell: perMeter,
        pricePurchase: perMeter,
        category: "danza",
      });
    }
    if (calc.tapeRolls > 0) {
      newLines.push({
        id: uid(),
        materialId: "",
        qty: calc.tapeRolls,
        name: `Nastro ${tapeType === "danza" ? "danza" : "biadesivo"}`,
        variant: `rotoli da ${calc.tapeRollLen} m`,
        unit: "rotoli" as any,
        priceSell: 0,
        pricePurchase: 0,
        category: "danza",
      });
    }
    if (newLines.length === 0) {
      toast.error("Nessun articolo da aggiungere");
      return;
    }
    writeDraftSalesCart("danza", [...cart, ...newLines]);
    toast.success(`Aggiunto all'ordine: ${newLines.length} riga/e per ${selected.name}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={mode === "calcolo" ? "default" : "outline"} onClick={() => setMode("calcolo")}>Calcolo & nesting</Button>
        <Button size="sm" variant={mode === "ordine" ? "default" : "outline"} onClick={() => setMode("ordine")}>Ordine manuale</Button>
        <Button size="sm" variant={mode === "ordine_nastri" ? "default" : "outline"} onClick={() => setMode("ordine_nastri")}>Ordine manuale nastri</Button>
        <Button size="sm" variant={mode === "catalogo" ? "default" : "outline"} onClick={() => setMode("catalogo")}>Listino tappeti</Button>
        <Button size="sm" variant={mode === "nastri" ? "default" : "outline"} onClick={() => setMode("nastri")}>Listino nastri</Button>
      </div>

      {mode === "ordine" ? (
        <ManualMagazzinoOrderForm
          key="ordine-danza"
          sourceLabel="Tappeto danza"
          categoryKey="danza"
          suggestions={[
            { descrizione: "Tappeto danza (rotolo intero)", um: "rt" },
            { descrizione: "Tappeto danza (taglio)", um: "mq" },
            { descrizione: "Nastro danza", um: "rt" },
            { descrizione: "Nastro biadesivo", um: "rt" },
          ]}
          picker={(onPick, onClose) => (
            <DancePickerDialog rolls={rolls} tapes={tapes} onPick={onPick} onClose={onClose} />
          )}
        />
      ) : mode === "ordine_nastri" ? (
        <ManualMagazzinoOrderForm
          key="ordine-nastri"
          sourceLabel="Nastri"
          categoryKey="nastri"
          suggestions={[
            { descrizione: "Nastro danza", um: "rt" },
            { descrizione: "Nastro biadesivo", um: "rt" },
          ]}
          picker={(onPick, onClose) => (
            <TapePickerDialog tapes={tapes} onPick={onPick} onClose={onClose} />
          )}
        />
      ) : mode === "nastri" ? (
        <TapeListSection tapes={tapes} setTapes={setTapes} />
      ) : mode === "calcolo" ? (
        <div className="border-2 border-ink/15 rounded-sm bg-paper">
          <div className="px-3 py-2 bg-muted/40 border-b flex items-center gap-2"><CalcIcon className="w-3.5 h-3.5" /><div className="font-mono text-[10px] uppercase tracking-widest">Calcolo & nesting tappeto</div></div>
          <div className="p-4 space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Spessore minimo (mm)"><Input type="number" step="0.1" value={needThickness || ""} onChange={(e) => setNeedThickness(Number(e.target.value))} /></Field>
              <Field label="Colore richiesto"><SelectWithAdd value={needColor} onChange={setNeedColor} options={allColors} placeholder="Tutti" emptyLabel="Tutti" /></Field>
            </div>
            <div className="border border-ink/15 rounded-sm divide-y max-h-44 overflow-auto">
              {filtered.length === 0 ? <div className="p-3 text-[12px] text-muted-foreground">Nessun tappeto disponibile coi filtri.</div> : filtered.map((r) => (
                <button key={r.id} type="button" onClick={() => setSelectedId(r.id)} className={`w-full text-left p-2.5 hover:bg-muted/30 ${selected?.id === r.id ? "bg-dept-soft/40" : ""}`}>
                  <div className="text-sm font-semibold">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">spess. {fmt(r.thicknessMm)} mm · rotolo {fmt(r.rollLength)} × {fmt(r.rollWidth)} m · {(r.colors ?? []).join(", ") || "colori n/d"}{r.pricePerSqm ? ` · ${eur(r.pricePerSqm)}/m²` : ""}</div>
                </button>
              ))}
            </div>

            {!selected ? <div className="text-[12px] text-muted-foreground">Seleziona o crea un tappeto nel listino.</div> : (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap text-[12px]">
                  <div>Tappeto: <strong>{selected.name}</strong> · spess. {fmt(selected.thicknessMm)} mm · rotolo {fmt(selected.rollLength)} × {fmt(selected.rollWidth)} m{(selected.rollLengths ?? []).length > 0 ? ` · pezze disponibili: ${[selected.rollLength, ...(selected.rollLengths ?? [])].map((n) => fmt(n)).join(" / ")} m` : ""}</div>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setDirection((d) => d === "vertical" ? "horizontal" : "vertical")}><RotateCw className="w-3.5 h-3.5 mr-1" />Ruota teli</Button>
                </div>
                {(selected.colors?.length ?? 0) > 0 && <ChipSelector label="Colore" values={selected.colors ?? []} value={chosenColor} onChange={setChosenColor} />}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Larghezza sala (m)"><Input type="number" step="0.1" value={stageW || ""} onChange={(e) => setStageW(Number(e.target.value))} /></Field>
                  <Field label="Profondità sala (m)"><Input type="number" step="0.1" value={stageH || ""} onChange={(e) => setStageH(Number(e.target.value))} /></Field>
                  <Field label="Verso teli"><div className="h-10 flex items-center rounded-md border border-input bg-background px-3 text-[12px] font-medium">{direction === "vertical" ? "strisce in profondità" : "strisce in larghezza"}</div></Field>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Forma sala</span>
                  <div className="flex rounded-md border border-input overflow-hidden">
                    <button type="button" onClick={() => setShapeMode("punti")} className={`h-9 px-3 text-[13px] font-semibold ${shapeMode === "punti" ? "bg-dept text-dept-foreground" : "bg-background"}`}>Disegno CAD (punti)</button>
                    <button type="button" onClick={() => setShapeMode("lati")} className={`h-9 px-3 text-[13px] font-semibold border-l border-input ${shapeMode === "lati" ? "bg-dept text-dept-foreground" : "bg-background"}`}>Lati e angoli</button>
                  </div>
                </div>
                {shapeMode === "punti"
                  ? <RoomPointsEditor verts={verts} setVerts={setVerts} fallbackW={stageW} fallbackH={stageH} segPoints={segPoints} />
                  : <RoomSegmentsEditor segments={segments} setSegments={setSegments} />}
                <DanceNestingCanvas points={activePoints} customPoints={customPoints} roomW={stageW} roomH={stageH} rollWidth={selected.rollWidth} direction={direction} />

                {calc ? (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                      <KPI label="Strisce / teli" value={`${calc.strips}`} hint={`passo ${fmt(selected.rollWidth)} m`} />
                      <KPI label="Metri lineari" value={`${fmt(calc.totalLen)} m`} hint={`${calc.strips} × ${fmt(direction === "vertical" ? calc.bounds.h : calc.bounds.w)} m`} />
                      <KPI label="Superficie sala" value={`${fmt(calc.surface)} m²`} hint={`sfrido ${fmt(calc.leftover)} m`} />
                      <KPI label="Prezzo unitario" value={`${eur(calc.unitPrice)}/m²`} hint={`taglio +${Math.round((calc.cutSurcharge - 1) * 100)}% (${eur(calc.unitPrice * calc.cutSurcharge)}/m²)`} />
                    </div>

                    <div className="border-2 border-ink/15 rounded-sm bg-background">
                      <div className="px-3 py-2 border-b bg-muted/30 font-mono text-[10px] uppercase tracking-widest flex items-center justify-between">
                        <span>Confronto opzioni di acquisto</span>
                        <span className="text-muted-foreground normal-case tracking-normal">taglio in multipli di {calc.cutStep} m · +{Math.round((calc.cutSurcharge - 1) * 100)}% al m²</span>
                      </div>
                      <div className="px-3 py-2 border-b bg-muted/20 text-[11px] text-muted-foreground">
                        Servono <strong className="text-foreground">{calc.strips} fasce da {fmt(calc.along)} m</strong> · totale {fmt(calc.totalLen)} m lineari × {fmt(selected.rollWidth)} m{calc.stripsPerRoll > 1 ? ` · da 1 rotolo da ${fmt(calc.best?.rollLen ?? selected.rollLength)} m si ricavano ${calc.stripsPerRoll} fasce` : ""}
                        <span className="block mt-0.5 italic">Clicca un'opzione per selezionarla manualmente.</span>
                      </div>
                      <div className="divide-y">
                        {calc.options.map((o, i) => {
                          const isSelected = o === calc.best;
                          const isCheapest = o === calc.cheapest;
                          const wholeSqm = o.wholeRolls * o.rollLen * selected.rollWidth;
                          const cutSqm = o.cutMeters * selected.rollWidth;
                          return (
                            <button
                              type="button"
                              key={i}
                              onClick={() => setChosenOptionKey(o.key)}
                              className={`w-full text-left px-3 py-2.5 transition-colors ${isSelected ? "bg-dept-soft/40 ring-2 ring-dept ring-inset" : "hover:bg-muted/30"}`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[12px] font-semibold flex items-center gap-2">
                                  {o.label}
                                  {isCheapest && <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-dept text-dept-foreground">migliore</span>}
                                  {isSelected && !isCheapest && <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-dept text-dept">scelta</span>}
                                </div>
                                <div className={`font-mono text-sm font-bold ${isSelected ? "text-dept" : ""}`}>{eur(o.price)}</div>
                              </div>
                              <div className="mt-1.5 pl-1 space-y-0.5 text-[11px] font-mono text-muted-foreground">
                                {o.wholeRolls > 0 && (
                                  <div className="flex items-center justify-between gap-3">
                                    <span>· {o.wholeRolls} rotolo{o.wholeRolls === 1 ? "" : "i"} intero{o.wholeRolls === 1 ? "" : "i"} mt {fmt(o.rollLen)}×{fmt(selected.rollWidth)} = {fmt(wholeSqm)} m² @ {eur(o.wholeUnit)}/m²</span>
                                    <span className="tabular-nums">{eur(o.wholePrice)}</span>
                                  </div>
                                )}
                                {o.cutMeters > 0 && (
                                  <div className="flex items-center justify-between gap-3">
                                    <span>· taglio mt {fmt(o.cutMeters)}×{fmt(selected.rollWidth)} = {fmt(cutSqm)} m² @ {eur(o.cutUnit)}/m²</span>
                                    <span className="tabular-nums">{eur(o.cutPrice)}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-3 text-foreground/70">
                                  <span>totale {fmt(o.purchasedM)} m × {fmt(selected.rollWidth)} m = {fmt(o.purchasedSqm)} m²</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="border-2 border-ink/15 rounded-sm bg-background">
                      <div className="px-3 py-2 border-b bg-muted/30 font-mono text-[10px] uppercase tracking-widest flex items-center justify-between gap-3">
                        <span>Nastro per giunzioni e perimetro</span>
                        <select
                          value={tapeType}
                          onChange={(e) => setTapeType(e.target.value as "danza" | "biadesivo")}
                          className="h-7 rounded-sm border border-input bg-background px-2 text-[11px] font-mono normal-case tracking-normal"
                        >
                          <option value="danza">Nastro danza · 33 m/rotolo</option>
                          <option value="biadesivo">Biadesivo · 25 m/rotolo</option>
                        </select>
                      </div>
                      <div className="px-3 py-2.5 text-[12px] space-y-1">
                        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                          <span>· perimetro sala</span>
                          <span className="tabular-nums">{fmt(calc.perimeter)} m</span>
                        </div>
                        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                          <span>· giunzioni teli ({Math.max(0, calc.strips - 1)} × {fmt(calc.along)} m)</span>
                          <span className="tabular-nums">{fmt(calc.tapeJunctions)} m</span>
                        </div>
                        <div className="flex items-center justify-between font-semibold pt-1 border-t border-ink/10">
                          <span>Totale nastro (somma pezzi interi)</span>
                          <span className="font-mono tabular-nums">{fmt(calc.tapeMeters)} m</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {calc.tapePieces.length} pezzi interi: {calc.tapePieces.map((p) => fmt(p)).join(" + ")} m
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-muted-foreground">Rotoli da {calc.tapeRollLen} m (no giunte sul singolo lato)</span>
                          <span className="font-mono font-bold text-dept">{calc.tapeRolls} rotolo{calc.tapeRolls === 1 ? "" : "i"}</span>
                        </div>
                        {calc.tapeOversize && (
                          <div className="text-[10px] text-destructive font-mono">
                            ⚠ alcuni lati superano la lunghezza del rotolo ({calc.tapeRollLen} m): servirà giunta o rotolo più lungo.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Aggiungi al carrello vendite (come Tessuti) + Invia diretto al Flow */}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" onClick={addToCart}>
                        <Plus className="w-4 h-4 mr-1" /> Aggiungi all'ordine
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFlowCliente("");
                          setFlowRef("");
                          setFlowTappetoMeters(Number((calc.best?.purchasedM ?? 0).toFixed(2)));
                          setFlowTappetoRolls(calc.best?.wholeRolls ?? 0);
                          setFlowTapeMeters(Number(calc.tapeMeters.toFixed(2)));
                          setFlowTapeRolls(calc.tapeRolls);
                          setFlowNote(`Tappeto ${selected.name}${chosenColor ? ` · ${chosenColor}` : ""} · sala ${fmt(stageW)}×${fmt(stageH)} m`);
                          setFlowOpen(true);
                        }}
                      >
                        <PackageCheck className="w-4 h-4 mr-1" />
                        Invia al Flow
                      </Button>
                    </div>
                  </>
                ) : <div className="text-[11px] text-muted-foreground">Inserisci misure sala e caratteristiche prodotto.</div>}
              </>
            )}
          </div>
        </div>

      ) : (
        <div className="border-2 border-ink/15 rounded-sm bg-paper">
          <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest">Listino tappeti danza ({rolls.length})</div>
            <Button size="sm" onClick={addRoll} className="h-7 px-2"><Plus className="w-3 h-3 mr-1" />Aggiungi</Button>
          </div>
          {rolls.length === 0 ? <div className="p-6 text-center text-[12px] text-muted-foreground">Nessun tappeto. Aggiungi il primo per iniziare.</div> : (
            <div className="divide-y max-h-[72vh] overflow-y-auto">
              {rolls.map((r) => {
                const isSel = selected?.id === r.id;
                return (
                  <div key={r.id} className={`p-3 cursor-pointer hover:bg-muted/30 ${isSel ? "bg-dept-soft/40" : ""}`} onClick={() => setSelectedId(r.id)}>
                    <div className="flex items-center gap-2">
                      {isSel ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <Input value={r.name} onChange={(e) => updateRoll(r.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()} className="h-8 text-[12px] flex-1" placeholder="Nome" />
                      <Button size="sm" variant="outline" className="h-8 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); setMode("calcolo"); }}>Usa</Button>
                      <button onClick={(e) => { e.stopPropagation(); removeRoll(r.id); }} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="mt-1 pl-6 text-[11px] text-muted-foreground">spess. {fmt(r.thicknessMm)} mm · rotolo {fmt(r.rollLength)} × {fmt(r.rollWidth)} m · {(r.colors ?? []).join(", ") || "colori non indicati"}{r.pricePerSqm ? ` · ${eur(r.pricePerSqm)}/m²` : ""}</div>
                    {isSel && (
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2" onClick={(e) => e.stopPropagation()}>
                        <Field label="Spessore (mm)"><Input type="number" step="0.1" value={r.thicknessMm || ""} onChange={(e) => updateRoll(r.id, { thicknessMm: Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                        <Field label="Altezza rotolo (m)"><Input type="number" step="0.1" value={r.rollWidth || ""} onChange={(e) => updateRoll(r.id, { rollWidth: Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                        <Field label="Lunghezza rotolo (m)"><Input type="number" step="0.1" value={r.rollLength || ""} onChange={(e) => updateRoll(r.id, { rollLength: Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                        <Field label="Altre lunghezze pezza (m)">
                          <Input
                            value={(r.rollLengths ?? []).join(", ")}
                            onChange={(e) => updateRoll(r.id, {
                              rollLengths: e.target.value.split(/[,;\s]+/).map((x) => Number(x.replace(",", "."))).filter((n) => n > 0),
                            })}
                            placeholder="es. 20, 15"
                            className="h-8 text-[12px]"
                          />
                        </Field>

                        <Field label="Prezzo / m² (€)"><Input type="number" step="0.01" value={r.pricePerSqm ?? ""} onChange={(e) => updateRoll(r.id, { pricePerSqm: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 text-[12px]" /></Field>
                        <div className="col-span-full"><ChipsEditor label="Colori disponibili" values={r.colors ?? []} onChange={(colors) => updateRoll(r.id, { colors })} placeholder="es. Nero, Grigio, Rosso" /></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog open={flowOpen} onOpenChange={setFlowOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invia tappeto al Flow (magazzino)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cliente"><Input value={flowCliente} onChange={(e) => setFlowCliente(e.target.value)} /></Field>
              <Field label="Rif. ordine cliente"><Input value={flowRef} onChange={(e) => setFlowRef(e.target.value)} placeholder="es. ORD-123" /></Field>
            </div>
            <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Tappeto · {selected?.name ?? "—"}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Metri da inviare"><Input type="number" step="0.1" value={flowTappetoMeters || ""} onChange={(e) => setFlowTappetoMeters(Number(e.target.value))} /></Field>
                <Field label="Rotoli interi"><Input type="number" value={flowTappetoRolls || ""} onChange={(e) => setFlowTappetoRolls(Number(e.target.value))} /></Field>
              </div>
            </div>
            <div className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Nastro · {tapeType === "danza" ? "danza" : "biadesivo"}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Metri da inviare"><Input type="number" step="0.1" value={flowTapeMeters || ""} onChange={(e) => setFlowTapeMeters(Number(e.target.value))} /></Field>
                <Field label="Rotoli"><Input type="number" value={flowTapeRolls || ""} onChange={(e) => setFlowTapeRolls(Number(e.target.value))} /></Field>
              </div>
            </div>
            <Field label="Note">
              <Textarea value={flowNote} onChange={(e) => setFlowNote(e.target.value)} rows={2} />
            </Field>
            <div>
              <Label className="text-[11px] font-mono uppercase tracking-wider">Responsabile magazzino *</Label>
              {magazzinoUsers.length === 0 ? (
                <div className="text-[11px] text-destructive mt-1">Nessun utente con settore "magazzino". Assegna il settore in Gestione utenti.</div>
              ) : (
                <select
                  value={flowAssignee}
                  onChange={(e) => setFlowAssignee(e.target.value)}
                  className="mt-1 w-full h-9 px-2 border-2 border-ink/20 rounded-sm bg-paper text-sm"
                >
                  <option value="">— seleziona —</option>
                  {magazzinoUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name || u.id.slice(0, 8)}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlowOpen(false)} disabled={flowBusy}>Annulla</Button>
            <Button
              disabled={flowBusy || !flowCliente.trim() || !flowAssignee}
              onClick={async () => {
                if (!user) { toast.error("Devi accedere"); return; }
                if (!flowAssignee) { toast.error("Seleziona il responsabile magazzino"); return; }
                setFlowBusy(true);
                try {
                  const code = await nextOrderCode();
                  const cliente = flowCliente.trim().slice(0, 200);
                  const items: string[] = [];
                  if (flowTappetoMeters > 0 || flowTappetoRolls > 0) {
                    items.push(`Tappeto ${selected?.name ?? ""}${chosenColor ? ` (${chosenColor})` : ""}: ${flowTappetoRolls} rotoli + ${fmt(flowTappetoMeters)} m`);
                  }
                  if (flowTapeMeters > 0 || flowTapeRolls > 0) {
                    items.push(`Nastro ${tapeType}: ${flowTapeRolls} rotoli (${fmt(flowTapeMeters)} m totali)`);
                  }
                  const note = [flowNote.trim(), items.join(" · ")].filter(Boolean).join(" — ");
                  const { data: pord, error: e1 } = await supabase.from("production_orders").insert({
                    code,
                    cliente,
                    data: new Date().toISOString().slice(0, 10),
                    note: `Tappeto danza — ${note}`,
                    priorita: "normale",
                    delivery: "spedizione",
                    status: "in_corso",
                    attachments: [],
                    nesting_included: false,
                    created_by: user.id,
                    customer_order_ref: flowRef.trim() || null,
                    snapshot: {
                      source: "magazzino-danza",
                      cliente, ref: flowRef.trim(),
                      tappeto: { name: selected?.name, color: chosenColor, meters: flowTappetoMeters, rolls: flowTappetoRolls },
                      nastro: { type: tapeType, meters: flowTapeMeters, rolls: flowTapeRolls },
                      sala: { w: stageW, h: stageH },
                      note: flowNote,
                    } as never,
                  }).select().single();
                  if (e1) throw e1;
                  await supabase.from("production_sub_orders").insert({
                    order_id: pord.id,
                    code: subCode(code, SUB_DEPT_SUFFIX["magazzino"], 1),
                    dept: "magazzino",
                    ordine: 0,
                    note,
                    files: [],
                    depends_on: null,
                    assignee_id: flowAssignee,
                  } as any);
                  await notify({
                    userIds: [flowAssignee],
                    type: "magazzino_da_preparare",
                    message: `Tappeto danza — ${code} · ${cliente}`,
                    order_id: pord.id,
                    link: "/produzione/preparazione",
                    is_urgent: false,
                  });
                  await logAction({
                    action: "FLOW_LANCIATO",
                    entity_type: "order",
                    entity_id: pord.id,
                    detail: `Tappeto danza ${code} per ${cliente} (${items.join(" · ")})`,
                    new_state: { code, source: "magazzino-danza" },
                  });
                  toast.success(`Ordine ${code} creato e inviato al magazzino`, {
                    action: { label: "Apri Flow", onClick: () => navigate("/flow") },
                  });
                  setFlowOpen(false);
                  navigate("/flow");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Errore creazione ordine");
                } finally {
                  setFlowBusy(false);
                }
              }}
            >
              {flowBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}
              Crea ordine magazzino
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoomSegmentsEditor({ segments, setSegments }: { segments: Segment[]; setSegments: (s: Segment[]) => void }) {
  const add = () => setSegments([...segments, { id: uid(), length: 0, angle: segments.length === 0 ? 0 : 90 }]);
  const upd = (id: string, patch: Partial<Segment>) => setSegments(segments.map((s) => s.id === id ? { ...s, ...patch } : s));
  const rm = (id: string) => setSegments(segments.filter((s) => s.id !== id));
  const pts = segmentsToPoints(segments);
  const closure = pts.length >= 2 ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) : 0;
  return (
    <div className="border-2 border-ink/15 rounded-sm bg-background">
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest">Sala irregolare · lati ({segments.length})</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSegments([])}>Reset</Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={add}><Plus className="w-3 h-3 mr-1" />Aggiungi lato</Button>
        </div>
      </div>
      {segments.length === 0 ? (
        <div className="p-3 text-[11px] text-muted-foreground">Nessun lato definito: la sala è considerata rettangolare con le misure indicate sopra. Aggiungi i lati per disegnare una sala irregolare (lunghezza in metri, angolo in gradi rispetto al lato precedente — il primo è considerato orizzontale).</div>
      ) : (
        <div className="p-3 space-y-1">
          <div className="grid grid-cols-[28px,1fr,1fr,32px] gap-2 text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
            <div>#</div><div>Lunghezza (m)</div><div>Angolo (°)</div><div></div>
          </div>
          {segments.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[28px,1fr,1fr,32px] gap-2 items-center">
              <div className="text-[11px] font-mono text-muted-foreground">{i + 1}</div>
              <Input type="number" step="0.01" value={s.length || ""} onChange={(e) => upd(s.id, { length: Number(e.target.value) })} className="h-8 text-[12px]" placeholder="es. 6.5" />
              <Input type="number" step="1" value={s.angle ?? 0} onChange={(e) => upd(s.id, { angle: Number(e.target.value) })} className="h-8 text-[12px]" placeholder={i === 0 ? "0" : "es. 90"} />
              <button onClick={() => rm(s.id)} className="text-ink/40 hover:text-destructive p-1" title="Rimuovi"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <div className="text-[10px] font-mono text-muted-foreground pt-1">Errore di chiusura: {fmt(closure)} m {closure > 0.01 ? "(la sala non si chiude)" : "(sala chiusa)"}</div>
        </div>
      )}
    </div>
  );
}

/** Editor CAD: vertici trascinabili + misure numeriche (X, Y e lunghezza lato). */
function RoomPointsEditor({ verts, setVerts, fallbackW, fallbackH, segPoints }: {
  verts: Point[]; setVerts: (p: Point[]) => void; fallbackW: number; fallbackH: number; segPoints: Point[];
}) {
  const W = 720, H = 420, pad = 46;
  const [drag, setDrag] = useState<number | null>(null);
  const [snap, setSnap] = useState(0.1);
  const [editSide, setEditSide] = useState<number | null>(null);
  const [sideDraft, setSideDraft] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const pts = verts;
  const xs = pts.length ? pts.map((p) => p.x) : [0, Math.max(fallbackW, 1)];
  const ys = pts.length ? pts.map((p) => p.y) : [0, Math.max(fallbackH, 1)];
  const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0);
  const w = Math.max(Math.max(...xs) - minX, 1), h = Math.max(Math.max(...ys) - minY, 1);
  const scale = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
  const toSvg = (p: Point) => ({ x: pad + (p.x - minX) * scale, y: pad + (p.y - minY) * scale });
  const toModel = (sx: number, sy: number) => ({ x: (sx - pad) / scale + minX, y: (sy - pad) / scale + minY });
  const round = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v);

  const setPoint = (i: number, patch: Partial<Point>) =>
    setVerts(pts.map((p, k) => (k === i ? { x: Number((patch.x ?? p.x).toFixed(3)), y: Number((patch.y ?? p.y).toFixed(3)) } : p)));

  const onMove = (e: React.PointerEvent) => {
    if (drag == null || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const m = toModel(sx, sy);
    setPoint(drag, { x: round(m.x), y: round(m.y) });
  };

  const startRect = () => {
    const a = Math.max(fallbackW, 1), b = Math.max(fallbackH, 1);
    setVerts([{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: b }, { x: 0, y: b }]);
  };
  const fromSegments = () => { if (segPoints.length >= 3) setVerts(segPoints.map((p) => ({ x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) }))); };

  const addAfter = (i: number) => {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mid = { x: Number(((a.x + b.x) / 2).toFixed(3)), y: Number(((a.y + b.y) / 2).toFixed(3)) };
    setVerts([...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)]);
  };
  const rm = (i: number) => setVerts(pts.filter((_, k) => k !== i));

  /** Cambia la lunghezza del lato i→i+1 spostando il vertice successivo lungo la stessa direzione. */
  const setSideLength = (i: number, len: number) => {
    const a = pts[i], j = (i + 1) % pts.length, b = pts[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const cur = Math.hypot(dx, dy);
    if (!cur || !Number.isFinite(len) || len <= 0) return;
    const k = len / cur;
    setPoint(j, { x: Number((a.x + dx * k).toFixed(3)), y: Number((a.y + dy * k).toFixed(3)) });
  };

  const area = polygonArea(pts);

  return (
    <div className="border-2 border-ink/15 rounded-sm bg-background">
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
        <div className="font-mono text-[11px] uppercase tracking-widest">Disegno CAD sala · {pts.length} vertici{area > 0 ? ` · ${fmt(area)} m²` : ""}</div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Snap</span>
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
            <option value={0}>libero</option>
            <option value={0.05}>5 cm</option>
            <option value={0.1}>10 cm</option>
            <option value={0.25}>25 cm</option>
            <option value={0.5}>50 cm</option>
          </select>
          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={startRect}>Da rettangolo</Button>
          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={fromSegments} disabled={segPoints.length < 3}>Da lati</Button>
          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setVerts([])}>Reset</Button>
        </div>
      </div>

      {pts.length < 3 ? (
        <div className="p-4 text-[13px] text-muted-foreground">
          Nessun disegno a punti attivo. Parti da <strong>Da rettangolo</strong> (usa le misure sala) o <strong>Da lati</strong>, poi trascina i vertici o scrivi le misure esatte.
        </div>
      ) : (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto touch-none select-none"
            onPointerMove={onMove}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
          >
            <defs>
              <pattern id="cad-grid-edit" width="18" height="18" patternUnits="userSpaceOnUse">
                <path d="M18 0H0V18" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="url(#cad-grid-edit)" className="text-ink" />
            <polygon points={pts.map((p) => { const s = toSvg(p); return `${s.x},${s.y}`; }).join(" ")} className="fill-dept-soft/40 stroke-dept" strokeWidth={2.5} />
            {pts.map((p, i) => {
              const q = pts[(i + 1) % pts.length];
              const sp = toSvg(p), sq = toSvg(q);
              const len = Math.hypot(q.x - p.x, q.y - p.y);
              const mx = (sp.x + sq.x) / 2, my = (sp.y + sq.y) / 2;
              const editing = editSide === i;
              return (
                <g key={`s${i}`}>
                  {editing ? (
                    <foreignObject x={mx - 45} y={my - 17} width={90} height={34}>
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={sideDraft}
                        onChange={(e) => setSideDraft(e.target.value)}
                        onBlur={() => { const v = Number(sideDraft); if (Number.isFinite(v) && v > 0) setSideLength(i, v); setEditSide(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { const v = Number(sideDraft); if (Number.isFinite(v) && v > 0) setSideLength(i, v); setEditSide(null); }
                          if (e.key === "Escape") setEditSide(null);
                        }}
                        className="w-full h-[32px] text-center text-[15px] font-bold rounded-md border-2 border-dept bg-background text-foreground outline-none"
                      />
                    </foreignObject>
                  ) : (
                    <g className="cursor-text" onPointerDown={(e) => { e.stopPropagation(); setSideDraft(String(Number(len.toFixed(2)))); setEditSide(i); }}>
                      <rect x={mx - 34} y={my - 13} width={68} height={26} rx={5} className="fill-background stroke-dept/50" strokeWidth={1.5} />
                      <text x={mx} y={my + 5} textAnchor="middle" className="fill-foreground" fontSize={14} fontWeight={700}>{fmt(len)} m</text>
                    </g>
                  )}
                </g>
              );
            })}

            {pts.map((p, i) => {
              const s = toSvg(p);
              return (
                <g key={`p${i}`} onPointerDown={(e) => { e.preventDefault(); setDrag(i); }} className="cursor-move">
                  <circle cx={s.x} cy={s.y} r={11} className={drag === i ? "fill-dept stroke-background" : "fill-background stroke-dept"} strokeWidth={3} />
                  <text x={s.x} y={s.y + 5} textAnchor="middle" fontSize={12} fontWeight={800} className={drag === i ? "fill-background" : "fill-dept"}>{i + 1}</text>
                </g>
              );
            })}
          </svg>

          <div className="p-3 space-y-1.5 border-t">
            <div className="grid grid-cols-[34px,1fr,1fr,1fr,74px] gap-2 text-[11px] uppercase tracking-wider font-mono text-muted-foreground">
              <div>#</div><div>X (m)</div><div>Y (m)</div><div>Lato → succ. (m)</div><div></div>
            </div>
            {pts.map((p, i) => {
              const q = pts[(i + 1) % pts.length];
              const len = Math.hypot(q.x - p.x, q.y - p.y);
              return (
                <div key={i} className="grid grid-cols-[34px,1fr,1fr,1fr,74px] gap-2 items-center">
                  <div className="text-[13px] font-mono font-bold">{i + 1}</div>
                  <Input type="number" step="0.01" value={p.x} onChange={(e) => setPoint(i, { x: Number(e.target.value) })} className="h-9 text-[13px]" />
                  <Input type="number" step="0.01" value={p.y} onChange={(e) => setPoint(i, { y: Number(e.target.value) })} className="h-9 text-[13px]" />
                  <Input type="number" step="0.01" value={Number(len.toFixed(2))} onChange={(e) => setSideLength(i, Number(e.target.value))} className="h-9 text-[13px]" />
                  <div className="flex gap-1">
                    <button onClick={() => addAfter(i)} className="text-ink/50 hover:text-dept p-1" title="Inserisci punto dopo"><Plus className="w-4 h-4" /></button>
                    <button onClick={() => rm(i)} className="text-ink/50 hover:text-destructive p-1" title="Elimina punto" disabled={pts.length <= 3}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
            <div className="text-[12px] text-muted-foreground pt-1">Trascina i vertici sul disegno oppure inserisci le misure esatte. Modificando un lato si sposta il vertice successivo lungo la stessa direzione.</div>
          </div>
        </>
      )}
    </div>
  );
}



function DanceNestingCanvas({ points, customPoints, roomW, roomH, rollWidth, direction }: { points: Point[]; customPoints: Point[]; roomW: number; roomH: number; rollWidth: number; direction: StripDirection }) {
  const W = 720, H = 360, pad = 24;
  const b = roomBounds(points, roomW, roomH);
  const scale = Math.min((W - pad * 2) / Math.max(b.w, 1), (H - pad * 2) / Math.max(b.h, 1));
  const toSvg = (p: Point) => ({ x: pad + (p.x - b.minX) * scale, y: pad + (p.y - b.minY) * scale });
  const poly = points.map((p) => { const s = toSvg(p); return `${s.x},${s.y}`; }).join(" ");
  const across = direction === "vertical" ? b.w : b.h;
  const strips = rollWidth > 0 ? Math.ceil(across / rollWidth) : 0;

  return (
    <div className="border-2 border-ink/15 rounded-sm overflow-hidden bg-background">
      <div className="px-3 py-2 border-b bg-muted/30 font-mono text-[10px] uppercase tracking-widest">Anteprima nesting · {customPoints.length > 0 ? `${customPoints.length} vertici` : "rettangolo"}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <defs>
          <pattern id="cad-grid" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M18 0H0V18" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.12" /></pattern>
          <clipPath id="room-clip"><polygon points={poly} /></clipPath>
        </defs>
        <rect width={W} height={H} fill="url(#cad-grid)" className="text-ink" />
        <g clipPath="url(#room-clip)">
          {Array.from({ length: Math.max(0, strips) }).map((_, i) => {
            const pos = i * rollWidth * scale;
            if (direction === "vertical") return <rect key={i} x={pad + pos} y={pad - 2} width={rollWidth * scale - 1} height={b.h * scale + 4} className={i % 2 ? "fill-dept-soft" : "fill-muted"} opacity="0.75" />;
            return <rect key={i} x={pad - 2} y={pad + pos} width={b.w * scale + 4} height={rollWidth * scale - 1} className={i % 2 ? "fill-dept-soft" : "fill-muted"} opacity="0.75" />;
          })}
        </g>
        <polygon points={poly} fill="none" stroke="currentColor" strokeWidth="2" className="text-dept" />
        {points.map((p, i) => { const s = toSvg(p); return <g key={`${i}-${p.x}-${p.y}`}><circle cx={s.x} cy={s.y} r="3.5" className="fill-dept" /><text x={s.x + 6} y={s.y - 6} fontSize="10" className="fill-foreground font-mono">{i + 1}</text></g>; })}
        {points.map((p, i) => {
          if (i === 0) return null;
          const a = toSvg(points[i - 1]), bp = toSvg(p);
          const mx = (a.x + bp.x) / 2, my = (a.y + bp.y) / 2;
          const len = Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
          return <text key={`L${i}`} x={mx} y={my - 4} fontSize="9" textAnchor="middle" className="fill-muted-foreground font-mono">{fmt(len)} m</text>;
        })}
      </svg>
    </div>
  );
}

/* ============== Sezione Vernice ignifuga ============== */
function FireSection({ products, setProducts }: { products: FireProduct[]; setProducts: (p: FireProduct[]) => void }) {
  const [mode, setMode] = useState<"calcolo" | "catalogo" | "ordine">("calcolo");
  const [selectedId, setSelectedId] = useState<string>(products[0]?.id ?? "");
  const [needMaterial, setNeedMaterial] = useState("");
  const [needColor, setNeedColor] = useState("");
  const [needClass, setNeedClass] = useState("");
  const [needBase, setNeedBase] = useState("");
  const [needFinish, setNeedFinish] = useState<FireFinish | "">("");
  const [needCoats, setNeedCoats] = useState<number>(0);
  const [surface, setSurface] = useState<number>(0);
  const [classId, setClassId] = useState<string>("");
  const [finishClassId, setFinishClassId] = useState<string>("");
  const [layer, setLayer] = useState<"base" | "finitura" | "both">("base");

  const allColors = useMemo(() => Array.from(new Set(products.flatMap((p) => p.colors ?? []).filter(Boolean))), [products]);
  const allBases = useMemo(() => Array.from(new Set(products.map((p) => p.base).filter(Boolean))), [products]);
  const allMaterials = useMemo(() => Array.from(new Set(products.flatMap((p) => splitTags(p.treatedMaterials)))), [products]);
  const allClasses = useMemo(() => Array.from(new Set(products.flatMap((p) => (p.classes ?? []).map((c) => c.className).filter(Boolean)))), [products]);
  const allCanLabels = useMemo(() => Array.from(new Set(products.flatMap((p) => (p.cans ?? []).map((c) => c.label).filter(Boolean)))), [products]);

  const filtered = useMemo(() => products.filter((p) => {
    const mOk = includesLoose(p.treatedMaterials, needMaterial);
    const cOk = !needColor.trim() || (p.colors ?? []).some((c) => includesLoose(c, needColor));
    const clOk = !needClass || (p.classes ?? []).some((c) => includesLoose(c.className, needClass));
    const bOk = includesLoose(p.base, needBase);
    const fOk = !needFinish || (p.finishes ?? []).includes(needFinish);
    return mOk && cOk && clOk && bOk && fOk;
  }), [products, needMaterial, needColor, needClass, needBase, needFinish]);
  const selected = products.find((p) => p.id === selectedId) ?? filtered[0] ?? products[0];
  const hasFinish = selected?.baseType === "base_finitura";
  // Auto-reset layer when switching product
  useEffect(() => {
    setLayer(hasFinish ? "both" : "base");
    setClassId("");
    setFinishClassId("");
  }, [selected?.id, hasFinish]);

  const activeClass = selected?.classes?.find((c) => c.id === classId) ?? selected?.classes?.[0];
  const activeFinishClass = selected?.finishClasses?.find((c) => c.id === finishClassId) ?? selected?.finishClasses?.[0];
  const coats = Math.max(1, Number(needCoats || selected?.coats || 1));
  const finishCoats = Math.max(1, Number(selected?.finishCoats || 1));

  const add = () => {
    const p: FireProduct = {
      id: uid(), name: "Nuovo prodotto ignifugo", treatedMaterials: "", colors: [], base: "Base",
      baseType: "base", component: "mono", coats: 1,
      cans: [{ id: uid(), kg: 5, label: "5", price: 0 }, { id: uid(), kg: 25, label: "25", price: 0 }],
      classes: [{ id: uid(), className: "Cl. 1", consumptionKgPerM2: 0.25 }], finishes: ["opaca"],
    };
    setProducts([...products, p]); setSelectedId(p.id); setMode("catalogo");
  };
  const upd = (id: string, patch: Partial<FireProduct>) => setProducts(products.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const rm = (id: string) => { setProducts(products.filter((p) => p.id !== id)); if (selectedId === id) setSelectedId(""); };

  /** Applica gli override prezzo del colore selezionato (se presente). */
  const applyColorOverrides = (cans: FireCan[] | undefined, ov?: Record<string, number>): FireCan[] => {
    if (!Array.isArray(cans)) return [];
    if (!ov) return cans;
    return cans.map((c) => {
      const v = Number(ov[c.id]);
      return Number.isFinite(v) && v > 0 ? { ...c, price: v } : c;
    });
  };

  type LayerCalc = {
    key: "base" | "finitura";
    label: string;
    kgNeeded: number;
    plan: NonNullable<ReturnType<typeof planCans>>;
    hasOverride: boolean;
    coats: number;
    klass: FireClass;
  };

  const calc = useMemo(() => {
    if (!selected || surface <= 0) return null;
    const colorKey = needColor.trim();
    const layers: LayerCalc[] = [];
    const wantBase = layer === "base" || layer === "both";
    const wantFin = (layer === "finitura" || layer === "both") && hasFinish;

    if (wantBase && activeClass && activeClass.consumptionKgPerM2 > 0 && selected.cans?.length) {
      const ov = colorKey ? selected.colorCanPrices?.[colorKey] : undefined;
      const eff = applyColorOverrides(selected.cans, ov);
      const kg = surface * coats * activeClass.consumptionKgPerM2;
      const plan = planCans(eff, kg);
      if (plan) layers.push({ key: "base", label: "Base", kgNeeded: kg, plan, hasOverride: !!ov && Object.keys(ov).length > 0, coats, klass: activeClass });
    }
    if (wantFin && activeFinishClass && activeFinishClass.consumptionKgPerM2 > 0 && selected.finishCans?.length) {
      const ov = colorKey ? selected.colorFinishCanPrices?.[colorKey] : undefined;
      const eff = applyColorOverrides(selected.finishCans, ov);
      const kg = surface * finishCoats * activeFinishClass.consumptionKgPerM2;
      const plan = planCans(eff, kg);
      if (plan) layers.push({ key: "finitura", label: "Finitura", kgNeeded: kg, plan, hasOverride: !!ov && Object.keys(ov).length > 0, coats: finishCoats, klass: activeFinishClass });
    }
    if (!layers.length) return null;
    const totalKgNeeded = layers.reduce((s, l) => s + l.kgNeeded, 0);
    const totalCost = layers.reduce((s, l) => s + l.plan.totalCost, 0);
    const totalCans = layers.reduce((s, l) => s + l.plan.totalCans, 0);
    return { layers, totalKgNeeded, totalCost, totalCans };
  }, [selected, surface, coats, finishCoats, activeClass, activeFinishClass, needColor, layer, hasFinish]);

  const addToCart = () => {
    if (!selected || !calc) return;
    const cart = readDraftSalesCart("ignifugo");
    const colorTag = needColor.trim();
    const newLines: CartLine[] = [];
    for (const L of calc.layers) {
      const baseLabel = `${selected.name}${colorTag ? ` · ${colorTag}` : ""}${selected.base ? ` · ${selected.base}` : ""} · ${L.label}${L.klass.className ? ` · ${L.klass.className}` : ""}`;
      for (const it of L.plan.items) {
        newLines.push({
          id: uid(),
          materialId: "",
          qty: it.count,
          name: `${baseLabel} — latta ${it.can.label} kg`,
          variant: `${fmt(it.can.kg)} kg · ${eur(it.can.price)}/latta`,
          unit: "latte" as any,
          priceSell: it.can.price,
          pricePurchase: it.can.price,
          category: "ignifugo",
        });
      }
    }
    writeDraftSalesCart("ignifugo", [...cart, ...newLines]);
    try { toast.success(`Aggiunto al carrello: ${newLines.length} riga/e per ${selected.name}`); } catch {}
  };


  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={mode === "calcolo" ? "default" : "outline"} onClick={() => setMode("calcolo")}>Richiesta cliente & calcolo</Button>
        <Button size="sm" variant={mode === "ordine" ? "default" : "outline"} onClick={() => setMode("ordine")}>Ordine manuale</Button>
        <Button size="sm" variant={mode === "catalogo" ? "default" : "outline"} onClick={() => setMode("catalogo")}>Listino vernici</Button>
      </div>

      {mode === "ordine" ? (
        <ManualMagazzinoOrderForm
          sourceLabel="Vernice ignifuga"
          categoryKey="ignifugo"
          suggestions={[
            { descrizione: "Vernice ignifuga (latta)", um: "latte" },
            { descrizione: "Vernice ignifuga (kg)", um: "kg" },
            { descrizione: "Diluente / additivo", um: "lt" },
          ]}
          picker={(onPick, onClose) => (
            <FirePickerDialog products={products} onPick={onPick} onClose={onClose} />
          )}
        />
      ) : mode === "calcolo" ? (
        <div className="border-2 border-ink/15 rounded-sm bg-paper">
          <div className="px-3 py-2 bg-muted/40 border-b flex items-center gap-2"><CalcIcon className="w-3.5 h-3.5" /><div className="font-mono text-[10px] uppercase tracking-widest">Necessità cliente</div></div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Materiale da trattare"><SelectWithAdd value={needMaterial} onChange={setNeedMaterial} options={allMaterials} placeholder="Tutti" emptyLabel="Tutti" /></Field>
              <Field label="Colore"><SelectWithAdd value={needColor} onChange={setNeedColor} options={allColors} placeholder="Tutti" emptyLabel="Tutti" /></Field>
              <Field label="Classe ignifuga"><SelectWithAdd value={needClass} onChange={setNeedClass} options={allClasses} placeholder="Tutte" emptyLabel="Tutte" /></Field>
              <Field label="Base"><SelectWithAdd value={needBase} onChange={setNeedBase} options={allBases} placeholder="Tutte" emptyLabel="Tutte" /></Field>
              <Field label="Finitura">
                <select value={needFinish} onChange={(e) => setNeedFinish(e.target.value as FireFinish | "")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Qualsiasi</option><option value="opaca">Opaca</option><option value="satinata">Satinata</option><option value="lucida">Lucida</option>
                </select>
              </Field>
              <Field label="Mani richieste (0 = da prodotto)"><Input type="number" min="0" step="1" value={needCoats || ""} onChange={(e) => setNeedCoats(Number(e.target.value))} /></Field>
            </div>

            <div className="border border-ink/15 rounded-sm divide-y max-h-56 overflow-auto">
              {filtered.length === 0 ? <div className="p-3 text-[12px] text-muted-foreground">Nessun prodotto disponibile con queste caratteristiche.</div> : filtered.map((p) => (
                <button key={p.id} type="button" onClick={() => { setSelectedId(p.id); setClassId(""); }} className={`w-full text-left p-3 hover:bg-muted/30 ${selected?.id === p.id ? "bg-dept-soft/40" : ""}`}>
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{(p.colors ?? []).join(", ") || "colore n/d"} · {p.base || "Base"} · {(p.finishes ?? []).join(", ")} · {(p.classes ?? []).map((c) => c.className).join(", ")} · {p.coats || 1} mani</div>
                </button>
              ))}
            </div>

            {!selected ? <div className="text-[12px] text-muted-foreground">Seleziona un prodotto disponibile.</div> : (
              <>
                <div className="text-[12px] flex items-center justify-between flex-wrap gap-2">
                  <div>Prodotto: <strong>{selected.name}</strong>{selected.base && <> · base {selected.base}</>} · {coats} mani base{hasFinish ? ` · ${finishCoats} mani finitura` : ""}</div>
                  {hasFinish && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] uppercase font-mono text-muted-foreground">Applica:</span>
                      {(["base","finitura","both"] as const).map((v) => (
                        <button key={v} type="button" onClick={() => setLayer(v)}
                          className={`px-2 py-0.5 text-[11px] border rounded-sm ${layer === v ? "bg-dept text-dept-foreground border-dept" : "border-ink/20 hover:bg-muted"}`}>
                          {v === "base" ? "Solo base" : v === "finitura" ? "Solo finitura" : "Base + Finitura"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {(layer === "base" || layer === "both") && (selected.classes?.length ?? 0) > 0 && (
                    <Field label={hasFinish ? "Classe ignifuga (BASE)" : "Classe ignifuga richiesta"}><select value={activeClass?.id ?? ""} onChange={(e) => setClassId(e.target.value)} className="h-9 text-[12px] w-full border rounded-sm px-2 bg-background">{(selected.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.className} — {fmt(c.consumptionKgPerM2)} kg/m²</option>)}</select></Field>
                  )}
                  {hasFinish && (layer === "finitura" || layer === "both") && (selected.finishClasses?.length ?? 0) > 0 && (
                    <Field label="Classe / consumo (FINITURA)"><select value={activeFinishClass?.id ?? ""} onChange={(e) => setFinishClassId(e.target.value)} className="h-9 text-[12px] w-full border rounded-sm px-2 bg-background">{(selected.finishClasses ?? []).map((c) => <option key={c.id} value={c.id}>{c.className || "Finitura"} — {fmt(c.consumptionKgPerM2)} kg/m²</option>)}</select></Field>
                  )}
                  <Field label="Superficie da trattare (m²)"><Input type="number" step="0.1" value={surface || ""} onChange={(e) => setSurface(Number(e.target.value))} placeholder="es. 120" /></Field>
                </div>
                {calc ? (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                      <KPI label="Kg necessari (totale)" value={`${fmt(calc.totalKgNeeded)} kg`} hint={calc.layers.map((l) => `${l.label}: ${fmt(l.kgNeeded)} kg`).join(" + ")} />
                      <KPI label="Latte totali" value={`${calc.totalCans}`} hint={calc.layers.map((l) => `${l.label}: ${l.plan.totalCans}`).join(" · ")} highlight />
                      <KPI label="Prezzo totale" value={eur(calc.totalCost)} hint={calc.layers.map((l) => `${l.label}: ${eur(l.plan.totalCost)}`).join(" + ")} highlight />
                    </div>
                    {calc.layers.map((L) => {
                      const planLabel = L.plan.items.map((it) => `${it.count} × ${it.can.label} kg`).join(" + ");
                      return (
                        <div key={L.key} className="border border-ink/15 rounded-sm mt-2">
                          <div className="px-3 py-1.5 bg-muted/40 border-b flex items-center justify-between">
                            <div className="font-mono text-[10px] uppercase tracking-widest">Layer · {L.label} ({L.coats} mani · {L.klass.className || "—"})</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{planLabel || "—"} · avanzo {fmt(L.plan.leftoverKg)} kg</div>
                          </div>
                          <div className="divide-y">
                            {L.plan.items.map((it) => (
                              <div key={it.can.id} className="grid grid-cols-[1fr,80px,100px,120px] gap-2 px-3 py-2 text-[11px] items-center">
                                <div><strong className="font-semibold">Latta da {it.can.label} kg</strong>{it.can.label !== String(it.can.kg) && <span className="text-muted-foreground"> (= {fmt(it.can.kg)} kg)</span>}</div>
                                <div className="text-right font-mono">× {it.count}</div>
                                <div className="text-right font-mono">{eur(it.can.price)}</div>
                                <div className="text-right font-mono font-bold">{eur(it.can.price * it.count)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {needColor.trim() ? `prezzi del colore "${needColor.trim()}"` : "prezzi base (nessun colore selezionato)"}
                        {calc.layers.some((l) => l.hasOverride) ? ` · override colore attivo` : ""}
                      </div>
                      <Button size="sm" onClick={addToCart}>
                        <Plus className="w-4 h-4 mr-1" /> Aggiungi all'ordine
                      </Button>
                    </div>

                  </>
                ) : <div className="text-[11px] text-muted-foreground">{hasFinish ? "Seleziona layer (base/finitura), classe e superficie per calcolare." : "Inserisci classe e superficie: il sistema sceglierà il miglior formato."}</div>}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="border-2 border-ink/15 rounded-sm bg-paper">
          <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest">Listino vernici ignifughe ({products.length})</div>
            <Button size="sm" onClick={add} className="h-7 px-2"><Plus className="w-3 h-3 mr-1" />Aggiungi</Button>
          </div>
          {products.length === 0 ? <div className="p-6 text-center text-[12px] text-muted-foreground">Nessun prodotto. Aggiungi il primo per iniziare.</div> : (
            <div className="divide-y max-h-[76vh] overflow-y-auto">
              {products.map((p) => {
                const isSel = selected?.id === p.id;
                return (
                  <div key={p.id} className={`p-3 cursor-pointer hover:bg-muted/30 ${isSel ? "bg-dept-soft/40" : ""}`} onClick={() => setSelectedId(p.id)}>
                    <div className="flex items-center gap-2">
                      {isSel ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <Input value={p.name} onChange={(e) => upd(p.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()} className="h-8 text-[12px] flex-1" placeholder="Nome prodotto" />
                      <Button size="sm" variant="outline" className="h-8 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); setMode("calcolo"); }}>Usa</Button>
                      <button onClick={(e) => { e.stopPropagation(); rm(p.id); }} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="mt-1 pl-6 text-[11px] text-muted-foreground">{p.treatedMaterials || "materiali n/d"} · {(p.colors ?? []).join(", ") || "colore n/d"} · {p.base || "Base"} · {p.coats || 1} mani</div>
                    {isSel && <FireProductEditor product={p} update={(patch) => upd(p.id, patch)} colorOptions={allColors} baseOptions={allBases} materialOptions={allMaterials} classOptions={allClasses} canLabelOptions={allCanLabels} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type LocalCan = { id: string; label: string; price: string };

function CansBlock({
  list, onSync, listId, title, canLabelOptions, colors, overrides, onOverridesChange,
}: {
  list: LocalCan[];
  onSync: (n: LocalCan[]) => void;
  listId: string;
  title: string;
  canLabelOptions: string[];
  colors: string[];
  overrides?: Record<string, Record<string, number>>;
  onOverridesChange?: (next: Record<string, Record<string, number>>) => void;
}) {
  const [activeColor, setActiveColor] = useState<string>("");
  const editingColor = activeColor && colors.includes(activeColor) && !!onOverridesChange;
  const colorRow = editingColor ? (overrides?.[activeColor] || {}) : {};
  const setColorPrice = (canId: string, value: string) => {
    if (!onOverridesChange) return;
    const next: Record<string, Record<string, number>> = { ...(overrides || {}) };
    const row = { ...(next[activeColor] || {}) };
    const n = Number(String(value).replace(",", "."));
    if (!value || !Number.isFinite(n) || n <= 0) delete row[canId];
    else row[canId] = n;
    if (Object.keys(row).length === 0) delete next[activeColor];
    else next[activeColor] = row;
    onOverridesChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{title}</div>
        {colors.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase font-mono text-muted-foreground">colore:</span>
            <select
              value={activeColor}
              onChange={(e) => setActiveColor(e.target.value)}
              className="h-6 text-[11px] border rounded-sm px-1 bg-background"
            >
              <option value="">Base (tutti)</option>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="space-y-1">
        {list.map((c, i) => {
          const computed = parseKgExpr(c.label);
          if (editingColor) {
            const basePrice = Number(String(c.price).replace(",", "")) || 0;
            const ov = colorRow[c.id];
            return (
              <div key={c.id} className="grid grid-cols-[140px,1fr,90px,32px] gap-2 items-center">
                <div className="h-7 px-2 flex items-center text-[11px] bg-muted/40 border rounded-sm font-mono">{c.label || "—"}</div>
                <Input
                  type="number" step="0.01"
                  value={ov != null && ov > 0 ? String(ov) : ""}
                  onChange={(e) => setColorPrice(c.id, e.target.value)}
                  placeholder={basePrice ? `= ${fmt(basePrice)} (base)` : "€ prezzo latta"}
                  className="h-7 text-[11px]"
                />
                <div className="text-[10px] text-muted-foreground font-mono text-right pr-1">{computed > 0 ? `= ${fmt(computed)} kg` : ""}</div>
                <span />
              </div>
            );
          }
          return (
            <div key={c.id} className="grid grid-cols-[140px,1fr,90px,32px] gap-2 items-center">
              <Input type="text" inputMode="text" value={c.label}
                onChange={(e) => onSync(list.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                list={listId} className="h-7 text-[11px]" placeholder='es. 5  oppure  10+3' />
              <Input type="number" step="0.01" value={c.price}
                onChange={(e) => onSync(list.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                className="h-7 text-[11px]" placeholder="€ prezzo latta" />
              <div className="text-[10px] text-muted-foreground font-mono text-right pr-1">{computed > 0 ? `= ${fmt(computed)} kg` : ""}</div>
              <button type="button" onClick={() => onSync(list.filter((_, j) => j !== i))} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          );
        })}
        <datalist id={listId}>{canLabelOptions.map((o) => <option key={o} value={o} />)}</datalist>
        {!editingColor && (
          <Button type="button" size="sm" variant="outline"
            onClick={() => onSync([...list, { id: uid(), label: "", price: "" }])}
            className="h-7 px-2 text-[11px]">
            <Plus className="w-3 h-3 mr-1" />Aggiungi formato
          </Button>
        )}
        <div className="text-[10px] text-muted-foreground">
          {editingColor
            ? <>Stai modificando i prezzi specifici per <strong>{activeColor}</strong>. Lascia vuoto per usare il prezzo base.</>
            : <>Suggerimento: per le confezioni promozionali tipo <strong>10+3</strong> o <strong>5+2</strong> scrivi l'espressione completa: il sistema sommerà automaticamente i kg.</>}
        </div>
      </div>
    </div>
  );
}

function FireProductEditor({ product: p, update, colorOptions, baseOptions, materialOptions, classOptions, canLabelOptions }: { product: FireProduct; update: (patch: Partial<FireProduct>) => void; colorOptions: string[]; baseOptions: string[]; materialOptions: string[]; classOptions: string[]; canLabelOptions: string[] }) {
  // Stato locale per latte: l'utente digita "10+3" come label e calcoliamo kg.
  const toLocal = (arr?: FireCan[]) => (arr ?? []).map((c) => ({ id: c.id || uid(), label: c.label || (c.kg ? String(c.kg) : ""), price: c.price ? String(c.price) : "" }));
  const fromLocal = (next: LocalCan[]): FireCan[] => {
    const out: FireCan[] = [];
    for (const c of next) {
      const kg = parseKgExpr(c.label);
      if (kg > 0) {
        const pr = Number(String(c.price).replace(",", "."));
        out.push({ id: c.id, kg, label: c.label.trim() || String(kg), price: Number.isFinite(pr) && pr > 0 ? pr : 0 });
      }
    }
    return out;
  };
  const [cans, setCans] = useState<LocalCan[]>(() => toLocal(p.cans));
  const [finishCans, setFinishCansLocal] = useState<LocalCan[]>(() => toLocal(p.finishCans));
  const syncCans = (next: LocalCan[]) => { setCans(next); update({ cans: fromLocal(next) }); };
  const syncFinishCans = (next: LocalCan[]) => { setFinishCansLocal(next); update({ finishCans: fromLocal(next) }); };
  // Materiali come tag multipli
  const matTags = splitTags(p.treatedMaterials);
  const setMatTags = (tags: string[]) => update({ treatedMaterials: tags.join(", ") });

  const hasFinish = p.baseType === "base_finitura";

  const renderCansBlock = (
    list: LocalCan[],
    onSync: (n: LocalCan[]) => void,
    listId: string,
    title: string,
    overrides?: Record<string, Record<string, number>>,
    onOverridesChange?: (next: Record<string, Record<string, number>>) => void,
  ) => (
    <CansBlock
      list={list}
      onSync={onSync}
      listId={listId}
      title={title}
      canLabelOptions={canLabelOptions}
      colors={p.colors ?? []}
      overrides={overrides}
      onOverridesChange={onOverridesChange}
    />
  );



  const renderClassesBlock = (
    classes: FireClass[] | undefined,
    onChange: (next: FireClass[]) => void,
    title: string,
  ) => (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">{title}</div>
      <div className="space-y-1">
        {(classes ?? []).map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr,110px,32px] gap-2 items-center">
            <SelectWithAdd value={c.className}
              onChange={(v) => onChange((classes ?? []).map((x) => x.id === c.id ? { ...x, className: v } : x))}
              options={classOptions} placeholder="es. Cl. 1" emptyLabel="—" />
            <Input type="number" step="0.01" value={c.consumptionKgPerM2 || ""}
              onChange={(e) => onChange((classes ?? []).map((x) => x.id === c.id ? { ...x, consumptionKgPerM2: Number(e.target.value) } : x))}
              className="h-7 text-[11px] text-right" placeholder="kg/m²" />
            <button onClick={() => onChange((classes ?? []).filter((x) => x.id !== c.id))} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <Button size="sm" variant="outline"
          onClick={() => onChange([...(classes ?? []), { id: uid(), className: "", consumptionKgPerM2: 0 }])}
          className="h-7 px-2 text-[11px]"><Plus className="w-3 h-3 mr-1" />Aggiungi classe</Button>
      </div>
    </div>
  );

  const renderColorPricesBlock = (
    _canList: FireCan[],
    surcharges: Record<string, number> | undefined,
    onChange: (next: Record<string, number>) => void,
    title: string,
  ) => {
    const colors = p.colors ?? [];
    if (colors.length === 0) return null;
    const setPct = (color: string, value: string) => {
      const next: Record<string, number> = { ...(surcharges || {}) };
      const n = Number(String(value).replace(",", "."));
      if (!value || !Number.isFinite(n) || n === 0) delete next[color];
      else next[color] = n;
      onChange(next);
    };
    return (
      <div className="border border-ink/15 rounded-sm p-2 bg-muted/20">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">{title}</div>
        <div className="text-[10px] text-muted-foreground mb-2">
          Una sola maggiorazione (%) per colore, applicata a tutti i formati di latta. Lascia vuoto o 0 per usare il prezzo base.
        </div>
        <div className="space-y-1">
          {colors.map((col) => {
            const cur = surcharges?.[col];
            return (
              <div key={col} className="grid grid-cols-[1fr,120px] gap-2 items-center">
                <div className="text-[12px] font-semibold">{col}</div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number" step="1"
                    value={cur != null && cur !== 0 ? String(cur) : ""}
                    onChange={(e) => setPct(col, e.target.value)}
                    placeholder="0"
                    className="h-7 text-[11px] text-right"
                  />
                  <span className="text-[11px] text-muted-foreground">%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };



  return (
    <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Materiali trattati (più valori)">
          <MultiTagInput value={matTags} onChange={setMatTags} options={materialOptions} placeholder="aggiungi materiale…" />
        </Field>
        <Field label="Colori (più valori)"><MultiTagInput value={p.colors ?? []} onChange={(colors) => update({ colors })} options={colorOptions} placeholder="aggiungi colore…" /></Field>
        <Field label="Base"><SelectWithAdd value={p.base} onChange={(v) => update({ base: v })} options={baseOptions} placeholder="—" /></Field>
        <Field label="Tipo"><select value={p.baseType} onChange={(e) => update({ baseType: e.target.value as FireBaseType })} className="h-8 text-[12px] w-full border rounded-sm px-2 bg-background"><option value="base">Solo base</option><option value="base_finitura">Base + finitura</option></select></Field>
        <Field label="Componenti"><select value={p.component} onChange={(e) => update({ component: e.target.value as FireComponent })} className="h-8 text-[12px] w-full border rounded-sm px-2 bg-background"><option value="mono">Monocomponente</option><option value="bi">Bicomponente</option></select></Field>
        <Field label="Mani"><Input type="number" min="1" step="1" value={p.coats || ""} onChange={(e) => update({ coats: Math.max(1, Number(e.target.value)) })} className="h-8 text-[12px]" /></Field>
      </div>

      {hasFinish ? (
        <Tabs defaultValue="base" className="w-full">
          <TabsList className="h-8">
            <TabsTrigger value="base" className="text-[11px]">Base</TabsTrigger>
            <TabsTrigger value="finitura" className="text-[11px]">Finitura</TabsTrigger>
          </TabsList>
          <TabsContent value="base" className="space-y-3 pt-2">
            {renderCansBlock(cans, syncCans, `cans-${p.id}`, "Formati latte BASE & prezzi (kg · €)", p.colorCanPrices, (next) => update({ colorCanPrices: next }))}
            {renderClassesBlock(p.classes, (next) => update({ classes: next }), "Classi ignifughe BASE & consumo (kg/m²)")}
          </TabsContent>
          <TabsContent value="finitura" className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Mani finitura"><Input type="number" min="1" step="1" value={p.finishCoats || ""} onChange={(e) => update({ finishCoats: Math.max(1, Number(e.target.value)) })} className="h-8 text-[12px]" placeholder="es. 1" /></Field>
            </div>
            {renderCansBlock(finishCans, syncFinishCans, `cans-fin-${p.id}`, "Formati latte FINITURA & prezzi (kg · €)", p.colorFinishCanPrices, (next) => update({ colorFinishCanPrices: next }))}
            {renderClassesBlock(p.finishClasses, (next) => update({ finishClasses: next }), "Consumo FINITURA (kg/m²)")}
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {renderCansBlock(cans, syncCans, `cans-${p.id}`, "Formati latte & prezzi (kg · €)", p.colorCanPrices, (next) => update({ colorCanPrices: next }))}
          {renderClassesBlock(p.classes, (next) => update({ classes: next }), "Classi ignifughe & consumo (kg/m²)")}
        </>
      )}

      <div><div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Finiture disponibili</div><div className="flex gap-2">{(["opaca", "satinata", "lucida"] as FireFinish[]).map((f) => { const on = (p.finishes ?? []).includes(f); return <button key={f} onClick={() => update({ finishes: on ? (p.finishes ?? []).filter((x) => x !== f) : [...(p.finishes ?? []), f] })} className={`px-2 py-1 text-[11px] capitalize border rounded-sm ${on ? "bg-dept text-dept-foreground border-dept" : "border-ink/20 hover:bg-muted"}`}>{f}</button>; })}</div></div>
    </div>
  );
}

/* ============== Helpers UI ============== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 block"><div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{label}</div>{children}</label>;
}
function ChipSelector({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="flex items-center gap-2 flex-wrap"><span className="text-[10px] uppercase font-mono text-muted-foreground">{label}:</span>{values.map((v) => <button key={v} onClick={() => onChange(value === v ? "" : v)} className={`px-2 py-0.5 text-[11px] border rounded-sm ${value === v ? "bg-dept text-dept-foreground border-dept" : "border-ink/20 hover:bg-muted"}`}>{v}</button>)}</div>;
}
function ChipsEditor({ label, values, onChange, placeholder, numeric }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; numeric?: boolean }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (numeric && !Number.isFinite(Number(v))) { setDraft(""); return; }
    if (values.includes(v)) { setDraft(""); return; }
    onChange([...values, v]); setDraft("");
  };
  return <div><div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">{label}</div><div className="flex flex-wrap gap-1.5 mb-1.5">{values.map((v) => <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] bg-muted rounded-sm border border-ink/10">{v}<button onClick={() => onChange(values.filter((x) => x !== v))} className="text-ink/40 hover:text-destructive">×</button></span>)}</div><div className="flex gap-1"><Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }} onBlur={commit} placeholder={placeholder} className="h-7 text-[11px]" /><Button type="button" size="sm" variant="outline" onClick={commit} className="h-7 px-2 text-[11px]">+</Button></div></div>;
}
function KPI({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return <div className={`border-2 ${highlight ? "border-dept bg-dept-soft/30" : "border-ink/15 bg-paper"} rounded-sm p-3`}><div className="font-mono text-[10px] uppercase text-muted-foreground">{label}</div><div className={`font-display text-2xl font-bold ${highlight ? "text-dept" : ""}`}>{value}</div>{hint && <div className="text-[10px] font-mono text-muted-foreground mt-1">{hint}</div>}</div>;
}

/** Input multi-tag con autocomplete e tasto "+". Permette di aggiungere
 *  più valori contemporaneamente separandoli con virgola, punto e virgola
 *  o invio. Mostra i suggerimenti già usati altrove. */
function MultiTagInput({ value, onChange, options, placeholder }: { value: string[]; onChange: (v: string[]) => void; options: string[]; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const commit = (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text) { setDraft(""); return; }
    const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  };
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const remaining = Array.from(new Set(options))
    .filter((o) => o && !value.includes(o))
    .filter((o) => !draft.trim() || norm(o).includes(norm(draft)));
  return (
    <div ref={wrapRef} className="space-y-1 relative">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] bg-muted rounded-sm border border-ink/10">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-ink/40 hover:text-destructive leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <Input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          onBlur={() => { setTimeout(() => commit(), 120); }}
          placeholder={placeholder ?? "aggiungi…"}
          className="h-8 text-[12px]"
        />
        <Button
          type="button"
          size="sm"
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          className="h-8 px-2 text-[11px]"
        >
          <Plus className="w-3 h-3 mr-1" />Aggiungi
        </Button>
      </div>
      {open && (draft.trim() || remaining.length > 0) && (
        <ul className="absolute z-30 left-0 right-0 top-full mt-1 bg-paper border-2 border-ink rounded-sm shadow-lg max-h-44 overflow-y-auto">
          {draft.trim() && !value.includes(draft.trim()) && !remaining.some((o) => norm(o) === norm(draft)) && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(draft); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-semibold bg-dept-soft/40 hover:bg-ink hover:text-paper"
              >
                + Crea "{draft.trim()}"
              </button>
            </li>
          )}
          {remaining.slice(0, 12).map((o) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(o); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-ink hover:text-paper"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============== Sezione vendita prodotti (stampa / tessuti) =============
   I listini coincidono con quelli del reparto: "stampa" usa il listino del
   Laboratorio, "tessuti" usa il listino della Tappezzeria. Le modifiche al
   catalogo si fanno dalle pagine reparto. */
type SaleCategory = "stampa" | "tessuti" | "danza" | "ignifugo" | "nastri";
type CartLine = {
  id: string;
  materialId: string;
  qty: number;
  // Snapshot per uso nel Flow (così il carrello è auto-contenuto nel draft).
  name?: string;
  variant?: string;
  unit?: SaleUnit;
  priceSell?: number;
  pricePurchase?: number;
  category?: SaleCategory;
  customerType?: CustomerType;
  priceMode?: PriceMode;
};

const DRAFT_STATE_KEY = "officina:state";

const readDraftSalesCart = (categoryKey: SaleCategory): CartLine[] => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(DRAFT_STATE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const c = parsed?.salesCarts?.[categoryKey];
    return Array.isArray(c) ? c : [];
  } catch { return []; }
};

const writeDraftSalesCart = (categoryKey: SaleCategory, next: CartLine[]) => {
  try {
    const raw = window.localStorage.getItem(DRAFT_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const salesCarts = { ...(parsed?.salesCarts || {}) };
    if (next.length === 0) delete salesCarts[categoryKey];
    else salesCarts[categoryKey] = next;
    const updated: any = { ...parsed };
    if (Object.keys(salesCarts).length === 0) delete updated.salesCarts;
    else updated.salesCarts = salesCarts;
    window.localStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("officina:draft-state-changed"));
  } catch { /* noop */ }
};

function SaleProductSection({
  title,
  categoryKey,
  sourceDept,
  sourceLabel,
  variantLabel,
  defaultUnit,
}: {
  title: string;
  categoryKey: SaleCategory;
  sourceDept: "stampa" | "tappezzeria";
  sourceLabel: string;
  variantLabel: string;
  defaultUnit: SaleUnit;
}) {
  const [catalog, setCatalog] = useState<{ materials: any[]; markupPct?: number } | null>(null);
  const [loadingCat, setLoadingCat] = useState(true);
  const [productName, setProductName] = useState("");
  const [colorFilter, setColorFilter] = useState<string>("");
  const [heightFilter, setHeightFilter] = useState<string>("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [customerType, setCustomerType] = useState<CustomerType>("final");
  const [priceMode, setPriceMode] = useState<PriceMode>("cut");
  const [saleUnitOverride, setSaleUnitOverride] = useState<SaleUnit | "">("");
  const [cart, setCart] = useState<CartLine[]>(() => readDraftSalesCart(categoryKey));
  useEffect(() => {
    writeDraftSalesCart(categoryKey, cart);
  }, [cart, categoryKey]);
  // Quando l'utente cambia scheda progetto (DraftTabsBar dispatcha l'evento),
  // ricarichiamo il carrello dalla draft attiva.
  useEffect(() => {
    const onLoaded = () => setCart(readDraftSalesCart(categoryKey));
    window.addEventListener("officina:draft-state-loaded", onLoaded);
    return () => window.removeEventListener("officina:draft-state-loaded", onLoaded);
  }, [categoryKey]);
  // Cliente, note, responsabile magazzino: ora si scelgono nel dialog "Crea commessa nel Flow".


  useEffect(() => {
    let cancelled = false;
    setLoadingCat(true);
    import("@/lib/catalog").then(({ loadCatalogCloud }) => {
      loadCatalogCloud(sourceDept).then((c) => {
        if (cancelled) return;
        setCatalog(c ?? { materials: [], markupPct: 0 });
        setLoadingCat(false);
      });
    });
    return () => { cancelled = true; };
  }, [sourceDept]);

  const materials = catalog?.materials ?? [];
  const productNames = useMemo(
    () => Array.from(new Set(materials.map((m: any) => m.name).filter(Boolean))).sort(),
    [materials],
  );
  useEffect(() => {
    if (!productName && productNames.length) setProductName(productNames[0] as string);
  }, [productNames, productName]);

  const variantsByName = useMemo(
    () => materials.filter((m: any) => m.name === productName),
    [materials, productName],
  );
  const colors = useMemo(
    () => Array.from(new Set(variantsByName.map((m: any) => String(m.color || "")).filter(Boolean))).sort(),
    [variantsByName],
  );
  useEffect(() => {
    if (colorFilter && !colors.includes(colorFilter)) setColorFilter("");
  }, [colors, colorFilter]);
  const variantsByColor = useMemo(
    () => colorFilter ? variantsByName.filter((m: any) => String(m.color || "") === colorFilter) : variantsByName,
    [variantsByName, colorFilter],
  );
  const heights = useMemo(
    () => Array.from(new Set(variantsByColor.map((m: any) => String(m.height || "")).filter(Boolean))).sort(),
    [variantsByColor],
  );
  useEffect(() => {
    if (heightFilter && !heights.includes(heightFilter)) setHeightFilter("");
  }, [heights, heightFilter]);
  const variants = useMemo(
    () => heightFilter ? variantsByColor.filter((m: any) => String(m.height || "") === heightFilter) : variantsByColor,
    [variantsByColor, heightFilter],
  );
  useEffect(() => {
    if (!variants.find((v: any) => v.id === variantId)) {
      setVariantId(variants[0]?.id ?? "");
    }
  }, [variants, variantId]);

  const labelOf = (m: any): string =>
    [m.color, m.height && `h${m.height}${m.heightUnit || ""}`, m.thickness, m.finish, m.fireproof]
      .filter(Boolean).join(" · ") || "—";
  const unitOf = (m: any): SaleUnit => {
    if (!m) return defaultUnit;
    const u = String(m.unit || "").toLowerCase();
    if (u === "mq" || u === "m²" || u === "m2") return "m²";
    if (u === "ml" || u === "mt" || u === "m") return "m";
    if (u === "pz" || u === "kg") return u as SaleUnit;
    if (m.priceUnit === "mq") return "m²";
    if (m.priceUnit === "ml") return "m";
    return defaultUnit;
  };
  const purchaseOf = (m: any): number => {
    if (!m) return 0;
    if (typeof m.costPrice === "number") return m.costPrice;
    return Number(m.pricePiece) || 0;
  };
  // Altezza materiale convertita in metri (per conversione m² → ml).
  const heightMeters = (m: any): number => {
    const h = Number(m?.height);
    if (!isFinite(h) || h <= 0) return 0;
    const u = String(m?.heightUnit || "cm").toLowerCase();
    if (u === "mm") return h / 1000;
    if (u === "m") return h;
    return h / 100;
  };
  // Prezzo d'acquisto convertito nell'unità di vendita scelta.
  const purchasePerSaleUnit = (m: any, su: SaleUnit): number => {
    const p = purchaseOf(m);
    const bu = unitOf(m);
    if (!m || bu === su) return p;
    if (bu === "m²" && su === "m") return p * heightMeters(m); // €/m² × altezza(m) = €/ml
    if (bu === "m" && su === "m²") {
      const h = heightMeters(m);
      return h > 0 ? p / h : p;
    }
    return p;
  };
  // Prezzo di vendita = acquisto × moltiplicatore (rivenditore/finale × intero/taglio).
  const sellPerSaleUnit = (m: any, su: SaleUnit): number =>
    sellPrice(purchasePerSaleUnit(m, su), customerType, priceMode);

  const selected = variants.find((v: any) => v.id === variantId) ?? variants[0];
  const baseUnit: SaleUnit = selected ? unitOf(selected) : defaultUnit;
  const canSwitchToMl = baseUnit === "m²" && heightMeters(selected) > 0;
  const effectiveSaleUnit: SaleUnit = saleUnitOverride && (saleUnitOverride === "m" || saleUnitOverride === "m²")
    ? saleUnitOverride
    : baseUnit;
  // Reset override se il nuovo materiale non lo supporta più.
  useEffect(() => {
    if (saleUnitOverride && !canSwitchToMl) setSaleUnitOverride("");
  }, [canSwitchToMl, saleUnitOverride]);

  const lineTotal = (line: CartLine) => {
    const m = materials.find((x: any) => x.id === line.materialId);
    // Usiamo sempre lo snapshot della riga: il prezzo dipende anche da
    // cliente/modalità/unità di vendita scelti al momento dell'aggiunta.
    const sell = (Number(line.priceSell) || 0) * line.qty;
    const purchase = (Number(line.pricePurchase) || 0) * line.qty;
    return { material: m, sell, purchase };
  };
  const cartTotals = useMemo(() => {
    let sell = 0, purchase = 0;
    for (const l of cart) { const t = lineTotal(l); sell += t.sell; purchase += t.purchase; }
    return { sell, purchase };
  }, [cart, materials]);

  const addToCart = () => {
    if (!selected || qty <= 0) return;
    setCart([...cart, {
      id: uid(),
      materialId: selected.id,
      qty,
      name: selected.name,
      variant: labelOf(selected),
      unit: effectiveSaleUnit,
      priceSell: sellPerSaleUnit(selected, effectiveSaleUnit),
      pricePurchase: purchasePerSaleUnit(selected, effectiveSaleUnit),
      category: categoryKey,
      customerType,
      priceMode,
    }]);
    setQty(0);
  };

  // Le righe del carrello vengono inviate al Flow tramite il bottone "Invia al Flow"
  // (DraftTabsBar → CreateCommessaButton), che gestisce cliente, riferimento ordine
  // e responsabile magazzino in un unico punto.


  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Fonte listino: <strong className="text-ink">{sourceLabel}</strong>
          {loadingCat ? " · caricamento…" : ` · ${materials.length} varianti`}
        </div>
        <div className="flex-1" />
        {cart.length > 0 && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
            {cart.length} articol{cart.length === 1 ? "o" : "i"} nel carrello · usa <strong>Invia al Flow</strong> in alto
          </div>
        )}
      </div>

      <div className="border-2 border-ink/15 rounded-sm bg-paper">
        <div className="px-3 py-2 bg-muted/40 border-b flex items-center gap-2">
          <CalcIcon className="w-3.5 h-3.5" />
          <div className="font-mono text-[10px] uppercase tracking-widest">Calcolo prezzo vendita — solo materiale</div>
        </div>
        <div className="p-4 space-y-4">
          {loadingCat ? (
            <div className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carico {sourceLabel.toLowerCase()}…</div>
          ) : materials.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Nessun materiale a listino in <strong>{sourceLabel}</strong>. Aggiungi i prodotti nella pagina del reparto.</div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Prodotto">
                  <select
                    value={productName}
                    onChange={(e) => { setProductName(e.target.value); setColorFilter(""); setHeightFilter(""); setVariantId(""); }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {productNames.map((n) => <option key={n as string} value={n as string}>{n as string}</option>)}
                  </select>
                </Field>
                {colors.length > 0 && (
                  <Field label="Colore">
                    <select
                      value={colorFilter}
                      onChange={(e) => { setColorFilter(e.target.value); setHeightFilter(""); setVariantId(""); }}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Tutti</option>
                      {colors.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                )}
                {heights.length > 0 && (
                  <Field label="Altezza">
                    <select
                      value={heightFilter}
                      onChange={(e) => { setHeightFilter(e.target.value); setVariantId(""); }}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Tutte</option>
                      {heights.map((h) => <option key={h} value={h}>{h}{selected?.heightUnit || "cm"}</option>)}
                    </select>
                  </Field>
                )}
                {variants.length > 0 && (
                  <Field label={variantLabel}>
                    <select
                      value={variantId}
                      onChange={(e) => setVariantId(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {variants.map((v: any) => <option key={v.id} value={v.id}>{labelOf(v)}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Quantità">
                  <div className="relative">
                    <Input type="number" step="0.01" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} className="pr-12" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono uppercase tracking-wider text-muted-foreground pointer-events-none">
                      {effectiveSaleUnit}
                    </span>
                  </div>
                </Field>
              </div>

              {/* Modalità di vendita: tipo cliente, intero/al taglio, unità */}
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Tipo cliente">
                  <div className="flex gap-1 border border-input rounded-md p-0.5 bg-background">
                    {(["final", "dealer"] as CustomerType[]).map((c) => (
                      <button key={c} type="button" onClick={() => setCustomerType(c)}
                        className={`flex-1 h-9 text-[12px] font-semibold rounded-sm transition-colors ${customerType === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                        {CUSTOMER_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Modalità">
                  <div className="flex gap-1 border border-input rounded-md p-0.5 bg-background">
                    {(["piece", "cut"] as PriceMode[]).map((m) => (
                      <button key={m} type="button" onClick={() => setPriceMode(m)}
                        className={`flex-1 h-9 text-[12px] font-semibold rounded-sm transition-colors ${priceMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                        {m === "piece" ? `Intero (×${priceMultiplier(customerType, "piece")})` : `Al taglio (×${priceMultiplier(customerType, "cut")})`}
                      </button>
                    ))}
                  </div>
                </Field>
                {canSwitchToMl ? (
                  <Field label="Unità di vendita">
                    <div className="flex gap-1 border border-input rounded-md p-0.5 bg-background">
                      {([
                        { v: "m²" as SaleUnit, lab: "m² (a metro quadro)" },
                        { v: "m" as SaleUnit, lab: `ml (h ${fmt(heightMeters(selected))} m)` },
                      ]).map((opt) => (
                        <button key={opt.v} type="button" onClick={() => setSaleUnitOverride(opt.v === baseUnit ? "" : opt.v)}
                          className={`flex-1 h-9 text-[12px] font-semibold rounded-sm transition-colors ${effectiveSaleUnit === opt.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                          {opt.lab}
                        </button>
                      ))}
                    </div>
                  </Field>
                ) : (
                  <Field label="Unità di vendita">
                    <div className="h-10 flex items-center px-3 text-[12px] font-mono text-muted-foreground border border-dashed border-input rounded-md">
                      {baseUnit} (unità del listino)
                    </div>
                  </Field>
                )}
              </div>

              {selected && qty > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  <KPI
                    label="Prezzo d'acquisto"
                    value={`${eur(purchasePerSaleUnit(selected, effectiveSaleUnit))}/${effectiveSaleUnit}`}
                    hint={effectiveSaleUnit !== baseUnit
                      ? `da ${eur(purchaseOf(selected))}/${baseUnit} × h ${fmt(heightMeters(selected))} m`
                      : `listino ${eur(purchaseOf(selected))}/${baseUnit}`}
                  />
                  <KPI
                    label="Prezzo vendita unitario"
                    value={`${eur(sellPerSaleUnit(selected, effectiveSaleUnit))}/${effectiveSaleUnit}`}
                    hint={`×${priceMultiplier(customerType, priceMode)} · ${priceMode === "piece" ? "intero" : "al taglio"}`}
                  />
                  <KPI label="Quantità" value={`${fmt(qty)} ${effectiveSaleUnit}`} hint={labelOf(selected)} />
                  <KPI label="Costo materiale" value={eur(purchasePerSaleUnit(selected, effectiveSaleUnit) * qty)} hint="totale d'acquisto" />
                  <KPI
                    label="Prezzo vendita totale"
                    value={eur(sellPerSaleUnit(selected, effectiveSaleUnit) * qty)}
                    hint={`${CUSTOMER_LABEL[customerType]} · ${priceMode === "piece" ? "intero" : "al taglio"}`}
                    highlight
                  />
                </div>
              )}

              <div className="flex justify-end">
                <Button size="sm" onClick={addToCart} disabled={!selected || qty <= 0}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi all'ordine
                </Button>
              </div>

              {cart.length > 0 && (
                <div className="border-2 border-ink/15 rounded-sm">
                  <div className="px-3 py-2 bg-muted/40 border-b font-mono text-[10px] uppercase tracking-widest">Carrello ordine ({cart.length}) — prezzo modificabile per riga</div>
                  <div className="divide-y">
                    {cart.map((l) => {
                      const t = lineTotal(l);
                      const unit = l.unit || (t.material ? unitOf(t.material) : "");
                      return (
                        <div key={l.id} className="grid grid-cols-[1fr,80px,110px,100px,32px] gap-2 px-3 py-2 text-[12px] items-center">
                          <div>
                            <strong>{l.name ?? t.material?.name ?? "—"}</strong>
                            {(l.variant || t.material) && (
                              <span className="text-muted-foreground"> · {l.variant ?? (t.material ? labelOf(t.material) : "")}</span>
                            )}
                          </div>
                          <Input
                            type="number" step="0.01" min="0"
                            value={l.qty || ""}
                            onChange={(e) => setCart(cart.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) || 0 } : x))}
                            className="h-7 text-[12px] text-right font-mono"
                            title={`Quantità (${unit})`}
                          />
                          <div className="relative">
                            <Input
                              type="number" step="0.01" min="0"
                              value={l.priceSell ?? ""}
                              onChange={(e) => setCart(cart.map((x) => x.id === l.id ? { ...x, priceSell: Number(e.target.value) || 0 } : x))}
                              className="h-7 text-[12px] text-right font-mono pr-8"
                              title={`Prezzo unitario di vendita (€/${unit})`}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground pointer-events-none">€/{unit}</span>
                          </div>
                          <div className="text-right font-mono font-bold">{eur(t.sell)}</div>
                          <button onClick={() => setCart(cart.filter((x) => x.id !== l.id))} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-[1fr,80px,110px,100px,32px] gap-2 px-3 py-2 text-[12px] items-center bg-dept-soft/30">
                      <div className="font-bold">Totale vendita</div>
                      <div></div>
                      <div></div>
                      <div className="text-right font-mono font-bold text-dept">{eur(cartTotals.sell)}</div>
                      <div></div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Cliente e responsabile magazzino sono scelti in "Crea commessa nel Flow" (DraftTabsBar). */}

    </div>
  );
}
