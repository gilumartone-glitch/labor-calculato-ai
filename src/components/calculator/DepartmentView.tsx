import { AnimatePresence, motion } from "framer-motion";
import { Plus, Wrench, Package, FileSpreadsheet, RotateCcw, Layers3 } from "lucide-react";
import { toast } from "sonner";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { CatalogPanel } from "./CatalogPanel";
import { MaterialRow } from "./MaterialRow";
import { PieceCard } from "./PieceCard";
import { NestingPanel } from "./NestingPanel";
import { InventoryDeptView } from "@/components/produzione/InventoryDeptView";
import { InvDept } from "@/lib/produzione/types";
import { Catalog, DepartmentState, MaterialLine, PieceLine, SubProject, TransportLine } from "./types";
import { eur } from "@/lib/format";
import { uid } from "@/lib/format";
import {
  pieceTotal,
  aggregateWorkBreakdown,
  pieceMaterialTotalQty,
  aggregateScrapDeduction,
  pieceScrapKey,
  pieceInitialScrapSellCost,
  pieceLeftoverScrapSellCost,
  pieceMaterialTotal,
  pieceWorkBreakdown,
} from "@/lib/piece";
import {
  computeNesting,
  piecesOfGroup,
  buildPieceIndexMap,
  getNestingConfig,
  recomputeGroupWithOverride,
  recomputeGroupWithMixedBins,
} from "@/lib/nesting";
import { materialAwareCatalog, withoutInitialScrap } from "@/lib/piece-catalog";
import { CustomerType, CUSTOMER_LABEL, priceMultiplier } from "@/lib/pricing";
import { CreateCommessaButton } from "./CreateCommessaButton";
import { CommessaReparto } from "@/components/flow/types";
import { copyLabDimensions, findLabDimensionSource } from "@/lib/lab-sync";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { mmToCm, mToCm } from "@/lib/fmt";

interface DepartmentViewProps {
  deptKey: string;
  deptLabel: string;
  description: string;
  catalog: Catalog;
  setCatalog: (c: Catalog) => void;
  state: DepartmentState;
  setState: (s: DepartmentState) => void;
  templateUrl: string;
  templateName: string;
  customerType: CustomerType;
  /** Catalogo del reparto Laboratorio: usato per risolvere il materiale dei
   *  pezzi marcati con `materialFromLab`. Default = `catalog`. */
  labCatalog?: Catalog;
  labPieces?: PieceLine[];
  /** Sub-progetti ("prodotti finiti") del progetto madre. Se assenti/vuoti,
   *  tutti i pezzi restano in un unico gruppo implicito "Generale". */
  subProjects?: SubProject[];
  activeSubProjectId?: string | null;
}

