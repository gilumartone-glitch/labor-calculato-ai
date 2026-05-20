import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { X, Layers, RotateCw, Plus, AlertTriangle, Scissors, Printer, Square, Triangle as TriangleIcon, RotateCcw, ChevronDown, ChevronUp, Package, Link2 } from "lucide-react";
import { Catalog, PieceLine, PerimeterSide, CatalogPerimeterPreset, PieceShape, PrintType, PrintMode } from "./types";
import { PickStockDialog } from "./PickStockDialog";
import type { InvDept } from "@/lib/produzione/types";
import { eur } from "@/lib/format";
import { uid } from "@/lib/format";
import { sideLengthM, pieceAreaM2, SIDE_LABEL, isTiroAPacchetto, tiroFiles } from "@/lib/perimeter";
import { convertLength } from "@/lib/perimeter";
import {
  computePieceMaterial,
  piecePerimetersTotal,
  pieceCustomWorksTotal,
  piecePrintTotal,
  pieceLeftoverScrapSellCost,
  MARGIN_WIDTH_CM,
  MARGIN_HEIGHT_CM,
} from "@/lib/piece";
import { TechnicalDrawing, DrawingSide } from "./TechnicalDrawing";
import { CustomerType, priceMultiplier } from "@/lib/pricing";

interface Props {
  index: number;
  line: PieceLine;
  catalog: Catalog;
  dept?: string;
  customerType?: CustomerType;
  /** Catalogo del Laboratorio: usato quando `line.materialFromLab` è attivo,
   *  per risolvere prodotto/variante/altezza tessuto dal listino corretto. */
  labCatalog?: Catalog;
  /** Pezzi del Laboratorio: usati per popolare il selettore "pezzo Lab"
   *  collegato quando `materialFromLab` è attivo. */
  labPieces?: PieceLine[];
  /** Se true, lo sfrido iniziale (1,5 m lineari) NON viene incluso nel totale
   *  della card: significa che un altro pezzo dello stesso gruppo materiale
   *  lo sta già conteggiando. Serve a far quadrare la somma delle card con il
   *  totale del reparto (sfrido contato una sola volta per materiale). */
  scrapDeducted?: boolean;
  /** Costo extra (€) ripartito su questo pezzo, es. sfrido nesting distribuito
   *  proporzionalmente quando l'utente flagga "Addebita sfrido" per il gruppo
   *  materiale. Viene sommato al totale del pezzo e mostrato come riga separata. */
  extraSurcharge?: number;
  extraSurchargeLabel?: string;
  onChange: (line: PieceLine) => void;
  onRemove: () => void;
}

const SIDES: PerimeterSide[] = ["top", "right", "bottom", "left"];

