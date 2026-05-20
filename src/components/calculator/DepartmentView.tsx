import { AnimatePresence, motion } from "framer-motion";
import { Plus, Wrench, Package, FileSpreadsheet, RotateCcw, Layers3 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { CatalogPanel } from "./CatalogPanel";
import { MaterialRow } from "./MaterialRow";
import { PieceCard } from "./PieceCard";
import { NestingPanel } from "./NestingPanel";
import { InventoryDeptView } from "@/components/produzione/InventoryDeptView";
import { InvDept } from "@/lib/produzione/types";
import { Catalog, DepartmentState, MaterialLine, PieceLine, TransportLine } from "./types";
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
import { computeNesting } from "@/lib/nesting";
import { materialAwareCatalog, withoutInitialScrap } from "@/lib/piece-catalog";
import { CustomerType, CUSTOMER_LABEL, priceMultiplier } from "@/lib/pricing";
import { CreateCommessaButton } from "./CreateCommessaButton";
import { CommessaReparto } from "@/components/flow/types";
import { copyLabDimensions, findLabDimensionSource } from "@/lib/lab-sync";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

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
}

export const DepartmentView = ({
  deptKey, deptLabel, description, catalog, setCatalog,
  state, setState, templateUrl, templateName, customerType, labCatalog, labPieces = [],
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
  const pieces = state.pieces ?? [];

  // ---- Nesting per gruppo materiale (per "Lastre per materiale" + sfrido addebitabile) ----
  // Uso un catalogo "uniforme": stessa logica per tutti i pezzi del gruppo.
  // Tappezzeria salta lo sfrido iniziale (coerente con la card pezzo).
  const nestingCatalog =
    deptKey === "tappezzeria" ? withoutInitialScrap(catalog) : catalog;
  const nestingGroups = computeNesting(pieces, nestingCatalog, customerType);
  const chargeNestingScrap = state.nestingState?.chargeNestingScrap ?? {};
  // Solo gruppi LASTRA: lo sfrido per-lastra ha senso lì (per il rotolo c'è già
  // lo sfrido iniziale 1,5 m e l'opzione per-pezzo).
  const lastraGroups = nestingGroups.filter((g) => g.format === "lastra");
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

  const piecesBaseTotal =
    pieces.reduce(
      (s, p) => s + pieceTotal(p, matCat(p), customerType),
      0,
    ) -
    // Lo sfrido (1,5 m linerai) si conta una sola volta per stesso materiale: tolgo i duplicati.
    aggregateScrapDeduction(
      pieces,
      (p) => matCat(p),
      () => customerType,
    ) +
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
  const workBreakdown = pieces.reduce(
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
    pieces.reduce(
      (s, p) => s + pieceMaterialTotalQty(p, matCat(p), customerType),
      0,
    ) -
    aggregateScrapDeduction(
      pieces,
      (p) => matCat(p),
      () => customerType,
    );

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
    const base = pieces.map((p) => {
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
      let initialScrap = 0;
      if (b.key) {
        const g = groupScrap.get(b.key);
        if (g && g.totalArea > 0) {
          initialScrap = (b.areaTot / g.totalArea) * g.totalScrap;
        } else {
          // fallback: nessuna area utile → resta sul primo pezzo
          initialScrap = b.initialScrapFull;
        }
      }
      const total = b.material + initialScrap + b.wb.total;
      return {
        piece: b.piece,
        qty: b.qty,
        material: b.material,
        initialScrap,
        leftoverScrap: b.leftoverScrap,
        work: b.wb,
        total,
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
    };
    setState({ ...state, pieces: [...pieces, newLine] });
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
              {nestingScrapExtra > 0 && (
                <SummaryStat label="Sfrido lastre" value={nestingScrapExtra} />
              )}
              <SummaryStat label="N. pezzi" value={totalPiecesQty} unit="pezzi" />
            </div>

            {/* Lastre per materiale + checkbox "Addebita sfrido" */}
            {lastraGroups.length > 0 && (
              <div className="mt-3 pt-3 border-t border-ink/10">
                <div className="label-cap mb-2">Lastre per materiale</div>
                <div className="space-y-1.5">
                  {lastraGroups.map((g) => {
                    const sheets = g.sheetsNeeded ?? 0;
                    const leftoverM2 = Math.max(0, g.totalAreaM2 - g.usedAreaM2);
                    const sellPerSqm =
                      g.totalAreaM2 > 0
                        ? g.materialCostOptimized / g.totalAreaM2
                        : 0;
                    const extra = leftoverM2 * sellPerSqm;
                    const checked = !!chargeNestingScrap[g.key];
                    const dim =
                      g.sheetWidthM && g.sheetHeightM
                        ? ` · ${Math.round(g.sheetWidthM * 100)}×${Math.round(
                            g.sheetHeightM * 100,
                          )} cm`
                        : "";
                    return (
                      <div
                        key={g.key}
                        className="flex items-center justify-between gap-3 p-2 border border-ink/15 rounded-sm bg-paper font-mono text-[11px]"
                      >
                        <div className="flex-1 min-w-0 truncate">
                          <span className="font-semibold">{g.label}</span>
                          <span className="text-muted-foreground">{dim}</span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="tabular-nums">
                            <strong>{sheets}</strong>{" "}
                            <span className="text-muted-foreground">lastre</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            sfrido {leftoverM2.toFixed(2)} m²
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {eur(extra)}
                          </span>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
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
                              className="w-3.5 h-3.5"
                            />
                            <span className="uppercase tracking-wider text-[10px]">
                              Addebita sfrido
                            </span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {perPieceTotals.length > 0 && (
              <div className="mt-3 pt-3 border-t border-ink/10">
                <div className="label-cap mb-2">Prezzo per lavorazione</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {perPieceTotals.map(
                    ({ piece, qty, material, initialScrap, leftoverScrap, work, total }, i) => {
                      const name = piece.productName?.trim() || `Pezzo ${i + 1}`;
                      // "Sfrido" mostra solo lo sfrido iniziale rotolo (1,5 m).
                      // Lo sfrido di lavorazione (leftover dei teli) è una lavorazione
                      // ed è già incluso in work.total → riga "Lavorazione".
                      const sfrido = initialScrap;
                      // "Lavorazione" = somma di tutte le voci di lavoro ESCLUSO lo scarto,
                      // che mostriamo come riga separata (work.scrap = leftoverScrap × qty).
                      const scarto = work.scrap;
                      const lavorazione = work.total - scarto;
                      const rows: { label: string; value: number }[] = [
                        { label: "Materiale", value: material },
                        { label: "Sfrido iniziale", value: sfrido },
                        { label: "Lavorazione", value: lavorazione },
                        { label: "Scarto", value: scarto },
                      ].filter((r) => r.label === "Materiale" || Math.abs(r.value) > 0.005);
                      const unitPrice = qty > 0 ? total / qty : total;
                      // Prezzo per metro quadro: si calcola sul singolo pezzo
                      // (unitPrice = prezzo di una copia) diviso l'area del pezzo in m².
                      const toM = (v: number) =>
                        piece.dimUnit === "mm"
                          ? v / 1000
                          : piece.dimUnit === "cm"
                            ? v / 100
                            : v;
                      const wM = toM(Number(piece.width) || 0);
                      const hM = toM(Number(piece.height) || 0);
                      // Per il trapezio uso la base media; altrimenti area del rettangolo.
                      const wbM = toM(Number(piece.widthBottom) || 0);
                      const areaM2 =
                        piece.shape === "trapezoid" && wbM > 0
                          ? ((wM + wbM) / 2) * hM
                          : wM * hM;
                      const pricePerSqm = areaM2 > 0 ? unitPrice / areaM2 : 0;
                      // Etichetta dimensioni del pezzo, es. "240×120 cm" o "2,40×1,20 m"
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
                        <div
                          key={piece.id}
                          className="border border-ink/15 rounded-sm bg-paper p-2.5 font-mono text-[11px]"
                        >
                          <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-ink/10">
                            <span className="text-muted-foreground">
                              #{i + 1} · {name}
                              {qty > 1 ? ` ×${qty}` : ""}
                              {dimLabel && (
                                <span className="ml-1.5 text-ink/70">· {dimLabel}</span>
                              )}
                            </span>
                            <span className="font-semibold tabular-nums text-[12px]">{eur(total)}</span>
                          </div>
                          <div className="space-y-0.5">
                            {rows.map((r, idx) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span>{r.label}</span>
                                <span className="tabular-nums">{eur(r.value)}</span>
                              </div>
                            ))}
                          </div>
                          {(qty > 1 || pricePerSqm > 0) && (
                            <div className="mt-1.5 pt-1.5 border-t border-ink/10 space-y-0.5 text-primary">
                              {qty > 1 && (
                                <div className="flex items-center justify-between">
                                  <span className="uppercase tracking-wider text-[10px]">
                                    Prezzo unitario ({qty} pz)
                                  </span>
                                  <span className="tabular-nums font-semibold">
                                    {eur(unitPrice)}
                                  </span>
                                </div>
                              )}
                              {pricePerSqm > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="uppercase tracking-wider text-[10px]">
                                    Prezzo al m² ({areaM2.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²)
                                  </span>
                                  <span className="tabular-nums font-semibold">
                                    {eur(pricePerSqm)}/m²
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}
          </div>

          <section className="panel p-6">
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

            <AnimatePresence initial={false}>
                {(() => {
                  // Per ogni gruppo "scrapKey" lo sfrido va contato una sola volta:
                  // lo lasciamo nel PRIMO pezzo del gruppo, gli altri lo escludono
                  // (così la somma delle card = totale lavorazioni del reparto).
                  const seenScrap = new Set<string>();
                  return pieces.map((p, i) => {
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
                <PieceCard
                  key={p.id}
                  index={i}
                    line={displayedPiece}
                  catalog={deptKey === "tappezzeria" ? withoutInitialScrap(catalog) : catalog}
                  dept={deptKey}
                  customerType={customerType}
                  labCatalog={labCatalog}
                  labPieces={labPieces}
                  scrapDeducted={scrapDeducted}
                  onChange={(line) =>
                    setState({
                      ...state,
                      pieces: pieces.map((x) => (x.id === p.id ? line : x)),
                    })
                  }
                  onRemove={() =>
                    setState({
                      ...state,
                      pieces: pieces.filter((x) => x.id !== p.id),
                    })
                  }
                />
                  );
                  });
                })()}
            </AnimatePresence>
            {pieces.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Nessun pezzo. Aggiungi il primo per iniziare.
              </div>
            )}

            <button
              type="button"
              onClick={addPiece}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary hover:text-ink transition-colors group"
            >
              <span className="w-5 h-5 grid place-items-center rounded-sm border-2 border-current group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Plus className="w-3 h-3" strokeWidth={3} />
              </span>
              Aggiungi pezzo
            </button>
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
