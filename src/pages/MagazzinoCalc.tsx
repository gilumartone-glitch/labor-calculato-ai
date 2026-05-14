import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Calculator as CalcIcon, Layers, Droplets, ChevronDown, ChevronRight, RotateCw, Printer, Scissors, PackageCheck, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

/* ============== Tipi ============== */
type DanceRoll = {
  id: string;
  name: string;
  thicknessMm: number;
  rollWidth: number;
  rollLength: number;
  colors: string[];
  pricePerSqm?: number;
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
  fireProducts: FireProduct[];
  printProducts: SaleProduct[];
  fabricProducts: SaleProduct[];
};
const initial: MagState = { version: 5, danceRolls: [], fireProducts: [], printProducts: [], fabricProducts: [] };
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
  return {
    version: 5,
    danceRolls,
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
export default function MagazzinoCalc() {
  const { state, setState, ready, status } = useSharedCloudState<MagState>("magazzino_calc", initial, {
    hydrate,
    localStorageKeys: MAGAZZINO_LOCAL_KEYS,
  });
  const [sub, setSub] = useState<"danza" | "ignifugo">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("sub") === "ignifugo" ? "ignifugo" : "danza";
  });
  const update = (patch: Partial<MagState>) => setState({ ...state, ...patch, version: 4 });

  return (
    <div className="space-y-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-dept">// Vendite</div>
        <h2 className="font-display text-2xl font-semibold">Vendite · Calcolo & schede magazzino</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {status === "saving" ? "Salvataggio listini…" : status === "error" ? "Errore salvataggio: non chiudere la pagina" : "Listini salvati"}
        </p>
      </div>

      <div className="flex gap-1 border-b-2 border-ink/15">
        {([
          { key: "danza", label: "Tappeto danza", Icon: Layers },
          { key: "ignifugo", label: "Vernice ignifuga", Icon: Droplets },
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
        <DanceSection rolls={state.danceRolls ?? []} setRolls={(danceRolls) => update({ danceRolls })} />
      ) : (
        <FireSection products={state.fireProducts ?? []} setProducts={(fireProducts) => update({ fireProducts })} />
      )}
    </div>
  );
}

