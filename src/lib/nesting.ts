import { Catalog, CatalogMaterial, PieceLine, PieceShape } from "@/components/calculator/types";
import { convertLength, DimUnit } from "./perimeter";
import { materialUnitCost } from "./material-match";
import { MARGIN_WIDTH_CM, MARGIN_HEIGHT_CM, pieceMaterialTotal, pieceSeamTotal, pieceHemAllowanceM, seamUnitPrice } from "./piece";
import { CustomerType } from "./pricing";

/**
 * Nesting di pezzi su un telo (rullo) di larghezza fissa.
 * Algoritmo: Shelf / First-Fit Decreasing con appaiamento di triangoli e
 * trapezi (riducono lo sfrido reale rispetto al solo bounding box).
 *
 * Tutte le dimensioni interne sono in metri.
 */

/**
 * Bordo di sicurezza (cm) aggiunto a tutti e 4 i lati del bbox di OGNI pezzo
 * per il fitting. Disattivato (0): le abbondanze sono ora gestite per-lato in
 * base alle lavorazioni perimetrali; non vogliamo margini "a priori" che
 * impediscano il fit. Il valore resta esposto per retro-compatibilità.
 */
export const NESTING_SAFETY_BORDER_CM = 0;
const NESTING_SAFETY_BORDER_M = NESTING_SAFETY_BORDER_CM / 100;

export type NestingPieceItem = {
  pieceId: string;
  /** indice della copia (0..quantity-1) */
  copy: number;
  /** label visibile ("P03" o "P03·2/4") */
  label: string;
  /** larghezza/altezza con margini, in metri */
  w: number;
  h: number;
  /** ruotato 90° dall'algoritmo */
  rotated: boolean;
  /** posizione finale sul telo (origine in alto a sinistra) */
  x: number;
  y: number;
  shape: PieceShape;
  /** per trapezio: base minore (in m, dopo margini) */
  widthBottomM?: number;
  /** se questo item è la metà di una coppia di triangoli/trapezi: id dell'altra metà */
  pairedWith?: string;
  /** "primary" disegna il poligono pieno; "secondary" lo disegna ribaltato/specchiato sopra al primary */
  pairRole?: "primary" | "secondary";
  /** Indice della lastra/foglio (0-based) in cui è collocato. */
  sheetIndex?: number;
};

export type NestingGroup = {
  /** chiave del gruppo: productName|color|fireproof oppure "free:<key>" */
  key: string;
  label: string;
  /** materiale di riferimento (variante più alta che riesce a contenere il pezzo più grande) */
  material: CatalogMaterial | null;
  rollWidthM: number;
  unitPrice: number;
  /** lunghezza totale del telo necessaria, in metri */
  totalLengthM: number;
  /** area utile (rollWidthM × totalLengthM), m² */
  totalAreaM2: number;
  /** area effettivamente coperta dai pezzi (forme reali, già con margini), m² */
  usedAreaM2: number;
  /** sfrido in % (1 - usedArea/totalArea) */
  wastePct: number;
  /** costo materiale ottimizzato */
  materialCostOptimized: number;
  /** costo INTERNO (acquisto) sui metri lineari realmente usati + sfrido iniziale */
  materialCostInternal: number;
  /** costo materiale "ingenuo" = somma dei costi materiale dei singoli pezzi (senza nesting) */
  materialCostNaive: number;
  /** risparmio (naive - optimized) */
  savings: number;
  items: NestingPieceItem[];
  /** pezzi che non si è riusciti a piazzare (es. troppo larghi) */
  unplaced: { pieceId: string; label: string; reason: string }[];
  /** Formato del materiale del gruppo: "lastra" | "rotolo" (default rotolo se assente) */
  format: "lastra" | "rotolo";
  /** Costo extra per sfrido iniziale rotolo (1,5 m × altezza rullo × €/mq × 1,3). 0 se lastra. */
  scrapCost: number;
  /** Costo aggiunto per il minimo di fatturazione lastra (0,5 m²). 0 se non applicato. */
  minBillingExtra: number;
  /** Solo per format = "lastra": numero di lastre necessarie per coprire il layout. */
  sheetsNeeded?: number;
  /** Solo per format = "lastra": altezza singola lastra in metri. */
  sheetHeightM?: number;
  /** Solo per format = "lastra": larghezza singola lastra in metri (dalla baseWidth catalogo). */
  sheetWidthM?: number;
  /** Lunghezza totale di cucitura verticale (m) introdotta dallo split di pezzi
   *  più larghi della larghezza del rullo. 0 se nessuno split necessario. */
  seamLengthM?: number;
  /** Costo cucitura (€) = seamLengthM × prezzo €/m della voce "Cucitura" del listino. */
  seamCost?: number;
  /** Quando il gruppo è stato ricomputato con bin eterogenei (sfridi + lastre miste),
   *  questo array contiene un elemento per ogni "foglio" usato — con dimensioni
   *  proprie. `items[i].sheetIndex` punta a `mixedSheets[i]`. */
  mixedSheets?: NestingMixedSheet[];
  /** % di sfruttamento medio della larghezza del rotolo (0..1).
   *  = areaUsata / (rollWidth × totalLength) ma calcolata "in larghezza":
   *  = (areaUsata / totalLength) / rollWidth. Indica quanto della larghezza
   *  disponibile viene effettivamente coperta dai pezzi. */
  widthUsagePct?: number;
  /** Metri di larghezza non utilizzati in media per ogni metro lineare di rotolo
   *  (rollWidth − areaUsata/totalLength). 0 = larghezza sfruttata al 100%. */
  widthUnusedM?: number;
  /** Lunghezza che si sarebbe consumata sommando i singoli pezzi senza nesting
   *  (somma di panelLengthM × panels per pezzo, equivalente al "naive" lineare). */
  naiveLengthM?: number;
  /** Metri lineari di rotolo risparmiati dal nesting rispetto al calcolo per-pezzo. */
  lengthSavedM?: number;
};

const factorOf = (u: DimUnit) => (u === "m" ? 1 : u === "cm" ? 0.01 : 0.001);

const pieceQty = (p: PieceLine) => Math.max(1, Math.floor(Number(p.quantity) || 1));

const normMaterialText = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

const materialGroupKey = (
  p: Pick<PieceLine, "productName" | "color" | "fireproof" | "thickness" | "finish" | "variantId" | "catalogMaterialId">,
) =>
  [p.productName, p.color, p.fireproof, p.thickness, p.finish, p.variantId ?? p.catalogMaterialId]
    .map(normMaterialText)
    .join("||");

const materialPriceUnit = (m: CatalogMaterial): "mq" | "ml" => {
  if (m.priceUnit === "mq" || m.priceUnit === "ml") return m.priceUnit;
  const unit = String(m.unit || "").trim().toLowerCase();
  return unit === "mq" || unit === "m²" || unit === "m2" ? "mq" : "ml";
};

/** Override formato per il nesting: dimensioni del foglio in metri + quantità disponibile.
 *  Se `quantity` è 0 o assente, è considerato illimitato (l'algoritmo aggiungerà fogli a piacere
 *  e segnalerà i mancanti). Quando `quantity > 0`, gli items oltre la disponibilità finiscono
 *  in `unplaced`. */
export type NestingFormatOverride = {
  source: "catalog" | "custom";
  /** larghezza foglio (m) */
  widthM: number;
  /** altezza foglio (m); per i rotoli può essere anche molto grande */
  heightM: number;
  /** quantità disponibile (0 = illimitato) */
  quantity?: number;
  /** etichetta da mostrare (es. "Lastra 305×205 cm") */
  label?: string;
};

/** Bin reale (sfrido o lastra intera) usato per il packing eterogeneo.
 *  Ogni bin ha dimensioni proprie e una etichetta umana. */
export type NestingMixedBin = {
  kind: "scrap" | "sheet";
  /** id magazzino (sfrido o inventory_items) */
  id: string;
  widthM: number;
  heightM: number;
  /** etichetta breve per UI (codice + dimensioni) */
  label: string;
};

/** Foglio risultante dal packing su bin eterogenei: stesse dimensioni del bin,
 *  con riferimento al bin originale (per etichetta nella canvas). */
export type NestingMixedSheet = {
  bin: NestingMixedBin;
  widthM: number;
  heightM: number;
};

