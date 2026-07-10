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
const normMaterialLoose = (s: string | undefined | null) => normMaterialText(s).replace(/\s+/g, "");

const materialGroupKey = (
  p: Pick<PieceLine, "productName" | "color" | "fireproof" | "thickness" | "finish" | "variantId" | "catalogMaterialId">,
) =>
  // La misura/formato scelto a riga (`variantId` / `catalogMaterialId`) NON deve
  // separare il gruppo: per il nesting contano famiglia, colore, ignifugo,
  // spessore e finitura. Così un policarbonato 8 mm con varianti 305×205 e
  // 600×205 viene ottimizzato scegliendo la lastra necessaria, non restando
  // bloccato sulla misura selezionata nella card.
  [
    normMaterialText(p.productName),
    normMaterialText(p.color),
    normMaterialText(p.fireproof),
    normMaterialLoose(p.thickness),
    normMaterialText(p.finish),
  ].join("||");

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

/** Configurazione runtime del nesting: fresa (kerf) e margine perimetrale.
 *  Letti da flag `__kerfMm`, `__perimeterMarginMm`, `__skipPerimeterMargin` del Catalog. */
export const getNestingConfig = (catalog: Catalog): { kerfM: number; perimeterM: number } => {
  const c = catalog as unknown as { __kerfMm?: number; __perimeterMarginMm?: number; __skipPerimeterMargin?: boolean };
  const kerfMm = Math.max(0, Number(c.__kerfMm) || 0);
  const skip = !!c.__skipPerimeterMargin;
  const basePerimMm = skip ? 0 : Math.max(0, Number(c.__perimeterMarginMm ?? 10));
  // Il margine effettivo somma sempre la larghezza fresa (istruzione utente:
  // "sul perimetro devi lasciare 10 mm + il margine della fresa").
  const perimMm = skip ? 0 : basePerimMm + kerfMm;
  return { kerfM: kerfMm / 1000, perimeterM: perimMm / 1000 };
};

/** Costruisce una mappa pieceId → allowance di orli (m).
 *  Se il catalog ha una larghezza fresa (`__kerfMm`), viene sommata al bbox
 *  di ogni pezzo per garantire spaziatura tra i tagli. */