export const DepartmentView = ({
  deptKey, deptLabel, description, catalog, setCatalog,
  state, setState, templateUrl, templateName, customerType, labCatalog, labPieces = [],
  subProjects = [], activeSubProjectId = null,
}: DepartmentViewProps) => {
  // Tappezzeria: lo sfrido iniziale del rotolo NON viene addebitato (prezzi
  // di vendita manuali già includono lo sfrido). Wrappiamo il catalogo per
  // questo reparto in modo che computePieceMaterial salti lo sfrido iniziale.
  const matCat = (p: PieceLine): Catalog => {
    const base = materialAwareCatalog(p, catalog, labCatalog);
    return deptKey === "tappezzeria" ? withoutInitialScrap(base) : base;
  };
  const materialsTotal = state.materials.reduce(
    (s, m) => s + m.quantity * m.unitCost, 0
  );
  const allPieces = state.pieces ?? [];
  // Se un sub-progetto è attivo, TUTTI i calcoli e la vista del reparto sono
  // limitati alle lavorazioni di quel prodotto finito. Su "Tutti" (activeSubProjectId=null)
  // si vedono tutte, raggruppate. Le mutazioni di stato usano `allPieces` per non
  // perdere i pezzi degli altri sub-progetti.
  // activeSubProjectId può essere:
  //  - null          → mostra tutti i pezzi (raggruppati per sub-progetto)
  //  - "__none__"    → mostra SOLO i pezzi "Generale" (senza sub-progetto)
  //  - <id>          → mostra SOLO i pezzi di quel sub-progetto
  const matchesActive = (p: PieceLine) => {
    if (!activeSubProjectId) return true;
    if (activeSubProjectId === "__none__") return !p.subProjectId;
    return (p.subProjectId ?? null) === activeSubProjectId;
  };
  const pieces = activeSubProjectId ? allPieces.filter(matchesActive) : allPieces;
  // I calcoli pesanti (nesting/prezzi riepilogo) vengono aggiornati a bassa priorità:
  // mentre l'utente digita nelle box la card resta fluida e il totale si riallinea subito dopo.
  const calcPieces = useDeferredValue(pieces);
  const inScope = matchesActive;

  // ---- Nesting per gruppo materiale (per "Lastre per materiale" + sfrido addebitabile) ----
  // Uso un catalogo "uniforme": stessa logica per tutti i pezzi del gruppo.
  // Tappezzeria salta lo sfrido iniziale (coerente con la card pezzo).
  // Il catalogo deve includere le STESSE impostazioni usate dal pannello Nesting
  // (fresa, margine perimetrale, "tutti i pezzi nella stessa pezza"), altrimenti
  // il totale del reparto non coincide col costo calcolato dal nesting.
  const nestSettings = state.nestingState?.settings;
  const nestingCatalog = useMemo(
    () => ({
      ...(deptKey === "tappezzeria" ? withoutInitialScrap(catalog) : catalog),
      __kerfMm: nestSettings?.kerfMm ?? 0,
      __perimeterMarginMm: nestSettings?.perimeterMm ?? 10,
      __skipPerimeterMargin: !!nestSettings?.skipPerimeter,
      __forceSinglePiece: !!nestSettings?.forceSinglePiece,
    }),
    [
      deptKey,
      catalog,
      nestSettings?.kerfMm,
      nestSettings?.perimeterMm,
      nestSettings?.skipPerimeter,
      nestSettings?.forceSinglePiece,
    ],
  );
  // Applico anche override formato / bin misti scelti nel pannello Nesting.
  const nestingOverrides = state.nestingState?.overrides ?? {};
  const nestingMixedBins = state.nestingState?.mixedBins ?? {};
  const nestingGroups = useMemo(() => {
    const base = computeNesting(calcPieces, nestingCatalog, customerType);
    const indexMap = buildPieceIndexMap(calcPieces);
    const perimeterM = getNestingConfig(nestingCatalog).perimeterM;
    return base.map((g) => {
      const mb = nestingMixedBins[g.key];
      if (mb && mb.length > 0) {
        return recomputeGroupWithMixedBins(
          g,
          piecesOfGroup(calcPieces, g.key),
          mb,
          indexMap,
          perimeterM,
          nestingCatalog,
        );
      }
      const ov = nestingOverrides[g.key];
      if (!ov || !(ov.widthM > 0) || !(ov.heightM > 0)) return g;
      const overridden = recomputeGroupWithOverride(
        g,
        piecesOfGroup(calcPieces, g.key),
        nestingCatalog,
        ov,
        indexMap,
        customerType,
      );
      if (ov.source === "catalog" && overridden.unplaced.length > 0 && g.unplaced.length === 0) return g;
      return overridden;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcPieces, nestingCatalog, customerType, state.nestingState?.overrides, state.nestingState?.mixedBins]);
  const chargeNestingScrap = state.nestingState?.chargeNestingScrap ?? {};
  // Gruppi su cui è possibile addebitare lo sfrido del nesting.
  // - LASTRA: sempre (lo sfrido per-lastra ha senso ovunque).
  // - ROTOLO: solo in Tappezzeria, dove l'utente vuole poter fatturare il
  //   tessuto effettivamente srotolato (consumo nesting) anziché la sola
  //   somma delle aree teoriche dei pezzi.
  const lastraGroups = nestingGroups.filter(
    (g) => g.format === "lastra" || (deptKey === "tappezzeria" && g.format === "rotolo"),
  );
  /** Per ogni gruppo lastra: costo extra dello sfrido addebitato (€). */
  const nestingScrapExtraByGroup: Record<string, number> = {};
  for (const g of lastraGroups) {
    if (!chargeNestingScrap[g.key]) continue;
    const leftoverM2 = Math.max(0, g.totalAreaM2 - g.usedAreaM2);
    const sellPerSqm =
      g.totalAreaM2 > 0 ? g.materialCostOptimized / g.totalAreaM2 : 0;
    nestingScrapExtraByGroup[g.key] = leftoverM2 * sellPerSqm;
  }
  const nestingScrapExtra = Object.values(nestingScrapExtraByGroup).reduce(
    (s, v) => s + v,
    0,
  );

  // Distribuzione dello sfrido nesting (per gruppo lastra flaggato) sui pezzi
  // del gruppo, in proporzione all'area lavorata (m² × qty). Mappa pieceId → €.
  const nestingScrapByPieceId: Record<string, number> = {};
  {
    const toM = (v: number, u: PieceLine["dimUnit"]) =>
      u === "mm" ? v / 1000 : u === "cm" ? v / 100 : v;
    const areaOf = (p: PieceLine) => {
      const w = toM(Number(p.width) || 0, p.dimUnit);
      const h = toM(Number(p.height) || 0, p.dimUnit);
      const wb = toM(Number(p.widthBottom) || 0, p.dimUnit);
      const a = p.shape === "trapezoid" && wb > 0 ? ((w + wb) / 2) * h : w * h;
      const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
      return a * qty;
    };
    for (const g of lastraGroups) {
      const extra = nestingScrapExtraByGroup[g.key] ?? 0;
      if (extra <= 0) continue;
      const gPieces = piecesOfGroup(calcPieces, g.key);
      const groupPieces = gPieces;
      const weights = groupPieces.map((p) => ({ id: p.id, w: areaOf(p) }));
      const tot = weights.reduce((s, x) => s + x.w, 0);
      if (tot > 0) {
        for (const { id, w } of weights) {
          nestingScrapByPieceId[id] = (nestingScrapByPieceId[id] ?? 0) + extra * (w / tot);
        }
      } else if (weights.length > 0) {
        const share = extra / weights.length;
        for (const { id } of weights) {
          nestingScrapByPieceId[id] = (nestingScrapByPieceId[id] ?? 0) + share;
        }
      }
    }
  }

  // ---- TAPPEZZERIA: ridistribuzione del costo materiale dal nesting sui pezzi ----
  // Per ogni gruppo ROTOLO: il costo materiale totale calcolato dal nesting
  // (materialCostOptimized, che include margini + minimo di fatturazione) viene
  // distribuito proporzionalmente all'area (con margini) di ogni pezzo del gruppo.
  // Mappa: pieceId -> { totalDistributed, single } — dove:
  //   totalDistributed = quota di materiale attribuita al pezzo (per tutte le copie)
  //   single           = totalDistributed / qty (usata nella card come "per copia")
  // La cucitura (seamCost) e lo sfrido iniziale (scrapCost) NON sono ridistribuiti:
  // restano rispettivamente nella lavorazione "Cuciture" della card e — in
  // Tappezzeria — sono già a zero (withoutInitialScrap).
  const isTappezzeria = deptKey === "tappezzeria";
  const bypassRedistribution = !!state.nestingState?.bypassRedistribution;
  const canRedistribute = isTappezzeria && !bypassRedistribution;
  const distributedMaterialByPieceId: Record<string, { total: number; single: number }> = {};
  if (canRedistribute) {
    for (const g of nestingGroups) {
      // Ridistribuisco il costo materiale del nesting per TUTTI i formati
      // (rotoli e lastre): così il totale reparto coincide col costo nesting.
      const fabricPrice =
        (g.materialCostOptimized ?? 0) - (g.seamCost ?? 0) - (g.scrapCost ?? 0);
      const totalArea = g.usedAreaM2;
      if (fabricPrice <= 0 || totalArea <= 0) continue;
      // Area per pezzo (già con margini, dal nesting) — somma di tutte le copie.
      const areaByPiece = new Map<string, number>();
      for (const it of g.items) {
        areaByPiece.set(
          it.pieceId,
          (areaByPiece.get(it.pieceId) ?? 0) + it.w * it.h,
        );
      }
      for (const [pid, a] of areaByPiece) {
        const total = fabricPrice * (a / totalArea);
          const piece = calcPieces.find((p) => p.id === pid);
        const qty = Math.max(1, Math.floor(Number(piece?.quantity) || 1));
        distributedMaterialByPieceId[pid] = { total, single: total / qty };
      }
    }
  }
  const getMaterialOverride = (pieceId: string): number | null =>
    distributedMaterialByPieceId[pieceId]?.single ?? null;

  // Costo materiale effettivo per il pezzo (totale = tutte le copie), rispettando
  // l'eventuale override di ridistribuzione nesting. Include ancora l'eventuale
  // sfrido iniziale (in Tappezzeria è 0 grazie a withoutInitialScrap).
  const effectivePieceMaterialTotalQty = (p: PieceLine): number => {
    const dist = distributedMaterialByPieceId[p.id];
    if (dist != null) return dist.total; // sostituisce il naive
    return pieceMaterialTotalQty(p, matCat(p), customerType);
  };
  // Totale pezzo (materiale + lavorazioni + sfridi + surcharge) con override.
  const effectivePieceTotal = (p: PieceLine): number => {
    const dist = distributedMaterialByPieceId[p.id];
    if (dist == null) return pieceTotal(p, matCat(p), customerType);
    // Ricalcolo: distribuito + lavorazioni per copia × qty. No sfrido iniziale
    // (Tappezzeria) e no leftoverScrap per pezzo (già dentro al nesting).
    const wb = pieceWorkBreakdown(p, matCat(p), customerType); // già × qty
    // pieceWorkBreakdown include lo sfrido pezzo (scrap): in Tappezzeria è 0.
    return dist.total + wb.total;
  };

  const piecesBaseTotal =
    calcPieces.reduce((s, p) => s + effectivePieceTotal(p), 0) -
    // Lo sfrido (1,5 m linerai) si conta una sola volta per stesso materiale: tolgo i duplicati.
    // Quando la ridistribuzione è attiva lo sfrido è già gestito dal nesting → no dedup.
    (canRedistribute
      ? 0
      : aggregateScrapDeduction(
           calcPieces,
          (p) => matCat(p),
          () => customerType,
        )) +
    // Sfrido nesting addebitato (per gruppo lastra flaggato).
    nestingScrapExtra;
  const isStampa = deptKey === "stampa";
  const transportsTotal = (state.transports ?? []).reduce((s, t) => s + t.quantity * t.unitCost, 0);
  // Nel reparto Laboratorio (stampa) il "Totale lavorazioni" include già il
  // nostro margine sul materiale/lavorazioni: il prezzo da proporre al cliente
  // coincide quindi con `piecesBaseTotal`. Negli altri reparti sommiamo anche
  // materiali sciolti e trasporti.
  const total = isStampa
    ? piecesBaseTotal
    : materialsTotal + piecesBaseTotal + transportsTotal;
  const piecesTotal = piecesBaseTotal;

  // Breakdown lavorazioni (somma per categoria su tutti i pezzi)
  const workBreakdown = calcPieces.reduce(
    (acc, p) => {
      const b = aggregateWorkBreakdown([p], matCat(p), customerType);
      acc.stampa += b.stampa;
      acc.taglio += b.taglio;
      acc.perimetrale += b.perimetrale;
      acc.altre += b.altre;
      acc.seam += b.seam;
      acc.custom += b.custom;
      acc.print += b.print;
      acc.scrap += b.scrap;
      acc.total += b.total;
      return acc;
    },
    { stampa: 0, taglio: 0, perimetrale: 0, altre: 0, seam: 0, custom: 0, print: 0, scrap: 0, total: 0 },
  );
  // Materiale "interno ai pezzi" = somma costo materiale × qty (separato dai materiali sciolti)
  const piecesMaterialTotal =
    calcPieces.reduce((s, p) => s + effectivePieceMaterialTotalQty(p), 0) -
    (canRedistribute
      ? 0
      : aggregateScrapDeduction(
          calcPieces,
          (p) => matCat(p),
          () => customerType,
        ));

  // Totale per singolo pezzo. Lo sfrido iniziale (1,5 m lineari) si paga UNA
  // volta sola per gruppo "scrapKey" (stesso materiale/modalità) ma viene
  // RIPARTITO proporzionalmente all'area lavorata (m² × qty) di ciascun pezzo
  // del gruppo. La somma rimane identica al totale del reparto.
  const perPieceTotals = (() => {
    // Helper: area di un singolo pezzo in m² (rect o trapezio)
    const toM = (v: number, u: PieceLine["dimUnit"]) =>
      u === "mm" ? v / 1000 : u === "cm" ? v / 100 : v;
    const areaSqm = (p: PieceLine) => {
      const w = toM(Number(p.width) || 0, p.dimUnit);
      const h = toM(Number(p.height) || 0, p.dimUnit);
      const wb = toM(Number(p.widthBottom) || 0, p.dimUnit);
      return p.shape === "trapezoid" && wb > 0 ? ((w + wb) / 2) * h : w * h;
    };

    // 1) Pre-calcolo per ogni pezzo
    const base = calcPieces.map((p) => {
      const cat = matCat(p);
      const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
      const key = pieceScrapKey(p, cat, customerType);
      const initialScrapFull = pieceInitialScrapSellCost(p, cat, customerType);
      const materialFull = pieceMaterialTotal(p, cat, customerType); // include sfrido iniziale
      const workingMaterialSingle = materialFull - initialScrapFull; // senza sfrido iniziale
      const material = workingMaterialSingle * qty;
      const leftoverScrapSingle = pieceLeftoverScrapSellCost(p, cat, customerType);
      const leftoverScrap = leftoverScrapSingle * qty;
      const wb = pieceWorkBreakdown(p, cat, customerType); // già × qty
      const areaTot = areaSqm(p) * qty;
      return { piece: p, cat, qty, key, initialScrapFull, material, leftoverScrap, wb, areaTot };
    });

    // 2) Per ogni gruppo "scrapKey" prendo lo sfrido pieno (uno solo) e la
    //    somma delle aree lavorate, così posso ripartire proporzionalmente.
    const groupScrap = new Map<string, { totalScrap: number; totalArea: number }>();
    const seenKey = new Set<string>();
    for (const b of base) {
      if (!b.key) continue;
      const g = groupScrap.get(b.key) ?? { totalScrap: 0, totalArea: 0 };
      if (!seenKey.has(b.key)) {
        // sfrido pieno: stesso valore per tutti i pezzi del gruppo, conta una volta
        g.totalScrap = b.initialScrapFull;
        seenKey.add(b.key);
      }
      g.totalArea += b.areaTot;
      groupScrap.set(b.key, g);
    }

    // 3) Distribuisco lo sfrido proporzionalmente. Per i pezzi senza key
    //    (sfrido non applicabile, es. lastre) lo sfrido resta 0.
    return base.map((b) => {
      const override = Number(b.piece.priceOverridePerSqm ?? 0);
      if (override > 0) {
        const total = b.areaTot * override;
        return {
          piece: b.piece,
          qty: b.qty,
          material: total,
          initialScrap: 0,
          leftoverScrap: 0,
          nestingScrap: 0,
          work: { stampa: 0, taglio: 0, perimetrale: 0, altre: 0, seam: 0, custom: 0, print: 0, scrap: 0, total: 0 },
          total,
          overridden: true as const,
        };
      }
      // Se c'è ridistribuzione dal nesting (Tappezzeria), sostituisco il
      // materiale calcolato per-pezzo con la quota nesting e azzero lo sfrido
      // iniziale (già incluso — o assente — nel prezzo del nesting).
      const dist = distributedMaterialByPieceId[b.piece.id];
      let material = b.material;
      let initialScrap = 0;
      let leftoverScrap = b.leftoverScrap;
      if (dist != null) {
        material = dist.total;
        leftoverScrap = 0; // già dentro al nesting
      } else if (b.key) {
        const g = groupScrap.get(b.key);
        if (g && g.totalArea > 0) {
          initialScrap = (b.areaTot / g.totalArea) * g.totalScrap;
        } else {
          // fallback: nessuna area utile → resta sul primo pezzo
          initialScrap = b.initialScrapFull;
        }
      }
      const nestingScrap = nestingScrapByPieceId[b.piece.id] ?? 0;
      const total = material + initialScrap + b.wb.total + nestingScrap;
      return {
        piece: b.piece,
        qty: b.qty,
        material,
        initialScrap,
        leftoverScrap,
        nestingScrap,
        work: b.wb,
        total,
        overridden: false as const,
      };
    });
  })();

  /** Numero totale di pezzi fisici nel reparto: somma delle `quantity` (default 1)
   *  di ogni card di lavorazione. Es. 2 card con qty 8 ciascuna ⇒ 16 pezzi. */
  const totalPiecesQty = pieces.reduce(
    (s, p) => s + Math.max(1, Math.floor(Number(p.quantity) || 1)),
    0,
  );

  type Tab = "lavorazioni" | "nesting" | "magazzino" | "listini";
  const [tab, setTab] = useState<Tab>("lavorazioni");
  const currentOverride = pieces.find((p) => Number(p.priceOverridePerSqm ?? 0) > 0)?.priceOverridePerSqm ?? null;
  const [levelInput, setLevelInput] = useState<string>(currentOverride ? String(currentOverride) : "");
  const hasOverride = pieces.some((p) => Number(p.priceOverridePerSqm ?? 0) > 0);
  // Ultimo pezzo aggiunto: la PieceCard corrispondente porta il focus sul campo Qt.
  const [lastAddedPieceId, setLastAddedPieceId] = useState<string | null>(null);
  // Ref sulla sezione Lavorazioni per intercettare Frecce Su/Giù come Tab/Shift+Tab.
  const lavorazioniRef = useRef<HTMLElement | null>(null);
  const onLavorazioniKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return;
    if (tag === "TEXTAREA") return; // dentro textarea le frecce navigano il testo
    const root = lavorazioniRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select:not([disabled])',
      ),
    ).filter((el) => el.tabIndex !== -1 && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const idx = focusables.indexOf(target);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? focusables[idx + 1] : focusables[idx - 1];
    if (!next) return;
    next.focus();
    if (next instanceof HTMLInputElement && (next.type === "text" || next.type === "number" || next.type === "search")) {
      try { next.select(); } catch { /* no-op */ }
    }
  };

  const applyLevelPrice = () => {
    const v = parseFloat(levelInput.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("Inserisci un €/m² valido");
      return;
    }
    setState({
      ...state,
      pieces: allPieces.map((p) => (inScope(p) ? { ...p, priceOverridePerSqm: v } : p)),
    });
    toast.success(`Prezzi livellati a ${v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/m²`);
  };

  const resetLevelPrice = () => {
    setState({
      ...state,
      pieces: allPieces.map((p) => (inScope(p) ? { ...p, priceOverridePerSqm: null } : p)),
    });
    setLevelInput("");
    toast.success("Prezzi ripristinati al calcolo automatico");
  };

  const addMaterial = () => {
    const newLine: MaterialLine = {
      id: uid(),
      catalogId: null,
      name: "",
      weight: "",
      color: "",
      height: "",
      heightUnit: "cm",
      composition: "",
      fireproof: "",
      unit: "m",
      priceMode: "cut",
      quantity: 0,
      unitCost: 0,
    };
    setState({ ...state, materials: [...state.materials, newLine] });
  };

  const addTransport = () => {
    const newLine: TransportLine = { id: uid(), description: "Trasporto", quantity: 1, unitCost: 0 };
    setState({ ...state, transports: [...(state.transports ?? []), newLine] });
  };

  const addPiece = () => {
    // Nel Laboratorio (stampa) non pre-compilare il prodotto: il listino è lungo
    // e il default cadeva sempre su MDF (prima voce). Meglio lasciare vuoto.
    const autoFill = deptKey !== "stampa";
    const firstName = autoFill ? (catalog.materials.find((m) => m.name.trim())?.name ?? "") : "";
    const variantsForProduct = autoFill ? catalog.materials.filter((m) => m.name === firstName) : [];
    const pickFirst = (values: (string | undefined)[], allowEmpty = false) => {
      const cleaned = values.map((v) => v ?? "");
      const preferred = cleaned.find((v) => v.trim());
      return preferred ?? (allowEmpty ? cleaned[0] ?? "" : "");
    };
    const firstColor = autoFill ? pickFirst(variantsForProduct.map((m) => m.color)) : "";
    const variantsForColor = variantsForProduct.filter((m) => !firstColor || m.color === firstColor);
    const firstFireproof = autoFill ? pickFirst(variantsForColor.map((m) => m.fireproof), true) : "";
    const variantsForFireproof = variantsForColor.filter((m) => !firstFireproof || m.fireproof === firstFireproof);
    const firstThickness = autoFill ? pickFirst(variantsForFireproof.map((m) => m.thickness)) : "";
    const variantsForThickness = variantsForFireproof.filter((m) => !firstThickness || (m.thickness ?? "") === firstThickness);
    const firstFinish = autoFill ? pickFirst(variantsForThickness.map((m) => m.finish)) : "";
    const newLine: PieceLine = {
      id: uid(),
      productName: firstName,
      color: firstColor,
      fireproof: firstFireproof,
      matchedHeight: "",
      matchedHeightUnit: "cm",
      catalogMaterialId: null,
      thickness: firstThickness,
      finish: firstFinish,
      priceMode: "cut",
      materialQty: 0,
      width: 0,
      height: 0,
      dimUnit: "cm",
      perimeters: [],
      // Per Stampa la rotazione è quasi sempre auspicabile (non c'è "verso" del tessuto):
      // attiva di default così il nesting può girare il pezzo per ridurre lo sfrido.
      allowRotation: deptKey === "stampa",
      // Per Stampa/Laboratorio le misure sono finali: nessun margine di lavorazione.
      noMargins: deptKey === "stampa",
      subProjectId: activeSubProjectId && activeSubProjectId !== "__none__" ? activeSubProjectId : null,
    };
    setState({ ...state, pieces: [...allPieces, newLine] });
    setLastAddedPieceId(newLine.id);
  };

  const copyLastPiece = () => {
    if (pieces.length === 0) {
      addPiece();
      return;
    }
    const last = pieces[pieces.length - 1];
    const copy: PieceLine = {
      ...last,
      id: uid(),
      width: 0,
      height: 0,
      widthBottom: undefined,
      materialQty: 0,
      // Mantieni perimetri/lavorazioni ma rigenera gli ID per evitare collisioni
      perimeters: (last.perimeters ?? []).map((pp) => ({ ...pp, id: uid() })),
      customWorks: (last.customWorks ?? []).map((cw) => ({ ...cw, id: uid() })),
    };
    setState({ ...state, pieces: [...allPieces, copy] });
    setLastAddedPieceId(copy.id);
  };

  return (
    <div className="space-y-6">
      {/* Header reparto */}
      <div className="flex items-end justify-between gap-6 pb-4 border-b-2 border-ink">
        <div>
          <h2 className="font-display text-3xl md:text-4xl font-semibold leading-none">
            {deptLabel}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">{description}</p>
          {/* Riv/Fin: visibile solo nel reparto Laboratorio (stampa). */}
          {isStampa && (
            <div className="mt-2 inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
              <span className="text-muted-foreground">Listino vendita:</span>
              <span className="px-1.5 py-0.5 bg-ink text-paper rounded-sm font-semibold">
                {CUSTOMER_LABEL[customerType]}
              </span>
              <span className="text-muted-foreground">
                intero ×{priceMultiplier(customerType, "piece")} · taglio ×{priceMultiplier(customerType, "cut")}
              </span>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="label-cap mb-1">Totale reparto</div>
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {eur(total)}
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-2">
            <CreateCommessaButton
              label="In Flow"
              defaultTitle={`${deptLabel} · ${new Date().toLocaleDateString("it-IT")}`}
              defaultAmount={total}
              defaultReparto={deptKey as CommessaReparto}
              snapshot={{
                source: "department",
                deptKey,
                deptLabel,
                customerType,
                totals: { materials: materialsTotal, pieces: piecesTotal, total },
                workBreakdown,
                state,
                catalog,
              }}
              variant="subtle"
              disabled={total === 0}
            />
            <button
              type="button"
              onClick={() => {
              const hasData =
                pieces.length > 0 ||
                state.materials.length > 0 ||
                state.operations.length > 0 ||
                (state.perimeters?.length ?? 0) > 0;
              if (!hasData) return;
              if (window.confirm(`Azzerare tutto il reparto "${deptLabel}"?\nVerranno rimossi pezzi, materiali e lavorazioni inseriti.\n(Il listino non viene toccato)`)) {
                setState({ materials: [], operations: [], perimeters: [], pieces: [], transports: [] });
                toast.success(`Reparto "${deptLabel}" azzerato`);
              }
            }}
              className="inline-flex items-center gap-1.5 px-2 py-1 border border-ink/30 rounded-sm text-[10px] uppercase tracking-wider font-semibold text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
              title="Reset reparto"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />{deptLabel}</CardTitle>
          <div role="tablist" aria-label="Sezioni reparto" className="flex flex-wrap gap-2">
            {([
              { k: "lavorazioni" as const, label: "Lavorazioni", icon: Wrench, show: true },
              { k: "nesting" as const, label: "Nesting", icon: Layers3, show: isStampa || deptKey === "tappezzeria" },
              { k: "magazzino" as const, label: "Magazzino", icon: Package, show: true },
              { k: "listini" as const, label: "Listini", icon: FileSpreadsheet, show: true },
            ]).filter((t) => t.show).map(({ k, label, icon: Icon }) => (
              <Button key={k} type="button" size="sm" variant={tab === k ? "default" : "outline"} role="tab" aria-selected={tab === k} onClick={() => setTab(k as Tab)}>
                <Icon className="h-4 w-4" />{label}
              </Button>
            ))}
          </div>
        </CardHeader>
      </Card>

      {/* === Tab: LAVORAZIONI === */}
      {tab === "lavorazioni" && (
        <motion.div
          key="lav"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* Card riepilogo */}
          <div className="panel p-5 bg-muted/20">
            <div className="flex items-baseline justify-between mb-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">Resoconto</span>
                <h4 className="font-display text-lg font-semibold leading-none">Lavorazioni del reparto</h4>
              </div>
              <div className="text-right">
                <div className="label-cap mb-0.5">Totale lavorazioni</div>
                <div className="font-mono text-xl font-semibold tabular-nums">{eur(piecesTotal)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 font-mono text-[11px]">
              <SummaryStat label="Materiale pezzi" value={piecesMaterialTotal} />
              {(isStampa || workBreakdown.stampa + workBreakdown.print > 0) && (
                <SummaryStat label="Stampa" value={workBreakdown.stampa + workBreakdown.print} />
              )}
              {(isStampa || workBreakdown.taglio > 0) && (
                <SummaryStat label="Taglio" value={workBreakdown.taglio} />
              )}
              {workBreakdown.perimetrale > 0 && (
                <SummaryStat label="Perimetrali" value={workBreakdown.perimetrale} />
              )}
              {workBreakdown.altre > 0 && <SummaryStat label="Altre" value={workBreakdown.altre} />}
              {!isStampa && workBreakdown.seam > 0 && (
                <SummaryStat label="Cuciture" value={workBreakdown.seam} />
              )}
              {workBreakdown.custom > 0 && <SummaryStat label="Custom" value={workBreakdown.custom} />}
              {workBreakdown.scrap > 0 && (
                <SummaryStat label="Scarto" value={workBreakdown.scrap} />
              )}
              <SummaryStat label="N. pezzi" value={totalPiecesQty} unit="pezzi" />
            </div>

            {/* Tessuti / Lastre per materiale */}
            {lastraGroups.length > 0 && (
              <div className="mt-4 pt-4 border-t border-ink/10">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="font-display text-base font-semibold">
                    {isTappezzeria ? "Tessuti" : "Lastre per materiale"}
                  </div>
                  {isTappezzeria && nestingGroups.some((g) => g.format === "rotolo") && (
                    <label
                      className="inline-flex items-center gap-2 cursor-pointer select-none text-sm"
                      title="Se attivo, ogni pezzo viene calcolato singolarmente (senza nesting). Se disattivo, il costo del tessuto calcolato dal nesting viene distribuito proporzionalmente sui pezzi."
                    >
                      <input
                        type="checkbox"
                        checked={bypassRedistribution}
                        onChange={(e) =>
                          setState({
                            ...state,
                            nestingState: {
                              ...(state.nestingState ?? {}),
                              bypassRedistribution: e.target.checked,
                            },
                          })
                        }
                        className="w-4 h-4"
                      />
                      <span className="font-medium">
                        Bypassa nesting (calcolo per singolo pezzo)
                      </span>
                    </label>
                  )}
                </div>
                <div className="space-y-2">
                  {lastraGroups.map((g) => {
                    const isRoll = g.format === "rotolo";
                    const sheets = g.sheetsNeeded ?? 0;
                    const leftoverM2 = Math.max(0, g.totalAreaM2 - g.usedAreaM2);
                    const sellPerSqm =
                      g.totalAreaM2 > 0
                        ? g.materialCostOptimized / g.totalAreaM2
                        : 0;
                    const extra = leftoverM2 * sellPerSqm;
                    const checked = !!chargeNestingScrap[g.key];
                    // In Tappezzeria la ridistribuzione nesting è automatica →
                    // niente checkbox "Addebita sfrido" per gruppo. Resta invece
                    // per i gruppi lastra degli altri reparti.
                    const showAddebitaSfrido = !isTappezzeria;
                    const dim = isRoll
                      ? ` · rotolo h ${mToCm(g.rollWidthM ?? 0)} cm × ${(g.totalLengthM ?? 0).toFixed(2)} m`
                      : g.sheetWidthM && g.sheetHeightM
                        ? ` · ${mToCm(g.sheetWidthM)}×${mToCm(g.sheetHeightM)} cm`
                        : "";
                    return (
                      <div
                        key={g.key}
                        className="flex items-center justify-between gap-4 p-3 border border-ink/15 rounded-sm bg-paper text-sm"
                      >
                        <div className="flex-1 min-w-0 truncate">
                          <span className="font-semibold">{g.label}</span>
                          <span className="text-muted-foreground">{dim}</span>
                          {subProjects.length > 0 && (() => {
                            const gp = piecesOfGroup(pieces, g.key);
                            const ids = Array.from(new Set(gp.map((p) => p.subProjectId ?? "")));
                            const names = ids
                              .map((id) => id ? (subProjects.find((s) => s.id === id)?.name ?? "?") : "Generale")
                              .sort((a, b) => a.localeCompare(b, "it"));
                            if (names.length === 0) return null;
                            return (
                              <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                                {names.map((n) => (
                                  <span key={n} className="px-1.5 py-0.5 bg-accent/40 text-ink rounded-sm text-[10px] uppercase tracking-wider">
                                    {n}
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-5 shrink-0">
                          {isRoll ? (
                            <span className="tabular-nums">
                              <strong>{(g.totalLengthM ?? 0).toFixed(2)}</strong>{" "}
                              <span className="text-muted-foreground">m lineari</span>
                            </span>
                          ) : (
                            <span className="tabular-nums">
                              <strong>{sheets}</strong>{" "}
                              <span className="text-muted-foreground">lastre</span>
                            </span>
                          )}
                          <span className="tabular-nums text-muted-foreground">
                            sfrido {leftoverM2.toFixed(2)} m²
                          </span>
                          <span className="tabular-nums font-semibold">
                            {eur(g.materialCostOptimized)}
                          </span>
                          {showAddebitaSfrido && (
                            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setState({
                                    ...state,
                                    nestingState: {
                                      ...(state.nestingState ?? {}),
                                      chargeNestingScrap: {
                                        ...(state.nestingState
                                          ?.chargeNestingScrap ?? {}),
                                        [g.key]: e.target.checked,
                                      },
                                    },
                                  })
                                }
                                className="w-4 h-4"
                              />
                              <span>Addebita sfrido</span>
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {perPieceTotals.length > 0 && (
              <div className="mt-4 pt-4 border-t border-ink/10">
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                  <div className="font-display text-base font-semibold">Prezzo per lavorazione</div>
                  <div className="flex items-end gap-2 text-sm">
                    <div className="flex flex-col">
                      <label className="text-xs text-muted-foreground mb-1 font-medium">
                        Livella €/m² su tutti i pezzi
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder="es. 19,90"
                          value={levelInput}
                          onChange={(e) => setLevelInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") applyLevelPrice(); }}
                          className="h-9 w-32 px-2 border border-input rounded-sm bg-paper tabular-nums text-sm"
                        />
                        <Button size="sm" variant="default" className="h-9 px-3 text-sm" onClick={applyLevelPrice}>
                          Applica
                        </Button>
                        {hasOverride && (
                          <Button size="sm" variant="outline" className="h-9 px-3 text-sm" onClick={resetLevelPrice}>
                            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Ripristina
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {hasOverride && (
                  <div className="mb-3 px-3 py-2 bg-primary/10 border border-primary/30 rounded-sm text-sm text-primary">
                    Prezzi livellati: il totale di ogni pezzo è area × €/m² impostato, ignorando materiale/lavorazioni/sfridi.
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {perPieceTotals.map(
                    ({ piece, qty, material, initialScrap, leftoverScrap, nestingScrap, work, total, overridden }, i) => {
                      const name = piece.productName?.trim() || `Pezzo ${i + 1}`;
                      const sfrido = initialScrap;
                      const scarto = work.scrap;
                      const lavorazione = work.total - scarto;
                      const rows: { label: string; value: number }[] = overridden
                        ? [{ label: "Prezzo livellato", value: material }]
                        : [
                            { label: "Materiale", value: material },
                            { label: "Sfrido iniziale", value: sfrido },
                            { label: "Sfrido lastre", value: nestingScrap },
                            { label: "Lavorazione", value: lavorazione },
                            { label: "Scarto", value: scarto },
                          ].filter((r) => r.label === "Materiale" || Math.abs(r.value) > 0.005);
                      const unitPrice = qty > 0 ? total / qty : total;
                      const toM = (v: number) =>
                        piece.dimUnit === "mm"
                          ? v / 1000
                          : piece.dimUnit === "cm"
                            ? v / 100
                            : v;
                      const wM = toM(Number(piece.width) || 0);
                      const hM = toM(Number(piece.height) || 0);
                      const wbM = toM(Number(piece.widthBottom) || 0);
                      const areaM2 =
                        piece.shape === "trapezoid" && wbM > 0
                          ? ((wM + wbM) / 2) * hM
                          : wM * hM;
                      const pricePerSqm = areaM2 > 0 ? unitPrice / areaM2 : 0;
                      const fmtDim = (v: number) =>
                        Number.isInteger(v)
                          ? String(v)
                          : v.toLocaleString("it-IT", { maximumFractionDigits: 2 });
                      const dimLabel =
                        piece.shape === "trapezoid" && Number(piece.widthBottom) > 0
                          ? `${fmtDim(piece.width)}/${fmtDim(piece.widthBottom)}×${fmtDim(piece.height)} ${piece.dimUnit}`
                          : Number(piece.width) > 0 && Number(piece.height) > 0
                            ? `${fmtDim(piece.width)}×${fmtDim(piece.height)} ${piece.dimUnit}`
                            : "";
                      return (
                        <button
                          key={piece.id}
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(`piece-${piece.id}`);
                            if (el) {
                              el.scrollIntoView({ behavior: "smooth", block: "start" });
                              el.classList.add("ring-2", "ring-primary");
                              setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1600);
                            }
                          }}
                          className="w-full text-left border border-ink/15 rounded-sm bg-paper p-3.5 text-sm hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
                          title="Vai alla lavorazione"
                        >
                          <div className="flex items-center justify-between mb-2 pb-2 border-b border-ink/10 gap-2">
                            <span className="text-muted-foreground truncate">
                              <span className="font-semibold text-ink">#{i + 1}</span> · {name}
                              {qty > 1 ? ` ×${qty}` : ""}
                              {dimLabel && (
                                <span className="ml-1.5 text-ink/70">· {dimLabel}</span>
                              )}
                              {subProjects.length > 0 && (() => {
                                const sp = subProjects.find((s) => s.id === piece.subProjectId);
                                const spName = sp?.name ?? "Generale";
                                return (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-accent/40 text-ink rounded-sm text-xs uppercase tracking-wider">
                                    {spName}
                                  </span>
                                );
                              })()}
                              {overridden && (
                                <span className="ml-1.5 px-1.5 py-0.5 bg-primary/15 text-primary rounded-sm text-xs uppercase tracking-wider">
                                  livellato
                                </span>
                              )}
                            </span>
                            <span className="font-semibold tabular-nums text-base shrink-0">{eur(total)}</span>
                          </div>
                          <div className="space-y-1">
                            {rows.map((r, idx) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span>{r.label}</span>
                                <span className="tabular-nums font-medium">{eur(r.value)}</span>
                              </div>
                            ))}
                          </div>
                          {(qty > 1 || pricePerSqm > 0) && (
                            <div className="mt-2 pt-2 border-t border-ink/10 space-y-1 text-primary">
                              {qty > 1 && (
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">
                                    Prezzo unitario ({qty} pz)
                                  </span>
                                  <span className="tabular-nums font-semibold">
                                    {eur(unitPrice)}
                                  </span>
                                </div>
                              )}
                              {pricePerSqm > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">
                                    Prezzo al m² ({areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²)
                                  </span>
                                  <span className="tabular-nums font-semibold">
                                    {eur(pricePerSqm)}/m²
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            )}
          </div>



          <section ref={lavorazioniRef} onKeyDown={onLavorazioniKeyDown} className="panel p-6">
            <header className="flex items-start justify-between gap-6 mb-5">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-xs text-primary font-bold tracking-widest">§02</span>
                <div>
                  <h3 className="font-display text-2xl font-semibold leading-none mb-1">Lavorazioni</h3>
                  <p className="text-xs text-muted-foreground">
                    Ogni pezzo: tipo prodotto + colore + ignifugo, dimensioni con altezza auto-selezionata dal listino, disegno tecnico e lavorazioni perimetrali.
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="label-cap mb-1">Subtotale</div>
                <div className="font-mono text-xl font-semibold tabular-nums">{eur(piecesTotal)}</div>
              </div>
            </header>
            <div className="rule-line mb-3" />

            {(() => {
              // Filtro per sub-progetto attivo: se null mostro tutti.
              // Se activeSubProjectId punta a un sub-progetto, mostro SOLO quello + un
              // "Aggiungi" scoped. Se null, mostro tutti raggruppati per sub-progetto.
              const groupsToRender: { key: string; label: string; subId: string | null; items: PieceLine[] }[] = [];
              if (activeSubProjectId === "__none__") {
                groupsToRender.push({
                  key: "__none__",
                  label: "Generale",
                  subId: null,
                  items: pieces.filter((p) => !p.subProjectId),
                });
              } else if (activeSubProjectId) {
                const sp = subProjects.find((s) => s.id === activeSubProjectId);
                groupsToRender.push({
                  key: activeSubProjectId,
                  label: sp?.name ?? "Prodotto",
                  subId: activeSubProjectId,
                  items: pieces.filter((p) => (p.subProjectId ?? null) === activeSubProjectId),
                });
              } else if (subProjects.length > 0) {
                const generalItems = pieces.filter((p) => !p.subProjectId);
                if (generalItems.length > 0) {
                  groupsToRender.push({ key: "__none__", label: "Generale", subId: null, items: generalItems });
                }
                subProjects.slice().sort((a, b) => a.order - b.order).forEach((s) => {
                  groupsToRender.push({
                    key: s.id, label: s.name, subId: s.id,
                    items: pieces.filter((p) => p.subProjectId === s.id),
                  });
                });
              } else {
                groupsToRender.push({ key: "__all__", label: "", subId: null, items: pieces });
              }

              // seenScrap va calcolato sul TOTALE pezzi (non per gruppo) per coerenza col totale reparto.
              const seenScrap = new Set<string>();
              const addPieceForSub = (subId: string | null) => {
                // clone di addPiece con override subProjectId
                const autoFill = deptKey !== "stampa";
                const firstName = autoFill ? (catalog.materials.find((m) => m.name.trim())?.name ?? "") : "";
                const newLine: PieceLine = {
                  id: uid(),
                  productName: firstName,
                  color: "",
                  fireproof: "",
                  matchedHeight: "",
                  matchedHeightUnit: "cm",
                  catalogMaterialId: null,
                  thickness: "",
                  finish: "",
                  priceMode: "cut",
                  materialQty: 0,
                  width: 0,
                  height: 0,
                  dimUnit: "cm",
                  perimeters: [],
                  allowRotation: deptKey === "stampa",
                  noMargins: deptKey === "stampa",
                  subProjectId: subId,
                };
                setState({ ...state, pieces: [...allPieces, newLine] });
                setLastAddedPieceId(newLine.id);
              };

              const showGroupHeaders = subProjects.length > 0 && !activeSubProjectId;

              return (
                <>
                  {groupsToRender.map((g) => (
                    <div key={g.key} className={showGroupHeaders || activeSubProjectId ? "mb-6" : ""}>
                      {(showGroupHeaders || activeSubProjectId) && g.label && (
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-primary/30">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary" />
                            <span className="font-display text-lg font-semibold">{g.label}</span>
                            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              {g.items.length} {g.items.length === 1 ? "lavorazione" : "lavorazioni"}
                            </span>
                          </div>
                          {g.subId !== null || subProjects.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => addPieceForSub(g.subId)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary hover:text-ink"
                            >
                              <Plus className="w-3 h-3" /> Aggiungi qui
                            </button>
                          ) : null}
                        </div>
                      )}
                      <AnimatePresence initial={false}>
                        {g.items.map((p) => {
                          const i = allPieces.findIndex((x) => x.id === p.id);
                          const labSource = !isStampa && p.materialFromLab
                            ? findLabDimensionSource(p, labPieces, i)
                            : undefined;
                          const displayedPiece = labSource ? copyLabDimensions(p, labSource) : p;
                          const key = pieceScrapKey(p, matCat(p), customerType);
                          let scrapDeducted = false;
                          if (key) {
                            if (seenScrap.has(key)) scrapDeducted = true;
                            else seenScrap.add(key);
                          }
                          return (
                            <div key={p.id} id={`piece-${p.id}`} className="scroll-mt-24">
                              {subProjects.length > 0 && (
                                <div className="flex items-center justify-end gap-2 mb-1 text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                                  <Package className="w-3 h-3" />
                                  <span>Prodotto</span>
                                  <select
                                    value={p.subProjectId ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value || null;
                                      setState({
                                        ...state,
                                        pieces: allPieces.map((x) =>
                                          x.id === p.id ? { ...x, subProjectId: v } : x,
                                        ),
                                      });
                                    }}
                                    className="h-6 px-1.5 border-2 border-ink/15 rounded-sm text-[11px] font-semibold bg-paper hover:border-primary focus:border-primary outline-none normal-case tracking-normal"
                                    title="Sposta questa lavorazione in un prodotto finito"
                                  >
                                    <option value="">Generale</option>
                                    {subProjects
                                      .slice()
                                      .sort((a, b) => a.order - b.order)
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              )}
                              <PieceCard
                                autoFocusQty={p.id === lastAddedPieceId}
                                index={i}
                                line={displayedPiece}
                                catalog={deptKey === "tappezzeria" ? withoutInitialScrap(catalog) : catalog}
                                dept={deptKey}
                                customerType={customerType}
                                labCatalog={labCatalog}
                                labPieces={labPieces}
                                scrapDeducted={scrapDeducted}
                                extraSurcharge={nestingScrapByPieceId[p.id] ?? 0}
                                extraSurchargeLabel="Sfrido lastre"
                                materialCostOverrideSingle={getMaterialOverride(p.id)}
                                onChange={(line) =>
                                  setState({
                                    ...state,
                                    pieces: allPieces.map((x) => (x.id === p.id ? line : x)),
                                  })
                                }
                                onRemove={() =>
                                  setState({
                                    ...state,
                                    pieces: allPieces.filter((x) => x.id !== p.id),
                                  })
                                }
                              />
                            </div>
                          );
                        })}
                      </AnimatePresence>
                      {g.items.length === 0 && (
                        <div className="py-4 text-center text-xs text-muted-foreground italic">
                          Nessuna lavorazione in questo prodotto.
                        </div>
                      )}
                    </div>
                  ))}
                </>
              );
            })()}
            {pieces.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Nessun pezzo. Aggiungi il primo per iniziare.
              </div>
            )}

            <div className="mt-4 flex items-center gap-4 flex-wrap">
              <button
                type="button"
                onClick={addPiece}
                className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary hover:text-ink transition-colors group"
              >
                <span className="w-5 h-5 grid place-items-center rounded-sm border-2 border-current group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Plus className="w-3 h-3" strokeWidth={3} />
                </span>
                Aggiungi pezzo{activeSubProjectId === "__none__" ? " (Generale)" : activeSubProjectId ? ` a "${subProjects.find((s) => s.id === activeSubProjectId)?.name ?? ""}"` : ""}
              </button>
              {pieces.length > 0 && (
                <button
                  type="button"
                  onClick={copyLastPiece}
                  className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-ink transition-colors group"
                  title="Duplica l'ultimo pezzo senza le dimensioni"
                >
                  <span className="w-5 h-5 grid place-items-center rounded-sm border-2 border-current">
                    <Plus className="w-3 h-3" strokeWidth={3} />
                  </span>
                  Copia pezzo
                </button>
              )}
            </div>

          </section>

        </motion.div>
      )}

      {/* === Tab: NESTING (solo Stampa) === */}
      {tab === "nesting" && (isStampa || deptKey === "tappezzeria") && (
        <motion.div
          key="nest"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {pieces.length > 0 ? (
            <NestingPanel
              pieces={pieces}
              catalog={deptKey === "tappezzeria" ? withoutInitialScrap(catalog) : catalog}
              customerType={customerType}
              onPiecesChange={(next) => setState({ ...state, pieces: next })}
              initialNestingState={state.nestingState as any}
              onNestingStateChange={(ns) => setState({ ...state, nestingState: ns as any })}
            />
          ) : (
            <div className="panel p-8 text-center text-sm text-muted-foreground">
              Nessun pezzo da nestare. Aggiungi prima i pezzi nella scheda <strong>Lavorazioni</strong>.
            </div>
          )}
        </motion.div>
      )}

      {/* === Tab: MAGAZZINO (+ materiali aggiuntivi e trasporti) === */}
      {tab === "magazzino" && (
        <motion.div
          key="mat"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* === Magazzino del reparto === */}
          {(deptKey === "stampa" || deptKey === "tappezzeria" || deptKey === "falegnameria") && (
            <section className="panel p-6">
              <header className="flex items-start justify-between gap-6 mb-4">
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-xs text-primary font-bold tracking-widest">§MZ</span>
                  <div>
                    <h3 className="font-display text-2xl font-semibold leading-none mb-1">Magazzino {deptLabel}</h3>
                    <p className="text-xs text-muted-foreground">
                      Disponibilità a magazzino dei materiali a listino. Aggiorna giacenze, posizioni e gestisci i pezzi di sfrido.
                    </p>
                  </div>
                </div>
              </header>
              <div className="rule-line mb-4" />
              <InventoryDeptView dept={deptKey as InvDept} catalog={catalog} />
            </section>
          )}

          <div className="panel p-5 bg-muted/20">
            <div className="flex items-baseline justify-between mb-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">Resoconto</span>
                <h4 className="font-display text-lg font-semibold leading-none">Materiali del reparto</h4>
              </div>
              <div className="text-right">
                <div className="label-cap mb-0.5">Totale materiali</div>
                <div className="font-mono text-xl font-semibold tabular-nums">
                  {eur(materialsTotal + piecesMaterialTotal)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[11px]">
              <SummaryStat label="Materiali sciolti" value={materialsTotal} />
              <SummaryStat label="Materiale nei pezzi" value={piecesMaterialTotal} />
              <SummaryStat label="N. voci sciolte" value={state.materials.length} unit="voci" />
              <SummaryStat label="N. pezzi (con materiale)" value={pieces.length} unit="pezzi" />
            </div>
          </div>

          <section className="panel p-6">
            <header className="flex items-start justify-between gap-6 mb-5">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-xs text-primary font-bold tracking-widest">§01</span>
                <div>
                  <h3 className="font-display text-2xl font-semibold leading-none mb-1">Materiali aggiuntivi</h3>
                  <p className="text-xs text-muted-foreground">
                    Materiali aggiuntivi non legati a un pezzo specifico (accessori, scorte, ecc.)
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="label-cap mb-1">Subtotale</div>
                <div className="font-mono text-xl font-semibold tabular-nums">{eur(materialsTotal)}</div>
              </div>
            </header>
            <div className="rule-line mb-2" />

            <div>
              <AnimatePresence initial={false}>
                {state.materials.map((m, i) => (
                  <MaterialRow
                    key={m.id}
                    index={i}
                    line={m}
                    catalog={catalog.materials}
                    customerType={customerType}
                    onChange={(line) =>
                      setState({
                        ...state,
                        materials: state.materials.map((x) => (x.id === m.id ? line : x)),
                      })
                    }
                    onRemove={() =>
                      setState({
                        ...state,
                        materials: state.materials.filter((x) => x.id !== m.id),
                      })
                    }
                    canRemove={state.materials.length > 1}
                  />
                ))}
              </AnimatePresence>
              {state.materials.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nessun materiale aggiuntivo.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={addMaterial}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary hover:text-ink transition-colors group"
            >
              <span className="w-5 h-5 grid place-items-center rounded-sm border-2 border-current group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Plus className="w-3 h-3" strokeWidth={3} />
              </span>
              Aggiungi materiale
            </button>
          </section>

          <section className="panel p-6">
            <header className="flex items-start justify-between gap-6 mb-5">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-xs text-primary font-bold tracking-widest">§TR</span>
                <div>
                  <h3 className="font-display text-2xl font-semibold leading-none mb-1">Trasporti</h3>
                  <p className="text-xs text-muted-foreground">Consegne, ritiri, corrieri o costi logistici del reparto.</p>
                </div>
              </div>
              <div className="text-right shrink-0"><div className="label-cap mb-1">Subtotale</div><div className="font-mono text-xl font-semibold tabular-nums">{eur(transportsTotal)}</div></div>
            </header>
            <div className="rule-line mb-2" />
            <div className="space-y-3">
              {(state.transports ?? []).map((t) => (
                <div key={t.id} className="grid gap-3 rounded-sm border border-border bg-background p-3 md:grid-cols-[minmax(220px,1fr)_110px_130px_110px_40px] md:items-end">
                  <label className="space-y-1.5"><span className="label-cap block">Descrizione</span><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={t.description} onChange={(e) => setState({ ...state, transports: (state.transports ?? []).map((x) => x.id === t.id ? { ...x, description: e.target.value } : x) })} /></label>
                  <label className="space-y-1.5"><span className="label-cap block">Quantità</span><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-mono" type="number" min="0" step="0.01" value={t.quantity || ""} onChange={(e) => setState({ ...state, transports: (state.transports ?? []).map((x) => x.id === t.id ? { ...x, quantity: e.target.value === "" ? 0 : Number(e.target.value) || 0 } : x) })} /></label>
                  <label className="space-y-1.5"><span className="label-cap block">Prezzo unitario</span><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-mono" type="number" min="0" step="0.01" value={t.unitCost || ""} onChange={(e) => setState({ ...state, transports: (state.transports ?? []).map((x) => x.id === t.id ? { ...x, unitCost: e.target.value === "" ? 0 : Number(e.target.value) || 0 } : x) })} /></label>
                  <div><div className="label-cap mb-1.5">Totale</div><div className="flex h-10 items-center font-mono font-semibold">{eur(t.quantity * t.unitCost)}</div></div>
                  <Button type="button" size="icon" variant="ghost" onClick={() => setState({ ...state, transports: (state.transports ?? []).filter((x) => x.id !== t.id) })}>×</Button>
                </div>
              ))}
            </div>
            <Button type="button" size="sm" className="mt-4" onClick={addTransport}><Plus className="h-4 w-4" />Aggiungi trasporto</Button>
          </section>
        </motion.div>
      )}

      {/* === Tab: LISTINI === */}
      {tab === "listini" && (
        <motion.div
          key="lis"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <CatalogPanel
            catalog={catalog}
            onCatalogChange={setCatalog}
            templateUrl={templateUrl}
            templateName={templateName}
            deptLabel={deptLabel}
            deptKey={deptKey}
          />
        </motion.div>
      )}
    </div>
  );
};

/** Statistica singola usata nelle card di riepilogo. */
const SummaryStat = ({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) => (
  <div className="border border-ink/15 rounded-sm p-2 bg-paper">
    <div className="label-cap mb-1">{label}</div>
    <div className="font-semibold tabular-nums text-sm">
      {unit
        ? `${value.toLocaleString("it-IT")} ${unit}`
        : eur(value)}
    </div>
  </div>
);