/** Area reale (m²) della forma del pezzo INCLUSI i margini di lavorazione e l'allowance per orli. */
const realAreaWithMarginsM2 = (p: PieceLine, hem: { addW: number; addH: number } = { addW: 0, addH: 0 }): number => {
  const f = factorOf(p.dimUnit);
  const mW = p.noMargins ? 0 : MARGIN_WIDTH_CM / 100;
  const mH = p.noMargins ? 0 : MARGIN_HEIGHT_CM / 100;
  const wM = (p.width || 0) * f + mW + hem.addW;
  const hM = (p.height || 0) * f + mH + hem.addH;
  if (wM <= 0 || hM <= 0) return 0;
  const shape = p.shape ?? "rect";
  if (shape === "triangle") return (wM * hM) / 2;
  if (shape === "trapezoid") {
    const wbBase = (p.widthBottom || p.width || 0) * f;
    const wbM = wbBase + mW + hem.addW;
    return ((wM + wbM) * hM) / 2;
  }
  return wM * hM;
};

/** Bounding box del pezzo + margini + orli in metri */
const bboxM = (p: PieceLine, hem: { addW: number; addH: number } = { addW: 0, addH: 0 }): { w: number; h: number; widthBottomM: number } => {
  const f = factorOf(p.dimUnit);
  const mW = p.noMargins ? 0 : MARGIN_WIDTH_CM / 100;
  const mH = p.noMargins ? 0 : MARGIN_HEIGHT_CM / 100;
  // Bordo di sicurezza 2 cm per lato (totale +4 cm su base e altezza), applicato
  // SEMPRE — anche se p.noMargins è true — perché serve per garantire che la
  // lastra contenga il pezzo con tolleranza.
  const safety = 2 * NESTING_SAFETY_BORDER_M;
  const w = (p.width || 0) * f + mW + hem.addW + safety;
  const h = (p.height || 0) * f + mH + hem.addH + safety;
  const wb = ((p.widthBottom ?? p.width) || 0) * f + mW + hem.addW + safety;
  return { w, h, widthBottomM: wb };
};

/** Costruisce una mappa pieceId → allowance di orli (m). */
const buildHemMap = (
  pieces: PieceLine[],
  catalog: Catalog,
): Map<string, { addW: number; addH: number }> => {
  const m = new Map<string, { addW: number; addH: number }>();
  for (const p of pieces) m.set(p.id, pieceHemAllowanceM(p, catalog));
  return m;
};

const hemOf = (
  hemMap: Map<string, { addW: number; addH: number }> | undefined,
  id: string,
): { addW: number; addH: number } => hemMap?.get(id) ?? { addW: 0, addH: 0 };

/** Filtra varianti compatibili (nome/colore/ignifugo) con altezza in metri. */
const candidateVariants = (
  materials: CatalogMaterial[],
  productName: string,
  color: string,
  fireproof: string,
  thickness?: string,
  finish?: string,
  variantId?: string | null,
): { material: CatalogMaterial; heightM: number }[] => {
  if (variantId) {
    const selected = materials.find((m) => m.id === variantId);
    if (selected) {
      const v = parseFloat(String(selected.height).replace(",", "."));
      const u: DimUnit = (["mm", "cm", "m"] as const).includes(selected.heightUnit as DimUnit)
        ? (selected.heightUnit as DimUnit)
        : "cm";
      const heightM = isFinite(v) && v > 0 ? convertLength(v, u, "m") : 0;
      return heightM > 0 ? [{ material: selected, heightM }] : [];
    }
  }
  const pn = normMaterialText(productName);
  const cn = normMaterialText(color);
  const fn = normMaterialText(fireproof);
  const tn = normMaterialText(thickness);
  const fin = normMaterialText(finish);
  return materials
    .filter((m) => normMaterialText(m.name) === pn)
    .filter((m) => (cn ? normMaterialText(m.color) === cn : true))
    .filter((m) => normMaterialText(m.fireproof) === fn)
    .filter((m) => (tn ? normMaterialText(m.thickness) === tn : true))
    .filter((m) => (fin ? normMaterialText(m.finish) === fin : true))
    .map((m) => {
      const v = parseFloat(String(m.height).replace(",", "."));
      const u: DimUnit = (["mm", "cm", "m"] as const).includes(m.heightUnit as DimUnit)
        ? (m.heightUnit as DimUnit)
        : "cm";
      return { material: m, heightM: isFinite(v) && v > 0 ? convertLength(v, u, "m") : 0 };
    })
    .filter((x) => x.heightM > 0)
    .sort((a, b) => a.heightM - b.heightM);
};

/** Sceglie la variante minima che copre il bbox più alto del gruppo (allowRotation considerato per pezzo). */
const pickRollVariant = (
  variants: { material: CatalogMaterial; heightM: number }[],
  pieces: PieceLine[],
  hemMap?: Map<string, { addW: number; addH: number }>,
): { material: CatalogMaterial; heightM: number } | null => {
  if (variants.length === 0) return null;
  // Per i ROTOLI conta solo l'altezza rullo (= heightM della variante).
  // Per le LASTRE invece il foglio ha sia base (baseWidth) sia altezza (height): un pezzo
  // entra se il suo bbox sta dentro il rettangolo W×H (con rotazione se abilitata).
  const isLastra = (variants[0]?.material?.format ?? "rotolo") === "lastra";
  const fits = variants.filter((v) => {
    if (!isLastra) {
      // rotolo: serve almeno l'altezza rullo
      let minRequired = 0;
      for (const p of pieces) {
        const { w, h } = bboxM(p, hemOf(hemMap, p.id));
        const need = p.allowRotation ? Math.min(w, h) : h;
        if (need > minRequired) minRequired = need;
      }
      return v.heightM >= minRequired;
    }
    // lastra: leggo baseWidth × height del foglio
    const u = (v.material.dimUnit || v.material.heightUnit || "cm") as DimUnit;
    const sheetWRaw = parseFloat(String(v.material.baseWidth || "0").replace(",", "."));
    const sheetHRaw = parseFloat(String(v.material.height || "0").replace(",", "."));
    const sheetW = sheetWRaw > 0 ? sheetWRaw * factorOf(u) : v.heightM;
    const sheetH = sheetHRaw > 0 ? sheetHRaw * factorOf(u) : v.heightM;
    return pieces.every((p) => {
      const { w, h } = bboxM(p, hemOf(hemMap, p.id));
      const fitNoRot = w <= sheetW + 1e-6 && h <= sheetH + 1e-6;
      const fitRot = p.allowRotation && h <= sheetW + 1e-6 && w <= sheetH + 1e-6;
      return fitNoRot || fitRot;
    });
  });
  if (fits.length === 0) {
    // se nessuna variante copre, uso la più alta (verranno marcati alcuni pezzi come unplaced)
    return variants[variants.length - 1];
  }
  return fits[0];
};

type RawItem = {
  pieceId: string;
  copy: number;
  label: string;
  shape: PieceShape;
  /** bbox (con margini) in metri, prima di rotazione */
  w: number;
  h: number;
  widthBottomM: number;
  allowRotation: boolean;
  /** area reale della forma (già con margini), m² */
  realArea: number;
};