const buildHemMap = (
  pieces: PieceLine[],
  catalog: Catalog,
): Map<string, { addW: number; addH: number }> => {
  const { kerfM } = getNestingConfig(catalog);
  const m = new Map<string, { addW: number; addH: number }>();
  for (const p of pieces) {
    const base = pieceHemAllowanceM(p, catalog);
    m.set(p.id, { addW: base.addW + kerfM, addH: base.addH + kerfM });
  }
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
  // NB: anche quando il pezzo è legato a `variantId` NON restringiamo la ricerca
  // a quella sola variante: il nesting deve poter esplorare tutte le varianti
  // della stessa famiglia (stesso prodotto/colore/ignifugo/spessore/finitura)
  // per scegliere quella che consuma meno o evita di spezzare i pezzi
  // "indivisibili". La variante selezionata dall'utente resta il riferimento
  // per pricing/etichette, ma il layout viene ottimizzato liberamente.
  const pn = normMaterialText(productName);
  const cn = normMaterialText(color);
  const fn = normMaterialText(fireproof);
  const tn = normMaterialLoose(thickness);
  const fin = normMaterialText(finish);
  const base = materials
    .filter((m) => normMaterialText(m.name) === pn)
    .filter((m) => (cn ? normMaterialText(m.color) === cn : true));
  // Filtro spessore/finitura morbido: nei progetti vecchi o in alcuni listini
  // una variante della stessa famiglia può avere spessore/finitura vuoti o scritti
  // diversamente (es. "8mm" vs "8 mm"). Se il filtro esatto produce risultati lo
  // uso; altrimenti non scarto formati validi come 600×205.
  const withThickness = tn ? base.filter((m) => normMaterialLoose(m.thickness) === tn) : base;
  const afterThickness = tn && withThickness.length > 0 ? withThickness : base;
  const withFinish = fin ? afterThickness.filter((m) => normMaterialText(m.finish) === fin) : afterThickness;
  const afterFinish = fin && withFinish.length > 0 ? withFinish : afterThickness;
  // Filtro ignifugo morbido: se il pezzo ha un valore ma alcune varianti della
  // stessa famiglia non lo riportano uguale, non voglio perdere formati validi
  // come 600×205. Se il filtro trova risultati, lo applico; altrimenti resto
  // sulla famiglia base.
  const withFire = fn ? afterFinish.filter((m) => normMaterialText(m.fireproof) === fn) : afterFinish;
  const filtered = fn && withFire.length > 0 ? withFire : afterFinish;
  const family = filtered
    .map((m) => {
      const v = parseFloat(String(m.height).replace(",", "."));
      const u: DimUnit = (["mm", "cm", "m"] as const).includes(m.heightUnit as DimUnit)
        ? (m.heightUnit as DimUnit)
        : "cm";
      return { material: m, heightM: isFinite(v) && v > 0 ? convertLength(v, u, "m") : 0 };
    })
    .filter((x) => x.heightM > 0)
    .sort((a, b) => a.heightM - b.heightM);
  // Fallback: se la ricerca per famiglia non trova nulla ma esiste una variante
  // esplicitamente selezionata, la usiamo comunque per non perdere il materiale.
  if (family.length === 0 && variantId) {
    const selected = materials.find((m) => m.id === variantId);
    if (selected) {
      const v = parseFloat(String(selected.height).replace(",", "."));
      const u: DimUnit = (["mm", "cm", "m"] as const).includes(selected.heightUnit as DimUnit)
        ? (selected.heightUnit as DimUnit)
        : "cm";
      const heightM = isFinite(v) && v > 0 ? convertLength(v, u, "m") : 0;
      if (heightM > 0) return [{ material: selected, heightM }];
    }
  }
  return family;
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
      sheetHeightM > 0 &&
      allowSplit
    ) {
      const fitsAsIs = w <= rollWidthM + 1e-6 && h <= sheetHeightM + 1e-6;
      const fitsRotated =
        p.allowRotation && h <= rollWidthM + 1e-6 && w <= sheetHeightM + 1e-6;
      if (!fitsAsIs && !fitsRotated) {
        // Scelgo l'orientazione con meno pannelli necessari.
        // Lo split è 2D: cross = colonne (su larghezza foglio), along = righe
        // (su altezza foglio). Così anche pezzi più grandi del foglio in
        // entrambe le dimensioni vengono spezzati in una griglia di pannelli.
        type Orient = {
          crossM: number;
          alongM: number;
          cols: number;
          rows: number;
        };
        const orientations: Orient[] = [];
        orientations.push({
          crossM: w,
          alongM: h,
          cols: Math.max(1, Math.ceil(w / rollWidthM)),
          rows: Math.max(1, Math.ceil(h / sheetHeightM)),
        });
        if (p.allowRotation) {
          orientations.push({
            crossM: h,
            alongM: w,
            cols: Math.max(1, Math.ceil(h / rollWidthM)),
            rows: Math.max(1, Math.ceil(w / sheetHeightM)),
          });
        }
        orientations.sort(
          (a, b) =>
            a.cols * a.rows - b.cols * b.rows ||
            a.cols + a.rows - (b.cols + b.rows),
        );
        const best = orientations[0];
        for (let c = 0; c < qty; c++) {
          const copyLabel = qty > 1 ? `${baseLabel}·${c + 1}/${qty}` : baseLabel;
          const totalPanels = best.cols * best.rows;
          let panelIdx = 0;
          let remainingAlongM = best.alongM;
          for (let r = 0; r < best.rows; r++) {
            const panelAlongM = Math.min(sheetHeightM, remainingAlongM);
            let remainingCrossM = best.crossM;
            for (let s = 0; s < best.cols; s++) {
              const panelCrossM = Math.min(rollWidthM, remainingCrossM);
              panelIdx += 1;
              items.push({
                pieceId: p.id,
                copy: c,
                label:
                  totalPanels > 1
                    ? `${copyLabel}~${panelIdx}/${totalPanels}`
                    : copyLabel,
                shape: "rect",
                w: panelCrossM,
                h: panelAlongM,
                widthBottomM: panelCrossM,
                allowRotation: false,
                realArea: panelCrossM * panelAlongM,
              });
              remainingCrossM = Math.max(0, remainingCrossM - panelCrossM);
            }
            remainingAlongM = Math.max(0, remainingAlongM - panelAlongM);
          }
          // cuciture: verticali tra colonne + orizzontali tra righe
          seamLengthM +=
            (best.cols - 1) * best.alongM + (best.rows - 1) * best.crossM;
        }
        continue;
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

// ============================================================================
// MaxRects Best-Short-Side-Fit (BSSF) con rotazione per-pezzo.
// Rispetto allo shelf/FFD produce packing molto più compatti sulle lastre,
// perché mantiene esplicitamente la lista dei rettangoli liberi e sceglie
// ogni volta il rettangolo che minimizza il lato corto residuo.
// Riferimento: J. Jylänki, "A Thousand Ways to Pack the Bin".
// ============================================================================

type MRRect = { x: number; y: number; w: number; h: number };
type MRPlacement = { rect: MRRect; score1: number; score2: number; rotated: boolean };

const mrIntersects = (a: MRRect, b: MRRect): boolean =>
  !(
    a.x >= b.x + b.w - 1e-9 ||
    a.x + a.w <= b.x + 1e-9 ||
    a.y >= b.y + b.h - 1e-9 ||
    a.y + a.h <= b.y + 1e-9
  );

const mrOverlapsUsed = (used: MRRect[] | undefined, rect: MRRect): boolean =>
  !!used?.some((u) => mrIntersects(u, rect));

const mrContains = (a: MRRect, b: MRRect): boolean =>
  a.x <= b.x + 1e-9 &&
  a.y <= b.y + 1e-9 &&
  a.x + a.w + 1e-9 >= b.x + b.w &&
  a.y + a.h + 1e-9 >= b.y + b.h;

/** Best-Short-Side-Fit su una lista di rettangoli liberi. Ritorna null se non ci sta.
 *  Se `used` è passato, scarta subito i candidati che si accavallano a pezzi già piazzati. */
const mrFindBSSF = (free: MRRect[], w: number, h: number, used?: MRRect[]): { rect: MRRect; score1: number; score2: number } | null => {
  let best: { rect: MRRect; score1: number; score2: number } | null = null;
  for (const fr of free) {
    if (fr.w + 1e-9 < w || fr.h + 1e-9 < h) continue;
    const rect = { x: fr.x, y: fr.y, w, h };
    if (mrOverlapsUsed(used, rect)) continue;
    const leftoverH = fr.w - w;
    const leftoverV = fr.h - h;
    const short = Math.min(leftoverH, leftoverV);
    const long = Math.max(leftoverH, leftoverV);
    if (
      !best ||
      short < best.score1 - 1e-9 ||
      (Math.abs(short - best.score1) < 1e-9 && long < best.score2)
    ) {
      best = { rect, score1: short, score2: long };
    }
  }
  return best;
};

/** Piazza il rettangolo r nella lista free[]: taglia i free intersecati in
 *  fino a 4 sotto-rettangoli e rimuove quelli contenuti. Muta free[]. */
const mrPlace = (free: MRRect[], r: MRRect): void => {
  const next: MRRect[] = [];
  for (const fr of free) {
    const noOverlap =
      r.x >= fr.x + fr.w - 1e-9 ||
      r.x + r.w <= fr.x + 1e-9 ||
      r.y >= fr.y + fr.h - 1e-9 ||
      r.y + r.h <= fr.y + 1e-9;
    if (noOverlap) {
      next.push(fr);
      continue;
    }
    if (r.x > fr.x + 1e-9) next.push({ x: fr.x, y: fr.y, w: r.x - fr.x, h: fr.h });
    if (r.x + r.w < fr.x + fr.w - 1e-9)
      next.push({ x: r.x + r.w, y: fr.y, w: fr.x + fr.w - (r.x + r.w), h: fr.h });
    if (r.y > fr.y + 1e-9) next.push({ x: fr.x, y: fr.y, w: fr.w, h: r.y - fr.y });
    if (r.y + r.h < fr.y + fr.h - 1e-9)
      next.push({ x: fr.x, y: r.y + r.h, w: fr.w, h: fr.y + fr.h - (r.y + r.h) });
  }
  // Rimuovi rettangoli liberi contenuti in altri
  const pruned: MRRect[] = [];
  for (let i = 0; i < next.length; i++) {
    let contained = false;
    for (let j = 0; j < next.length; j++) {
      if (i !== j && mrContains(next[j], next[i])) {
        contained = true;
        break;
      }
    }
    if (!contained) pruned.push(next[i]);
  }
  free.length = 0;
  for (const r2 of pruned) free.push(r2);
};

type MRBin = { w: number; h: number; free: MRRect[]; used: MRRect[] };
const mrNewBin = (w: number, h: number): MRBin => ({ w, h, free: [{ x: 0, y: 0, w, h }], used: [] });

/** Costruisce la lista di orientamenti (naturale + eventualmente ruotato) per una unit. */
const mrUnitOrientations = (u: PairedUnit): { w: number; h: number; rotated: boolean }[] => {
  const allRect = u.parts.every((p) => p.shape === "rect");
  const allowRot = allRect ? u.parts.every((p) => p.allowRotation) : u.parts.every((p) => p.allowRotation);
  const ors: { w: number; h: number; rotated: boolean }[] = [{ w: u.w, h: u.h, rotated: false }];
  if (allowRot && Math.abs(u.w - u.h) > 1e-9) ors.push({ w: u.h, h: u.w, rotated: true });
  return ors;
};

/** Emette gli item finali (una entry per parte della PairedUnit). */
const mrEmitItems = (
  u: PairedUnit,
  placed: MRRect,
  rotated: boolean,
  sheetIndex: number | undefined,
  out: NestingPieceItem[],
): void => {
  u.parts.forEach((part, idx) => {
    const role: "primary" | "secondary" = idx === 0 ? "primary" : "secondary";
    out.push({
      pieceId: part.pieceId,
      copy: part.copy,
      label: part.label,
      w: placed.w,
      h: placed.h,
      rotated,
      x: placed.x,
      y: placed.y,
      shape: part.shape,
      widthBottomM: part.shape === "trapezoid" ? part.widthBottomM : undefined,
      pairedWith:
        u.parts.length === 2 ? u.parts[1 - idx].pieceId + ":" + u.parts[1 - idx].copy : undefined,
      pairRole: u.parts.length === 2 ? role : undefined,
      sheetIndex,
    });
  });
};

const pairedItemKey = (it: Pick<NestingPieceItem, "pieceId" | "copy">) => `${it.pieceId}:${it.copy}`;

/** Controllo finale di sicurezza: due pezzi rettangolari emessi sullo stesso foglio
 *  non devono mai avere bbox sovrapposti. Le coppie triangle/trapezoid condividono
 *  volutamente lo stesso bbox e vengono ignorate. */
const nestingItemsOverlap = (items: NestingPieceItem[]): boolean => {
  const bySheet = new Map<number, NestingPieceItem[]>();
  for (const it of items) {
    const si = it.sheetIndex ?? 0;
    if (!bySheet.has(si)) bySheet.set(si, []);
    bySheet.get(si)!.push(it);
  }
  for (const sheetItems of bySheet.values()) {
    for (let i = 0; i < sheetItems.length; i++) {
      const a = sheetItems[i];
      for (let j = i + 1; j < sheetItems.length; j++) {
        const b = sheetItems[j];
        if (a.pairedWith === pairedItemKey(b) || b.pairedWith === pairedItemKey(a)) continue;
        if (mrIntersects(
          { x: a.x, y: a.y, w: a.w, h: a.h },
          { x: b.x, y: b.y, w: b.w, h: b.h },
        )) return true;
      }
    }
  }
  return false;
};

const sortedUnitVariants = (units: PairedUnit[]): PairedUnit[][] => [
  [...units].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h),
  [...units].sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h)),
  [...units].sort((a, b) => b.w - a.w || b.h - a.h || b.w * b.h - a.w * a.h),
  [...units].sort((a, b) => b.h - a.h || b.w - a.w || b.w * b.h - a.w * a.h),
  [...units].sort((a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h),
];