/* ============== Sezione Tappeto danza ============== */
function DanceSection({ rolls, setRolls }: { rolls: DanceRoll[]; setRolls: (r: DanceRoll[]) => void }) {
  // mode default = calcolo (catalogo dopo)
  const [mode, setMode] = useState<"calcolo" | "catalogo">("calcolo");
  const [selectedId, setSelectedId] = useState<string>(rolls[0]?.id ?? "");
  const [needThickness, setNeedThickness] = useState<number>(0);
  const [needColor, setNeedColor] = useState<string>("");
  const [stageW, setStageW] = useState<number>(18);
  const [stageH, setStageH] = useState<number>(10);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [direction, setDirection] = useState<StripDirection>("vertical");
  const [chosenColor, setChosenColor] = useState<string>("");

  const allColors = useMemo(() => Array.from(new Set(rolls.flatMap((r) => r.colors ?? []))), [rolls]);

  const filtered = useMemo(() => rolls.filter((r) => {
    const tOk = !needThickness || r.thicknessMm >= needThickness;
    const cOk = !needColor || (r.colors ?? []).some((c) => includesLoose(c, needColor));
    return tOk && cOk;
  }), [rolls, needThickness, needColor]);
  const selected = rolls.find((r) => r.id === selectedId) ?? filtered[0] ?? rolls[0];

  const customPoints = segmentsToPoints(segments);
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
    const across = direction === "vertical" ? b.w : b.h;
    const along = direction === "vertical" ? b.h : b.w;
    const strips = Math.ceil(across / selected.rollWidth);
    const totalLen = strips * along;
    const rollsNeeded = Math.ceil(totalLen / selected.rollLength);
    const totalCovered = rollsNeeded * selected.rollLength;
    const purchasedSqm = rollsNeeded * selected.rollLength * selected.rollWidth;
    const unit = Number(selected.pricePerSqm ?? 0);
    return { strips, totalLen, rollsNeeded, leftover: totalCovered - totalLen, surface, bounds: b, unitPrice: unit, purchasedSqm, totalPrice: unit * purchasedSqm };
  }, [selected, activePoints, customPoints, stageW, stageH, direction]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={mode === "calcolo" ? "default" : "outline"} onClick={() => setMode("calcolo")}>Calcolo & nesting</Button>
        <Button size="sm" variant={mode === "catalogo" ? "default" : "outline"} onClick={() => setMode("catalogo")}>Listino magazzino</Button>
      </div>

      {mode === "calcolo" ? (
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
                  <div>Tappeto: <strong>{selected.name}</strong> · spess. {fmt(selected.thicknessMm)} mm · rotolo {fmt(selected.rollLength)} × {fmt(selected.rollWidth)} m</div>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setDirection((d) => d === "vertical" ? "horizontal" : "vertical")}><RotateCw className="w-3.5 h-3.5 mr-1" />Ruota teli</Button>
                </div>
                {(selected.colors?.length ?? 0) > 0 && <ChipSelector label="Colore" values={selected.colors ?? []} value={chosenColor} onChange={setChosenColor} />}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Larghezza sala (m)"><Input type="number" step="0.1" value={stageW || ""} onChange={(e) => setStageW(Number(e.target.value))} /></Field>
                  <Field label="Profondità sala (m)"><Input type="number" step="0.1" value={stageH || ""} onChange={(e) => setStageH(Number(e.target.value))} /></Field>
                  <Field label="Verso teli"><div className="h-10 flex items-center rounded-md border border-input bg-background px-3 text-[12px] font-medium">{direction === "vertical" ? "strisce in profondità" : "strisce in larghezza"}</div></Field>
                </div>

                <RoomSegmentsEditor segments={segments} setSegments={setSegments} />
                <DanceNestingCanvas points={activePoints} customPoints={customPoints} roomW={stageW} roomH={stageH} rollWidth={selected.rollWidth} direction={direction} />

                {calc ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                    <KPI label="Strisce / teli" value={`${calc.strips}`} hint={`passo ${fmt(selected.rollWidth)} m`} />
                    <KPI label="Metri lineari" value={`${fmt(calc.totalLen)} m`} hint={`${calc.strips} × ${fmt(direction === "vertical" ? calc.bounds.h : calc.bounds.w)} m`} />
                    <KPI label="Rotoli interi" value={`${calc.rollsNeeded}`} hint={`rotoli da ${fmt(selected.rollLength)} m`} highlight />
                    <KPI label="Sfrido residuo" value={`${fmt(calc.leftover)} m`} hint={`Superficie ${fmt(calc.surface)} m²`} />
                    <KPI label="Prezzo unitario" value={`${eur(calc.unitPrice)}/m²`} hint="prezzo a m²" />
                    <KPI label="Prezzo totale" value={eur(calc.totalPrice)} hint={`${fmt(calc.purchasedSqm)} m² × ${eur(calc.unitPrice)}`} highlight />
                  </div>
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
  const [mode, setMode] = useState<"calcolo" | "catalogo">("calcolo");
  const [selectedId, setSelectedId] = useState<string>(products[0]?.id ?? "");
  const [needMaterial, setNeedMaterial] = useState("");
  const [needColor, setNeedColor] = useState("");
  const [needClass, setNeedClass] = useState("");
  const [needBase, setNeedBase] = useState("");
  const [needFinish, setNeedFinish] = useState<FireFinish | "">("");
  const [needCoats, setNeedCoats] = useState<number>(0);
  const [surface, setSurface] = useState<number>(0);
  const [classId, setClassId] = useState<string>("");

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
  const activeClass = selected?.classes?.find((c) => c.id === classId) ?? selected?.classes?.[0];
  const coats = Math.max(1, Number(needCoats || selected?.coats || 1));

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

  const calc = useMemo(() => {
    if (!selected || surface <= 0 || !activeClass || activeClass.consumptionKgPerM2 <= 0) return null;
    if (!selected.cans?.length) return null;
    const kgNeeded = surface * coats * activeClass.consumptionKgPerM2;
    const plan = planCans(selected.cans, kgNeeded);
    if (!plan) return null;
    return { kgNeeded, plan };
  }, [selected, surface, coats, activeClass]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={mode === "calcolo" ? "default" : "outline"} onClick={() => setMode("calcolo")}>Richiesta cliente & calcolo</Button>
        <Button size="sm" variant={mode === "catalogo" ? "default" : "outline"} onClick={() => setMode("catalogo")}>Listino vernici</Button>
      </div>

      {mode === "calcolo" ? (
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
                <div className="text-[12px]">Prodotto: <strong>{selected.name}</strong>{selected.base && <> · base {selected.base}</>} · {coats} mani</div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {(selected.classes?.length ?? 0) > 0 && <Field label="Classe ignifuga richiesta"><select value={activeClass?.id ?? ""} onChange={(e) => setClassId(e.target.value)} className="h-9 text-[12px] w-full border rounded-sm px-2 bg-background">{(selected.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.className} — {fmt(c.consumptionKgPerM2)} kg/m²</option>)}</select></Field>}
                  <Field label="Superficie da trattare (m²)"><Input type="number" step="0.1" value={surface || ""} onChange={(e) => setSurface(Number(e.target.value))} placeholder="es. 120" /></Field>
                  <Field label="Mani applicate"><div className="h-10 flex items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">{coats}</div></Field>
                </div>
                {calc ? (() => {
                  const { kgNeeded, plan } = calc;
                  const planLabel = plan.items.map((it) => `${it.count} × ${it.can.label} kg`).join(" + ");
                  return (
                    <>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                        <KPI label="Kg necessari" value={`${fmt(kgNeeded)} kg`} hint={`${fmt(surface)} m² × ${coats} mani × ${fmt(activeClass!.consumptionKgPerM2)} kg/m²`} />
                        <KPI label="Mix consigliato" value={planLabel || "—"} hint={`${plan.totalCans} latta/e — ${fmt(plan.totalKg)} kg totali`} highlight />
                        <KPI label="Avanzo" value={`${fmt(plan.leftoverKg)} kg`} hint={`vernice in più rispetto al fabbisogno`} />
                        <KPI label="Prezzo totale" value={eur(plan.totalCost)} hint={plan.items.map((it) => `${it.count}×${eur(it.can.price)}`).join(" + ") || "prezzi mancanti"} highlight />
                      </div>
                      <div className="border border-ink/15 rounded-sm divide-y mt-2">
                        {plan.items.map((it) => (
                          <div key={it.can.id} className="grid grid-cols-[1fr,80px,100px,120px] gap-2 px-3 py-2 text-[11px] items-center">
                            <div><strong className="font-semibold">Latta da {it.can.label} kg</strong>{it.can.label !== String(it.can.kg) && <span className="text-muted-foreground"> (= {fmt(it.can.kg)} kg)</span>}</div>
                            <div className="text-right font-mono">× {it.count}</div>
                            <div className="text-right font-mono">{eur(it.can.price)}</div>
                            <div className="text-right font-mono font-bold">{eur(it.can.price * it.count)}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })() : <div className="text-[11px] text-muted-foreground">Inserisci classe e superficie: il sistema sceglierà automaticamente il miglior formato (e quante latte servono).</div>}
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

function FireProductEditor({ product: p, update, colorOptions, baseOptions, materialOptions, classOptions, canLabelOptions }: { product: FireProduct; update: (patch: Partial<FireProduct>) => void; colorOptions: string[]; baseOptions: string[]; materialOptions: string[]; classOptions: string[]; canLabelOptions: string[] }) {
  // Stato locale per latte: l'utente digita "10+3" come label e calcoliamo kg.
  type LocalCan = { id: string; label: string; price: string };
  const [cans, setCans] = useState<LocalCan[]>(() =>
    (p.cans ?? []).map((c) => ({ id: c.id || uid(), label: c.label || (c.kg ? String(c.kg) : ""), price: c.price ? String(c.price) : "" }))
  );
  const syncCans = (next: LocalCan[]) => {
    setCans(next);
    const cansOut: FireCan[] = [];
    for (const c of next) {
      const kg = parseKgExpr(c.label);
      if (kg > 0) {
        const pr = Number(String(c.price).replace(",", "."));
        cansOut.push({ id: c.id, kg, label: c.label.trim() || String(kg), price: Number.isFinite(pr) && pr > 0 ? pr : 0 });
      }
    }
    update({ cans: cansOut });
  };
  // Materiali come tag multipli
  const matTags = splitTags(p.treatedMaterials);
  const setMatTags = (tags: string[]) => update({ treatedMaterials: tags.join(", ") });
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

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Formati latte & prezzi (kg · €)</div>
        <div className="space-y-1">
          {cans.map((c, i) => {
            const computed = parseKgExpr(c.label);
            return (
            <div key={c.id} className="grid grid-cols-[140px,1fr,90px,32px] gap-2 items-center">
              <Input
                type="text"
                inputMode="text"
                value={c.label}
                onChange={(e) => syncCans(cans.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                list={`cans-${p.id}`}
                className="h-7 text-[11px]"
                placeholder='es. 5  oppure  10+3'
              />
              <Input
                type="number"
                step="0.01"
                value={c.price}
                onChange={(e) => syncCans(cans.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                className="h-7 text-[11px]"
                placeholder="€ prezzo latta"
              />
              <div className="text-[10px] text-muted-foreground font-mono text-right pr-1">
                {computed > 0 ? `= ${fmt(computed)} kg` : ""}
              </div>
              <button
                type="button"
                onClick={() => syncCans(cans.filter((_, j) => j !== i))}
                className="text-ink/40 hover:text-destructive p-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            );
          })}
          <datalist id={`cans-${p.id}`}>{canLabelOptions.map((o) => <option key={o} value={o} />)}</datalist>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => syncCans([...cans, { id: uid(), label: "", price: "" }])}
            className="h-7 px-2 text-[11px]"
          >
            <Plus className="w-3 h-3 mr-1" />Aggiungi formato
          </Button>
          <div className="text-[10px] text-muted-foreground">
            Suggerimento: per le confezioni promozionali tipo <strong>10+3</strong> o <strong>5+2</strong> scrivi l'espressione completa: il sistema sommerà automaticamente i kg.
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Classi ignifughe & consumo (kg/m²)</div>
        <div className="space-y-1">
          {(p.classes ?? []).map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr,110px,32px] gap-2 items-center">
              <SelectWithAdd
                value={c.className}
                onChange={(v) => update({ classes: (p.classes ?? []).map((x) => x.id === c.id ? { ...x, className: v } : x) })}
                options={classOptions}
                placeholder="es. Cl. 1"
                emptyLabel="—"
              />
              <Input type="number" step="0.01" value={c.consumptionKgPerM2 || ""} onChange={(e) => update({ classes: (p.classes ?? []).map((x) => x.id === c.id ? { ...x, consumptionKgPerM2: Number(e.target.value) } : x) })} className="h-7 text-[11px] text-right" placeholder="kg/m²" />
              <button onClick={() => update({ classes: (p.classes ?? []).filter((x) => x.id !== c.id) })} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => update({ classes: [...(p.classes ?? []), { id: uid(), className: "", consumptionKgPerM2: 0 }] })} className="h-7 px-2 text-[11px]"><Plus className="w-3 h-3 mr-1" />Aggiungi classe</Button>
        </div>
      </div>

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
          className="h-7 text-[11px]"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => commit()} className="h-7 px-2 text-[11px]">
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      {open && remaining.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 top-full mt-1 bg-paper border-2 border-ink rounded-sm shadow-lg max-h-44 overflow-y-auto">
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