/** Esplode i pezzi in singole copie in base a quantity. */
const explodePieces = (
  pieces: PieceLine[],
  indexMap: Map<string, number>,
  rollWidthM = 0,
  materialFormat: "lastra" | "rotolo" = "rotolo",
  sheetHeightM = 0,
  hemMap?: Map<string, { addW: number; addH: number }>,
): { items: RawItem[]; seamLengthM: number } => {
  const items: RawItem[] = [];
  let seamLengthM = 0;
  for (const p of pieces) {
    const hem = hemOf(hemMap, p.id);
    const { w, h, widthBottomM } = bboxM(p, hem);
    if (w <= 0 || h <= 0) continue;
    const real = realAreaWithMarginsM2(p, hem);
    const qty = pieceQty(p);
    const idx = indexMap.get(p.id) ?? 0;
    const baseLabel = `P${String(idx + 1).padStart(2, "0")}`;

    // Per i rotoli, i rettangoli vengono orientati come:
    // - asse X = altezza del rotolo occupata dal pezzo (vincolata da rollWidthM)
    // - asse Y = lunghezza sviluppata sul rotolo
    // Se non entrano nell'altezza del rotolo, vengono spezzati in teli affiancati
    // con cuciture verticali (destra↔sinistra), mai sopra/sotto.
    const shape = p.shape ?? "rect";
    const isRect = shape === "rect";
    const allowSplit = p.allowSplit === true;
    if (materialFormat === "rotolo" && isRect && rollWidthM > 0 && allowSplit) {
      type Orientation = {
        crossM: number;
        alongM: number;
        panels: number;
      };

      const orientations: Orientation[] = [
        {
          // default: la larghezza finale del pezzo viene coperta con più teli
          // affiancati; ogni telo sviluppa l'altezza del pezzo lungo il rotolo.
          crossM: w,
          alongM: h,
          panels: Math.max(1, Math.ceil(w / rollWidthM)),
        },
      ];

      if (p.allowRotation && w !== h) {
        orientations.push({
          // ruotato: scambio i lati, ma le cuciture restano sempre verticali
          // e i teli si affiancano comunque sui lati.
          crossM: h,
          alongM: w,
          panels: Math.max(1, Math.ceil(h / rollWidthM)),
        });
      }

      // Scelgo l'orientamento che consuma MENO rotolo: stima ≈ panels × alongM.
      // Preferisco SEMPRE l'orientamento senza cuciture (1 solo telo) quando esiste,
      // anche se il consumo di metri è leggermente maggiore — meglio un pezzo unico
      // che spezzato. Esempio: rullo h=320 e pezzo 620×300 ruotabile → 1 telo da
      // 620 m, non 2 teli da 300 m con cucitura.
      orientations.sort((a, b) => {
        if ((a.panels === 1) !== (b.panels === 1)) return a.panels === 1 ? -1 : 1;
        return (
          a.panels * a.alongM - b.panels * b.alongM ||
          a.panels - b.panels ||
          a.alongM - b.alongM
        );
      });
      const best = orientations[0];

      // Se il miglior orientamento NON richiede cuciture (1 solo telo), lascio
      // decidere allo shelf packer l'orientamento finale: la rotazione resta
      // attiva e il packer può affiancare più copie sulla larghezza del rotolo.
      const noSplitNeeded = p.allowRotation && best.panels === 1;
      if (noSplitNeeded) {
        for (let c = 0; c < qty; c++) {
          const copyLabel = qty > 1 ? `${baseLabel}·${c + 1}/${qty}` : baseLabel;
          items.push({
            pieceId: p.id,
            copy: c,
            label: copyLabel,
            shape: "rect",
            w,
            h,
            widthBottomM,
            allowRotation: true,
            realArea: real,
          });
        }
        continue;
      }

      for (let c = 0; c < qty; c++) {
        const copyLabel = qty > 1 ? `${baseLabel}·${c + 1}/${qty}` : baseLabel;
        let remainingCrossM = best.crossM;
        for (let s = 0; s < best.panels; s++) {
          const panelCrossM = Math.min(rollWidthM, remainingCrossM);
          items.push({
            pieceId: p.id,
            copy: c,
            label: best.panels > 1 ? `${copyLabel}~${s + 1}/${best.panels}` : copyLabel,
            shape: "rect",
            // X = pannello affiancato nel verso dell'altezza rotolo
            w: panelCrossM,
            // Y = sviluppo lungo il rotolo, uguale per tutti i pannelli
            h: best.alongM,
            widthBottomM: panelCrossM,
            // L'orientamento è già risolto qui: niente rotazioni successive,
            // così le cuciture restano sempre verticali.
            allowRotation: false,
            realArea: panelCrossM * best.alongM,
          });
          remainingCrossM = Math.max(0, remainingCrossM - panelCrossM);
        }
        seamLengthM += (best.panels - 1) * best.alongM;
      }
      continue;
    }

    // ----- LASTRE: se un rettangolo non entra in un singolo foglio in nessuna
    // orientazione, lo splittiamo in pannelli (cuciture verticali), così non
    // viene scartato. Ogni pannello deve entrare in W×H del foglio. -----
    // Per le lastre lo split è automatico quando il pezzo non entra in un
    // singolo foglio: spezziamo in pannelli affiancati e mostriamo nel
    // riepilogo quante lastre/pannelli servono (non serve `allowSplit`).
    if (
      materialFormat === "lastra" &&
      isRect &&
      rollWidthM > 0 &&
      sheetHeightM > 0
    ) {
      const fitsAsIs = w <= rollWidthM + 1e-6 && h <= sheetHeightM + 1e-6;
      const fitsRotated =
        p.allowRotation && h <= rollWidthM + 1e-6 && w <= sheetHeightM + 1e-6;
      if (!fitsAsIs && !fitsRotated) {
        // Scelgo l'orientazione con meno pannelli necessari
        type Orient = { crossM: number; alongM: number; panels: number; sheetSpan: number };
        const orientations: Orient[] = [];
        // orientazione default: cross = w (split sulla larghezza del foglio),
        // along = h (deve stare nell'altezza del foglio)
        if (h <= sheetHeightM + 1e-6) {
          orientations.push({
            crossM: w,
            alongM: h,
            panels: Math.max(1, Math.ceil(w / rollWidthM)),
            sheetSpan: 1,
          });
        }
        // ruotata: cross = h, along = w
        if (p.allowRotation && w <= sheetHeightM + 1e-6) {
          orientations.push({
            crossM: h,
            alongM: w,
            panels: Math.max(1, Math.ceil(h / rollWidthM)),
            sheetSpan: 1,
          });
        }
        if (orientations.length > 0) {
          orientations.sort(
            (a, b) =>
              a.panels * a.alongM - b.panels * b.alongM ||
              a.panels - b.panels ||
              a.alongM - b.alongM,
          );
          const best = orientations[0];
          for (let c = 0; c < qty; c++) {
            const copyLabel = qty > 1 ? `${baseLabel}·${c + 1}/${qty}` : baseLabel;
            let remainingCrossM = best.crossM;
            for (let s = 0; s < best.panels; s++) {
              const panelCrossM = Math.min(rollWidthM, remainingCrossM);
              items.push({
                pieceId: p.id,
                copy: c,
                label: best.panels > 1 ? `${copyLabel}~${s + 1}/${best.panels}` : copyLabel,
                shape: "rect",
                w: panelCrossM,
                h: best.alongM,
                widthBottomM: panelCrossM,
                allowRotation: false,
                realArea: panelCrossM * best.alongM,
              });
              remainingCrossM = Math.max(0, remainingCrossM - panelCrossM);
            }
            seamLengthM += (best.panels - 1) * best.alongM;
          }
          continue;
        }
        // se nessuna orientazione regge nemmeno splittando (along > sheetH),
        // lascio che l'unit finisca in unplaced col flusso normale
      }
    }

    for (let c = 0; c < qty; c++) {
      items.push({
        pieceId: p.id,
        copy: c,
        label: qty > 1 ? `${baseLabel}·${c + 1}/${qty}` : baseLabel,
        shape: p.shape ?? "rect",
        w,
        h,
        widthBottomM,
        allowRotation: !!p.allowRotation,
        realArea: real,
      });
    }
  }
  return { items, seamLengthM };
};

/** Appaiamento di triangoli/trapezi: a coppie producono un rettangolo (triangoli) o
 * un parallelogramma (trapezi) che occupa meno spazio. Restituisce coppie + singoli.
 */
type PairedUnit = {
  /** dimensioni del bbox della coppia, in metri (w × h) */
  w: number;
  h: number;
  parts: RawItem[]; // 1 (singolo) o 2 (coppia)
  pairKind: "single" | "triangle-pair" | "trapezoid-pair";
};

const pairShapes = (raw: RawItem[]): PairedUnit[] => {
  const result: PairedUnit[] = [];
  // Raggruppo per (shape, w, h) per appaiare solo identici
  const buckets: Record<string, RawItem[]> = {};
  for (const r of raw) {
    const key = `${r.shape}|${r.w.toFixed(3)}|${r.h.toFixed(3)}|${r.widthBottomM.toFixed(3)}`;
    (buckets[key] ||= []).push(r);
  }
  Object.values(buckets).forEach((bucket) => {
    const shape = bucket[0].shape;
    if (shape === "rect") {
      bucket.forEach((r) =>
        result.push({ w: r.w, h: r.h, parts: [r], pairKind: "single" }),
      );
      return;
    }
    if (shape === "triangle") {
      // appaio a coppie -> bbox = w × h (un triangolo + ribaltato)
      while (bucket.length >= 2) {
        const a = bucket.shift()!;
        const b = bucket.shift()!;
        result.push({ w: a.w, h: a.h, parts: [a, b], pairKind: "triangle-pair" });
      }
      bucket.forEach((r) =>
        result.push({ w: r.w, h: r.h, parts: [r], pairKind: "single" }),
      );
      return;
    }
    // trapezoid: due trapezi testa-coda formano un parallelogramma; per il packing uso bbox = w × h
    while (bucket.length >= 2) {
      const a = bucket.shift()!;
      const b = bucket.shift()!;
      result.push({ w: a.w, h: a.h, parts: [a, b], pairKind: "trapezoid-pair" });
    }
    bucket.forEach((r) =>
      result.push({ w: r.w, h: r.h, parts: [r], pairKind: "single" }),
    );
  });
  return result;
};

