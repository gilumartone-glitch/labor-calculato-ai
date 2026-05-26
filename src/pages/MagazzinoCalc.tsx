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
type ManualLine = { id: string; descrizione: string; qty: string; um: string; note: string };

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
  suggestions,
  picker,
}: {
  sourceLabel: string;
  suggestions: { descrizione: string; um: string }[];
  picker?: (onPick: (item: PickedItem) => void, onClose: () => void) => React.ReactNode;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cliente, setCliente] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ManualLine[]>([
    { id: uid(), descrizione: "", qty: "", um: suggestions[0]?.um ?? "pz", note: "" },
  ]);
  const [assignee, setAssignee] = useState("");
  const [users, setUsers] = useState<{ id: string; display_name: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("profiles").select("id, display_name").contains("settori", ["magazzino"]).order("display_name", { ascending: true })
      .then(({ data }) => setUsers(data ?? []));
  }, []);

  const addLine = (preset?: { descrizione: string; um: string }) => {
    const id = uid();
    setLines([...lines, { id, descrizione: preset?.descrizione ?? "", qty: "", um: preset?.um ?? "pz", note: "" }]);
    return id;
  };
  const addAndPick = () => { const id = addLine(); setPickerLineId(id); };
  const updLine = (id: string, patch: Partial<ManualLine>) => setLines(lines.map((l) => l.id === id ? { ...l, ...patch } : l));
  const rmLine = (id: string) => setLines(lines.filter((l) => l.id !== id));
  const [manualEdit, setManualEdit] = useState<Record<string, boolean>>({});

  const validLines = lines.filter((l) => l.descrizione.trim() && Number(l.qty) > 0);

  const submit = async () => {
    if (!user) { toast.error("Devi accedere"); return; }
    if (!cliente.trim()) { toast.error("Inserisci il cliente"); return; }
    if (validLines.length === 0) { toast.error("Aggiungi almeno una voce"); return; }
    if (!assignee) { toast.error("Seleziona il responsabile magazzino"); return; }
    setBusy(true);
    try {
      const code = await nextOrderCode();
      const itemsTxt = validLines.map((l) => `${l.descrizione} — ${l.qty} ${l.um}${l.note ? ` (${l.note})` : ""}`).join(" · ");
      const fullNote = [note.trim(), itemsTxt].filter(Boolean).join("\n");
      const { data: pord, error: e1 } = await supabase.from("production_orders").insert({
        code,
        cliente: cliente.trim().slice(0, 200),
        data: new Date().toISOString().slice(0, 10),
        note: `${sourceLabel} — ${fullNote}`,
        priorita: "normale",
        delivery: "spedizione",
        status: "in_corso",
        attachments: [],
        nesting_included: false,
        created_by: user.id,
        customer_order_ref: ref.trim() || null,
        snapshot: {
          source: `magazzino-ordine-manuale`,
          sourceLabel,
          cliente: cliente.trim(),
          ref: ref.trim(),
          items: validLines.map((l) => ({ descrizione: l.descrizione, qty: Number(l.qty), um: l.um, note: l.note })),
          note,
        } as never,
      }).select().single();
      if (e1) throw e1;
      await supabase.from("production_sub_orders").insert({
        order_id: pord.id,
        code: subCode(code, SUB_DEPT_SUFFIX["magazzino"], 1),
        dept: "magazzino",
        ordine: 0,
        note: itemsTxt,
        files: [],
        depends_on: null,
        assignee_id: assignee,
      } as any);
      await notify({
        userIds: [assignee],
        type: "magazzino_da_preparare",
        message: `${sourceLabel} — ${code} · ${cliente.trim()}`,
        order_id: pord.id,
        link: "/produzione/preparazione",
        is_urgent: false,
      });
      await logAction({
        action: "FLOW_LANCIATO",
        entity_type: "order",
        entity_id: pord.id,
        detail: `${sourceLabel} ${code} per ${cliente.trim()} (${itemsTxt})`,
        new_state: { code, source: "magazzino-ordine-manuale" },
      });
      toast.success(`Ordine ${code} creato e inviato al magazzino`, {
        action: { label: "Apri Flow", onClick: () => navigate("/flow") },
      });
      navigate("/flow");
      setCliente(""); setRef(""); setNote("");
      setLines([{ id: uid(), descrizione: "", qty: "", um: suggestions[0]?.um ?? "pz", note: "" }]);
      setAssignee("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore creazione ordine");
    } finally { setBusy(false); }
  };

  return (
    <div className="border-2 border-ink/15 rounded-sm bg-paper">
      <div className="px-3 py-2 bg-muted/40 border-b flex items-center gap-2">
        <PackageCheck className="w-3.5 h-3.5" />
        <div className="font-mono text-[10px] uppercase tracking-widest">Ordine manuale → magazzino</div>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Cliente *"><Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nome cliente" /></Field>
          <Field label="Rif. ordine cliente"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="es. ORD-123" /></Field>
        </div>

        <div className="border-2 border-ink/15 rounded-sm bg-background">
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
            <div className="font-mono text-[10px] uppercase tracking-widest">Voci ordine ({lines.length})</div>
            <div className="flex gap-1 flex-wrap">
              {picker && (
                <Button size="sm" className="h-7 text-[11px]" onClick={addAndPick}>
                  <Plus className="w-3 h-3 mr-1" />Scegli dal listino
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addLine()}>
                <Plus className="w-3 h-3 mr-1" />Riga manuale
              </Button>
            </div>
          </div>
          <div className="divide-y">
            {lines.length === 0 && <div className="p-3 text-[12px] text-muted-foreground">Aggiungi almeno una voce.</div>}
            {lines.map((l) => {
              const isManual = manualEdit[l.id] || !picker;
              return (
                <div key={l.id} className="p-2 grid grid-cols-[1fr,90px,80px,1fr,32px] gap-2 items-start">
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

        <Field label="Note ordine"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note interne / istruzioni" /></Field>

        <div>
          <Label className="text-[11px] font-mono uppercase tracking-wider">Responsabile magazzino *</Label>
          {users.length === 0 ? (
            <div className="text-[11px] text-destructive mt-1">Nessun utente con settore "magazzino". Assegna il settore in Gestione utenti.</div>
          ) : (
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="mt-1 w-full h-9 px-2 border-2 border-ink/20 rounded-sm bg-paper text-sm">
              <option value="">— seleziona —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.id.slice(0, 8)}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {(() => {
            const missing: string[] = [];
            if (!cliente.trim()) missing.push("cliente");
            if (validLines.length === 0) missing.push("almeno una voce con descrizione e quantità > 0");
            if (!assignee) missing.push("responsabile magazzino");
            return missing.length > 0 ? (
              <div className="text-[10px] font-mono text-amber-700">Manca: {missing.join(" · ")}</div>
            ) : null;
          })()}
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}
            Crea ordine magazzino
          </Button>
        </div>
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
function DanceSection({ rolls, setRolls, tapes, setTapes }: { rolls: DanceRoll[]; setRolls: (r: DanceRoll[]) => void; tapes: TapeRoll[]; setTapes: (t: TapeRoll[]) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // mode default = calcolo (catalogo dopo)
  const [mode, setMode] = useState<"calcolo" | "catalogo" | "ordine" | "nastri">("calcolo");
  const [selectedId, setSelectedId] = useState<string>(rolls[0]?.id ?? "");
  const [needThickness, setNeedThickness] = useState<number>(0);
  const [needColor, setNeedColor] = useState<string>("");
  const [stageW, setStageW] = useState<number>(18);
  const [stageH, setStageH] = useState<number>(10);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [direction, setDirection] = useState<StripDirection>("vertical");
  const [chosenColor, setChosenColor] = useState<string>("");
  const [tapeType, setTapeType] = useState<"danza" | "biadesivo">("danza");
  const [chosenOptionKey, setChosenOptionKey] = useState<string | null>(null);

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
    const unit = Number(selected.pricePerSqm ?? 0);
    const cutSurcharge = 1.2;
    const cutStep = 5;
    const w = selected.rollWidth;
    const L = selected.rollLength;

    // Ogni FASCIA richiede `along` metri continui (non spezzabili tra rotoli, salvo along>L).
    // Da un rotolo intero possiamo ricavare floor(L/along) fasce (se along<=L).
    const stripsPerRoll = along > 0 && along <= L ? Math.floor(L / along) : 0;
    const wholePerStripIfBigger = along > L ? Math.ceil(along / L) : 0; // se la fascia non entra in 1 rotolo

    const ceilToStep = (m: number) => (m > 0 ? Math.ceil(m / cutStep) * cutStep : 0);

    type Opt = {
      key: string; label: string;
      wholeRolls: number; cutMeters: number;
      purchasedM: number; purchasedSqm: number; price: number;
      wholePrice: number; cutPrice: number;
      wholeUnit: number; cutUnit: number;
    };
    const options: Opt[] = [];
    const wholeUnit = unit;
    const cutUnit = unit * cutSurcharge;
    const makeOpt = (key: string, label: string, wholeRolls: number, cutMeters: number): Opt => {
      const wholePrice = wholeRolls * L * w * wholeUnit;
      const cutPrice = cutMeters * w * cutUnit;
      const purchasedM = wholeRolls * L + cutMeters;
      return {
        key, label, wholeRolls, cutMeters,
        purchasedM, purchasedSqm: purchasedM * w,
        price: wholePrice + cutPrice,
        wholePrice, cutPrice, wholeUnit, cutUnit,
      };
    };

    // Vincolo fisico: un singolo pezzo "al taglio" non può superare la lunghezza
    // del rotolo (L). Una fascia non si può spezzare tra due pezzi.
    // → cutMeters valido solo se cutMeters <= L E contiene fasce intere
    //   (cutMeters / along >= numero fasce richieste sul taglio).

    if (along <= L && stripsPerRoll >= 1) {
      // A) Solo rotoli interi
      {
        const wholeRolls = Math.ceil(strips / stripsPerRoll);
        options.push(makeOpt("whole", `${wholeRolls} rotolo${wholeRolls === 1 ? "" : "i"} interi`, wholeRolls, 0));
      }
      // B) Solo al taglio: tutte le fasce su un unico pezzo, valido solo se ≤ L
      {
        const cutMeters = ceilToStep(strips * along);
        if (cutMeters > 0 && cutMeters <= L) {
          options.push(makeOpt("cut", `${fmt(cutMeters)} m al taglio`, 0, cutMeters));
        }
      }
      // C) Mix: K rotoli interi + 1 pezzo al taglio per le fasce restanti (≤ L)
      const maxWholeRolls = Math.floor(strips / stripsPerRoll);
      for (let K = 1; K <= maxWholeRolls; K++) {
        const stripsRemain = strips - K * stripsPerRoll;
        if (stripsRemain <= 0) continue;
        const cutMeters = ceilToStep(stripsRemain * along);
        if (cutMeters > L) continue; // pezzo unico al taglio non può superare L
        options.push(makeOpt(
          `mix-${K}`,
          `${K} rotolo${K === 1 ? "" : "i"} intero${K === 1 ? "" : "i"} + ${fmt(cutMeters)} m al taglio`,
          K, cutMeters,
        ));
      }
    } else if (along > L) {
      // Fascia più lunga del rotolo: ogni fascia richiede ceil(along/L) rotoli
      const perStrip = wholePerStripIfBigger;
      const wholeRolls = perStrip * strips;
      options.push(makeOpt("whole", `${wholeRolls} rotoli interi`, wholeRolls, 0));
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

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={mode === "calcolo" ? "default" : "outline"} onClick={() => setMode("calcolo")}>Calcolo & nesting</Button>
        <Button size="sm" variant={mode === "ordine" ? "default" : "outline"} onClick={() => setMode("ordine")}>Ordine manuale</Button>
        <Button size="sm" variant={mode === "catalogo" ? "default" : "outline"} onClick={() => setMode("catalogo")}>Listino tappeti</Button>
        <Button size="sm" variant={mode === "nastri" ? "default" : "outline"} onClick={() => setMode("nastri")}>Listino nastri</Button>
      </div>

      {mode === "ordine" ? (
        <ManualMagazzinoOrderForm
          sourceLabel="Tappeto danza"
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
                        Servono <strong className="text-foreground">{calc.strips} fasce da {fmt(calc.along)} m</strong> · totale {fmt(calc.totalLen)} m lineari × {fmt(selected.rollWidth)} m{calc.stripsPerRoll > 1 ? ` · da 1 rotolo da ${fmt(selected.rollLength)} m si ricavano ${calc.stripsPerRoll} fasce` : ""}
                        <span className="block mt-0.5 italic">Clicca un'opzione per selezionarla manualmente.</span>
                      </div>
                      <div className="divide-y">
                        {calc.options.map((o, i) => {
                          const isSelected = o === calc.best;
                          const isCheapest = o === calc.cheapest;
                          const wholeSqm = o.wholeRolls * selected.rollLength * selected.rollWidth;
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
                                    <span>· {o.wholeRolls} rotolo{o.wholeRolls === 1 ? "" : "i"} intero{o.wholeRolls === 1 ? "" : "i"} mt {fmt(selected.rollLength)}×{fmt(selected.rollWidth)} = {fmt(wholeSqm)} m² @ {eur(o.wholeUnit)}/m²</span>
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

                    {/* Invia al Flow: ordine magazzino con override manuale */}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
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
                        <PackageCheck className="w-4 h-4 mr-2" />
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
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={mode === "calcolo" ? "default" : "outline"} onClick={() => setMode("calcolo")}>Richiesta cliente & calcolo</Button>
        <Button size="sm" variant={mode === "ordine" ? "default" : "outline"} onClick={() => setMode("ordine")}>Ordine manuale</Button>
        <Button size="sm" variant={mode === "catalogo" ? "default" : "outline"} onClick={() => setMode("catalogo")}>Listino vernici</Button>
      </div>

      {mode === "ordine" ? (
        <ManualMagazzinoOrderForm
          sourceLabel="Vernice ignifuga"
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

/* ============== Sezione vendita prodotti (stampa / tessuti) =============
   I listini coincidono con quelli del reparto: "stampa" usa il listino del
   Laboratorio, "tessuti" usa il listino della Tappezzeria. Le modifiche al
   catalogo si fanno dalle pagine reparto. */
type SaleCategory = "stampa" | "tessuti";
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
  const sellOf = (m: any): number => {
    if (!m) return 0;
    const base = Number(m.priceCut) || Number(m.pricePiece) || 0;
    if (typeof m.costPrice === "number") return base; // tappezzeria: prezzo già di vendita
    const markup = Number(catalog?.markupPct ?? 0);
    return base * (1 + markup / 100);
  };

  const selected = variants.find((v: any) => v.id === variantId) ?? variants[0];

  const lineTotal = (line: CartLine) => {
    const m = materials.find((x: any) => x.id === line.materialId);
    // Se il catalogo non ha il materiale (es. carrello caricato prima del
    // fetch del catalogo), uso i prezzi salvati nella riga.
    const sell = m ? sellOf(m) * line.qty : (Number(line.priceSell) || 0) * line.qty;
    const purchase = m ? purchaseOf(m) * line.qty : (Number(line.pricePurchase) || 0) * line.qty;
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
      unit: unitOf(selected),
      priceSell: sellOf(selected),
      pricePurchase: purchaseOf(selected),
      category: categoryKey,
    }]);
    setQty(0);
  };

  const onWarehouseConfirm = async (d: WarehouseConfirmData) => {
    if (!user || cart.length === 0) return;
    setSaving(true);
    try {
      const code = await nextOrderCode();
      const noteLines = cart.map((l) => {
        const m = materials.find((x: any) => x.id === l.materialId);
        if (!m) return null;
        return `• ${m.name} (${labelOf(m)}) — ${l.qty} ${unitOf(m)} · vendita ${eur(sellOf(m) * l.qty)}`;
      }).filter(Boolean).join("\n");
      const fullNote = `Vendita ${categoryKey} (solo materiale)\n${noteLines}${orderNote ? `\n\nNote: ${orderNote}` : ""}`;

      const { data: pord, error: e1 } = await supabase
        .from("production_orders")
        .insert({
          code,
          cliente: (cliente || d.production_name || "Cliente").slice(0, 200),
          data: new Date().toISOString().slice(0, 10),
          note: fullNote,
          priorita: "normale",
          delivery: "corriere",
          status: "in_corso",
          attachments: [],
          nesting_included: false,
          created_by: user.id,
          snapshot: { source: "vendite", category: categoryKey, sourceDept, items: cart.map((l) => {
            const m = materials.find((x: any) => x.id === l.materialId);
            return {
              materialId: m?.id,
              name: m?.name,
              variant: m ? labelOf(m) : "",
              qty: l.qty,
              unit: m ? unitOf(m) : defaultUnit,
              priceSell: m ? sellOf(m) : 0,
              pricePurchase: m ? purchaseOf(m) : 0,
            };
          }) } as never,
          customer_order_ref: d.customer_order_ref,
          production_name: d.production_name || null,
        } as any)
        .select()
        .single();
      if (e1) throw e1;

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
          message: `Acquisti — ${code}: ${d.missing.length} materiale/i da ordinare per ${cliente || "vendita"}`,
          order_id: pord.id,
          link: "/produzione/acquisti",
          is_urgent: false,
        });
      }

      const { error: e2 } = await supabase.from("production_sub_orders").insert({
        order_id: pord.id,
        code: subCode(code, SUB_DEPT_SUFFIX["magazzino"], 1),
        dept: "magazzino",
        ordine: (d.missing?.length ?? 0),
        note: `Vendita ${title} · ${d.customer_order_ref}` + (d.missing?.length ? ` · in attesa acquisti (${d.missing.length})` : ""),
        files: [],
        depends_on: firstAcquistiId,
        assignee_id: d.assignee_id,
      } as any);
      if (e2) throw e2;

      await notify({
        userIds: [d.assignee_id],
        type: "magazzino_da_preparare",
        message: d.missing?.length
          ? `In attesa acquisti — ${code} · ${cliente || "vendita"} (${d.missing.length} materiali)`
          : `Da preparare: ${code} · ${cliente || "vendita"} (Ordine ${d.customer_order_ref})`,
        order_id: pord.id,
        link: "/produzione/preparazione",
        is_urgent: false,
      });

      await logAction({
        action: "VENDITA_LANCIATA",
        entity_type: "order",
        entity_id: pord.id,
        detail: `Vendita ${categoryKey} ${code} — rif. cliente ${d.customer_order_ref}`,
        new_state: { code, category: categoryKey, items: cart.length },
      });

      toast.success(`Ordine ${code} creato e inviato al magazzino`);
      setConfirmOpen(false);
      setOrderOpen(false);
      setCart([]);
      setCliente("");
      setOrderNote("");
      navigate("/flow");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore creazione ordine");
    } finally {
      setSaving(false);
    }
  };

  const materialsForDialog = useMemo(() => cart.map((l) => {
    const m = materials.find((x: any) => x.id === l.materialId);
    return {
      key: l.id,
      label: m?.name ?? "—",
      detail: [m ? labelOf(m) : "", `${l.qty} ${m ? unitOf(m) : ""}`].filter(Boolean).join(" · "),
    };
  }), [cart, materials]);

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
                      {selected ? unitOf(selected) : defaultUnit}
                    </span>
                  </div>
                </Field>
              </div>

              {selected && qty > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KPI label="Prezzo unitario" value={`${eur(sellOf(selected))}/${unitOf(selected)}`} hint={purchaseOf(selected) ? `acquisto ${eur(purchaseOf(selected))}` : "vendita"} />
                  <KPI label="Quantità" value={`${fmt(qty)} ${unitOf(selected)}`} hint={labelOf(selected)} />
                  <KPI label="Costo materiale" value={eur(purchaseOf(selected) * qty)} hint="prezzo d'acquisto" />
                  <KPI label="Prezzo vendita" value={eur(sellOf(selected) * qty)} hint="solo materiale, no lavorazione" highlight />
                </div>
              )}

              <div className="flex justify-end">
                <Button size="sm" onClick={addToCart} disabled={!selected || qty <= 0}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi all'ordine
                </Button>
              </div>

              {cart.length > 0 && (
                <div className="border-2 border-ink/15 rounded-sm">
                  <div className="px-3 py-2 bg-muted/40 border-b font-mono text-[10px] uppercase tracking-widest">Carrello ordine ({cart.length})</div>
                  <div className="divide-y">
                    {cart.map((l) => {
                      const t = lineTotal(l);
                      return (
                        <div key={l.id} className="grid grid-cols-[1fr,80px,100px,32px] gap-2 px-3 py-2 text-[12px] items-center">
                          <div>
                            <strong>{t.material?.name ?? "—"}</strong>
                            {t.material && <span className="text-muted-foreground"> · {labelOf(t.material)}</span>}
                          </div>
                          <div className="text-right font-mono">{fmt(l.qty)} {t.material ? unitOf(t.material) : ""}</div>
                          <div className="text-right font-mono font-bold">{eur(t.sell)}</div>
                          <button onClick={() => setCart(cart.filter((x) => x.id !== l.id))} className="text-ink/40 hover:text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-[1fr,80px,100px,32px] gap-2 px-3 py-2 text-[12px] items-center bg-dept-soft/30">
                      <div className="font-bold">Totale vendita</div>
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