/** Shelf / First-Fit Decreasing su un telo di larghezza rollWidthM (lunghezza illimitata).
 *
 *  Convenzione:
 *  - L'altezza del pezzo (`h`) è la dimensione ORTOGONALE al senso del telo:
 *    va sempre allineata alla larghezza del rotolo (l'"altezza tessuto" 975 cm,
 *    ecc.). Più pezzi si affiancano lungo la larghezza sommando le loro `h`.
 *  - La larghezza del pezzo (`w`) sviluppa il telo lungo la sua lunghezza.
 *  - Se il pezzo ha `allowRotation` attivo, si può anche invertire il verso
 *    (utile per far entrare pezzi più alti della larghezza rullo). Se la
 *    rotazione è disattivata, il pezzo NON viene ruotato: si rispetta la
 *    direzione di ordito.
 */
const shelfPack = (
  units: PairedUnit[],
  rollWidthM: number,
): { items: NestingPieceItem[]; totalLengthM: number; unplaced: PairedUnit[] } => {
  type Cand = { cross: number; along: number; swapped: boolean };
  type OrientedUnit = PairedUnit & { cross: number; along: number; swapped: boolean };
  const oriented: OrientedUnit[] = units.map((u) => {
    const canRotate = u.w !== u.h && u.parts.every((p) => p.allowRotation);
    // "Naturale": h allineato all'altezza rotolo (cross), w sviluppato in lunghezza.
    const natural: Cand = { cross: u.h, along: u.w, swapped: false };
    const rotated: Cand = { cross: u.w, along: u.h, swapped: true };
    const all: Cand[] = [natural, ...(canRotate ? [rotated] : [])];
    const fitting = all.filter((c) => c.cross <= rollWidthM + 1e-6);
    // Se nessun candidato entra in larghezza rullo, tengo comunque il "naturale"
    // (verrà marcato come non piazzabile più sotto).
    const pool = fitting.length > 0 ? fitting : [natural];
    // A parità di fit, preferisco l'orientamento che consuma MENO lunghezza
    // (along più piccolo) e che sfrutta meglio la larghezza.
    pool.sort((a, b) => a.along - b.along || (rollWidthM - a.cross) - (rollWidthM - b.cross));
    const best = pool[0];
    return { ...u, cross: best.cross, along: best.along, swapped: best.swapped };
  });
  // Ordino per lunghezza (along) decrescente; a parità, per larghezza (cross) decrescente
  const sorted = [...oriented].sort((a, b) => b.along - a.along || b.cross - a.cross);
  type Shelf = { y: number; height: number; usedW: number };
  const shelves: Shelf[] = [];
  const items: NestingPieceItem[] = [];
  const unplaced: PairedUnit[] = [];
  let totalLengthM = 0; // = somma "along" degli shelf

  const placeUnit = (
    u: PairedUnit,
    cross: number,
    along: number,
    swapped: boolean,
    x: number,
    y: number,
  ) => {
    u.parts.forEach((part, idx) => {
      const role: "primary" | "secondary" = idx === 0 ? "primary" : "secondary";
      items.push({
        pieceId: part.pieceId,
        copy: part.copy,
        label: part.label,
        // Rendering: w = dimensione disegnata orizzontalmente (cross), h = verticale (along)
        w: cross,
        h: along,
        rotated: swapped,
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
    if (u.cross > rollWidthM + 1e-6) {
      unplaced.push(u);
      continue;
    }
    // FFD: cerco la prima shelf che ha spazio in larghezza E lunghezza compatibile
    let chosen: Shelf | null = null;
    for (const sh of shelves) {
      if (u.along <= sh.height + 1e-6 && sh.usedW + u.cross <= rollWidthM + 1e-6) {
        chosen = sh;
        break;
      }
    }
    if (!chosen) {
      chosen = { y: totalLengthM, height: u.along, usedW: 0 };
      shelves.push(chosen);
      totalLengthM += u.along;
    }
    const x = chosen.usedW;
    const y = chosen.y;
    chosen.usedW += u.cross;
    placeUnit(u, u.cross, u.along, u.swapped, x, y);
  }

  return { items, totalLengthM, unplaced };
};

/** Multi-sheet MaxRects (BSSF) packer: distribuisce le units su più fogli identici W×H.
 *  Ogni unit DEVE entrare in un singolo foglio (no spanning). I non-piazzabili
 *  finiscono in `unplaced`. Restituisce items con `sheetIndex` valorizzato.
 *
 *  Rispetto al vecchio shelf/FFD:
 *  - considera esplicitamente lo spazio libero rimasto (non solo l'ultima riga)
 *  - sceglie l'orientamento per-pezzo che minimizza lo scarto lato-corto
 *  - può mischiare pezzi ruotati e non ruotati sullo stesso foglio
 */
const multiSheetPack = (
  units: PairedUnit[],
  sheetWidthM: number,
  sheetHeightM: number,
): { items: NestingPieceItem[]; sheetsUsed: number; unplaced: PairedUnit[] } => {
  // Ordino per max lato desc, poi area desc (euristica standard per MaxRects)
  const sorted = [...units].sort(
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  );
  const bins: MRBin[] = [];
  const allItems: NestingPieceItem[] = [];
  const unplaced: PairedUnit[] = [];

  for (const u of sorted) {
    const ors = mrUnitOrientations(u).filter(
      (o) => o.w <= sheetWidthM + 1e-6 && o.h <= sheetHeightM + 1e-6,
    );
    if (ors.length === 0) {
      unplaced.push(u);
      continue;
    }
    // Cerco il MIGLIORE placement globalmente tra tutti i bin aperti e tutti gli orientamenti.
    let best: { binIdx: number; placement: MRPlacement } | null = null;
    for (let bi = 0; bi < bins.length; bi++) {
      for (const o of ors) {
        const f = mrFindBSSF(bins[bi].free, o.w, o.h);
        if (!f) continue;
        if (mrOverlapsUsed(bins[bi].used, f.rect)) continue;
        const cand: MRPlacement = { rect: f.rect, score1: f.score1, score2: f.score2, rotated: o.rotated };
        if (
          !best ||
          cand.score1 < best.placement.score1 - 1e-9 ||
          (Math.abs(cand.score1 - best.placement.score1) < 1e-9 && cand.score2 < best.placement.score2)
        ) {
          best = { binIdx: bi, placement: cand };
        }
      }
    }
    if (!best) {
      // Apro un nuovo foglio
      const bin = mrNewBin(sheetWidthM, sheetHeightM);
      bins.push(bin);
      const bi = bins.length - 1;
      // Nel bin appena aperto scelgo l'orientamento che spreca meno
      let openBest: MRPlacement | null = null;
      for (const o of ors) {
          const f = mrFindBSSF(bin.free, o.w, o.h);
        if (!f) continue;
          if (mrOverlapsUsed(bin.used, f.rect)) continue;
        const cand: MRPlacement = { rect: f.rect, score1: f.score1, score2: f.score2, rotated: o.rotated };
        if (
          !openBest ||
          cand.score1 < openBest.score1 - 1e-9 ||
          (Math.abs(cand.score1 - openBest.score1) < 1e-9 && cand.score2 < openBest.score2)
        ) {
          openBest = cand;
        }
      }
      if (!openBest) {
        unplaced.push(u);
        continue;
      }
      mrPlace(bin.free, openBest.rect);
      bin.used.push(openBest.rect);
      mrEmitItems(u, openBest.rect, openBest.rotated, bi, allItems);
    } else {
      mrPlace(bins[best.binIdx].free, best.placement.rect);
      bins[best.binIdx].used.push(best.placement.rect);
      mrEmitItems(u, best.placement.rect, best.placement.rotated, best.binIdx, allItems);
    }
  }

  return { items: allItems, sheetsUsed: bins.length, unplaced };
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
  // Margine perimetrale + fresa: riduce l'area utilizzabile e trasla gli items.
  const { perimeterM } = getNestingConfig(catalog);
  const explodeW = Math.max(0.001, rollWidthM - 2 * perimeterM);
  const explodeH = fmt0 === "lastra" ? Math.max(0.001, preSheetH - 2 * perimeterM) : preSheetH;
  // Esplodo per quantity
  const { items: raw, seamLengthM: splitSeamLengthM } = explodePieces(
    pieces,
    pieceIndexMap,
    explodeW,
    fmt0,
    explodeH,
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
  const shiftItems = (its: NestingPieceItem[]): NestingPieceItem[] =>
    perimeterM > 0 ? its.map((it) => ({ ...it, x: it.x + perimeterM, y: it.y + perimeterM })) : its;
  if (format === "lastra") {
    const u = (picked.material.dimUnit || picked.material.heightUnit || "cm") as DimUnit;
    const sheetHRaw = parseFloat(String(picked.material.height || "0").replace(",", "."));
    const sheetWRaw = parseFloat(String(picked.material.baseWidth || "0").replace(",", "."));
    const baseW = sheetWRaw > 0 ? sheetWRaw * factorOf(u) : rollWidthM;
    const baseH = sheetHRaw > 0 ? sheetHRaw * factorOf(u) : rollWidthM;
    const sheetW = sheetRotated ? baseH : baseW;
    const sheetH = sheetRotated ? baseW : baseH;
    sheetHeightAuto = sheetH;
    const usableW = Math.max(0.001, sheetW - 2 * perimeterM);
    const usableH = Math.max(0.001, sheetH - 2 * perimeterM);
    const packed = multiSheetPack(units, usableW, usableH);
    items = shiftItems(packed.items);
    unplaced = packed.unplaced;
    sheetsUsedAuto = packed.sheetsUsed;
    totalLengthM = packed.sheetsUsed * sheetH;
  } else {
    const usableRoll = Math.max(0.001, rollWidthM - 2 * perimeterM);
    const packed = shelfPack(units, usableRoll);
    items = shiftItems(packed.items);
    totalLengthM = packed.totalLengthM + 2 * perimeterM;
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

/** Calcola un candidato "mix": usa TUTTE le varianti lastra della stessa famiglia
 *  come pool di bin (illimitato per variante) e sceglie automaticamente il formato
 *  più piccolo che contiene ogni pezzo/gruppo di pezzi. Serve per non forzare
 *  tutti i pezzi sulla lastra più grande quando alcuni starebbero comodi su una
 *  più piccola. Ritorna null se ci sono meno di 2 varianti lastra utili. */
const computeMixedLastraGroup = (
  key: string,
  label: string,
  pieces: PieceLine[],
  catalog: Catalog,
  pieceIndexMap: Map<string, number>,
  customer: CustomerType | undefined,
  lastraVars: { material: CatalogMaterial; heightM: number }[],
): NestingGroup | null => {
  if (lastraVars.length < 2) return null;
  const hemMap = buildHemMap(pieces, catalog);
  const sheetRotated = !!pieces[0]?.rotateSheet;
  const variantsWH = lastraVars
    .map(({ material }) => {
      const u = (material.dimUnit || material.heightUnit || "cm") as DimUnit;
      const wRaw = parseFloat(String(material.baseWidth || "0").replace(",", "."));
      const hRaw = parseFloat(String(material.height || "0").replace(",", "."));
      const bW = wRaw > 0 ? wRaw * factorOf(u) : 0;
      const bH = hRaw > 0 ? hRaw * factorOf(u) : 0;
      const W = sheetRotated ? bH : bW;
      const H = sheetRotated ? bW : bH;
      return { material, W, H, area: W * H };
    })
    .filter((v) => v.W > 0 && v.H > 0)
    .sort((a, b) => a.area - b.area);
  if (variantsWH.length < 2) return null;
  const maxW = Math.max(...variantsWH.map((v) => v.W));
  const maxH = Math.max(...variantsWH.map((v) => v.H));
  const { perimeterM } = getNestingConfig(catalog);
  const { items: raw, seamLengthM: splitSeamLengthM } = explodePieces(
    pieces,
    pieceIndexMap,
    Math.max(0.001, maxW - 2 * perimeterM),
    "lastra",
    Math.max(0.001, maxH - 2 * perimeterM),
    hemMap,
  );
  if (raw.length === 0) return null;
  const maxSheets = raw.length + 4;
  const matByBinId = new Map<string, CatalogMaterial>();
  const availableBins: NestingMixedBin[] = [];
  variantsWH.forEach((v) => {
    for (let i = 0; i < maxSheets; i++) {
      const id = `${v.material.id}#${i}`;
      matByBinId.set(id, v.material);
      availableBins.push({
        kind: "sheet",
        id,
        widthM: v.W,
        heightM: v.H,
        label: `${v.material.name}`,
      });
    }
  });
  availableBins.sort((a, b) => a.widthM * a.heightM - b.widthM * b.heightM);

  const units = pairShapes(raw);
  type OpenSheet = {
    bin: NestingMixedBin;
    w: number;
    h: number;
    free: MRRect[];
    used: MRRect[];
    material: CatalogMaterial;
  };
  const openSheets: OpenSheet[] = [];
  const allItems: NestingPieceItem[] = [];
  const unplacedUnits: PairedUnit[] = [];

  const sorted = [...units].sort(
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  );
  for (const u of sorted) {
    const ors = mrUnitOrientations(u);
    // 1) MaxRects BSSF su TUTTI i fogli aperti: scelgo il placement globale migliore
    let best: { sheetIdx: number; placement: MRPlacement } | null = null;
    for (let si = 0; si < openSheets.length; si++) {
      const s = openSheets[si];
      for (const o of ors) {
        if (o.w > s.w + 1e-6 || o.h > s.h + 1e-6) continue;
        const f = mrFindBSSF(s.free, o.w, o.h, s.used);
        if (!f) continue;
        const cand: MRPlacement = { rect: f.rect, score1: f.score1, score2: f.score2, rotated: o.rotated };
        if (
          !best ||
          cand.score1 < best.placement.score1 - 1e-9 ||
          (Math.abs(cand.score1 - best.placement.score1) < 1e-9 && cand.score2 < best.placement.score2)
        ) {
          best = { sheetIdx: si, placement: cand };
        }
      }
    }
    if (best) {
      const s = openSheets[best.sheetIdx];
      mrPlace(s.free, best.placement.rect);
      s.used.push(best.placement.rect);
      mrEmitItems(u, best.placement.rect, best.placement.rotated, best.sheetIdx, allItems);
      continue;
    }
    // 2) apri il bin più PICCOLO che contiene almeno un orientamento
    let openIdx = -1;
    for (let i = 0; i < availableBins.length; i++) {
      const b = availableBins[i];
      const bw = Math.max(0.001, b.widthM - 2 * perimeterM);
      const bh = Math.max(0.001, b.heightM - 2 * perimeterM);
      if (ors.some((o) => o.w <= bw + 1e-6 && o.h <= bh + 1e-6)) {
        openIdx = i;
        break;
      }
    }
    if (openIdx < 0) {
      unplacedUnits.push(u);
      continue;
    }
    const bin = availableBins.splice(openIdx, 1)[0];
    const material = matByBinId.get(bin.id)!;
    const usableW = Math.max(0.001, bin.widthM - 2 * perimeterM);
    const usableH = Math.max(0.001, bin.heightM - 2 * perimeterM);
    const newSheet: OpenSheet = {
      bin, w: usableW, h: usableH,
      free: [{ x: 0, y: 0, w: usableW, h: usableH }],
      used: [],
      material,
    };
    openSheets.push(newSheet);
    const newIndex = openSheets.length - 1;
    let openBest: MRPlacement | null = null;
    for (const o of ors) {
      if (o.w > newSheet.w + 1e-6 || o.h > newSheet.h + 1e-6) continue;
      const f = mrFindBSSF(newSheet.free, o.w, o.h, newSheet.used);
      if (!f) continue;
      const cand: MRPlacement = { rect: f.rect, score1: f.score1, score2: f.score2, rotated: o.rotated };
      if (
        !openBest ||
        cand.score1 < openBest.score1 - 1e-9 ||
        (Math.abs(cand.score1 - openBest.score1) < 1e-9 && cand.score2 < openBest.score2)
      ) {
        openBest = cand;
      }
    }
    if (!openBest) {
      unplacedUnits.push(u);
      continue;
    }
    mrPlace(newSheet.free, openBest.rect);
    newSheet.used.push(openBest.rect);
    mrEmitItems(u, openBest.rect, openBest.rotated, newIndex, allItems);
  }

  if (openSheets.length === 0) return null;

  // Trasla gli items del margine perimetrale (coordinate assolute sul foglio).
  if (perimeterM > 0) {
    for (const it of allItems) {
      it.x += perimeterM;
      it.y += perimeterM;
    }
  }

  // Costo per foglio con prezzi della sua variante specifica
  const cutCount = pieces.filter((p) => p.priceMode === "cut").length;
  const mode: "piece" | "cut" = cutCount >= pieces.length / 2 ? "cut" : "piece";
  const seamPricePerM = seamUnitPrice(catalog);
  const MIN_AREA_M2 = 0.5;
  let materialCostOptimized = 0;
  let materialCostInternal = 0;
  let totalSheetArea = 0;
  for (const s of openSheets) {
    const m = s.material;
    const unitPrice = materialUnitCost(m, mode, customer);
    const priceUnit = materialPriceUnit(m);
    const sellPerSqm =
      priceUnit === "mq" ? unitPrice : s.w > 0 ? unitPrice / s.w : 0;
    const purchaseUnit = mode === "piece" ? m.pricePiece : m.priceCut;
    const purchasePerSqm =
      priceUnit === "mq" ? purchaseUnit : s.w > 0 ? purchaseUnit / s.w : 0;
    const area = s.w * s.h;
    totalSheetArea += area;
    materialCostOptimized += area * sellPerSqm;
    materialCostInternal += area * purchasePerSqm;
  }
  let minBillingExtra = 0;
  if (totalSheetArea < MIN_AREA_M2) {
    const m = openSheets[0].material;
    const unitPrice = materialUnitCost(m, mode, customer);
    const priceUnit = materialPriceUnit(m);
    const sellPerSqm =
      priceUnit === "mq"
        ? unitPrice
        : openSheets[0].w > 0
        ? unitPrice / openSheets[0].w
        : 0;
    const extra = (MIN_AREA_M2 - totalSheetArea) * sellPerSqm;
    minBillingExtra = extra;
    materialCostOptimized += extra;
  }
  const seamLengthM = splitSeamLengthM;
  const seamCost = seamLengthM * seamPricePerM;
  materialCostOptimized += seamCost;

  // NOTE: riportiamo le dimensioni FISICHE della lastra (bin.widthM/heightM),
  // NON quelle utili post-margine. Il margine serve solo a decidere se un pezzo
  // ci entra: la lastra fisica che viene tagliata è la piena (es. 305×205).
  const mixedSheets: NestingMixedSheet[] = openSheets.map((s) => ({
    bin: s.bin,
    widthM: s.bin.widthM,
    heightM: s.bin.heightM,
  }));
  const usedAreaM2 = raw.reduce((s, r) => s + r.realArea, 0);
  const totalAreaM2 = totalSheetArea;
  const wastePct = totalAreaM2 > 0 ? Math.max(0, 1 - usedAreaM2 / totalAreaM2) : 0;
  const refSheet = openSheets.reduce(
    (best, s) => (s.w * s.h > best.w * best.h ? s : best),
    openSheets[0],
  );
  return {
    key,
    label,
    material: refSheet.material,
    rollWidthM: refSheet.bin.widthM,
    unitPrice: materialUnitCost(refSheet.material, mode, customer),
    totalLengthM: openSheets.reduce((s, sh) => s + sh.bin.heightM, 0),
    totalAreaM2,
    usedAreaM2,
    wastePct,
    materialCostOptimized,
    materialCostInternal,
    materialCostNaive: 0,
    savings: 0,
    items: allItems,
    unplaced: unplacedUnits.flatMap((u) =>
      u.parts.map((p) => ({
        pieceId: p.pieceId,
        label: p.label,
        reason: "Pezzo non entra in nessuna lastra disponibile",
      })),
    ),
    format: "lastra",
    scrapCost: 0,
    minBillingExtra,
    sheetsNeeded: openSheets.length,
    sheetHeightM: refSheet.bin.heightM,
    sheetWidthM: refSheet.bin.widthM,
    seamLengthM,
    seamCost,
    mixedSheets,
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
      // Candidato "mix": usa insieme più formati di lastra della stessa famiglia
      const lastraVars = allVariants.filter(
        (v) => (v.material.format ?? "rotolo") === "lastra",
      );
      if (lastraVars.length >= 2) {
        const mixed = computeMixedLastraGroup(
          k,
          label,
          ps,
          catalog,
          pieceIndexMap,
          customer,
          lastraVars,
        );
        if (mixed) candidates.push(mixed);
      }
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
  const { perimeterM } = getNestingConfig(catalog);
  const usableW = Math.max(0.001, sheetW - 2 * perimeterM);
  const usableH = Math.max(0.001, sheetH - 2 * perimeterM);
  const { items: raw } = explodePieces(pieces, pieceIndexMap, usableW, baseGroup.format, usableH, hemMap);
  const units = pairShapes(raw);
  const packedRaw = multiSheetPack(units, usableW, usableH);
  const items = perimeterM > 0
    ? packedRaw.items.map((it) => ({ ...it, x: it.x + perimeterM, y: it.y + perimeterM }))
    : packedRaw.items;
  const sheetsUsed = packedRaw.sheetsUsed;
  const unplaced = packedRaw.unplaced;

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
  perimeterMOrCatalog: number | Catalog = 0,
  maybeCatalog?: Catalog,
): NestingGroup => {
  if (bins.length === 0) return baseGroup;
  // Compat: accetta sia (…, perimeterM, catalog?) sia (…, catalog).
  const catalog: Catalog | undefined =
    typeof perimeterMOrCatalog === "number" ? maybeCatalog : perimeterMOrCatalog;
  const perimeterM: number = typeof perimeterMOrCatalog === "number"
    ? perimeterMOrCatalog
    : (catalog ? getNestingConfig(catalog).perimeterM : 0);
  // hemMap con kerf: garantisce spaziatura fresa tra pezzi anche nel path mixed bins,
  // altrimenti il DXF esportato risulta senza spazio tra i pannelli.
  const hemMap = catalog ? buildHemMap(pieces, catalog) : undefined;
  // 1) Esplodi i pezzi usando come limite la massima dimensione disponibile (il bin più grande)
  const maxW = Math.max(...bins.map((b) => b.widthM));
  const maxH = Math.max(...bins.map((b) => b.heightM));
  const { items: raw } = explodePieces(
    pieces,
    pieceIndexMap,
    Math.max(0.001, maxW - 2 * perimeterM),
    "lastra",
    Math.max(0.001, maxH - 2 * perimeterM),
    hemMap,
  );

  const units = pairShapes(raw);

  // 2) Pool di "fogli aperti", ognuno con le proprie dimensioni di bin (MaxRects BSSF)
  type OpenSheet = { bin: NestingMixedBin; w: number; h: number; free: MRRect[]; used: MRRect[] };
  const openSheets: OpenSheet[] = [];
  const allItems: NestingPieceItem[] = [];
  const unplacedUnits: PairedUnit[] = [];

  // bin disponibili da "aprire" (un'istanza ciascuno: l'utente ha già scelto la quantità a monte
  // creando più volte lo stesso bin se serve)
  const availableBins: NestingMixedBin[] = [...bins].sort(
    (a, b) => a.widthM * a.heightM - b.widthM * b.heightM,
  );

  // Pezzi grandi prima (max side, poi area)
  const sorted = [...units].sort(
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  );

  // Helper: miglior BSSF sui fogli aperti filtrato per tipo (scrap/sheet).
  const bestOnOpen = (ors: ReturnType<typeof mrUnitOrientations>, kind: "scrap" | "sheet") => {
    let best: { sheetIdx: number; placement: MRPlacement } | null = null;
    for (let si = 0; si < openSheets.length; si++) {
      const s = openSheets[si];
      if (s.bin.kind !== kind) continue;
      for (const o of ors) {
        if (o.w > s.w + 1e-6 || o.h > s.h + 1e-6) continue;
        const f = mrFindBSSF(s.free, o.w, o.h);
        if (!f) continue;
        if (mrOverlapsUsed(s.used, f.rect)) continue;
        const cand: MRPlacement = { rect: f.rect, score1: f.score1, score2: f.score2, rotated: o.rotated };
        if (
          !best ||
          cand.score1 < best.placement.score1 - 1e-9 ||
          (Math.abs(cand.score1 - best.placement.score1) < 1e-9 && cand.score2 < best.placement.score2)
        ) {
          best = { sheetIdx: si, placement: cand };
        }
      }
    }
    return best;
  };

  // Helper: indice del più piccolo bin disponibile del tipo indicato che contiene il pezzo.
  const findNewBinIdx = (ors: ReturnType<typeof mrUnitOrientations>, kind: "scrap" | "sheet") => {
    for (let i = 0; i < availableBins.length; i++) {
      const b = availableBins[i];
      if (b.kind !== kind) continue;
      const bw = Math.max(0.001, b.widthM - 2 * perimeterM);
      const bh = Math.max(0.001, b.heightM - 2 * perimeterM);
      if (ors.some((o) => o.w <= bw + 1e-6 && o.h <= bh + 1e-6)) return i;
    }
    return -1;
  };

  const openNewBin = (binIdx: number, ors: ReturnType<typeof mrUnitOrientations>, u: PairedUnit) => {
    const bin = availableBins.splice(binIdx, 1)[0];
    const usableW = Math.max(0.001, bin.widthM - 2 * perimeterM);
    const usableH = Math.max(0.001, bin.heightM - 2 * perimeterM);
    const newSheet: OpenSheet = {
      bin, w: usableW, h: usableH,
      free: [{ x: 0, y: 0, w: usableW, h: usableH }],
        used: [],
    };
    openSheets.push(newSheet);
    const newIndex = openSheets.length - 1;
    let openBest: MRPlacement | null = null;
    for (const o of ors) {
      if (o.w > newSheet.w + 1e-6 || o.h > newSheet.h + 1e-6) continue;
      const f = mrFindBSSF(newSheet.free, o.w, o.h);
      if (!f) continue;
      if (mrOverlapsUsed(newSheet.used, f.rect)) continue;
      const cand: MRPlacement = { rect: f.rect, score1: f.score1, score2: f.score2, rotated: o.rotated };
      if (
        !openBest ||
        cand.score1 < openBest.score1 - 1e-9 ||
        (Math.abs(cand.score1 - openBest.score1) < 1e-9 && cand.score2 < openBest.score2)
      ) {
        openBest = cand;
      }
    }
    if (!openBest) return false;
    mrPlace(newSheet.free, openBest.rect);
    newSheet.used.push(openBest.rect);
    mrEmitItems(u, openBest.rect, openBest.rotated, newIndex, allItems);
    return true;
  };

  for (const u of sorted) {
    const ors = mrUnitOrientations(u);
    // Priorità: 1) sfridi aperti  2) apri nuovo sfrido  3) lastre aperte  4) apri nuova lastra.
    // Così gli sfridi vengono SEMPRE consumati prima delle lastre intere.
    const order: Array<"scrap" | "sheet"> = ["scrap", "sheet"];
    let placed = false;
    for (const kind of order) {
      const b = bestOnOpen(ors, kind);
      if (b) {
        const s = openSheets[b.sheetIdx];
        mrPlace(s.free, b.placement.rect);
        s.used.push(b.placement.rect);
        mrEmitItems(u, b.placement.rect, b.placement.rotated, b.sheetIdx, allItems);
        placed = true; break;
      }
      const idx = findNewBinIdx(ors, kind);
      if (idx >= 0 && openNewBin(idx, ors, u)) { placed = true; break; }
    }
    if (!placed) unplacedUnits.push(u);
  }

  if (perimeterM > 0) {
    for (const it of allItems) { it.x += perimeterM; it.y += perimeterM; }
  }

  const mixedSheets: NestingMixedSheet[] = openSheets.map((s) => ({
    bin: s.bin, widthM: s.bin.widthM, heightM: s.bin.heightM,
  }));

  // Aree e sfrido (calcolati sui fogli effettivamente usati, eterogenei)
  const totalAreaM2 = openSheets.reduce((s, sh) => s + sh.bin.widthM * sh.bin.heightM, 0);
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
    rollWidthM: openSheets[0]?.bin.widthM ?? baseGroup.rollWidthM,
    totalLengthM: openSheets.reduce((s, sh) => s + sh.bin.heightM, 0),
    totalAreaM2,
    usedAreaM2,
    wastePct,
    sheetsNeeded: openSheets.length,
    // Per la canvas usiamo "sheetWidthM/sheetHeightM" del primo foglio come fallback,
    // ma il rendering reale userà `mixedSheets` quando presente.
    sheetWidthM: openSheets[0]?.bin.widthM ?? baseGroup.sheetWidthM,
    sheetHeightM: openSheets[0]?.bin.heightM ?? baseGroup.sheetHeightM,
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
    `${norm(m.name)}|${norm(m.color)}|${norm((m as any).fireproof)}|${norm(String((m as any).thickness ?? ""))}|${norm((m as any).finish)}|${norm((m as any).format)}|${norm((m as any).baseWidth)}|${norm((m as any).height)}|${norm((m as any).rollLength)}|${norm((m as any).dimUnit)}|${norm((m as any).heightUnit)}`;
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

// ============================================================================
// DIAGNOSTICA: mostra i criteri usati per filtrare/scegliere le lastre.
// Restituisce, per ogni gruppo, i filtri applicati, le varianti considerate,
// le metriche di ciascun candidato e la variante vincente (con motivazione).
// ============================================================================

export type NestingDiagnosticVariant = {
  materialId: string;
  materialName: string;
  format: "lastra" | "rotolo";
  /** dimensioni foglio/rullo in metri (h è "altezza rullo" per rotolo) */
  sheetWidthM: number;
  sheetHeightM: number;
  /** flags dalla scheda materiale */
  color?: string;
  fireproof?: string;
  thickness?: string;
  finish?: string;
  /** metriche calcolate simulando il gruppo con questa variante */
  feasible: boolean;
  unplacedCount: number;
  seamLengthM: number;
  wastePct: number;
  materialCostOptimized: number;
  totalAreaM2: number;
  sheetsNeeded?: number;
  /** true se è la variante scelta */
  chosen: boolean;
  /** true se è la variante selezionata a mano nella card (variantId/catalogMaterialId) */
  selectedByUser: boolean;
};

export type NestingDiagnostic = {
  groupKey: string;
  label: string;
  /** criteri di famiglia usati per filtrare i materiali del catalogo */
  filters: {
    productName: string;
    color: string;
    fireproof: string;
    thickness: string;
    finish: string;
    variantIdHint: string | null;
  };
  /** varianti trovate nel catalogo con quei filtri */
  variantsConsidered: NestingDiagnosticVariant[];
  /** id variante scelta (null se nessuna) */
  chosenVariantId: string | null;
  /** breve descrizione del criterio di selezione */
  chosenReason: string;
  /** varianti scartate perché non trovate/nessun match */
  notes: string[];
};

export const diagnoseNesting = (
  pieces: PieceLine[],
  catalog: Catalog,
  customer?: CustomerType,
): NestingDiagnostic[] => {
  const valid = pieces.filter(
    (p) => p.productName && (p.width || 0) > 0 && (p.height || 0) > 0,
  );
  if (valid.length === 0) return [];
  const pieceIndexMap = buildPieceIndexMap(pieces);

  const groups = new Map<string, PieceLine[]>();
  for (const p of valid) {
    const k = materialGroupKey(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  const out: NestingDiagnostic[] = [];
  for (const [k, ps] of groups) {
    const first = ps[0];
    const label = `${first.productName}${first.color ? ` · ${first.color}` : ""}${first.fireproof ? ` · ${first.fireproof}` : ""}`;
    const variantIdHint = first.variantId ?? first.catalogMaterialId ?? null;
    const notes: string[] = [];

    const variants = candidateVariants(
      catalog.materials,
      first.productName,
      first.color,
      first.fireproof,
      first.thickness,
      first.finish,
      variantIdHint,
    );

    if (variants.length === 0) {
      notes.push("Nessuna variante nel catalogo corrisponde ai filtri della famiglia.");
    }

    // simulo un computeGroup per ogni variante per raccogliere le metriche
    const computed = variants.map((v) => {
      const g = computeGroup(k, label, ps, catalog, pieceIndexMap, customer, v);
      const u = (v.material.dimUnit || v.material.heightUnit || "cm") as DimUnit;
      const sheetWRaw = parseFloat(String(v.material.baseWidth || "0").replace(",", "."));
      const sheetHRaw = parseFloat(String(v.material.height || "0").replace(",", "."));
      const isLastra = (v.material.format ?? "rotolo") === "lastra";
      const sheetW = isLastra
        ? (sheetWRaw > 0 ? sheetWRaw * factorOf(u) : v.heightM)
        : v.heightM;
      const sheetH = isLastra
        ? (sheetHRaw > 0 ? sheetHRaw * factorOf(u) : v.heightM)
        : v.heightM;
      const diag: NestingDiagnosticVariant = {
        materialId: v.material.id,
        materialName: v.material.name,
        format: (v.material.format ?? "rotolo") as "lastra" | "rotolo",
        sheetWidthM: sheetW,
        sheetHeightM: sheetH,
        color: v.material.color,
        fireproof: (v.material as any).fireproof,
        thickness: (v.material as any).thickness,
        finish: (v.material as any).finish,
        feasible: g.unplaced.length === 0 && g.items.length > 0,
        unplacedCount: g.unplaced.length,
        seamLengthM: g.seamLengthM ?? 0,
        wastePct: g.wastePct,
        materialCostOptimized: g.materialCostOptimized,
        totalAreaM2: g.totalAreaM2,
        sheetsNeeded: g.sheetsNeeded,
        chosen: false,
        selectedByUser: v.material.id === variantIdHint,
      };
      return diag;
    });

    // stessa ordinatura di computeNesting
    let chosenId: string | null = null;
    let chosenReason = "Nessuna variante disponibile.";
    if (computed.length > 0) {
      const feasible = computed.filter((c) => c.feasible);
      const pool = feasible.length > 0 ? [...feasible] : [...computed];
      pool.sort((a, b) => {
        const aSeams = a.seamLengthM > 1e-6 ? 1 : 0;
        const bSeams = b.seamLengthM > 1e-6 ? 1 : 0;
        if (aSeams !== bSeams) return aSeams - bSeams;
        const dCost = a.materialCostOptimized - b.materialCostOptimized;
        if (Math.abs(dCost) > 1e-3) return dCost;
        const dWaste = a.wastePct - b.wastePct;
        if (Math.abs(dWaste) > 1e-4) return dWaste;
        return a.totalAreaM2 - b.totalAreaM2;
      });
      const winner = pool[0];
      chosenId = winner.materialId;
      const bits: string[] = [];
      if (feasible.length === 0) bits.push("nessuna variante piazza tutti i pezzi — scelta la meno peggio");
      else bits.push(`${feasible.length}/${computed.length} varianti fattibili`);
      if (winner.seamLengthM <= 1e-6) bits.push("nessuna cucitura da split");
      else bits.push(`cuciture split ${winner.seamLengthM.toFixed(2)} m`);
      bits.push(`costo €${winner.materialCostOptimized.toFixed(2)}`);
      bits.push(`sfrido ${(winner.wastePct * 100).toFixed(1)}%`);
      chosenReason = bits.join(" · ");
      for (const c of computed) if (c.materialId === chosenId) c.chosen = true;
    }

    out.push({
      groupKey: k,
      label,
      filters: {
        productName: first.productName ?? "",
        color: first.color ?? "",
        fireproof: first.fireproof ?? "",
        thickness: first.thickness ?? "",
        finish: first.finish ?? "",
        variantIdHint,
      },
      variantsConsidered: computed,
      chosenVariantId: chosenId,
      chosenReason,
      notes,
    });
  }
  return out;
};