/** Shelf / First-Fit Decreasing su un telo di larghezza rollWidthM (lunghezza illimitata). */
const shelfPack = (
  units: PairedUnit[],
  rollWidthM: number,
): { items: NestingPieceItem[]; totalLengthM: number; unplaced: PairedUnit[] } => {
  // Per ogni unit scelgo prima l'orientamento che sfrutta meglio la larghezza del rotolo.
  // Così un pezzo 620×300 su rotolo h 320 diventa 300×620 e resta un telo unico,
  // non due pannelli 320×620 affiancati/spezzati in preview.
  type OrientedUnit = PairedUnit & { originalW: number; originalH: number };
  const oriented: OrientedUnit[] = units.map((u) => {
    const canRotate = u.w !== u.h && u.parts.every((p) => p.allowRotation);
    const candidates = [
      { w: u.w, h: u.h },
      ...(canRotate ? [{ w: u.h, h: u.w }] : []),
    ].filter((c) => c.w <= rollWidthM + 1e-6);
    const best = (candidates.length > 0 ? candidates : [{ w: u.w, h: u.h }]).sort((a, b) => {
      const aSideWaste = rollWidthM - a.w;
      const bSideWaste = rollWidthM - b.w;
      return aSideWaste - bSideWaste || b.h - a.h;
    })[0];
    return { ...u, w: best.w, h: best.h, originalW: u.w, originalH: u.h };
  });
  // Ordino per altezza del bbox decrescente; in caso di parità, larghezza decrescente
  const sorted = [...oriented].sort((a, b) => b.h - a.h || b.w - a.w);
  type Shelf = { y: number; height: number; usedW: number };
  const shelves: Shelf[] = [];
  const items: NestingPieceItem[] = [];
  const unplaced: PairedUnit[] = [];
  let totalLengthM = 0; // = somma altezze degli shelf

  const placeUnit = (u: PairedUnit, x: number, y: number) => {
    // Una "unit" può contenere 1 o 2 RawItem; le posizioni della coppia coincidono
    u.parts.forEach((part, idx) => {
      const role: "primary" | "secondary" = idx === 0 ? "primary" : "secondary";
      // se ho ruotato l'unit, scambio w/h
      // (ruoto solo se la rotazione è permessa per ENTRAMBI i pezzi della coppia: per semplicità
      // gestisco la rotazione a livello di unit qui sotto, ricevendo già w/h corretti)
      items.push({
        pieceId: part.pieceId,
        copy: part.copy,
        label: part.label,
        w: u.w,
        h: u.h,
        rotated: u.w !== part.w || u.h !== part.h,
        x,
        y,
        shape: part.shape,
        widthBottomM: part.shape === "trapezoid" ? part.widthBottomM : undefined,
        pairedWith: u.parts.length === 2 ? u.parts[1 - idx].pieceId + ":" + u.parts[1 - idx].copy : undefined,
        pairRole: u.parts.length === 2 ? role : undefined,
      });
    });
  };

  for (const u of sorted) {
    const candidates: { w: number; h: number; rotated: boolean }[] = [
      { w: u.w, h: u.h, rotated: u.w !== u.originalW || u.h !== u.originalH },
    ];

    let placed = false;
    for (const cand of candidates) {
      if (cand.w > rollWidthM + 1e-6) continue; // non ci sta in larghezza
      // FFD: cerco la prima shelf che ha spazio in larghezza E altezza compatibile (h<=shelf.height)
      let chosen: Shelf | null = null;
      for (const sh of shelves) {
        if (cand.h <= sh.height + 1e-6 && sh.usedW + cand.w <= rollWidthM + 1e-6) {
          chosen = sh;
          break;
        }
      }
      if (!chosen) {
        // creo nuova shelf in fondo
        chosen = { y: totalLengthM, height: cand.h, usedW: 0 };
        shelves.push(chosen);
        totalLengthM += cand.h;
      }
      const x = chosen.usedW;
      const y = chosen.y;
      chosen.usedW += cand.w;
      placeUnit({ ...u, w: cand.w, h: cand.h }, x, y);
      placed = true;
      break;
    }
    if (!placed) unplaced.push(u);
  }

  return { items, totalLengthM, unplaced };
};

/** Multi-sheet shelf packer: distribuisce le units su più fogli identici W×H.
 *  Ogni unit DEVE entrare in un singolo foglio (no spanning). I non-piazzabili
 *  finiscono in `unplaced`. Restituisce items con `sheetIndex` valorizzato.
 */