const fmtM = (m: number) =>
  m.toLocaleString("it-IT", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const priceUnitOf = (m: Catalog["materials"][number] | null): "mq" | "ml" => {
  if (!m) return "ml";
  if (m.priceUnit === "mq" || m.priceUnit === "ml") return m.priceUnit;
  const unit = String(m.unit || "").trim().toLowerCase();
  return unit === "mq" || unit === "m²" || unit === "m2" ? "mq" : "ml";
};

export const PieceCard = ({ index, line, catalog, dept, customerType, labCatalog, labPieces = [], scrapDeducted = false, onChange, onRemove }: Props) => {
  const isStampa = dept === "stampa";
  const materialLockedToLab = !isStampa && !!line.materialFromLab;
  // Stato locale di stringa per i campi dimensionali: permette di digitare
  // liberamente decimali (anche con la virgola italiana) senza che il
  // re-render azzeri ciò che si sta scrivendo.
  const fmtNum = (n: number | undefined): string =>
    n && n > 0 ? String(n).replace(".", ",") : "";
  const parseNum = (s: string): number => {
    const v = parseFloat(s.replace(",", "."));
    return isFinite(v) && v > 0 ? v : 0;
  };
  const [widthStr, setWidthStr] = useState<string>(fmtNum(line.width));
  const [heightStr, setHeightStr] = useState<string>(fmtNum(line.height));
  const [widthBottomStr, setWidthBottomStr] = useState<string>(fmtNum(line.widthBottom));
  // Risincronizza quando cambia esternamente (es. Reset, sync da Lab),
  // ma NON sovrascrivere se la stringa locale rappresenta già lo stesso numero
  // (altrimenti digitare "0," o "1." azzera il campo durante l'input).
  useEffect(() => {
    setWidthStr((prev) => (parseNum(prev) === (line.width ?? 0) ? prev : fmtNum(line.width)));
  }, [line.width]);
  useEffect(() => {
    setHeightStr((prev) => (parseNum(prev) === (line.height ?? 0) ? prev : fmtNum(line.height)));
  }, [line.height]);
  useEffect(() => {
    setWidthBottomStr((prev) => (parseNum(prev) === (line.widthBottom ?? 0) ? prev : fmtNum(line.widthBottom)));
  }, [line.widthBottom]);
  /** Catalogo da cui leggere materiali/varianti per QUESTO pezzo.
   *  Se il pezzo preleva il materiale dal Laboratorio, usiamo i materiali del
   *  catalogo Lab ma manteniamo le lavorazioni perimetrali (es. "Cucitura")
   *  del reparto corrente. */
  const materialCatalog: Catalog =
    line.materialFromLab && labCatalog
      ? { ...catalog, materials: labCatalog.materials }
      : catalog;
  const shape: PieceShape = line.shape ?? "rect";
  type StampaSubTab = "stampa" | "taglio" | "perimetrale" | "altre";
  const [stampaTab, setStampaTab] = useState<StampaSubTab>("stampa");
  /** Sotto-categoria attiva (solo per i tab Stampa e Taglio). */
  const PRINT_SUBS = [
    { k: "uv", label: "Stampa UV" },
    { k: "solvente", label: "Solvente" },
    { k: "laser", label: "Laser" },
  ] as const;
  const CUT_SUBS = [
    { k: "cnc", label: "CNC" },
    { k: "laser", label: "Laser" },
    { k: "squadratrice", label: "Squadratrice" },
    { k: "plotter", label: "Plotter" },
  ] as const;
  const [printSub, setPrintSub] = useState<string>("uv");
  const [cutSub, setCutSub] = useState<string>("cnc");
  /** Card collassabile: di default aperta, l'utente può chiuderla per ridurre
   *  l'ingombro quando ha tante lavorazioni nel reparto. */
  const [collapsed, setCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  /** Reparto magazzino di riferimento per il selettore "aggancia pezzo".
   *  Il calcolatore usa "stampa" anche come Laboratorio. */
  const stockDept: InvDept | null = (() => {
    if (dept === "stampa" || dept === "tappezzeria" || dept === "falegnameria") return dept;
    return null;
  })();

  /** Sotto-tipo di stampa "bloccato" se sul pezzo è già applicata una lavorazione di stampa.
   *  I pezzi possono avere UN SOLO processo di stampa (UV oppure Solvente oppure Laser). */
  const lockedPrintSub = useMemo(() => {
    for (const pp of line.perimeters) {
      const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
      if (op && (op.category ?? "perimetrale") === "stampa") {
        return op.subcategory ?? null;
      }
    }
    return null;
  }, [line.perimeters, catalog.perimeterOps]);
  /** Sotto-tipo di stampa effettivo (lockato se presente). */
  const effectivePrintSub = lockedPrintSub ?? printSub;
  const productNames = useMemo(
    () => Array.from(new Set(materialCatalog.materials.map((m) => m.name))).filter(Boolean).sort(),
    [materialCatalog.materials],
  );
  const colors = useMemo(
    () => Array.from(new Set(materialCatalog.materials.filter((m) => m.name === line.productName).map((m) => m.color))).filter(Boolean),
    [materialCatalog.materials, line.productName],
  );
  const fireproofs = useMemo(
    () => Array.from(new Set(materialCatalog.materials.filter((m) => m.name === line.productName && (line.color ? m.color === line.color : true)).map((m) => m.fireproof))),
    [materialCatalog.materials, line.productName, line.color],
  );
  /** Spessori disponibili per il prodotto+colore selezionato (sempre mostrato anche se uno solo). */
  const thicknesses = useMemo(
    () =>
      Array.from(
        new Set(
          materialCatalog.materials
            .filter((m) => m.name === line.productName && (line.color ? m.color === line.color : true))
            .map((m) => m.thickness ?? ""),
        ),
      ).filter((t) => t !== ""),
    [materialCatalog.materials, line.productName, line.color],
  );
  /** Finiture disponibili per il prodotto+colore+spessore */
  const finishes = useMemo(
    () =>
      Array.from(
        new Set(
          materialCatalog.materials
            .filter(
              (m) =>
                m.name === line.productName &&
                (line.color ? m.color === line.color : true) &&
                (line.thickness ? (m.thickness ?? "") === line.thickness : true),
            )
            .map((m) => m.finish ?? ""),
        ),
      ).filter((f) => f !== ""),
    [materialCatalog.materials, line.productName, line.color, line.thickness],
  );

  /** Varianti del materiale che corrispondono ai filtri prodotto/colore/spessore/finitura.
   *  Ognuna rappresenta un formato (lastra: base×h) o un'altezza/lunghezza (rotolo). */
  const variantOptions = useMemo(
    () =>
      materialCatalog.materials.filter(
        (m) =>
          m.name === line.productName &&
          (line.color ? m.color === line.color : true) &&
          (line.thickness ? (m.thickness ?? "") === (line.thickness ?? "") : true) &&
          (line.finish ? (m.finish ?? "") === (line.finish ?? "") : true),
      ),
    [materialCatalog.materials, line.productName, line.color, line.thickness, line.finish],
  );

  /** Etichetta human-readable di una variante (formato + dimensioni). */
  const variantLabel = (m: typeof materialCatalog.materials[number]): string => {
    const u = m.dimUnit || m.heightUnit || "cm";
    if (m.format === "lastra") {
      return `Lastra ${m.baseWidth || "?"} × ${m.height || "?"} ${u}`;
    }
    if (m.format === "rotolo") {
      const len = m.rollLength ? `${m.rollLength}${u} × ` : "";
      return `Rotolo ${len}h ${m.height || "?"} ${u}`;
    }
    return `${m.height || "?"} ${u}`;
  };

  // Breakdown materiale (margini + rotazione + teli + cuciture)
  const mat = useMemo(
    () => computePieceMaterial(line, materialCatalog, customerType),
    [line, materialCatalog, customerType],
  );

  /** Variante effettivamente in uso (selezione manuale o auto-match). */
  const activeVariant = mat.material;

  /** Verifica se il pezzo (con margini) sta dentro la variante scelta. */
  const fitCheck = useMemo(() => {
    if (!activeVariant) return { fits: true, msg: "" };
    const u = (activeVariant.dimUnit || activeVariant.heightUnit || "cm") as "cm" | "m" | "mm";
    const pieceWM = mat.pieceWidthM; // include margini
    const pieceHM = mat.pieceHeightM;
    const heightM = convertLength(parseFloat(String(activeVariant.height).replace(",", ".")) || 0, u, "m");
    if (activeVariant.format === "lastra") {
      const baseRaw = convertLength(parseFloat(String(activeVariant.baseWidth || "0").replace(",", ".")) || 0, u, "m");
      const heightRaw = heightM;
      const baseM = line.rotateSheet ? heightRaw : baseRaw;
      const sheetHM = line.rotateSheet ? baseRaw : heightRaw;
      if (baseM <= 0 || sheetHM <= 0) return { fits: true, msg: "" };
      const fitsNormal = pieceWM <= baseM && pieceHM <= sheetHM;
      const fitsRot = !!line.allowRotation && pieceHM <= baseM && pieceWM <= sheetHM;
      if (fitsNormal || fitsRot) return { fits: true, msg: "" };
      const dispW = line.rotateSheet ? activeVariant.height : activeVariant.baseWidth;
      const dispH = line.rotateSheet ? activeVariant.baseWidth : activeVariant.height;
      return {
        fits: false,
        msg: `Il pezzo (${fmtM(pieceWM)} × ${fmtM(pieceHM)} m con margini) non entra nel formato lastra ${dispW} × ${dispH} ${u}${line.rotateSheet ? " (lastra ruotata)" : ""}`,
      };
    }
    if (activeVariant.format === "rotolo") {
      if (heightM <= 0) return { fits: true, msg: "" };
      const fitsNormal = pieceHM <= heightM;
      const fitsRot = !!line.allowRotation && pieceWM <= heightM;
      if (fitsNormal || fitsRot) return { fits: true, msg: "" };
      return {
        fits: false,
        msg: `L'altezza del pezzo (${fmtM(pieceHM)} m con margini) supera l'altezza del rotolo ${activeVariant.height} ${u}`,
      };
    }
    return { fits: true, msg: "" };
  }, [activeVariant, mat.pieceWidthM, mat.pieceHeightM, line.allowRotation, line.rotateSheet]);

  const perimetersTotal = useMemo(
    () => piecePerimetersTotal(line, catalog, customerType),
    [line, catalog, customerType],
  );
  const customWorksTotal = useMemo(() => pieceCustomWorksTotal(line), [line]);
  const printTotal = useMemo(() => piecePrintTotal(line, catalog), [line, catalog]);
  const printOps = catalog.printOps ?? [];
  const printOp = line.printOpId ? printOps.find((p) => p.id === line.printOpId) : undefined;
  const areaM2 = useMemo(
    () => pieceAreaM2({ width: line.width, height: line.height, dimUnit: line.dimUnit, shape, widthBottom: line.widthBottom }),
    [line.width, line.height, line.dimUnit, shape, line.widthBottom],
  );

  // Se il pezzo preleva il materiale dal Laboratorio, il costo materiale NON
  // viene addebitato qui (apparirà come riga automatica in Laboratorio).
  // Le LAVORAZIONI (perimetrali + cuciture) restano invece a carico del
  // reparto corrente: la cucitura dipende dall'altezza del tessuto Lab.
  const materialsSubtotal =
    line.materialFromLab ? 0 : mat.feasible ? mat.materialCost : 0;
  const workSubtotal =
    perimetersTotal + (mat.feasible ? mat.seamCost : 0) + customWorksTotal + printTotal;
  const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
  // Lo sfrido (1,5 m linerai) si conta UNA SOLA VOLTA per pezzo, non per copia.
  // → totale = (materiale-lavorabile + lavorazioni) × qty + sfrido × 1
  // Se `scrapDeducted` è true, un altro pezzo dello stesso gruppo materiale
  // sta già conteggiando lo sfrido → qui non lo includiamo (così la somma
  // delle card combacia con il totale del reparto).
  const fullScrapSell = mat.feasible ? mat.initialScrapSellCost : 0;
  const scrapSell = scrapDeducted ? 0 : fullScrapSell;
  const workingMaterial = materialsSubtotal - fullScrapSell;
  // Sfrido di nesting (leftover) — solo materiale, senza lavorazioni.
  // Si applica per ogni copia del pezzo (è materiale fisico consumato in più).
  const leftoverScrap = useMemo(
    () => pieceLeftoverScrapSellCost(line, catalog, customerType),
    [line, catalog, customerType],
  );
  const leftoverM2 = useMemo(() => {
    if (!line.chargeScrap || !mat.feasible) return 0;
    const teli = mat.panels * mat.rollWidthM * mat.panelLengthM;
    const used = mat.pieceWidthM * mat.panelLengthM;
    return Math.max(0, teli - used);
  }, [line.chargeScrap, mat.feasible, mat.panels, mat.rollWidthM, mat.panelLengthM, mat.pieceWidthM]);
  const scrapWidthM = Math.max(0, mat.panels * mat.rollWidthM - mat.pieceWidthM);
  const initialScrapAreaM2 = mat.initialScrapSellCost > 0 ? 1.5 * mat.rollWidthM : 0;
  const materialEffectiveAreaM2 = mat.feasible ? mat.pieceWidthM * mat.pieceHeightM : areaM2;
  const totalSingle = workingMaterial + workSubtotal + leftoverScrap;
  const total = totalSingle * qty + scrapSell;
  const materialsSubtotalDisplay = workingMaterial * qty + scrapSell;
  const worksSubtotalDisplay = (workSubtotal + leftoverScrap) * qty;

  // Disegno: lati colorati dai perimetri applicati
  const drawSides: DrawingSide[] = line.perimeters.flatMap((pp) => {
    const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
    if (!op) return [];
    return pp.sides.map((s) => ({
      side: s,
      label: op.name,
      color: op.color || "hsl(220 14% 35%)",
    }));
  });

  /* ---- Mutators ---- */
  const setProduct = (productName: string) => {
    const validColors = materialCatalog.materials.filter((m) => m.name === productName).map((m) => m.color);
    const newColor = validColors.includes(line.color) ? line.color : (validColors[0] || "");
    const validFire = materialCatalog.materials.filter((m) => m.name === productName && m.color === newColor).map((m) => m.fireproof);
    const newFire = validFire.includes(line.fireproof) ? line.fireproof : (validFire[0] || "");
    const validTh = materialCatalog.materials
      .filter((m) => m.name === productName && m.color === newColor)
      .map((m) => m.thickness ?? "");
    const newTh = validTh.includes(line.thickness ?? "") ? line.thickness : (validTh.find((t) => t) || "");
    const validFin = materialCatalog.materials
      .filter((m) => m.name === productName && m.color === newColor && (m.thickness ?? "") === (newTh ?? ""))
      .map((m) => m.finish ?? "");
    const newFin = validFin.includes(line.finish ?? "") ? line.finish : (validFin.find((f) => f) || "");
    onChange({ ...line, productName, color: newColor, fireproof: newFire, thickness: newTh, finish: newFin });
  };

  const setColor = (color: string) => {
    const validFire = materialCatalog.materials.filter((m) => m.name === line.productName && m.color === color).map((m) => m.fireproof);
    const newFire = validFire.includes(line.fireproof) ? line.fireproof : (validFire[0] || "");
    const validTh = materialCatalog.materials
      .filter((m) => m.name === line.productName && m.color === color)
      .map((m) => m.thickness ?? "");
    const newTh = validTh.includes(line.thickness ?? "") ? line.thickness : (validTh.find((t) => t) || "");
    const validFin = materialCatalog.materials
      .filter((m) => m.name === line.productName && m.color === color && (m.thickness ?? "") === (newTh ?? ""))
      .map((m) => m.finish ?? "");
    const newFin = validFin.includes(line.finish ?? "") ? line.finish : (validFin.find((f) => f) || "");
    onChange({ ...line, color, fireproof: newFire, thickness: newTh, finish: newFin });
  };

  const setThickness = (thickness: string) => {
    const validFin = materialCatalog.materials
      .filter(
        (m) =>
          m.name === line.productName &&
          (line.color ? m.color === line.color : true) &&
          (m.thickness ?? "") === thickness,
      )
      .map((m) => m.finish ?? "");
    const newFin = validFin.includes(line.finish ?? "") ? line.finish : (validFin.find((f) => f) || "");
    onChange({ ...line, thickness, finish: newFin });
  };

  const togglePerimeterSide = (perimId: string, side: PerimeterSide) => {
    onChange({
      ...line,
      perimeters: line.perimeters.map((pp) =>
        pp.id === perimId
          ? { ...pp, sides: pp.sides.includes(side) ? pp.sides.filter((s) => s !== side) : [...pp.sides, side] }
          : pp,
      ),
    });
  };

  const setPerimeterOp = (perimId: string, opId: string) => {
    onChange({
      ...line,
      perimeters: line.perimeters.map((pp) => (pp.id === perimId ? { ...pp, opId } : pp)),
    });
  };

  const removePerimeter = (perimId: string) => {
    onChange({ ...line, perimeters: line.perimeters.filter((pp) => pp.id !== perimId) });
  };

  const setPerimeterQty = (perimId: string, q: number) => {
    onChange({
      ...line,
      perimeters: line.perimeters.map((pp) =>
        pp.id === perimId ? { ...pp, quantity: q } : pp,
      ),
    });
  };

  /** Toggle "preset" — inserisce/rimuove una riga per la voce di catalogo dato. */
  const togglePerimeterPreset = (opId: string) => {
    const existing = line.perimeters.find((pp) => pp.opId === opId);
    if (existing) {
      onChange({ ...line, perimeters: line.perimeters.filter((pp) => pp.id !== existing.id) });
    } else {
      // Per le lavorazioni di STAMPA, le modalità (Standard/Fronte-Retro/Con Bianco)
      // sono mutuamente esclusive: un pezzo può avere UN SOLO processo di stampa
      // (UV / Solvente / Laser e una sola modalità tra Standard / Fronte-Retro / Con Bianco).
      // Selezionarne una rimuove tutte le altre lavorazioni di stampa già presenti.
      const targetOp = catalog.perimeterOps.find((o) => o.id === opId);
      const isStampaCat = (targetOp?.category ?? "perimetrale") === "stampa";
      const filtered = isStampaCat
        ? line.perimeters.filter((pp) => {
            const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
            if (!op) return true;
            // Rimuovo qualsiasi lavorazione di stampa già presente sul pezzo.
            return (op.category ?? "perimetrale") !== "stampa";
          })
        : line.perimeters;
      onChange({
        ...line,
        perimeters: [...filtered, { id: uid(), opId, sides: [] }],
      });
    }
  };

  const addPerimeter = (
    categoryFilter?: "stampa" | "taglio" | "perimetrale" | "altre",
    subFilter?: string,
  ) => {
    const pool = catalog.perimeterOps.filter((o) => {
      if (categoryFilter && (o.category ?? "perimetrale") !== categoryFilter) return false;
      if (subFilter && (o.subcategory ?? "") !== subFilter) return false;
      return true;
    });
    if (pool.length === 0) return;
    onChange({
      ...line,
      perimeters: [...line.perimeters, { id: uid(), opId: pool[0].id, sides: [] }],
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = catalog.perimeterPresets.find((p) => p.id === presetId);
    if (!preset) return;
    onChange({
      ...line,
      perimeters: preset.items.map((it) => ({ id: uid(), opId: it.opId, sides: [...it.sides] })),
    });
  };

  /* ---- Lavorazioni libere (custom) ---- */
  const customWorks = line.customWorks ?? [];
  const addCustomWork = () =>
    onChange({
      ...line,
      customWorks: [...customWorks, { id: uid(), name: "", price: 0 }],
    });
  const updateCustomWork = (id: string, patch: Partial<{ name: string; price: number }>) =>
    onChange({
      ...line,
      customWorks: customWorks.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    });
  const removeCustomWork = (id: string) =>
    onChange({ ...line, customWorks: customWorks.filter((w) => w.id !== id) });

  const matchedHeightLabel = mat.material
    ? `${mat.material.height} ${mat.material.heightUnit}`
    : "—";

  // Colore distintivo per ciascun pezzo (deterministico per id, coerente con il nesting)
  const pieceHue = (() => {
    const id = line.id ?? String(index);
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  })();
  const pieceAccent = `hsl(${pieceHue} 70% 50%)`;
  const isAlt = index % 2 === 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.25 }}
      className={`border border-ink/20 rounded-sm p-4 mb-3 relative overflow-hidden ${isAlt ? "bg-muted/40" : "bg-paper"}`}
      style={{ borderLeft: `6px solid ${pieceAccent}` }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <span
            className="font-mono text-[11px] font-bold tracking-widest px-2 py-1 rounded-sm text-paper"
            style={{ backgroundColor: pieceAccent }}
          >
            P{String(index + 1).padStart(2, "0")}
          </span>
          <h4 className="font-display text-base font-semibold leading-none" style={{ color: pieceAccent }}>
            {line.productName || "Nuovo pezzo"}
          </h4>
          <div className="inline-flex items-baseline gap-1 ml-2 px-2 py-0.5 border border-ink/30 rounded-sm">
            <span className="label-cap">Qt</span>
            <input
              type="number"
              min={1}
              step={1}
              value={qty === 0 ? "" : qty}
              onChange={(e) =>
                onChange({ ...line, quantity: Math.max(1, parseInt(e.target.value) || 1) })
              }
              className="w-12 bg-transparent text-right font-mono text-sm font-semibold focus:outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="label-cap mb-0.5">
              Totale {qty > 1 ? `× ${qty}` : "pezzo"}
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">{eur(total)}</div>
            {qty > 1 && (
              <div className="font-mono text-[10px] text-muted-foreground">
                {eur(totalSingle)}/cad
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Espandi pezzo" : "Comprimi pezzo"}
            aria-expanded={!collapsed}
            title={collapsed ? "Espandi pezzo" : "Comprimi pezzo"}
            className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-ink hover:text-paper hover:border-ink transition-colors"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              if (line.perimeters.length === 0 && (line.customWorks?.length ?? 0) === 0) return;
              if (window.confirm("Azzerare tutte le lavorazioni di questo pezzo?\n(Materiale e dimensioni resteranno invariati)")) {
                onChange({ ...line, perimeters: [], customWorks: [] });
              }
            }}
            aria-label="Reset lavorazioni del pezzo"
            title="Reset lavorazioni del pezzo"
            className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-ink hover:text-paper hover:border-ink transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Rimuovi pezzo"
            className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
      <>
      {/* 1) Tipo prodotto · Colore · Ignifugo · Altezza auto */}
      <div className="grid grid-cols-12 gap-3 items-end">
        <div className="col-span-12 md:col-span-4">
          <label className="label-cap block mb-1">Tipo prodotto</label>
          {productNames.length > 0 ? (
            <select
              value={line.productName}
              onChange={(e) => setProduct(e.target.value)}
              disabled={materialLockedToLab}
              className="input-bare w-full text-sm bg-paper disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">— scegli —</option>
              {productNames.map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          ) : (
            <input
              type="text"
              value={line.productName}
              onChange={(e) => onChange({ ...line, productName: e.target.value })}
              placeholder="Carica un listino"
              disabled={materialLockedToLab}
              className="input-bare w-full text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
          )}
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="label-cap block mb-1">Colore</label>
          <select
            value={line.color}
            onChange={(e) => setColor(e.target.value)}
            disabled={materialLockedToLab || !line.productName || colors.length === 0}
            className="input-bare w-full text-sm bg-paper disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">—</option>
            {colors.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        {!isStampa && fireproofs.some((f) => (f || "").trim() !== "") && (
          <div className="col-span-6 md:col-span-3">
            <label className="label-cap block mb-1">Ignifugo</label>
            <select
              value={line.fireproof}
              onChange={(e) => onChange({ ...line, fireproof: e.target.value })}
              disabled={materialLockedToLab || !line.productName || fireproofs.length === 0}
              className="input-bare w-full text-sm bg-paper disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fireproofs.length === 0 && <option value="">—</option>}
              {fireproofs.map((f) => (<option key={f} value={f}>{f || "Non ignifugo"}</option>))}
            </select>
          </div>
        )}
        {isStampa && (
          <div className="col-span-6 md:col-span-2">
            <label className="label-cap block mb-1">Spessore</label>
            <select
              value={line.thickness ?? ""}
              onChange={(e) => setThickness(e.target.value)}
              disabled={!line.productName || thicknesses.length === 0}
              className="input-bare w-full text-sm bg-paper disabled:opacity-50"
            >
              {thicknesses.length === 0 && <option value="">—</option>}
              {thicknesses.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
        )}
        {isStampa && finishes.length > 0 && (
          <div className="col-span-6 md:col-span-2">
            <label className="label-cap block mb-1">Finitura</label>
            <select
              value={line.finish ?? ""}
              onChange={(e) => onChange({ ...line, finish: e.target.value })}
              className="input-bare w-full text-sm bg-paper"
            >
              {finishes.map((f) => (<option key={f} value={f}>{f}</option>))}
            </select>
          </div>
        )}
        <div className={`col-span-12 ${isStampa ? (finishes.length > 0 ? "md:col-span-1" : "md:col-span-3") : "md:col-span-2"} text-right`}>
          <div className="label-cap mb-1">
            {isStampa
              ? `Supporto · €/${mat.material?.unit || mat.material?.priceUnit || "mq"}`
              : "Altezza tessuto"}
          </div>
          <div className={`font-mono text-sm font-semibold tabular-nums ${mat.material ? "text-ink" : "text-destructive"}`}>
            {isStampa
              ? (mat.material ? `${eur(mat.unitCost)}/${mat.material.unit || mat.material.priceUnit || "mq"}` : "—")
              : matchedHeightLabel}
          </div>
          {!isStampa && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {mat.material ? `${eur(mat.unitCost)}/${mat.material.unit}` : "nessuna variante"}
            </div>
          )}
        </div>
      </div>

      {/* Stampa: dettaglio formato (lastra/rotolo) e dimensioni della variante selezionata */}
      {isStampa && mat.material && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
          <span className="px-2 py-0.5 border border-ink/30 rounded-sm bg-muted/30 text-ink font-bold">
            {mat.material.format ?? "—"}
          </span>
          {mat.material.thickness && (
            <span className="text-muted-foreground">· spessore <span className="text-ink font-semibold">{mat.material.thickness}</span></span>
          )}
          {mat.material.finish && (
            <span className="text-muted-foreground">· {mat.material.finish}</span>
          )}
          {(mat.material.format === "lastra"
            ? (mat.material.baseWidth || mat.material.height)
            : (mat.material.rollLength || mat.material.height)) && (
            <span className="text-muted-foreground">
              · misure{" "}
              <span className="text-ink font-semibold">
                {mat.material.format === "lastra"
                  ? `${mat.material.baseWidth || "?"} × ${mat.material.height || "?"}`
                  : `${mat.material.rollLength || "?"} × ${mat.material.height || "?"} (h)`}
                {" "}
                {mat.material.dimUnit || mat.material.heightUnit || ""}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Aggancia pezzo da magazzino (prenotazione soft) */}
      {stockDept && line.productName && !materialLockedToLab && (
        <div className="mt-3 flex items-center justify-between gap-2 p-2 border border-dashed border-ink/20 rounded-sm bg-muted/20">
          <div className="min-w-0 flex-1">
            <div className="label-cap mb-0.5 flex items-center gap-1.5">
              <Package className="w-3 h-3" /> Magazzino
            </div>
            {line.pickedStockId ? (
              <div className="text-xs font-mono text-ink truncate">
                <Link2 className="w-3 h-3 inline mr-1 text-primary" />
                {line.pickedStockLabel ?? "Pezzo selezionato"}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                Nessun pezzo agganciato — sceglierà l'operatore in produzione.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider border border-ink/30 rounded-sm hover:bg-ink hover:text-paper transition-colors"
          >
            {line.pickedStockId ? "Cambia" : "Scegli"}
          </button>
        </div>
      )}

      {stockDept && (
        <PickStockDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          line={line}
          dept={stockDept}
          onPick={(next) => onChange({ ...line, ...next })}
        />
      )}

      {/* Dimensioni · Modalità prezzo · Ruota tessuto */}
      <div className="grid grid-cols-12 gap-3 items-end mt-4 pt-3 border-t border-dashed border-ink/15">
        <div className="col-span-12 md:col-span-2">
          <label className="label-cap block mb-1">Forma</label>
          <div className="flex border border-ink/40 rounded-sm overflow-hidden">
            {([
              { v: "rect", label: "▭", title: "Rettangolo" },
              { v: "triangle", label: "△", title: "Triangolo" },
              { v: "trapezoid", label: "⏢", title: "Trapezio" },
            ] as { v: PieceShape; label: string; title: string }[]).map((s) => (
              <button
                key={s.v}
                type="button"
                title={s.title}
                disabled={materialLockedToLab}
                onClick={() => !materialLockedToLab && onChange({ ...line, shape: s.v })}
                className={`flex-1 px-1.5 py-1.5 text-base leading-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  shape === s.v ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-1">
            Area: {areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
          </div>
        </div>
        <div className="col-span-12 md:col-span-3">
          <label className="label-cap block mb-1 text-primary font-bold">
            ◆ {shape === "trapezoid" ? "B maggiore × Altezza" : shape === "triangle" ? "Base × Altezza" : "Base × Altezza pezzo"}
          </label>
          <div className="grid grid-cols-12 gap-1 items-center rounded-sm border-2 border-primary/60 bg-primary/5 px-1 py-1">
            <input
              type="text"
              inputMode="decimal"
              value={widthStr}
              onChange={(e) => {
                setWidthStr(e.target.value);
                onChange({ ...line, width: parseNum(e.target.value) });
              }}
              placeholder={shape === "trapezoid" ? "B" : "b"}
              disabled={materialLockedToLab}
              className="col-span-5 input-bare font-mono text-lg font-bold text-right text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="col-span-2 text-center text-primary font-bold text-lg">×</span>
            <input
              type="text"
              inputMode="decimal"
              value={heightStr}
              onChange={(e) => {
                setHeightStr(e.target.value);
                onChange({ ...line, height: parseNum(e.target.value) });
              }}
              placeholder="h"
              disabled={materialLockedToLab}
              className="col-span-5 input-bare font-mono text-lg font-bold text-right text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          {shape === "trapezoid" && (
            <div className="mt-1">
              <input
                type="text"
                inputMode="decimal"
                value={widthBottomStr}
                onChange={(e) => {
                  setWidthBottomStr(e.target.value);
                  onChange({ ...line, widthBottom: parseNum(e.target.value) });
                }}
                placeholder="b minore"
                disabled={materialLockedToLab}
                className="input-bare font-mono text-sm text-right w-full disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          )}
          <div className="mt-1 inline-flex border border-ink/40 rounded-sm overflow-hidden">
            {(["mm", "cm", "m"] as const).map((u) => (
              <button
                key={u}
                type="button"
                disabled={materialLockedToLab}
                onClick={() => !materialLockedToLab && onChange({ ...line, dimUnit: u })}
                className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  line.dimUnit === u ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          {!isStampa && (
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              + margini lavorazione: +{MARGIN_WIDTH_CM} cm base · +{MARGIN_HEIGHT_CM} cm altezza
            </div>
          )}
        </div>

        {!isStampa && (
          <div className="col-span-6 md:col-span-2">
            <label className="label-cap block mb-1">Modalità prezzo</label>
            <div className="flex border border-ink/40 rounded-sm overflow-hidden">
              <button
                type="button"
                onClick={() => onChange({ ...line, priceMode: "cut" })}
                className={`flex-1 px-2 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                  line.priceMode === "cut" ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                }`}
              >
                Taglio
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...line, priceMode: "piece" })}
                className={`flex-1 px-2 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                  line.priceMode === "piece" ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                }`}
              >
                Pezza
              </button>
            </div>
          </div>
        )}

        <div className="col-span-6 md:col-span-3">
            <label className="label-cap block mb-1">Ruota tessuto</label>
            <button
              type="button"
              onClick={() => onChange({ ...line, allowRotation: !line.allowRotation })}
              className={`w-full inline-flex items-center justify-between gap-2 px-3 py-2 border-2 rounded-sm text-[11px] uppercase tracking-wider font-bold transition-colors ${
                line.allowRotation
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-ink/40 text-ink/60 hover:border-ink hover:text-ink"
              }`}
              title="Permette al sistema di scambiare base/altezza per scegliere l'orientamento più economico"
            >
              <span className="inline-flex items-center gap-2">
                <RotateCw className="w-3.5 h-3.5" />
                {line.allowRotation ? "Rotazione attiva" : "Rotazione disattivata"}
              </span>
              {mat.feasible && mat.rotated && (
                <span className="font-mono text-[9px] tracking-wider px-1.5 py-0.5 rounded-sm bg-paper text-primary">
                  APPLICATA
                </span>
              )}
            </button>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              {line.allowRotation
                ? "Il sistema sceglie l'orientamento più economico."
                : "Senza flag, l'altezza del tessuto deve coprire l'altezza del pezzo. Le cuciture restano sempre verticali."}
            </div>
        </div>

        <div className="col-span-6 md:col-span-2">
            <label className="label-cap block mb-1">Dividi pannello</label>
            <button
              type="button"
              onClick={() => onChange({ ...line, allowSplit: line.allowSplit !== true })}
              className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 border-2 rounded-sm text-[11px] uppercase tracking-wider font-bold transition-colors ${
                line.allowSplit === true
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-ink/40 text-ink/60 hover:border-ink hover:text-ink"
              }`}
              title="Se attivo il sistema può spezzare il pezzo in più pannelli affiancati (con cucitura/giuntura). Se disattivo (default), il pezzo deve entrare interamente nella misura della lastra/rullo, altrimenti viene segnalato come non piazzabile."
            >
              <Scissors className="w-3.5 h-3.5" />
              {line.allowSplit === true ? "Divisibile" : "Indivisibile"}
            </button>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              {line.allowSplit === true
                ? "Il sistema può spezzare il pezzo in più pannelli."
                : "Il pezzo deve entrare intero: se non sta nella lastra/rullo viene segnalato come non piazzabile."}
            </div>
        </div>

        {!isStampa && (
          <div className="col-span-12">
            <label className="label-cap block mb-1">Origine materiale</label>
            <button
              type="button"
              onClick={() => {
                const next = !line.materialFromLab;
                // Quando cambio l'origine del materiale, il listino di riferimento
                // cambia: se il prodotto/colore corrente non esiste nel nuovo
                // catalogo, lo resetto così l'utente può sceglierne uno valido
                // dal Laboratorio (e l'altezza tessuto viene risolta).
                const targetCatalog =
                  next && labCatalog ? labCatalog : catalog;
                const stillValidProduct = targetCatalog.materials.some(
                  (m) => m.name === line.productName,
                );
                if (stillValidProduct) {
                  onChange({ ...line, materialFromLab: next });
                  return;
                }
                onChange({
                  ...line,
                  materialFromLab: next,
                  productName: "",
                  color: "",
                  fireproof: "",
                  thickness: "",
                  finish: "",
                  variantId: null,
                });
              }}
              className={`w-full inline-flex items-center justify-between gap-2 px-3 py-2 border-2 rounded-sm text-[11px] uppercase tracking-wider font-bold transition-colors ${
                line.materialFromLab
                  ? "border-ink bg-muted text-ink"
                  : "border-ink/40 text-ink/60 hover:border-ink hover:text-ink"
              }`}
              title="Se attivo, il materiale viene preso dal Laboratorio (con +20cm h e +10cm w totali) e il costo materiale di questo pezzo viene azzerato qui."
            >
              <span className="inline-flex items-center gap-2">
                <Layers className="w-3.5 h-3.5" />
                {line.materialFromLab
                  ? "Materiale prelevato dal Laboratorio"
                  : "Materiale dal listino del reparto corrente"}
              </span>
              {line.materialFromLab && (
                <span className="font-mono text-[9px] tracking-wider px-1.5 py-0.5 rounded-sm bg-paper text-ink border border-ink/20">
                  +20 cm H · +10 cm W
                </span>
              )}
            </button>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              {line.materialFromLab
                ? "Il costo materiale di questo pezzo è azzerato qui: comparirà come riga automatica in Laboratorio."
                : "Disattiva per far comparire la riga materiale (con margini extra) nel reparto Laboratorio."}
            </div>
            {line.materialFromLab && (
              <div className="mt-2">
                <label className="label-cap block mb-1">Pezzo Laboratorio collegato</label>
                {labPieces.length === 0 ? (
                  <div className="text-[11px] text-destructive font-mono">
                    Nessun pezzo in Laboratorio · creane uno per poterlo collegare
                  </div>
                ) : (
                  <select
                    value={line.linkedLabPieceId ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...line,
                        linkedLabPieceId: e.target.value || null,
                      })
                    }
                    className="input-bare w-full text-sm bg-paper"
                  >
                    <option value="">— auto (per materiale) —</option>
                    {labPieces.map((lp, i) => {
                      const dim =
                        lp.shape === "trapezoid" && Number(lp.widthBottom) > 0
                          ? `${lp.width}/${lp.widthBottom}×${lp.height} ${lp.dimUnit}`
                          : `${lp.width || "?"}×${lp.height || "?"} ${lp.dimUnit}`;
                      const qty = Math.max(1, Math.floor(Number(lp.quantity) || 1));
                      const name = lp.productName || `Pezzo Lab #${i + 1}`;
                      return (
                        <option key={lp.id} value={lp.id}>
                          {`#${String(i + 1).padStart(2, "0")} · ${name} · ${dim} · ×${qty}`}
                        </option>
                      );
                    })}
                  </select>
                )}
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Scegli quale pezzo lavorato in Laboratorio vuoi lavorare anche qui. Se lasci "auto", il sistema accoppia per materiale.
                </div>
              </div>
            )}
          </div>
        )}

        {/* STAMPA — selezione variante (formato/altezza) della voce di listino */}
        {isStampa && (
          <div className="col-span-12 md:col-span-5">
            <label className="label-cap block mb-1">
              Variante listino · {variantOptions[0]?.format === "lastra" ? "formato (B × H)" : "altezza"}
            </label>
            <div className="flex gap-1.5">
              <select
                value={line.variantId ?? (mat.material?.id ?? "")}
                onChange={(e) => onChange({ ...line, variantId: e.target.value || null })}
                disabled={variantOptions.length === 0}
                className="input-bare flex-1 text-sm bg-paper disabled:opacity-50"
              >
                <option value="">— automatica (più conveniente) —</option>
                {variantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v)}{line.rotateSheet && v.format === "lastra" ? " ↻" : ""}
                  </option>
                ))}
              </select>
              {(activeVariant?.format === "lastra" || variantOptions[0]?.format === "lastra") && (
                <button
                  type="button"
                  onClick={() => onChange({ ...line, rotateSheet: !line.rotateSheet })}
                  title="Ruota la lastra del listino scambiando base ↔ altezza (es. 305×122 → 122×305). Il nesting userà le nuove misure."
                  className={`shrink-0 inline-flex items-center justify-center gap-1 px-2.5 border-2 rounded-sm text-[10px] uppercase tracking-wider font-bold transition-colors ${
                    line.rotateSheet
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-ink/40 text-ink/60 hover:border-ink hover:text-ink"
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {line.rotateSheet ? "Ruotata" : "Ruota"}
                </button>
              )}
            </div>
            {!fitCheck.fits && (
              <div className={`mt-1.5 px-2 py-1.5 border rounded-sm text-[10px] ${
                line.bypassFitCheck
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "border-destructive/60 bg-destructive/10 text-destructive"
              }`}>
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-bold uppercase tracking-wider mb-0.5">
                      {line.bypassFitCheck
                        ? "Avviso ignorato manualmente"
                        : "La lavorazione non entra nel formato"}
                    </div>
                    <div>{fitCheck.msg}</div>
                  </div>
                </div>
                <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!line.bypassFitCheck}
                    onChange={(e) => onChange({ ...line, bypassFitCheck: e.target.checked })}
                    className="w-3 h-3 accent-current"
                  />
                  <span className="font-mono uppercase tracking-wider">
                    Bypassa manualmente (procedi comunque)
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* STAMPA — flag "Intero" per usare il moltiplicatore "lastra/rotolo intero" anziché "al taglio" */}
        {isStampa && (
          <>
          <div className="col-span-12 md:col-span-2">
            <label className="label-cap block mb-1">Acquisto</label>
            <button
              type="button"
              onClick={() =>
                onChange({ ...line, priceMode: line.priceMode === "piece" ? "cut" : "piece" })
              }
              className={`w-full inline-flex items-center justify-between gap-2 px-2 py-2 border-2 rounded-sm text-[10px] uppercase tracking-wider font-bold transition-colors ${
                line.priceMode === "piece"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-ink/40 text-ink/60 hover:border-ink hover:text-ink"
              }`}
              title={
                line.priceMode === "piece"
                  ? "Lastra/rotolo intero · moltiplicatore più basso"
                  : "Al taglio · moltiplicatore più alto"
              }
            >
              <span>{line.priceMode === "piece" ? "✓ Intero" : "Al taglio"}</span>
              <span className="font-mono opacity-80">
                ×{customerType === "final"
                  ? line.priceMode === "piece" ? "1.5" : "2.0"
                  : line.priceMode === "piece" ? "1.3" : "1.5"}
              </span>
            </button>
          </div>
          <div className="col-span-12 md:col-span-2">
            <label className="label-cap block mb-1">Sfrido</label>
            <button
              type="button"
              onClick={() => onChange({ ...line, chargeScrap: !line.chargeScrap })}
              className={`w-full inline-flex items-center justify-between gap-2 px-2 py-2 border-2 rounded-sm text-[10px] uppercase tracking-wider font-bold transition-colors ${
                line.chargeScrap
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-ink/40 text-ink/60 hover:border-ink hover:text-ink"
              }`}
              title={
                line.chargeScrap
                  ? "Addebita anche il materiale di scarto del nesting (senza lavorazione)"
                  : "Non addebitare il materiale di scarto"
              }
            >
              <span>{line.chargeScrap ? "✓ Addebita" : "Escluso"}</span>
              <span className="font-mono opacity-80">scarto</span>
            </button>
          </div>
          </>
        )}
      </div>

      {/* Breakdown materiale (calcolato automaticamente) */}
      <div className="mt-4 pt-3 border-t border-dashed border-ink/15">
        {!mat.feasible ? (
          <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/5 rounded-sm">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs text-destructive">{mat.reason ?? "Calcolo non disponibile"}</div>
          </div>
        ) : isStampa ? (
          <div className="grid grid-cols-12 gap-3 text-[11px]">
            <div className="col-span-6 md:col-span-3">
              <div className="label-cap mb-0.5">Pezzo</div>
              <div className="font-mono tabular-nums">
                {fmtM(mat.pieceWidthM)} × {fmtM(mat.pieceHeightM)} m
              </div>
            </div>
            <div className="col-span-6 md:col-span-3">
              <div className="label-cap mb-0.5">Area stampa</div>
              <div className="font-mono tabular-nums font-semibold">
                {areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
              </div>
            </div>
            <div className="col-span-12 md:col-span-3">
              <div className="label-cap mb-0.5">Costo supporto</div>
              <div className="font-mono tabular-nums">
                {mat.material ? `${eur(mat.unitCost)}/${mat.material.unit || mat.material.priceUnit || "mq"}` : "—"}
              </div>
            </div>
            <div className="col-span-12 md:col-span-3 text-right">
              <div className="label-cap mb-0.5">Costo materiale</div>
              <div className="font-mono tabular-nums font-semibold">{eur(mat.materialCost)}</div>
              {mat.material && (
                <div className="font-mono text-[9px] text-muted-foreground">
                  {fmtM(mat.pieceHeightM)} × {fmtM(mat.pieceWidthM)} m + sfrido iniziale
                </div>
              )}
            </div>
            {mat.initialScrapSellCost > 0 && (
              <div className="col-span-12 mt-1 pt-2 border-t border-dashed border-ink/15">
                <div className="flex items-center justify-between mb-1">
                  <div className="label-cap">Sfrido iniziale rotolo</div>
                  <div className="font-mono tabular-nums font-semibold">+{eur(mat.initialScrapSellCost)}</div>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground space-y-0.5">
                  <div>
                    Materiale stampato: {fmtM(mat.pieceHeightM)} m × {fmtM(mat.pieceWidthM)} m ={" "}
                    <span className="text-ink font-semibold">
                      {materialEffectiveAreaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
                    </span>
                  </div>
                  {(() => {
                    const m = mat.material;
                    if (!m) return null;
                    const purchase =
                      typeof m.costPrice === "number"
                        ? m.costPrice
                        : line.priceMode === "piece"
                        ? m.pricePiece
                        : m.priceCut;
                    const purchasePerSqm = priceUnitOf(m) === "mq" ? purchase : purchase / mat.rollWidthM;
                    return (
                      <div>
                        Sfrido iniziale = 1,50 m × {fmtM(mat.rollWidthM)} m ={" "}
                        <span className="text-ink">
                          {initialScrapAreaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
                        </span>{" "}
                        × {eur(purchasePerSqm)}/mq × 1,3 ={" "}
                        <span className="text-ink font-semibold">{eur(mat.initialScrapSellCost)}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {line.chargeScrap && leftoverScrap > 0 && (
              <div className="col-span-12 mt-1 pt-2 border-t border-dashed border-ink/15">
                <div className="flex items-center justify-between mb-1">
                  <div className="label-cap">Scarto nesting (materiale)</div>
                  <div className="font-mono tabular-nums font-semibold">+{eur(leftoverScrap)}</div>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground space-y-0.5">
                  <div>
                    Area teli: {mat.panels} × ({fmtM(mat.rollWidthM)} m × {fmtM(mat.panelLengthM)} m) ={" "}
                    <span className="text-ink">
                      {(mat.panels * mat.rollWidthM * mat.panelLengthM).toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
                    </span>
                  </div>
                  <div>
                    Area occupata dal pezzo sui teli: {fmtM(mat.pieceWidthM)} m × {fmtM(mat.panelLengthM)} m ={" "}
                    <span className="text-ink">
                      {(mat.pieceWidthM * mat.panelLengthM).toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
                    </span>
                  </div>
                  <div>
                    Scarto di lavorazione = area teli − area occupata ={" "}
                    <span className="text-ink font-semibold">
                      {fmtM(scrapWidthM)} m × {fmtM(mat.panelLengthM)} m ={" "}
                      {leftoverM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²
                    </span>
                  </div>
                  {(() => {
                    const m = mat.material;
                    if (!m) return null;
                    const purchase =
                      typeof m.costPrice === "number"
                        ? m.costPrice
                        : line.priceMode === "piece"
                        ? m.pricePiece
                        : m.priceCut;
                    const purchasePerSqm = priceUnitOf(m) === "mq" ? purchase : purchase / mat.rollWidthM;
                    return (
                      <div>
                        Costo = {leftoverM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m² × {eur(purchasePerSqm)}/mq × 1,3 ={" "}
                        <span className="text-ink font-semibold">{eur(leftoverScrap)}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-3 text-[11px]">
            <div className="col-span-6 md:col-span-2">
              <div className="label-cap mb-0.5">Pezzo + margini</div>
              <div className="font-mono tabular-nums">
                {fmtM(mat.pieceWidthM)} × {fmtM(mat.pieceHeightM)} m
              </div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="label-cap mb-0.5">Larghezza rullo</div>
              <div className="font-mono tabular-nums">{fmtM(mat.rollWidthM)} m</div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="label-cap mb-0.5">N. teli</div>
              <div className="font-mono tabular-nums">
                {mat.panels} × {fmtM(mat.panelLengthM)} m
              </div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="label-cap mb-0.5">Tessuto totale</div>
              <div className="font-mono tabular-nums font-semibold">{fmtM(mat.totalMetersM)} m</div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="label-cap mb-0.5">Cuciture teli</div>
              <div className="font-mono tabular-nums">
                {mat.seamLengthM > 0 ? `${fmtM(mat.seamLengthM)} m` : "—"}
              </div>
              {mat.seamLengthM > 0 && mat.seamUnitPrice === 0 && (
                <div className="font-mono text-[9px] text-destructive">
                  Aggiungi "Cucitura" al listino
                </div>
              )}
            </div>
            <div className="col-span-6 md:col-span-2 text-right">
              <div className="label-cap mb-0.5">Costo materiale</div>
              <div className="font-mono tabular-nums font-semibold">{eur(mat.materialCost)}</div>
            </div>
            <div className="col-span-12 mt-1 pt-2 border-t border-dashed border-ink/15 grid grid-cols-12 gap-3">
              <div className="col-span-6 md:col-span-4">
                <div className="label-cap mb-0.5">Materiale lavorato (interno)</div>
                <div className="font-mono tabular-nums">
                  {eur(mat.workingMaterialCost)}
                </div>
                <div className="font-mono text-[9px] text-muted-foreground">
                  {fmtM(mat.totalMetersM)} m × {fmtM(mat.rollWidthM)} m · acquisto
                </div>
              </div>
              <div className="col-span-6 md:col-span-4">
                <div className="label-cap mb-0.5">Sfrido iniziale (interno)</div>
                <div className="font-mono tabular-nums">
                  {mat.initialScrapCost > 0 ? eur(mat.initialScrapCost) : "—"}
                </div>
                {mat.initialScrapCost > 0 && (
                  <div className="font-mono text-[9px] text-muted-foreground">
                    1,50 m × {fmtM(mat.rollWidthM)} m · acquisto
                  </div>
                )}
              </div>
              <div className="col-span-12 md:col-span-4 text-right">
                <div className="label-cap mb-0.5">Costo interno totale</div>
                <div className="font-mono tabular-nums font-semibold">
                  {eur(mat.purchaseCost)}
                </div>
                <div className="font-mono text-[9px] text-muted-foreground">
                  {fmtM(mat.totalMetersM + (mat.initialScrapCost > 0 ? 1.5 : 0))} m totali usati
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2) Disegno tecnico (per Tappezzeria/Falegnameria - per Stampa è dopo i tab) */}
      {!isStampa && (
        <div className="mt-4">
          <TechnicalDrawing
            width={line.width}
            height={line.height}
            unit={line.dimUnit}
            sides={drawSides}
            shape={shape}
            widthBottom={line.widthBottom}
            canvasWidth={520}
            canvasHeight={240}
          />
        </div>
      )}

      {/* 2a) STAMPA — tab Stampa / Taglio / Perimetrale (solo reparto Stampa) */}
      {isStampa && (
        <div className="mt-4 pt-3 border-t border-dashed border-ink/15">
          <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="inline-flex border-2 border-ink rounded-sm overflow-hidden">
            {([
              { k: "stampa", label: "Stampa", Icon: Printer },
              { k: "taglio", label: "Taglio", Icon: Scissors },
              { k: "perimetrale", label: "Perimetrali", Icon: Layers },
              { k: "altre", label: "Altre", Icon: Plus },
            ] as { k: StampaSubTab; label: string; Icon: typeof Printer }[]).map(({ k, label, Icon }) => {
              const isActive = stampaTab === k;
              const count = line.perimeters.filter((pp) => {
                const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
                if (!op) return false;
                return (op.category ?? "perimetrale") === k;
              }).length;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStampaTab(k)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                    isActive ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                  {count > 0 && (
                    <span className={`ml-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-mono font-bold ${
                      isActive ? "bg-paper text-ink" : "bg-primary text-primary-foreground"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          </div>
          {/* Sotto-categorie per Stampa e Taglio */}
          {(stampaTab === "stampa" || stampaTab === "taglio") && (
            <div className="block mb-3">
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
              // {stampaTab === "stampa" ? "Tipo di stampa" : "Macchina di taglio"}
            </div>
            <div className="inline-flex border border-ink/40 rounded-sm overflow-hidden flex-wrap">
              {(stampaTab === "stampa" ? PRINT_SUBS : CUT_SUBS).map(({ k, label }) => {
                const sel = stampaTab === "stampa" ? effectivePrintSub : cutSub;
                const active = sel === k;
                // In stampa, se c'è già un processo applicato, gli altri sono bloccati
                const isLockedDisabled =
                  stampaTab === "stampa" && lockedPrintSub !== null && lockedPrintSub !== k;
                /** Numero di lavorazioni di questa sotto-categoria già applicate al pezzo. */
                const subCount = line.perimeters.filter((pp) => {
                  const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
                  if (!op) return false;
                  if ((op.category ?? "perimetrale") !== stampaTab) return false;
                  return (op.subcategory ?? "") === k;
                }).length;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={isLockedDisabled}
                    onClick={() => stampaTab === "stampa" ? setPrintSub(k) : setCutSub(k)}
                    title={isLockedDisabled ? `Rimuovi prima la stampa ${lockedPrintSub?.toUpperCase()} per cambiare processo` : undefined}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : isLockedDisabled
                        ? "text-ink/30 cursor-not-allowed"
                        : "text-ink/60 hover:text-ink"
                    }`}
                  >
                    {label}
                    {subCount > 0 && (
                      <span className={`inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[8px] font-mono font-bold ${
                        active ? "bg-paper text-ink" : "bg-ink text-paper"
                      }`}>
                        {subCount}
                      </span>
                    )}
                    {stampaTab === "stampa" && active && lockedPrintSub && (
                      <span className="ml-1 font-mono text-[8px] opacity-80">●</span>
                    )}
                  </button>
                );
              })}
            </div>
            {stampaTab === "stampa" && lockedPrintSub && (
              <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                Processo bloccato: rimuovi tutte le lavorazioni di stampa per cambiare tipo.
              </div>
            )}
            </div>
          )}
        </div>
      )}

      {/* 3) Lavorazioni del pezzo: stampa / taglio / perimetrale / altre (Stampa) o solo perimetrali (altri reparti) */}
      {(() => {
        const activeCategory: "stampa" | "taglio" | "perimetrale" | "altre" | undefined =
          isStampa ? stampaTab : undefined;
        const activeSub =
          isStampa && stampaTab === "stampa" ? effectivePrintSub
          : isStampa && stampaTab === "taglio" ? cutSub
          : "";
        const matchSub = (o: { subcategory?: string }) =>
          !activeSub || (o.subcategory ?? "") === activeSub;
        const visibleOps = activeCategory
          ? catalog.perimeterOps.filter((o) => (o.category ?? "perimetrale") === activeCategory && matchSub(o))
          : catalog.perimeterOps;
        const visiblePerimeters = activeCategory
          ? line.perimeters.filter((pp) => {
              const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
              if (!op) return false;
              if ((op.category ?? "perimetrale") !== activeCategory) return false;
              return matchSub(op);
            })
          : line.perimeters;
        const sectionTitle = activeCategory === "stampa"
          ? "Lavorazioni di stampa"
          : activeCategory === "taglio"
          ? "Lavorazioni di taglio"
          : activeCategory === "altre"
          ? "Altre lavorazioni"
          : "Lavorazioni perimetrali";
        return (
        <div className="mt-5 pt-3 border-2 border-accent/60 bg-accent/5 rounded-md p-3 shadow-sm">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="font-mono text-xs uppercase tracking-widest text-accent-foreground font-bold bg-accent px-2 py-1 rounded-sm">
            ⚙ {sectionTitle} · subtot {eur(perimetersTotal)}
          </div>
          <div className="flex items-center gap-2">
            {catalog.perimeterPresets.length > 0 && (
              <select
                value=""
                onChange={(e) => { if (e.target.value) applyPreset(e.target.value); }}
                className="input-bare text-[11px] bg-paper py-1"
                title="Applica un preset (sostituisce le lavorazioni del pezzo)"
              >
                <option value="">↘ Applica preset…</option>
                {catalog.perimeterPresets.map((p: CatalogPerimeterPreset) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => addPerimeter(activeCategory, activeSub || undefined)}
              disabled={visibleOps.length === 0}
              className="inline-flex items-center gap-1.5 px-2 py-1 border border-ink/40 rounded-sm text-[10px] uppercase tracking-wider font-bold hover:bg-ink hover:text-paper transition-colors disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              Aggiungi custom
            </button>
          </div>
        </div>

        {/* Barra preset: checkbox per ogni voce di listino della categoria attiva */}
        {isStampa && visibleOps.length > 0 && (
          <div className="mb-3 p-2 border border-dashed border-ink/20 rounded-sm bg-muted/20">
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
              // Preset listino — seleziona per aggiungere
            </div>
            <div className="flex flex-wrap gap-1.5">
              {visibleOps.map((o) => {
                const active = line.perimeters.some((pp) => pp.opId === o.id);
                const u = o.priceUnit ?? "m";
                const uLabel = u === "m" ? "Mt" : u === "mq" ? "Mq" : u === "pz" ? "Pz" : "Min";
                const p =
                  customerType === "final" && typeof o.priceFinal === "number"
                    ? o.priceFinal
                    : o.pricePerMeter;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => togglePerimeterPreset(o.id)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-wider font-bold transition-colors ${
                      active
                        ? "bg-ink text-paper border-ink"
                        : "border-ink/30 text-ink/70 hover:border-ink hover:text-ink"
                    }`}
                    title={`${eur(p)}/${uLabel}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm border border-current"
                      style={{ backgroundColor: active ? (o.color || "transparent") : "transparent" }}
                    />
                    {o.name}
                    <span className="font-mono opacity-60">{eur(p)}/{uLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {visiblePerimeters.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground border border-dashed border-ink/15 rounded-sm">
            Nessuna {activeCategory === "taglio" ? "lavorazione di taglio" : "lavorazione"}. {visibleOps.length === 0 ? "Apri il listino lavorazioni per definire i tipi." : "Aggiungi una riga."}
          </div>
        ) : (
          <div className="space-y-2">
            {visiblePerimeters.map((pp) => {
              const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
              const opUnit = op?.priceUnit ?? "m";
              const isMq = opUnit === "mq";
              const isPz = opUnit === "pz";
              const isMin = opUnit === "min";
              const isManualQty = isPz || isMin;
              /** I lati (selettori) hanno senso SOLO per lavorazioni perimetrali con prezzo €/m.
               *  - Per le altre categorie (stampa/taglio/altre): nascosti.
               *  - Per lavorazioni a €/mq, €/pz, €/min: nascosti (la quantità è area o manuale). */
              const isPerimeterCategory = !isStampa || activeCategory === "perimetrale";
              const showSides = isPerimeterCategory && opUnit === "m";
              const opPrice =
                customerType === "final" && typeof op?.priceFinal === "number"
                  ? op.priceFinal
                  : op?.pricePerMeter ?? 0;
              const isTiro = isTiroAPacchetto(op?.name || "");
              const meters = pp.sides.reduce((acc, s) => acc + sideLengthM(s, line.width, line.height, line.dimUnit), 0);
              const areaM2 = pieceAreaM2({ width: line.width, height: line.height, dimUnit: line.dimUnit });
              // Tiro a pacchetto: n.file × altezza × €/m
              const widthM = sideLengthM("top", line.width, line.height, line.dimUnit);
              const heightM = sideLengthM("left", line.width, line.height, line.dimUnit);
              const files = isTiro ? tiroFiles(widthM) : 0;
              const tiroQtyM = files * heightM;
              // Per le lavorazioni a "pezzo" la quantità coincide con la quantità del pezzo
              // (es. una squadratura per ogni pezzo). Per "minuto" resta inserimento manuale.
              const manualQ = isPz ? qty : Math.max(0, Number(pp.quantity) || 0);
              const perimQty = isTiro
                ? tiroQtyM
                : isManualQty
                ? manualQ
                : isMq
                ? areaM2
                : meters;
              const cost = opPrice * perimQty;
              return (
                <div key={pp.id} className="grid grid-cols-12 gap-2 items-end p-2 border border-ink/10 rounded-sm">
                  <div className="col-span-12 md:col-span-3">
                    <label className="label-cap block mb-1">Lavorazione</label>
                    <select
                      value={pp.opId}
                      onChange={(e) => setPerimeterOp(pp.id, e.target.value)}
                      className="input-bare w-full text-sm bg-paper"
                    >
                      {visibleOps.map((o) => {
                        const u = o.priceUnit ?? "m";
                        const uLabel = u === "m" ? "Mt" : u === "mq" ? "Mq" : u === "pz" ? "Pz" : "Min";
                        const p =
                          customerType === "final" && typeof o.priceFinal === "number"
                            ? o.priceFinal
                            : o.pricePerMeter;
                        return (
                          <option key={o.id} value={o.id}>
                            {o.name} · {eur(p)}/{uLabel}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="col-span-10 md:col-span-6">
                    <label className="label-cap block mb-1 inline-flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      {isTiro
                        ? `Tiri automatici · ${files} file × ${fmtM(heightM)} m`
                        : isPz
                        ? `Quantità · ${qty} pz (= q.tà pezzo)`
                        : isMin
                        ? `Quantità (${isPz ? "pezzi" : "minuti"})`
                        : isMq
                        ? `Area pezzo · ${areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²`
                        : showSides
                        ? `Lati (${pp.sides.length}/4)`
                        : `Lunghezza · ${meters.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m`}
                    </label>
                    {isTiro ? (
                      <div className="px-2 py-1.5 border border-dashed border-ink/30 rounded-sm font-mono text-[10px] text-muted-foreground bg-muted/20">
                        {widthM <= 0 || heightM <= 0
                          ? "Imposta dimensioni del pezzo"
                          : `Larghezza ${fmtM(widthM)} m → ${files} file (${
                              widthM <= 6
                                ? "≤ 6 m"
                                : widthM <= 9
                                ? "6–9 m"
                                : widthM <= 12
                                ? "9–12 m"
                                : "> 12 m: 1 fila / 160 cm"
                            }) × altezza ${fmtM(heightM)} m`}
                      </div>
                    ) : isPz ? (
                      <div className="px-2 py-1.5 border border-dashed border-ink/30 rounded-sm font-mono text-xs text-muted-foreground bg-muted/20 flex items-center justify-between">
                        <span>Sincronizzato con la q.tà del pezzo</span>
                        <span className="font-semibold text-ink">{qty} pz</span>
                      </div>
                    ) : isMin ? (
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={manualQ === 0 ? "" : manualQ}
                        onChange={(e) => setPerimeterQty(pp.id, parseFloat(e.target.value) || 0)}
                        placeholder="n. minuti"
                        className="input-bare w-full font-mono text-sm text-right"
                      />
                    ) : !showSides ? (
                      <div className="px-2 py-1.5 border border-dashed border-ink/30 rounded-sm font-mono text-[10px] text-muted-foreground bg-muted/20">
                        {isMq
                          ? `Area = ${areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m² × ${eur(opPrice)}/mq`
                          : `Lunghezza = ${meters > 0 ? meters.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "—"} m × ${eur(opPrice)}/m`}
                      </div>
                    ) : (
                    <div className="grid grid-cols-4 gap-1">
                      {SIDES.map((s) => {
                        const active = pp.sides.includes(s);
                        const len = sideLengthM(s, line.width, line.height, line.dimUnit);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => togglePerimeterSide(pp.id, s)}
                            title={`${SIDE_LABEL[s]} · ${len.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m`}
                            className={`px-1.5 py-1 rounded-sm border text-[10px] uppercase tracking-wider font-bold transition-colors ${
                              active ? "border-current text-paper" : "border-ink/30 text-ink/60 hover:border-ink"
                            }`}
                            style={active ? { backgroundColor: op?.color || "hsl(220 14% 35%)", borderColor: "transparent" } : undefined}
                          >
                            {SIDE_LABEL[s]}
                          </button>
                        );
                      })}
                    </div>
                    )}
                  </div>
                  <div className="col-span-12 md:col-span-2 text-right">
                    <div className="label-cap mb-1">Costo</div>
                    <div className="font-mono text-sm font-semibold tabular-nums">{eur(cost)}</div>
                    <div className="font-mono text-[9px] text-muted-foreground">
                      {isTiro
                        ? `${files} × ${fmtM(heightM)} m`
                        : isManualQty
                        ? `${manualQ} ${isPz ? "pz" : "min"}`
                        : isMq
                        ? `${areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²`
                        : `${meters.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m`}
                    </div>
                  </div>
                  <div className="col-span-12 md:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removePerimeter(pp.id)}
                      aria-label="Rimuovi"
                      className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cucitura inter-telo (automatica, mostrata solo se attiva) */}
        {!isStampa && mat.feasible && mat.seamLengthM > 0 && (
          <div className="mt-2 grid grid-cols-12 gap-2 items-center p-2 border border-dashed border-ink/30 rounded-sm bg-muted/30">
            <div className="col-span-12 md:col-span-9 inline-flex items-center gap-2 text-[11px]">
              <Scissors className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold">Cucitura tra teli</span>
              <span className="font-mono text-muted-foreground">
                · {mat.panels - 1} cucitur{mat.panels - 1 === 1 ? "a" : "e"} ×{" "}
                {fmtM(mat.panelLengthM)} m = {fmtM(mat.seamLengthM)} m
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                ({eur(mat.seamUnitPrice)}/m)
              </span>
            </div>
            <div className="col-span-12 md:col-span-3 text-right font-mono text-sm font-semibold tabular-nums">
              {eur(mat.seamCost)}
            </div>
          </div>
        )}
        </div>
        );
      })()}

      {/* Disegno tecnico per Stampa: dopo i tab Stampa/Taglio/Perimetrali */}
      {isStampa && (
        <div className="mt-4">
          <TechnicalDrawing
            width={line.width}
            height={line.height}
            unit={line.dimUnit}
            sides={drawSides}
            shape={shape}
            widthBottom={line.widthBottom}
            canvasWidth={520}
            canvasHeight={240}
          />
        </div>
      )}

      {/* Lavorazioni libere (forfettarie, una tantum) */}
      <div className="mt-4 pt-3 border-t border-dashed border-ink/15">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">
            // Lavorazioni libere · subtot {eur(customWorksTotal)}
          </div>
          <button
            type="button"
            onClick={addCustomWork}
            className="inline-flex items-center gap-1.5 px-2 py-1 border border-ink/40 rounded-sm text-[10px] uppercase tracking-wider font-bold hover:bg-ink hover:text-paper transition-colors"
          >
            <Plus className="w-3 h-3" />
            Aggiungi libera
          </button>
        </div>

        {customWorks.length === 0 ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground border border-dashed border-ink/15 rounded-sm">
            Nessuna lavorazione libera. Usa per aggiunte fuori listino con prezzo forfettario.
          </div>
        ) : (
          <div className="space-y-2">
            {customWorks.map((w) => (
              <div key={w.id} className="grid grid-cols-12 gap-2 items-end p-2 border border-ink/10 rounded-sm">
                <div className="col-span-12 md:col-span-8">
                  <label className="label-cap block mb-1">Descrizione</label>
                  <input
                    type="text"
                    value={w.name}
                    onChange={(e) => updateCustomWork(w.id, { name: e.target.value })}
                    placeholder="es. Modifica su misura, trasporto, montaggio…"
                    className="input-bare w-full text-sm"
                  />
                </div>
                <div className="col-span-10 md:col-span-3">
                  <label className="label-cap block mb-1">Prezzo €</label>
                  <input
                    type="number"
                    step="0.01"
                    value={w.price === 0 ? "" : w.price}
                    onChange={(e) =>
                      updateCustomWork(w.id, { price: parseFloat(e.target.value) || 0 })
                    }
                    placeholder="0.00"
                    className="input-bare w-full font-mono text-sm text-right"
                  />
                </div>
                <div className="col-span-2 md:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeCustomWork(w.id)}
                    aria-label="Rimuovi"
                    className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subtotali pezzo: Materiali / Lavorazioni / Totale */}
      <div className="mt-4 pt-3 border-t-2 border-ink/30 grid grid-cols-3 gap-3">
        <div>
          <div className="label-cap mb-0.5">Subtot. materiali {qty > 1 ? `× ${qty}` : ""}</div>
          <div className="font-mono text-sm font-semibold tabular-nums">{eur(materialsSubtotalDisplay)}</div>
        </div>
        <div>
          <div className="label-cap mb-0.5">Subtot. lavorazioni {qty > 1 ? `× ${qty}` : ""}</div>
          <div className="font-mono text-sm font-semibold tabular-nums">{eur(worksSubtotalDisplay)}</div>
          {!isStampa && mat.feasible && mat.seamCost > 0 && (
            <div className="font-mono text-[9px] text-muted-foreground">
              di cui cuciture {eur(mat.seamCost * qty)}
            </div>
          )}
          {isStampa && leftoverScrap > 0 && (
            <div className="font-mono text-[9px] text-muted-foreground">
              di cui sfrido nesting {eur(leftoverScrap * qty)}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="label-cap mb-0.5">Totale pezzo</div>
          <div className="font-mono text-base font-bold tabular-nums">{eur(total)}</div>
        </div>
      </div>
      </>
      )}
    </motion.div>
  );
};