const multiSheetPack = (
  units: PairedUnit[],
  sheetWidthM: number,
  sheetHeightM: number,
): { items: NestingPieceItem[]; sheetsUsed: number; unplaced: PairedUnit[] } => {
  // Ordino per altezza decrescente, poi larghezza decrescente
  const sorted = [...units].sort((a, b) => b.h - a.h || b.w - a.w);
  type Shelf = { y: number; height: number; usedW: number };
  // Per ciascun foglio: lista di shelf + lunghezza usata
  type Sheet = { shelves: Shelf[]; usedH: number };
  const sheets: Sheet[] = [];
  const allItems: NestingPieceItem[] = [];
  const unplaced: PairedUnit[] = [];

  const placeOnSheet = (
    sheetIndex: number,
    u: PairedUnit,
    cand: { w: number; h: number },
  ): boolean => {
    const sheet = sheets[sheetIndex];
    // FFD nel foglio
    let chosen: Shelf | null = null;
    for (const sh of sheet.shelves) {
      if (cand.h <= sh.height + 1e-6 && sh.usedW + cand.w <= sheetWidthM + 1e-6) {
        chosen = sh;
        break;
      }
    }
    if (!chosen) {
      // Apro nuova shelf solo se c'è ancora altezza disponibile
      if (sheet.usedH + cand.h > sheetHeightM + 1e-6) return false;
      chosen = { y: sheet.usedH, height: cand.h, usedW: 0 };
      sheet.shelves.push(chosen);
      sheet.usedH += cand.h;
    }
    const x = chosen.usedW;
    const y = chosen.y;
    chosen.usedW += cand.w;
    // Posiziono le parti dell'unit
    u.parts.forEach((part, idx) => {
      const role: "primary" | "secondary" = idx === 0 ? "primary" : "secondary";
      allItems.push({
        pieceId: part.pieceId,
        copy: part.copy,
        label: part.label,
        w: cand.w,
        h: cand.h,
        rotated: cand.w !== part.w || cand.h !== part.h,
        x,
        y,
        shape: part.shape,
        widthBottomM: part.shape === "trapezoid" ? part.widthBottomM : undefined,
        pairedWith:
          u.parts.length === 2 ? u.parts[1 - idx].pieceId + ":" + u.parts[1 - idx].copy : undefined,
        pairRole: u.parts.length === 2 ? role : undefined,
        sheetIndex,
      });
    });
    return true;
  };

  for (const u of sorted) {
    const candidates: { w: number; h: number }[] = [{ w: u.w, h: u.h }];
    const allRect = u.parts.every((p) => p.shape === "rect");
    const allowRot = allRect ? true : u.parts.every((p) => p.allowRotation);
    if (allowRot && u.w !== u.h) candidates.push({ w: u.h, h: u.w });
    // Filtro candidati che non entrano in un singolo foglio
    const fitting = candidates.filter(
      (c) => c.w <= sheetWidthM + 1e-6 && c.h <= sheetHeightM + 1e-6,
    );
    if (fitting.length === 0) {
      unplaced.push(u);
      continue;
    }

    let placed = false;
    // Provo a piazzare nei fogli esistenti
    for (let s = 0; s < sheets.length && !placed; s++) {
      for (const cand of fitting) {
        if (placeOnSheet(s, u, cand)) {
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      // Apro un nuovo foglio
      sheets.push({ shelves: [], usedH: 0 });
      const s = sheets.length - 1;
      for (const cand of fitting) {
        if (placeOnSheet(s, u, cand)) {
          placed = true;
          break;
        }
      }
      if (!placed) unplaced.push(u);
    }
  }

  return { items: allItems, sheetsUsed: sheets.length, unplaced };
};

/** Calcola un gruppo di nesting (un materiale + un set di pezzi). */
const computeGroup = (
  key: string,
  label: string,
  pieces: PieceLine[],
  catalog: Catalog,
  pieceIndexMap: Map<string, number>,
  customer?: CustomerType,
  /** Se valorizzato, usa questa variante invece di scegliere la più piccola che entra. */
  forcedVariant?: { material: CatalogMaterial; heightM: number } | null,
): NestingGroup => {
  const variants = candidateVariants(
    catalog.materials,
    pieces[0].productName,
    pieces[0].color,
    pieces[0].fireproof,
    pieces[0].thickness,
    pieces[0].finish,
    pieces[0].variantId ?? pieces[0].catalogMaterialId,
  );
  const hemMap = buildHemMap(pieces, catalog);
  const picked = forcedVariant ?? pickRollVariant(variants, pieces, hemMap);

  // Costo "ingenuo": somma del costo materiale di ogni pezzo (computePieceMaterial già esistente
  // gestisce teli + cuciture; lo riusiamo per coerenza)
  // Lo importiamo da piece.ts via funzione locale per evitare import circolare:
  // qui ricalcoliamo il costo come m² × prezzo unitario assumendo full-bbox; ma per "naive"
  // più realistico sarebbe la somma dei piani per-pezzo. Per evitare doppia import lo lasciamo
  // al chiamante.
  // Calcoliamo solo l'ottimizzato qui.
  const empty: NestingGroup = {
    key,
    label,
    material: picked?.material ?? null,
    rollWidthM: picked?.heightM ?? 0,
    unitPrice: 0,
    totalLengthM: 0,
    totalAreaM2: 0,
    usedAreaM2: 0,
    wastePct: 0,
    materialCostOptimized: 0,
    materialCostInternal: 0,
    materialCostNaive: 0,
    savings: 0,
    items: [],
    unplaced: pieces.flatMap((p) =>
      Array.from({ length: pieceQty(p) }, (_, c) => ({
        pieceId: p.id,
        label: `P${String((pieceIndexMap.get(p.id) ?? 0) + 1).padStart(2, "0")}${pieceQty(p) > 1 ? `·${c + 1}/${pieceQty(p)}` : ""}`,
        reason: !picked ? "Nessuna variante materiale disponibile" : "Pezzo più largo del telo",
      })),
    ),
    format: (picked?.material?.format ?? "rotolo"),
    scrapCost: 0,
    minBillingExtra: 0,
  };

  if (!picked) return empty;
  // Rotazione della lastra (scambia base ↔ altezza del foglio).
  // Per coerenza nel gruppo prendo il flag dal primo pezzo.
  const sheetRotated = !!pieces[0]?.rotateSheet && (picked.material.format === "lastra");

  // Pre-calcolo sheetH per format=lastra (serve allo split nelle lastre)
  const fmt0 = picked.material.format ?? "rotolo";
  let preSheetH = 0;
  let preRollWidthM = picked.heightM;
  if (fmt0 === "lastra") {
    const u = (picked.material.dimUnit || picked.material.heightUnit || "cm") as DimUnit;
    const sheetHRaw = parseFloat(String(picked.material.height || "0").replace(",", "."));
    const sheetWRaw = parseFloat(String(picked.material.baseWidth || "0").replace(",", "."));
    const baseW = sheetWRaw > 0 ? sheetWRaw * factorOf(u) : picked.heightM;
    const baseH = sheetHRaw > 0 ? sheetHRaw * factorOf(u) : picked.heightM;
    preRollWidthM = sheetRotated ? baseH : baseW;
    preSheetH = sheetRotated ? baseW : baseH;
  }
  const rollWidthM = preRollWidthM;
  // Esplodo per quantity
  const { items: raw, seamLengthM: splitSeamLengthM } = explodePieces(
    pieces,
    pieceIndexMap,
    rollWidthM,
    fmt0,
    preSheetH,
    hemMap,
  );
  if (raw.length === 0) return { ...empty, material: picked.material, rollWidthM, unplaced: [] };

  // Pre-pairing triangoli/trapezi
  const units = pairShapes(raw);

  // Formato del materiale (default rotolo)
  const format: "lastra" | "rotolo" = picked.material.format ?? "rotolo";

  // Per le LASTRE: pack diretto su fogli reali (W × H) per contare correttamente
  // quante lastre intere servono. L'algoritmo prova entrambi gli orientamenti
  // automaticamente per ogni pezzo (vedi multiSheetPack).
  let items: NestingPieceItem[];
  let totalLengthM: number;
  let unplaced: PairedUnit[];
  let sheetsUsedAuto: number | undefined;
  let sheetHeightAuto: number | undefined;
  if (format === "lastra") {
    const u = (picked.material.dimUnit || picked.material.heightUnit || "cm") as DimUnit;
    const sheetHRaw = parseFloat(String(picked.material.height || "0").replace(",", "."));
    const sheetWRaw = parseFloat(String(picked.material.baseWidth || "0").replace(",", "."));
    // rollWidthM (=picked.heightM) è ricavato dal campo "height" della variante. Per le
    // lastre interpretiamo: larghezza foglio = baseWidth, altezza foglio = height.
    // Se sheetRotated, base e altezza vengono scambiate.
    const baseW = sheetWRaw > 0 ? sheetWRaw * factorOf(u) : rollWidthM;
    const baseH = sheetHRaw > 0 ? sheetHRaw * factorOf(u) : rollWidthM;
    const sheetW = sheetRotated ? baseH : baseW;
    const sheetH = sheetRotated ? baseW : baseH;
    sheetHeightAuto = sheetH;
    const packed = multiSheetPack(units, sheetW, sheetH);
    items = packed.items;
    unplaced = packed.unplaced;
    sheetsUsedAuto = packed.sheetsUsed;
    totalLengthM = packed.sheetsUsed * sheetH;
  } else {
    const packed = shelfPack(units, rollWidthM);
    items = packed.items;
    totalLengthM = packed.totalLengthM;
    unplaced = packed.unplaced;
  }

  const usedAreaM2 = raw.reduce((s, r) => s + r.realArea, 0);
  // Per le lastre la "larghezza" effettiva è la base lastra; per i rotoli è l'altezza rullo.
  const surfaceWidthM =
    format === "lastra"
      ? (() => {
          const u = (picked.material.dimUnit || picked.material.heightUnit || "cm") as DimUnit;
          const wRaw = parseFloat(String(picked.material.baseWidth || "0").replace(",", "."));
          const hRaw = parseFloat(String(picked.material.height || "0").replace(",", "."));
          const w = wRaw > 0 ? wRaw * factorOf(u) : rollWidthM;
          const h = hRaw > 0 ? hRaw * factorOf(u) : rollWidthM;
          return sheetRotated ? h : w;
        })()
      : rollWidthM;
  const totalAreaM2 = surfaceWidthM * totalLengthM;
  const wastePct = totalAreaM2 > 0 ? Math.max(0, 1 - usedAreaM2 / totalAreaM2) : 0;

  // Prezzo unitario: prendo il priceMode più frequente nel gruppo (semplificazione)
  const cutCount = pieces.filter((p) => p.priceMode === "cut").length;
  const mode: "piece" | "cut" = cutCount >= pieces.length / 2 ? "cut" : "piece";
  const unitPrice = materialUnitCost(picked.material, mode, customer);

  // Prezzo d'acquisto unitario base (€/mq o €/ml a seconda di priceUnit), serve per:
  //   - sfrido rotolo (×1,3 fisso, NON il moltiplicatore cliente)
  //   - minimo lastra (€/mq)
  const purchaseUnit =
    mode === "piece" ? picked.material.pricePiece : picked.material.priceCut;
  const priceUnit: "mq" | "ml" = materialPriceUnit(picked.material);
  // €/mq d'acquisto: se priceUnit è "ml" lo converto dividendo per la larghezza rullo
  const purchasePerSqm =
    priceUnit === "mq"
      ? purchaseUnit
      : rollWidthM > 0
      ? purchaseUnit / rollWidthM
      : 0;

  // Costo materiale ottimizzato base
  // Per i ROTOLI: prezzo cliente = area effettiva pezzi (usedAreaM2) × €/mq di vendita.
  // Per le LASTRE: il calcolo viene fatto più sotto sul minimo lastra.
  const sellPerSqm = priceUnit === "mq"
    ? unitPrice
    : rollWidthM > 0 ? unitPrice / rollWidthM : 0;
  let materialCostOptimized =
    format === "rotolo"
      ? usedAreaM2 * sellPerSqm
      : totalLengthM * unitPrice;

  // ---- Minimo lastre: 0,5 mq totali per ordine/materiale ----
  let minBillingExtra = 0;
  let sheetsNeeded: number | undefined = undefined;
  let sheetHeightM: number | undefined = undefined;
  if (format === "lastra") {
    const MIN_AREA_M2 = 0.5;
    // ricalcolo su base mq: usedAreaM2 al prezzo €/mq di vendita (con markup cliente)
    const sellPerSqm = priceUnit === "mq"
      ? unitPrice
      : rollWidthM > 0 ? unitPrice / rollWidthM : 0;
    // Numero di lastre = quelle effettivamente usate dal multiSheetPack.
    sheetHeightM = sheetHeightAuto ?? 0;
    sheetsNeeded = Math.max(1, sheetsUsedAuto ?? 1);
    const sheetAreaM2 = sheetHeightM > 0 ? surfaceWidthM * sheetHeightM : usedAreaM2;
    const totalSheetArea = sheetsNeeded * sheetAreaM2;
    const billedAreaM2 = Math.max(totalSheetArea, MIN_AREA_M2);
    const lastraCost = billedAreaM2 * sellPerSqm;
    minBillingExtra = Math.max(0, lastraCost - usedAreaM2 * sellPerSqm);
    materialCostOptimized = lastraCost;
  }

  // ---- Sfrido iniziale rotolo: 1,5 m × altezza rullo × (€/mq d'acquisto × 1,30) ----
  // Formula fissa per il prezzo CLIENTE dello sfrido: il moltiplicatore è 1,30
  // (NON il moltiplicatore cliente dinamico).
  const SCRAP_SELL_MULT = 1.3;
  let scrapCost = 0;
  const skipInitialScrap = !!catalog.__skipInitialScrap;
  if (format === "rotolo" && !skipInitialScrap) {
    const SCRAP_LENGTH_M = 1.5;
    scrapCost = SCRAP_LENGTH_M * rollWidthM * purchasePerSqm * SCRAP_SELL_MULT;
    materialCostOptimized += scrapCost;
  }

  // ---- Cuciture verticali per pezzi spezzati su più teli ----
  // Le cuciture sono sempre verticali: lo split di explodePieces ha già accumulato
  // la lunghezza totale di cucitura (panels-1) × altezza pezzo per ogni copia.
  const seamPricePerM = seamUnitPrice(catalog);
  const seamLengthM = splitSeamLengthM;
  const seamCost = seamLengthM * seamPricePerM;
  materialCostOptimized += seamCost;

  // ---- Costo INTERNO (acquisto) ----
  // Per i ROTOLI: (metri lineari teli × larghezza rullo + 1,5 m × larghezza rullo) × €/mq d'acquisto
  // Per le LASTRE: usedAreaM2 × €/mq d'acquisto (o totalLengthM × €/ml fallback)
  let materialCostInternal = 0;
  if (format === "rotolo") {
    const SCRAP_LENGTH_M = skipInitialScrap ? 0 : 1.5;
    const consumedAreaM2 = (totalLengthM + SCRAP_LENGTH_M) * rollWidthM;
    materialCostInternal = consumedAreaM2 * purchasePerSqm;
  } else {
    materialCostInternal = priceUnit === "mq"
      ? usedAreaM2 * purchaseUnit
      : totalLengthM * purchaseUnit;
  }

  // ---- Indicatori di sfruttamento del rotolo ----
  // Larghezza media usata su tutta la lunghezza sviluppata.
  const avgWidthUsedM = totalLengthM > 0 ? usedAreaM2 / totalLengthM : 0;
  const widthUsagePct = surfaceWidthM > 0 ? Math.min(1, avgWidthUsedM / surfaceWidthM) : 0;
  const widthUnusedM = Math.max(0, surfaceWidthM - avgWidthUsedM);
  // "Naive" length: somma delle lunghezze occupate da ogni copia se piazzate da sole
  // (= somma dei loro h, già post-split per teli affiancati). Per le lastre non ha
  // significato lineare → resta a 0.
  const naiveLengthM = format === "rotolo"
    ? raw.reduce((s, r) => s + r.h, 0)
    : 0;
  const lengthSavedM = format === "rotolo"
    ? Math.max(0, naiveLengthM - totalLengthM)
    : 0;

  return {
    key,
    label,
    material: picked.material,
    rollWidthM,
    unitPrice,
    totalLengthM,
    totalAreaM2,
    usedAreaM2,
    wastePct,
    materialCostOptimized,
    materialCostInternal,
    materialCostNaive: 0, // popolato dal chiamante per evitare ciclo di import
    savings: 0,
    items,
    unplaced: unplaced.flatMap((u) =>
      u.parts.map((p) => ({ pieceId: p.pieceId, label: p.label, reason: "Pezzo più largo del telo" })),
    ),
    format,
    scrapCost,
    minBillingExtra,
    sheetsNeeded,
    sheetHeightM,
    sheetWidthM: format === "lastra" ? surfaceWidthM : undefined,
    seamLengthM,
    seamCost,
    widthUsagePct,
    widthUnusedM,
    naiveLengthM,
    lengthSavedM,
  };
};

/** Raggruppa i pezzi per (productName|color|fireproof) e calcola un nesting per ciascuno. */
export const computeNesting = (
  pieces: PieceLine[],
  catalog: Catalog,
  customer?: CustomerType,
): NestingGroup[] => {
  const valid = pieces.filter(
    (p) => p.productName && (p.width || 0) > 0 && (p.height || 0) > 0,
  );
  if (valid.length === 0) return [];

  // Mappa pezzo → indice originale (per label P01, P02...)
  const pieceIndexMap = new Map<string, number>();
  pieces.forEach((p, i) => pieceIndexMap.set(p.id, i));

  const groups = new Map<string, PieceLine[]>();
  for (const p of valid) {
    const k = materialGroupKey(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  return Array.from(groups.entries()).map(([k, ps]) => {
    const label = `${ps[0].productName}${ps[0].color ? ` · ${ps[0].color}` : ""}${ps[0].fireproof ? ` · ${ps[0].fireproof}` : ""}`;
    // Provo TUTTE le varianti compatibili e tengo quella che produce meno sfrido
    // (a parità di pezzi piazzati). Se nessuna variante "perfetta" esiste, ricado
    // su quella minima che entra (comportamento storico di pickRollVariant).
    const allVariants = candidateVariants(
      catalog.materials,
      ps[0].productName,
      ps[0].color,
      ps[0].fireproof,
      ps[0].thickness,
      ps[0].finish,
      ps[0].variantId ?? ps[0].catalogMaterialId,
    );
    let g: NestingGroup;
    if (allVariants.length <= 1) {
      g = computeGroup(k, label, ps, catalog, pieceIndexMap, customer);
    } else {
      const candidates = allVariants.map((v) =>
        computeGroup(k, label, ps, catalog, pieceIndexMap, customer, v),
      );
      // Filtro: solo quelle che riescono a piazzare TUTTI i pezzi
      const feasible = candidates.filter((c) => c.unplaced.length === 0 && c.items.length > 0);
      const pool = feasible.length > 0 ? feasible : candidates;
      // Ordino per:
      //  1) PREFERISCO le varianti SENZA cuciture introdotte da split (seamLengthM=0):
      //     un rullo più alto che contiene il pezzo intero vince SEMPRE su uno più stretto
      //     che richiede di spezzarlo, anche se il costo è marginalmente diverso.
      //  2) costo materiale ottimizzato
      //  3) sfrido percentuale
      //  4) lunghezza/area minore
      pool.sort((a, b) => {
        const aHasSeams = (a.seamLengthM ?? 0) > 1e-6 ? 1 : 0;
        const bHasSeams = (b.seamLengthM ?? 0) > 1e-6 ? 1 : 0;
        if (aHasSeams !== bHasSeams) return aHasSeams - bHasSeams;
        const dCost = a.materialCostOptimized - b.materialCostOptimized;
        if (Math.abs(dCost) > 1e-3) return dCost;
        const dWaste = a.wastePct - b.wastePct;
        if (Math.abs(dWaste) > 1e-4) return dWaste;
        return a.totalAreaM2 - b.totalAreaM2;
      });
      g = pool[0];
    }
    // Naive cost = somma materiale+cuciture come calcolato per-pezzo (× quantity)
    const naive = ps.reduce((s, p) => {
      const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
      return (
        s +
        (pieceMaterialTotal(p, catalog, customer) +
          pieceSeamTotal(p, catalog, customer)) *
          qty
      );
    }, 0);
    g.materialCostNaive = naive;
    g.savings = naive - g.materialCostOptimized;
    return g;
  });
};

/** Ricalcola un gruppo di nesting forzando un formato (foglio W×H) e una quantità disponibile.
 *  Restituisce un nuovo `NestingGroup` con items ridistribuiti su più fogli identici e
 *  numero di fogli usati. Pezzi che non entrano singolarmente nel foglio vengono marcati
 *  come unplaced. Il costo materiale ottimizzato viene RICALCOLATO come (fogliUsati × area foglio × €/mq).
 */
export const recomputeGroupWithOverride = (
  baseGroup: NestingGroup,
  pieces: PieceLine[],
  catalog: Catalog,
  override: NestingFormatOverride,
  pieceIndexMap: Map<string, number>,
  customer?: CustomerType,
): NestingGroup => {
  const sheetW = override.widthM;
  const sheetH = override.heightM;
  if (sheetW <= 0 || sheetH <= 0) return baseGroup;

  // Per il recompute con override (lastra) usiamo le dimensioni del foglio come
  // larghezza limite — non rilevante per lo split di rotoli, ma evita pezzi enormi.
  const hemMap = buildHemMap(pieces, catalog);
  const { items: raw } = explodePieces(pieces, pieceIndexMap, sheetW, baseGroup.format, sheetH, hemMap);
  const units = pairShapes(raw);
  const { items, sheetsUsed, unplaced } = multiSheetPack(units, sheetW, sheetH);

  // Quantità disponibile (0 = illimitato)
  const available = Math.max(0, Math.floor(Number(override.quantity) || 0));
  let extraUnplaced: { pieceId: string; label: string; reason: string }[] = [];
  let usedSheets = sheetsUsed;
  let visibleItems = items;
  if (available > 0 && sheetsUsed > available) {
    // Mantengo solo i pezzi piazzati nei primi `available` fogli; i restanti diventano unplaced.
    visibleItems = items.filter((it) => (it.sheetIndex ?? 0) < available);
    const lostItems = items.filter((it) => (it.sheetIndex ?? 0) >= available);
    extraUnplaced = lostItems.map((it) => ({
      pieceId: it.pieceId,
      label: it.label,
      reason: `Disponibilità superata (servirebbero ${sheetsUsed} fogli, disponibili ${available})`,
    }));
    usedSheets = available;
  }

  // Area utile = somma area reale dei pezzi effettivamente piazzati
  const placedKey = new Set(visibleItems.map((it) => `${it.pieceId}|${it.copy}`));
  const usedAreaM2 = raw
    .filter((r) => placedKey.has(`${r.pieceId}|${r.copy}`))
    .reduce((s, r) => s + r.realArea, 0);

  const totalAreaM2 = usedSheets * sheetW * sheetH;
  const wastePct = totalAreaM2 > 0 ? Math.max(0, 1 - usedAreaM2 / totalAreaM2) : 0;

  // Costo: usa €/mq (priceUnit del materiale) o ricalcola dal materiale di base
  let unitPricePerSqm = 0;
  if (baseGroup.material) {
    const mat = baseGroup.material;
    const cutCount = pieces.filter((p) => p.priceMode === "cut").length;
    const mode: "piece" | "cut" = cutCount >= pieces.length / 2 ? "cut" : "piece";
    const purchaseUnit = mode === "piece" ? mat.pricePiece : mat.priceCut;
    const priceUnit = materialPriceUnit(mat);
    const baseRollW = baseGroup.rollWidthM > 0 ? baseGroup.rollWidthM : sheetW;
    const purchasePerSqm =
      priceUnit === "mq" ? purchaseUnit : baseRollW > 0 ? purchaseUnit / baseRollW : 0;
    // Riapplico il moltiplicatore cliente se possibile (di solito già incluso in unitPrice del gruppo)
    const sellPerSqm = baseGroup.unitPrice > 0 && baseRollW > 0
      ? (baseGroup.unitPrice * baseGroup.rollWidthM) / baseRollW
      : purchasePerSqm;
    unitPricePerSqm = sellPerSqm;
  }
  const materialCostOptimized = totalAreaM2 * unitPricePerSqm;

  // Format risultante: se l'utente ha specificato una quantità o sceglie esplicitamente
  // una variante "lastra", consideriamo il calcolo come "lastra"; altrimenti
  // manteniamo il formato originario del gruppo (rotolo o lastra).
  const overrideFormat: "lastra" | "rotolo" =
    override.source === "catalog" || (override.quantity ?? 0) > 0
      ? "lastra"
      : baseGroup.format;

  return {
    ...baseGroup,
    rollWidthM: sheetW,
    totalLengthM: usedSheets * sheetH,
    totalAreaM2,
    usedAreaM2,
    wastePct,
    materialCostOptimized,
    materialCostInternal: baseGroup.materialCostInternal,
    savings: baseGroup.materialCostNaive - materialCostOptimized,
    items: visibleItems,
    unplaced: [
      ...unplaced.flatMap((u) =>
        u.parts.map((p) => ({
          pieceId: p.pieceId,
          label: p.label,
          reason: `Pezzo non entra ${overrideFormat === "lastra" ? "nella lastra" : "nel telo"} ${sheetW.toFixed(2)} × ${sheetH.toFixed(2)} m`,
        })),
      ),
      ...extraUnplaced,
    ],
    format: overrideFormat,
    scrapCost: 0,
    minBillingExtra: 0,
    sheetsNeeded: sheetsUsed, // quanti effettivamente servirebbero (può superare available)
    sheetHeightM: sheetH,
    sheetWidthM: sheetW,
  };
};

/** Ritorna la mappa pezzo→indice originale, utile per chiamare `recomputeGroupWithOverride`. */
export const buildPieceIndexMap = (pieces: PieceLine[]): Map<string, number> => {
  const m = new Map<string, number>();
  pieces.forEach((p, i) => m.set(p.id, i));
  return m;
};

/** Ricalcola un gruppo distribuendo i pezzi su BIN ETEROGENEI (sfridi + lastre intere
 *  di dimensioni diverse). Strategia greedy:
 *    1. ordina i pezzi per area decrescente
 *    2. ordina i bin per area crescente (best-fit) — sfridi prima delle lastre intere
 *    3. per ogni pezzo prova ad inserirlo nel primo bin che ha spazio (shelf/FFD interno)
 *    4. se nessun bin esistente lo accoglie, prova ad APRIRE un nuovo foglio dal pool
 *       (il bin più piccolo ancora disponibile che lo contiene)
 *  Restituisce un NestingGroup con `mixedSheets[]` valorizzato e `items[].sheetIndex` che
 *  punta al foglio corretto. Lasciamo invariati i costi (per ora si riferiscono al gruppo
 *  base) — l'obiettivo principale è la PREVIEW visiva. */
export const recomputeGroupWithMixedBins = (
  baseGroup: NestingGroup,
  pieces: PieceLine[],
  bins: NestingMixedBin[],
  pieceIndexMap: Map<string, number>,
): NestingGroup => {
  if (bins.length === 0) return baseGroup;
  // 1) Esplodi i pezzi usando come limite la massima dimensione disponibile (il bin più grande)
  const maxW = Math.max(...bins.map((b) => b.widthM));
  const maxH = Math.max(...bins.map((b) => b.heightM));
  const { items: raw } = explodePieces(pieces, pieceIndexMap, maxW, "lastra", maxH);
  const units = pairShapes(raw);

  // 2) Pool di "fogli aperti", ognuno con le proprie dimensioni di bin
  type Shelf = { y: number; height: number; usedW: number };
  type OpenSheet = { bin: NestingMixedBin; w: number; h: number; shelves: Shelf[]; usedH: number };
  const openSheets: OpenSheet[] = [];
  const allItems: NestingPieceItem[] = [];
  const unplacedUnits: PairedUnit[] = [];

  // bin disponibili da "aprire" (un'istanza ciascuno: l'utente ha già scelto la quantità a monte
  // creando più volte lo stesso bin se serve)
  const availableBins: NestingMixedBin[] = [...bins].sort(
    (a, b) => a.widthM * a.heightM - b.widthM * b.heightM,
  );

  const tryPlaceOnSheet = (
    sheet: OpenSheet,
    sheetIndex: number,
    u: PairedUnit,
    cand: { w: number; h: number },
  ): boolean => {
    if (cand.w > sheet.w + 1e-6 || cand.h > sheet.h + 1e-6) return false;
    let chosen: Shelf | null = null;
    for (const sh of sheet.shelves) {
      if (cand.h <= sh.height + 1e-6 && sh.usedW + cand.w <= sheet.w + 1e-6) {
        chosen = sh;
        break;
      }
    }
    if (!chosen) {
      if (sheet.usedH + cand.h > sheet.h + 1e-6) return false;
      chosen = { y: sheet.usedH, height: cand.h, usedW: 0 };
      sheet.shelves.push(chosen);
      sheet.usedH += cand.h;
    }
    const x = chosen.usedW;
    const y = chosen.y;
    chosen.usedW += cand.w;
    u.parts.forEach((part, idx) => {
      const role: "primary" | "secondary" = idx === 0 ? "primary" : "secondary";
      allItems.push({
        pieceId: part.pieceId,
        copy: part.copy,
        label: part.label,
        w: cand.w,
        h: cand.h,
        rotated: cand.w !== part.w || cand.h !== part.h,
        x,
        y,
        shape: part.shape,
        widthBottomM: part.shape === "trapezoid" ? part.widthBottomM : undefined,
        pairedWith: u.parts.length === 2 ? u.parts[1 - idx].pieceId + ":" + u.parts[1 - idx].copy : undefined,
        pairRole: u.parts.length === 2 ? role : undefined,
        sheetIndex,
      });
    });
    return true;
  };

  // Pezzi grandi prima
  const sorted = [...units].sort((a, b) => b.h - a.h || b.w - a.w);
  for (const u of sorted) {
    const allRect = u.parts.every((p) => p.shape === "rect");
    const allowRot = allRect ? true : u.parts.every((p) => p.allowRotation);
    const candidates: { w: number; h: number }[] = [{ w: u.w, h: u.h }];
    if (allowRot && u.w !== u.h) candidates.push({ w: u.h, h: u.w });

    let placed = false;
    // 1) prova nei fogli già aperti (più piccoli prima → meno spreco)
    const openSorted = openSheets
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s.w * a.s.h - b.s.w * b.s.h);
    for (const { s, i } of openSorted) {
      for (const cand of candidates) {
        if (tryPlaceOnSheet(s, i, u, cand)) { placed = true; break; }
      }
      if (placed) break;
    }
    if (placed) continue;

    // 2) apri un nuovo foglio dal pool: il più piccolo che contiene almeno un cand
    let openIdx = -1;
    for (let i = 0; i < availableBins.length; i++) {
      const b = availableBins[i];
      const ok = candidates.some((c) => c.w <= b.widthM + 1e-6 && c.h <= b.heightM + 1e-6);
      if (ok) { openIdx = i; break; }
    }
    if (openIdx < 0) {
      unplacedUnits.push(u);
      continue;
    }
    const bin = availableBins.splice(openIdx, 1)[0];
    const newSheet: OpenSheet = {
      bin, w: bin.widthM, h: bin.heightM, shelves: [], usedH: 0,
    };
    openSheets.push(newSheet);
    const newIndex = openSheets.length - 1;
    let placedNow = false;
    for (const cand of candidates) {
      if (tryPlaceOnSheet(newSheet, newIndex, u, cand)) { placedNow = true; break; }
    }
    if (!placedNow) unplacedUnits.push(u);
  }

  const mixedSheets: NestingMixedSheet[] = openSheets.map((s) => ({
    bin: s.bin, widthM: s.w, heightM: s.h,
  }));

  // Aree e sfrido (calcolati sui fogli effettivamente usati, eterogenei)
  const totalAreaM2 = openSheets.reduce((s, sh) => s + sh.w * sh.h, 0);
  const placedKey = new Set(allItems.map((it) => `${it.pieceId}|${it.copy}`));
  const usedAreaM2 = raw
    .filter((r) => placedKey.has(`${r.pieceId}|${r.copy}`))
    .reduce((s, r) => s + r.realArea, 0);
  const wastePct = totalAreaM2 > 0 ? Math.max(0, 1 - usedAreaM2 / totalAreaM2) : 0;

  return {
    ...baseGroup,
    items: allItems,
    unplaced: [
      ...unplacedUnits.flatMap((u) =>
        u.parts.map((p) => ({
          pieceId: p.pieceId,
          label: p.label,
          reason: `Pezzo non entra in nessun bin selezionato`,
        })),
      ),
    ],
    format: "lastra",
    rollWidthM: openSheets[0]?.w ?? baseGroup.rollWidthM,
    totalLengthM: openSheets.reduce((s, sh) => s + sh.h, 0),
    totalAreaM2,
    usedAreaM2,
    wastePct,
    sheetsNeeded: openSheets.length,
    // Per la canvas usiamo "sheetWidthM/sheetHeightM" del primo foglio come fallback,
    // ma il rendering reale userà `mixedSheets` quando presente.
    sheetWidthM: openSheets[0]?.w ?? baseGroup.sheetWidthM,
    sheetHeightM: openSheets[0]?.h ?? baseGroup.sheetHeightM,
    mixedSheets,
    scrapCost: 0,
    minBillingExtra: 0,
  };
};

/** Raggruppa i pezzi (stessa logica di `computeNesting`) e restituisce il sottoinsieme
 *  appartenente a un dato `groupKey`. Utile per ricomputare un gruppo con override. */
export const piecesOfGroup = (pieces: PieceLine[], groupKey: string): PieceLine[] => {
  return pieces.filter((p) => materialGroupKey(p) === groupKey);
};

/** Unisce più cataloghi in uno solo, deduplicando i materiali per (id) o, in mancanza,
 *  per chiave (name|color|fireproof|thickness|finish|format). Serve per calcolare un
 *  nesting GLOBALE quando i pezzi provengono da snapshot/preventivi diversi che però
 *  condividono lo stesso materiale.
 *
 *  NOTA: per il nesting servono solo `materials` e `perimeterOps` (per le categorie),
 *  ma uniamo tutto per sicurezza. Il primo catalog vince per i campi scalari.
 */
export const mergeCatalogs = (catalogs: Catalog[]): Catalog | null => {
  const valid = catalogs.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
  const matKey = (m: CatalogMaterial) =>
    m.id ||
    `${norm(m.name)}|${norm(m.color)}|${norm((m as any).fireproof)}|${norm(String((m as any).thickness ?? ""))}|${norm((m as any).finish)}|${norm((m as any).format)}|${(m as any).widthM ?? ""}|${(m as any).heightM ?? ""}`;
  const dedupe = <T,>(arr: T[], key: (x: T) => string): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const x of arr) {
      const k = key(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  };
  const first = valid[0];
  return {
    ...first,
    materials: dedupe(valid.flatMap((c) => c.materials ?? []), matKey),
    operations: dedupe(valid.flatMap((c) => c.operations ?? []), (o: any) => o.id || `${norm(o.name)}|${o.unit ?? ""}`),
    perimeterOps: dedupe(valid.flatMap((c) => c.perimeterOps ?? []), (o: any) => o.id || `${norm(o.name)}|${norm(o.category)}`),
    perimeterPresets: dedupe(valid.flatMap((c) => c.perimeterPresets ?? []), (o: any) => o.id || norm(o.name)),
    printOps: dedupe(valid.flatMap((c) => c.printOps ?? []), (o: any) => o.id || `${o.type}|${o.mode}`),
  };
};