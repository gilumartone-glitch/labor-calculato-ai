import { Catalog, PieceLine, PerimeterLine, CatalogMaterial } from "@/components/calculator/types";
import { materialUnitCost } from "./material-match";
import { perimeterCost, convertLength, DimUnit, pieceAreaM2 } from "./perimeter";
import { CustomerType } from "./pricing";

const pieceAreaM2Local = (piece: PieceLine) =>
  pieceAreaM2({
    width: piece.width,
    height: piece.height,
    dimUnit: piece.dimUnit,
    shape: piece.shape,
    widthBottom: piece.widthBottom,
  });

/* ============================================================
 * Calcolo materiale con margini, rotazione opzionale e cuciture.
 *
 * Regole:
 * - alle dimensioni del pezzo si aggiungono SEMPRE i margini di lavorazione:
 *     +20 cm in altezza, +10 cm in larghezza
 * - SENZA rotazione: il tessuto può essere usato solo "in altezza", cioè
 *   l'altezza del rullo deve coprire l'altezza del pezzo. Se esiste una
 *   variante con altezza ≥ altezza pezzo → 1 telo, nessuna cucitura.
 *   Se NESSUNA variante copre l'altezza pezzo → si compongono più teli
 *   affiancati (tutti dello stesso rullo, l'altezza utile più grande
 *   disponibile) e si aggiunge una "Cucitura" verticale.
 * - CON rotazione attiva: il sistema valuta anche l'orientamento ruotato
 *   (altezza pezzo trattata come larghezza) e tiene il piano più economico.
 * - Le cuciture sono SEMPRE verticali. Il numero di teli è
 *   ceil(larghezzaPezzo / altezzaRullo); la lunghezza totale di cucitura è
 *   (N − 1) × altezzaPezzo. Se basta 1 telo → nessuna cucitura.
 * - Tutti i teli devono avere la STESSA altezza di rullo (stessa variante).
 * ============================================================ */

/** Margini di lavorazione fissi (cm). Disattivati: ora le abbondanze sono
 *  calcolate per-lato in base alle lavorazioni perimetrali applicate
 *  (vedi PERIMETER_ALLOWANCE_CM / pieceHemAllowanceM). */
export const MARGIN_WIDTH_CM = 0;
export const MARGIN_HEIGHT_CM = 0;

/**
 * Allowance (cm) di tessuto richiesto sul lato in cui è applicata una specifica
 * lavorazione perimetrale. Match per nome (case-insensitive) sul prefisso.
 * Se più lavorazioni con allowance sono applicate sullo stesso lato, si SOMMANO.
 */
export const PERIMETER_ALLOWANCE_CM: {
  match: (name: string) => boolean;
  cm: number;
  /** Lati su cui l'allowance va effettivamente conteggiata. Default = tutti. */
  sides?: ("top" | "bottom" | "left" | "right")[];
}[] = [
  // Orli: solo sui lati superiore/inferiore (mai sui laterali)
  { match: (n) => n.startsWith("orl"), cm: 2.5, sides: ["top", "bottom"] },
  { match: (n) => n.startsWith("sacc"), cm: 10 },                       // Sacca
  { match: (n) => n.includes("anell") || n.includes("lacc"), cm: 10 }, // Anelli e laccetti
  { match: (n) => n.startsWith("velcr"), cm: 5 },                       // Velcro
  { match: (n) => n.startsWith("piomb"), cm: 5 },                       // Piombo
];

const allowanceCmForOpNameOnSide = (
  name: string | undefined | null,
  side: "top" | "bottom" | "left" | "right",
): number => {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return 0;
  let total = 0;
  for (const rule of PERIMETER_ALLOWANCE_CM) {
    if (!rule.match(n)) continue;
    if (rule.sides && !rule.sides.includes(side)) continue;
    total += rule.cm;
  }
  return total;
};

/**
 * Calcola l'allowance di tessuto extra (in metri) richiesto dalle lavorazioni
 * perimetrali applicate al pezzo, lato per lato. Le allowance dei lati opposti
 * si sommano (es. orlo top + orlo bottom = +5 cm sull'altezza).
 *  - addH = top + bottom (sull'altezza del pezzo)
 *  - addW = left + right (sulla larghezza del pezzo)
 * Mantiene il nome storico per compatibilità con le importazioni esistenti.
 */
export const pieceHemAllowanceM = (
  piece: PieceLine,
  catalog: Catalog,
): { addW: number; addH: number } => {
  const ops = catalog?.perimeterOps ?? [];
  if (ops.length === 0) return { addW: 0, addH: 0 };
  const opCm = new Map<string, number>();
  for (const o of ops) {
    const cm = allowanceCmForOpName(o.name);
    if (cm > 0) opCm.set(o.id, cm);
  }
  if (opCm.size === 0) return { addW: 0, addH: 0 };
  // sideCm[side] = somma cm allowance sul lato (più lavorazioni si sommano)
  const sideCm: Record<string, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const pl of piece.perimeters ?? []) {
    const cm = opCm.get(pl.opId);
    if (!cm) continue;
    for (const s of pl.sides ?? []) {
      if (s in sideCm) sideCm[s] += cm;
    }
  }
  const addH = (sideCm.top + sideCm.bottom) / 100;
  const addW = (sideCm.left + sideCm.right) / 100;
  return { addW, addH };
};

/** Risultato di calcolo materiale per un pezzo. */
export type PieceMaterialBreakdown = {
  /** materiale auto-matchato dal listino (può essere null se nessuna variante copre) */
  material: CatalogMaterial | null;
  /** larghezza utile del rullo, in metri */
  rollWidthM: number;
  /** dimensioni del pezzo + margini, in metri (dopo eventuale rotazione) */
  pieceWidthM: number;
  pieceHeightM: number;
  /** true se il sistema ha applicato la rotazione (scambio b↔h) per ottimizzare */
  rotated: boolean;
  /** numero di teli necessari (≥1) */
  panels: number;
  /** lunghezza di un singolo telo, in metri */
  panelLengthM: number;
  /** quantità totale di tessuto, in metri lineari (panels × panelLengthM) */
  totalMetersM: number;
  /** costo del materiale (€) */
  materialCost: number;
  /** prezzo unitario applicato (€/m) */
  unitCost: number;
  /** lunghezza totale di cucitura (m), 0 se panels = 1 */
  seamLengthM: number;
  /** costo cucitura (€), basato sull'op "Cucitura" del listino */
  seamCost: number;
  /** prezzo €/m della cucitura usato (0 se "Cucitura" non in listino) */
  seamUnitPrice: number;
  /** Costo del solo materiale "da lavorare" (10×5 nell'esempio): metri × larghezza × €/mq di vendita
   *  oppure metri × €/ml. NON include lo sfrido iniziale del rotolo. */
  workingMaterialCost: number;
  /** Costo SOSTENUTO (acquisto, senza moltiplicatore cliente) per TUTTI i metri effettivamente
   *  usati = materiale da lavorare + sfrido iniziale rotolo, calcolato al prezzo d'acquisto. */
  purchaseCost: number;
  /** Quota dello sfrido iniziale rotolo già inclusa in `materialCost` (vendita, con markup). */
  initialScrapCost: number;
  /** Quota dello sfrido iniziale rotolo a prezzo di VENDITA (già inclusa in `materialCost`).
   *  Serve per dedurla quando più pezzi condividono lo stesso materiale (sfrido una sola volta). */
  initialScrapSellCost: number;
  /** Identifica univocamente il "materiale sfrido" condiviso tra pezzi: stessa variante + stesso
   *  priceMode → stesso costo sfrido (1,5 m × larghezza rullo × €/mq). */
  scrapKey: string | null;
  /** true se il calcolo è valido (pezzo coperto dal tessuto). */
  feasible: boolean;
  /** motivo del fallimento se !feasible */
  reason?: string;
};

/** Converte l'altezza del rullo (string + unit) in metri. */
const rollHeightMeters = (m: CatalogMaterial): number => {
  const v = parseFloat(String(m.height).replace(",", "."));
  if (!isFinite(v) || v <= 0) return 0;
  const u: DimUnit = (["mm", "cm", "m"] as const).includes(m.heightUnit as DimUnit)
    ? (m.heightUnit as DimUnit)
    : "cm";
  return convertLength(v, u, "m");
};

const materialPriceUnit = (m: CatalogMaterial): "mq" | "ml" => {
  const explicit = m.priceUnit;
  if (explicit === "mq" || explicit === "ml") return explicit;
  const unit = String(m.unit || "").trim().toLowerCase();
  return unit === "mq" || unit === "m²" || unit === "m2" ? "mq" : "ml";
};

/** Filtra le varianti compatibili (nome/colore/ignifugo) con altezza > 0, ordinate per altezza crescente. */
const candidateVariants = (
  materials: CatalogMaterial[],
  productName: string,
  color: string,
  fireproof: string,
  thickness?: string,
  finish?: string,
  variantId?: string | null,
): { material: CatalogMaterial; heightM: number }[] => {
  // Se è stata scelta esplicitamente una variante, restringo a quella sola
  if (variantId) {
    const m = materials.find((x) => x.id === variantId);
    if (m) {
      const h = rollHeightMeters(m);
      return h > 0 ? [{ material: m, heightM: h }] : [];
    }
  }
  const base = materials
    .filter((m) => m.name === productName)
    .filter((m) => (color ? m.color === color : true))
    .filter((m) => (thickness ? (m.thickness || "") === thickness : true))
    .filter((m) => (finish ? (m.finish || "") === finish : true));
  // Filtro ignifugo "soft": se applicandolo non resta nulla, ignoralo
  // (es. se il listino è stato aggiornato e la variante salvata non esiste più).
  const withFire = fireproof
    ? base.filter((m) => (m.fireproof || "") === fireproof)
    : base;
  const filtered = withFire.length > 0 ? withFire : base;
  return filtered
    .map((m) => ({ material: m, heightM: rollHeightMeters(m) }))
    .filter((x) => x.heightM > 0)
    .sort((a, b) => a.heightM - b.heightM);
};

/**
 * Calcola un piano di taglio per un dato orientamento del pezzo.
 * - pieceHeightM → dimensione che il rullo deve coprire "in altezza"
 * - pieceWidthM  → dimensione lungo cui si affiancano i teli (cucitura verticale)
 *
 * Strategia rotolo:
 * - la larghezza del rotolo copre SEMPRE la larghezza finale del pezzo a pannelli affiancati
 * - `panels = ceil(pieceWidthM / altezzaRullo)`
 * - ogni telo è lungo `pieceHeightM`
 * - metri lineari totali = `panels × pieceHeightM`
 * - cuciture verticali = `(panels - 1) × pieceHeightM`
 *
 * Se sono presenti materiali non rotolo, ricade sulla logica legacy.
 *
 * Ritorna null se non ci sono varianti disponibili.
 */
type OrientationPlan = {
  material: CatalogMaterial;
  rollWidthM: number;
  panels: number;
  panelLengthM: number;
  totalMetersM: number;
  seamLengthM: number;
};

const planOrientation = (
  variants: { material: CatalogMaterial; heightM: number }[],
  pieceWidthM: number,
  pieceHeightM: number,
): OrientationPlan | null => {
  if (variants.length === 0 || pieceWidthM <= 0 || pieceHeightM <= 0) return null;

  const rollVariants = variants.filter((v) => (v.material.format ?? "rotolo") === "rotolo");
  if (rollVariants.length > 0) {
    const sorted = [...rollVariants].sort((a, b) => a.heightM - b.heightM);
    const cheapest = sorted.reduce<OrientationPlan | null>((best, current) => {
      const panels = Math.max(1, Math.ceil(pieceWidthM / current.heightM));
      const plan: OrientationPlan = {
        material: current.material,
        rollWidthM: current.heightM,
        panels,
        panelLengthM: pieceHeightM,
        totalMetersM: panels * pieceHeightM,
        seamLengthM: Math.max(0, panels - 1) * pieceHeightM,
      };

      if (!best) return plan;
      if (plan.totalMetersM !== best.totalMetersM) {
        return plan.totalMetersM < best.totalMetersM ? plan : best;
      }
      if (plan.panels !== best.panels) {
        return plan.panels < best.panels ? plan : best;
      }
      // A parità di metri lineari e numero di teli, preferisco il rotolo
      // PIÙ STRETTO sufficiente: meno sfrido in altezza e costo materiale
      // più basso (i rotoli più alti costano di più al m).
      return plan.rollWidthM < best.rollWidthM ? plan : best;
    }, null);

    return cheapest;
  }

  // Fallback legacy per materiali non-rotolo.
  const single = variants.find((v) => v.heightM >= pieceHeightM);
  if (single) {
    return {
      material: single.material,
      rollWidthM: single.heightM,
      panels: 1,
      panelLengthM: pieceWidthM,
      totalMetersM: pieceWidthM,
      seamLengthM: 0,
    };
  }

  // Nessuna variante copre: uso la più alta disponibile.
  const tallest = variants[variants.length - 1];
  const panels = Math.max(2, Math.ceil(pieceHeightM / tallest.heightM));
  // Ogni telo è lungo pieceWidthM (cucitura verticale lungo la dimensione verticale del pezzo)
  // Attenzione: i teli si affiancano lungo pieceHeightM, ciascuno di altezza rullo (heightM)
  // e lunghezza pari a pieceWidthM. La cucitura è verticale e va percorsa per pieceHeightM
  // meno... no: la cucitura unisce due teli adiacenti, quindi corre per tutta la lunghezza
  // del telo = pieceWidthM. Tuttavia, secondo le regole utente:
  // "calcolo cuciture = (teli − 1) × altezza pezzo".
  // => seamLengthM = (panels - 1) * pieceHeightM
  const panelLengthM = pieceWidthM;
  const totalMetersM = panels * panelLengthM;
  const seamLengthM = (panels - 1) * pieceHeightM;
  return {
    material: tallest.material,
    rollWidthM: tallest.heightM,
    panels,
    panelLengthM,
    totalMetersM,
    seamLengthM,
  };
};

/** Trova nel catalogo il prezzo €/m della lavorazione "Cucitura" (case-insensitive). */
export const seamUnitPrice = (catalog: Catalog): number => {
  const op = catalog.perimeterOps.find(
    (o) => o.name.trim().toLowerCase() === "cucitura",
  );
  return op ? op.pricePerMeter : 0;
};

/** Breakdown completo del materiale per un pezzo. */
export const computePieceMaterial = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): PieceMaterialBreakdown => {
  // dimensioni base del pezzo in metri
  const baseW = convertLength(piece.width || 0, piece.dimUnit, "m");
  const baseH = convertLength(piece.height || 0, piece.dimUnit, "m");
  // margini di lavorazione (cm → m). Disabilitati se piece.noMargins è true (es. Laboratorio/Stampa).
  const marginW = piece.noMargins ? 0 : MARGIN_WIDTH_CM / 100;
  const marginH = piece.noMargins ? 0 : MARGIN_HEIGHT_CM / 100;
  // Allowance per orli (2,5 cm per lato attivo).
  const hem = pieceHemAllowanceM(piece, catalog);
  const pieceWM = baseW > 0 ? baseW + marginW + hem.addW : 0;
  const pieceHM = baseH > 0 ? baseH + marginH + hem.addH : 0;

  const empty: PieceMaterialBreakdown = {
    material: null,
    rollWidthM: 0,
    pieceWidthM: pieceWM,
    pieceHeightM: pieceHM,
    rotated: false,
    panels: 0,
    panelLengthM: 0,
    totalMetersM: 0,
    materialCost: 0,
    unitCost: 0,
    seamLengthM: 0,
    seamCost: 0,
    seamUnitPrice: seamUnitPrice(catalog),
    workingMaterialCost: 0,
    purchaseCost: 0,
    initialScrapCost: 0,
    initialScrapSellCost: 0,
    scrapKey: null,
    feasible: false,
  };

  if (!piece.productName || pieceWM <= 0 || pieceHM <= 0) {
    return { ...empty, reason: "Inserisci tipo prodotto e dimensioni" };
  }

  const variants = candidateVariants(
    catalog.materials,
    piece.productName,
    piece.color,
    piece.fireproof,
    piece.thickness,
    piece.finish,
    piece.variantId,
  );

  if (variants.length === 0) {
    return {
      ...empty,
      reason: "Nessuna variante disponibile per questo prodotto/colore/ignifugo",
    };
  }

  const seamPrice = seamUnitPrice(catalog);

  // Prezzo CLIENTE = area reale che il cliente riceve (pezzo + margini) × €/mq vendita.
  // Per i ROTOLI aggiungo anche lo sfrido iniziale (1,5 m × larghezza rullo) valutato
  // come (€/mq d'acquisto × 1,3) — moltiplicatore FISSO per lo sfrido, non quello cliente.
  // Per i materiali in €/ml manteniamo il calcolo lineare (metri lineari × €/ml di vendita).
  const SCRAP_SELL_MULT = 1.3;
  // Lo sfrido iniziale del rotolo si addebita SOLO se il pezzo richiede stampa.
  // Se il cliente prende solo il materiale (nessuna stampa selezionata) non c'è
  // scarto di partenza da imputare.
  const hasPrintWork =
    !!piece.printOpId ||
    (piece.perimeters ?? []).some((pp) => {
      const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
      return (op?.category ?? "") === "stampa";
    });
  const noPrintNoScrap = !hasPrintWork;
  // Prezzo d'ACQUISTO unitario (per calcolo sfrido a costo). Per il nuovo schema
  // Tappezzeria (manual sell prices) il costo è in `costPrice`. Per lo schema legacy
  // "molt. automatici" il costo è già in pricePiece/priceCut (= prezzo d'acquisto).
  const purchaseUnit = (m: typeof variants[number]["material"]): number => {
    if (typeof m.costPrice === "number") return m.costPrice;
    return piece.priceMode === "piece" ? m.pricePiece : m.priceCut;
  };
  // Prezzo di VENDITA dello sfrido. In Tappezzeria (prezzo manuale) lo sfrido viene
  // venduto al prezzo di listino (= pricePiece/priceCut), così resta coerente con il
  // resto del materiale. Negli altri reparti applichiamo il moltiplicatore fisso 1,30
  // sul costo d'acquisto.
  const scrapSellUnit = (m: typeof variants[number]["material"]): number => {
    const purchase = purchaseUnit(m);
    if (typeof m.costPrice === "number") {
      return piece.priceMode === "piece" ? m.pricePiece : m.priceCut;
    }
    return purchase * SCRAP_SELL_MULT;
  };
  const clientCostForPlan = (plan: OrientationPlan, unit: number): number => {
    const format = plan.material.format ?? "rotolo";
    const priceUnit = materialPriceUnit(plan.material);
    // In Tappezzeria (catalog marcato con __skipInitialScrap) NON addebitiamo
    // lo sfrido iniziale e vendiamo il rotolo a metri lineari reali usati.
    const skipInitialScrap = !!catalog.__skipInitialScrap || noPrintNoScrap;
    if (format === "rotolo" && skipInitialScrap) {
      // Nesting interno alla card: più copie dello stesso pezzo possono
      // affiancarsi sulla larghezza del rotolo. Calcoliamo i metri lineari
      // totali del rotolo necessari per TUTTE le copie e poi dividiamo per
      // qty (questo helper restituisce il costo per singola copia, che il
      // chiamante moltiplicherà nuovamente × qty).
      const qty = Math.max(1, Math.floor(Number(piece.quantity) || 1));
      // BUGFIX: se il pezzo è più largo del rullo servono più teli per coprirlo.
      // In quel caso usiamo i metri lineari totali calcolati dal piano (plan.totalMetersM)
      // invece di assumere che il pezzo entri nella larghezza del rullo.
      if (plan.rollWidthM > 0 && pieceWM > plan.rollWidthM) {
        if (priceUnit === "ml") return plan.totalMetersM * unit;
        // priceUnit === "mq": area effettivamente consumata dai teli
        return plan.totalMetersM * plan.rollWidthM * unit;
      }
      const piecesPerShelf =
        plan.rollWidthM > 0 && pieceWM > 0
          ? Math.max(1, Math.floor(plan.rollWidthM / pieceWM))
          : 1;
      const shelves = Math.ceil(qty / piecesPerShelf);
      const nestedTotalMetersM = shelves * pieceHM;
      return (nestedTotalMetersM * unit) / qty;
    }
    if (format === "rotolo" && priceUnit === "mq") {
      const areaM2 = pieceWM * pieceHM;
      // Sfrido a prezzo di vendita: 1,5 m × larghezza rullo × €/mq vendita sfrido
      const sellPerSqm = scrapSellUnit(plan.material);
      const scrapSell = skipInitialScrap ? 0 : 1.5 * plan.rollWidthM * sellPerSqm;
      return areaM2 * unit + scrapSell;
    }
    if (format === "rotolo" && priceUnit === "ml") {
      // Materiale rotolo venduto a metro lineare: lo sfrido è 1,5 m × €/ml vendita sfrido
      const sellPerMl = scrapSellUnit(plan.material);
      const scrapSell = skipInitialScrap ? 0 : 1.5 * sellPerMl;
      return plan.totalMetersM * unit + scrapSell;
    }
    // LASTRA (o fallback) con prezzo €/mq: cliente paga l'area effettiva del pezzo
    // (larghezza × altezza), non i metri lineari. Nessuno sfrido iniziale.
    if (priceUnit === "mq") {
      return pieceWM * pieceHM * unit;
    }
    // LASTRA con prezzo €/ml (raro): metri lineari × €/ml.
    return plan.totalMetersM * unit;
  };

  // Costo INTERNO (sostenuto): tutto il materiale realmente consumato a prezzo d'acquisto.
  // = (metri lineari teli + 1,5 m sfrido) × larghezza rullo × €/mq d'acquisto, oppure
  //   (metri lineari teli) × €/ml d'acquisto + sfrido valutato a €/mq se disponibile.
  const internalCostForPlan = (
    plan: OrientationPlan,
  ): { cost: number; scrap: number; scrapSell: number } => {
    const format = plan.material.format ?? "rotolo";
    const purchase = purchaseUnit(plan.material);
    const priceUnit = materialPriceUnit(plan.material);
    const skipInitialScrap = !!catalog.__skipInitialScrap || noPrintNoScrap;
    if (format === "rotolo" && skipInitialScrap) {
      const qty = Math.max(1, Math.floor(Number(piece.quantity) || 1));
      // BUGFIX coerente con clientCostForPlan: pezzi più larghi del rullo
      // richiedono più teli — usa plan.totalMetersM invece di pieceHM.
      if (plan.rollWidthM > 0 && pieceWM > plan.rollWidthM) {
        const cost =
          priceUnit === "ml"
            ? plan.totalMetersM * purchase
            : plan.totalMetersM * plan.rollWidthM * purchase;
        return { cost, scrap: 0, scrapSell: 0 };
      }
      const piecesPerShelf =
        plan.rollWidthM > 0 && pieceWM > 0
          ? Math.max(1, Math.floor(plan.rollWidthM / pieceWM))
          : 1;
      const shelves = Math.ceil(qty / piecesPerShelf);
      const nestedTotalMetersM = shelves * pieceHM;
      return { cost: (nestedTotalMetersM * purchase) / qty, scrap: 0, scrapSell: 0 };
    }
    if (format !== "rotolo" || plan.rollWidthM <= 0) {
      // Lastra (o fallback) — il costo interno è area × €/mq oppure metri × €/ml.
      const cost =
        priceUnit === "mq"
          ? pieceWM * pieceHM * purchase
          : plan.totalMetersM * purchase;
      return { cost, scrap: 0, scrapSell: 0 };
    }
    const purchasePerSqm =
      priceUnit === "mq" ? purchase : purchase / plan.rollWidthM;
    const scrap = skipInitialScrap ? 0 : 1.5 * plan.rollWidthM * purchasePerSqm;
    const working = plan.totalMetersM * plan.rollWidthM * purchasePerSqm;
    // Vendita sfrido: usa il prezzo di vendita unitario per lo sfrido.
    const sellPerSqm =
      priceUnit === "mq" ? scrapSellUnit(plan.material) : scrapSellUnit(plan.material) / plan.rollWidthM;
    const scrapSell = skipInitialScrap ? 0 : 1.5 * plan.rollWidthM * sellPerSqm;
    return { cost: working + scrap, scrap, scrapSell };
  };

  // Piano naturale: il rullo copre l'altezza del pezzo, i teli si affiancano sulla larghezza
  const natural = planOrientation(variants, pieceWM, pieceHM);
  // Piano ruotato: il rullo copre la larghezza del pezzo (trattata come "altezza"),
  // i teli si affiancano sull'altezza del pezzo
  const rotated = piece.allowRotation
    ? planOrientation(variants, pieceHM, pieceWM)
    : null;

  type FullPlan = {
    plan: OrientationPlan;
    rotated: boolean;
    cost: number;
    unit: number;
    materialCost: number;
    seamCost: number;
    internalCost: number;
    internalScrap: number;
    internalScrapSell: number;
  };

  const wrap = (p: OrientationPlan | null, isRot: boolean): FullPlan | null => {
    if (!p) return null;
    // In Tappezzeria (catalog marcato __skipInitialScrap) il prezzo del materiale
    // nelle lavorazioni si prende SEMPRE dal "prezzo a taglio" senza moltiplicatori,
    // indipendentemente dal priceMode scelto sul pezzo.
    const effectiveMode: "piece" | "cut" = catalog.__skipInitialScrap ? "cut" : piece.priceMode;
    const u = catalog.__skipInitialScrap
      ? materialUnitCost(p.material, "cut") // niente customer => niente molt. Riv/Fin
      : materialUnitCost(p.material, piece.priceMode, customer);
    void effectiveMode;
    const materialCost = clientCostForPlan(p, u);
    const seamCost = p.seamLengthM * seamPrice;
    const cost = materialCost + seamCost;
    const {
      cost: internalCost,
      scrap: internalScrap,
      scrapSell: internalScrapSell,
    } = internalCostForPlan(p);
    return {
      plan: p,
      rotated: isRot,
      cost,
      unit: u,
      materialCost,
      seamCost,
      internalCost,
      internalScrap,
      internalScrapSell,
    };
  };

  const plans = [wrap(natural, false), wrap(rotated, true)].filter(
    (x): x is FullPlan => x !== null,
  );

  if (plans.length === 0) {
    return {
      ...empty,
      reason: "Impossibile calcolare il piano di taglio",
    };
  }

  // Per i ROTOLI di stampa il telo va SEMPRE sviluppato sul lato lungo del pezzo:
  // es. 4,50 × 12,10 su rotolo h 2 m => 3 teli lunghi 12,10 m,
  // mai 7 teli lunghi 4,50 m. Questa scelta viene prima del prezzo perché
  // il materiale del pezzo si vende sui mq effettivi, mentre gli sfridi sono voci separate.
  plans.sort((a, b) => {
    const aRoll = (a.plan.material.format ?? "rotolo") === "rotolo";
    const bRoll = (b.plan.material.format ?? "rotolo") === "rotolo";
    if (aRoll && bRoll && a.plan.panels !== b.plan.panels) {
      return a.plan.panels - b.plan.panels;
    }
    if (aRoll && bRoll && a.plan.panelLengthM !== b.plan.panelLengthM) {
      return b.plan.panelLengthM - a.plan.panelLengthM;
    }

    const costDiff = a.cost - b.cost;
    if (Math.abs(costDiff) > 0.000001) return costDiff;

    return a.rotated === b.rotated ? 0 : a.rotated ? 1 : -1;
  });
  const best = plans[0];
  const material = best.plan.material;
  const rollWidthM = best.plan.rollWidthM;
  const unit = best.unit;

  const materialCost = best.materialCost; // prezzo CLIENTE (vendita)
  const format = material.format ?? "rotolo";
  const priceUnit = materialPriceUnit(material);
  const purchase = purchaseUnit(material);
  const purchasePerSqm = priceUnit === "mq" ? purchase : rollWidthM > 0 ? purchase / rollWidthM : 0;
  const skipInitialScrap = !!catalog.__skipInitialScrap || noPrintNoScrap;
  const workingMaterialCost =
    skipInitialScrap && format === "rotolo"
      ? best.plan.totalMetersM * purchase
      : priceUnit === "mq"
      ? pieceWM * pieceHM * purchasePerSqm
      : best.internalCost - best.internalScrap; // costo interno dei mq effettivi o fallback legacy
  const initialScrapCost = best.internalScrap; // costo interno sfrido
  const seamCost = best.seamCost;
  const purchaseCost = best.internalCost; // costo interno totale
  const effectivePieceWidthM = best.rotated ? pieceHM : pieceWM;
  const effectivePieceHeightM = best.rotated ? pieceWM : pieceHM;

  return {
    material,
    rollWidthM,
    pieceWidthM: effectivePieceWidthM,
    pieceHeightM: effectivePieceHeightM,
    rotated: best.rotated,
    panels: best.plan.panels,
    panelLengthM: best.plan.panelLengthM,
    totalMetersM: best.plan.totalMetersM,
    materialCost,
    unitCost: unit,
    seamLengthM: best.plan.seamLengthM,
    seamCost,
    seamUnitPrice: seamPrice,
    workingMaterialCost,
    purchaseCost,
    initialScrapCost,
    initialScrapSellCost: best.internalScrapSell,
    scrapKey: best.internalScrap > 0 ? `${material.id}|${piece.priceMode}` : null,
    feasible: true,
  };
};

/** Costo materiale del pezzo (basato su computePieceMaterial). */
export const pieceMaterialTotal = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  // Se il materiale viene dal Laboratorio, il costo non è contabilizzato qui:
  // la riga corrispondente compare nel reparto Lab.
  if (piece.materialFromLab) return 0;
  const b = computePieceMaterial(piece, catalog, customer);
  return b.feasible ? b.materialCost : 0;
};

/** Costo cuciture aggiuntive per teli, 0 se panels<=1 o "Cucitura" non in listino. */
export const pieceSeamTotal = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  const b = computePieceMaterial(piece, catalog, customer);
  return b.feasible ? b.seamCost : 0;
};

/** Costo lavorazioni perimetrali del pezzo (esclude cucitura tra teli, che è separata). */
export const piecePerimetersTotal = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number =>
  piece.perimeters.reduce((acc, pp) => {
    const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
    if (!op) return acc;
    const virt: PerimeterLine = {
      id: pp.id,
      catalogId: op.id,
      name: op.name,
      pricePerMeter: op.pricePerMeter,
      priceFinal: op.priceFinal,
      priceUnit: op.priceUnit ?? "m",
      color: op.color,
      sides: pp.sides,
      width: piece.width,
      height: piece.height,
      dimUnit: piece.dimUnit,
      quantity: pp.quantity,
    };
    // Includo shape/widthBottom per il calcolo €/mq con forme non rettangolari
    const virtShaped = virt as PerimeterLine & {
      shape?: typeof piece.shape;
      widthBottom?: number;
    };
    virtShaped.shape = piece.shape;
    virtShaped.widthBottom = piece.widthBottom;
    return acc + perimeterCost(virtShaped, customer);
  }, 0);

/** Costo stampa (€/mq × area reale, in base alla forma). */
export const piecePrintTotal = (piece: PieceLine, catalog: Catalog): number => {
  if (!piece.printOpId) return 0;
  const op = (catalog.printOps ?? []).find((p) => p.id === piece.printOpId);
  if (!op) return 0;
  const area = pieceAreaM2Local(piece);
  return area * (op.pricePerSqm || 0);
};

/** Costo lavorazioni libere (forfettarie) inserite sul pezzo. */
export const pieceCustomWorksTotal = (piece: PieceLine): number =>
  (piece.customWorks ?? []).reduce((acc, w) => acc + (Number(w.price) || 0), 0);

/** Subtotale lavorazioni del pezzo (perimetrali + cuciture inter-telo). */
export const pieceWorkTotal = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number =>
  piecePerimetersTotal(piece, catalog, customer) +
  pieceSeamTotal(piece, catalog, customer) +
  pieceCustomWorksTotal(piece) +
  piecePrintTotal(piece, catalog);

/**
 * Breakdown lavorazioni del pezzo per categoria, già moltiplicato per la quantità del pezzo.
 * Categorie usate nell'app: "stampa" | "taglio" | "perimetrale" | "altre" (default "perimetrale").
 * - `seam`: cucitura tra teli (tipica della Tappezzeria)
 * - `custom`: lavorazioni libere/forfettarie inserite manualmente
 * - `print`: stampa "veloce" (printOpId, €/mq) — separata dalle perimetrali categoria stampa
 */
export type PieceWorkBreakdown = {
  stampa: number;
  taglio: number;
  perimetrale: number;
  altre: number;
  seam: number;
  custom: number;
  print: number;
  /** Sfrido di lavorazione (leftover dei teli) addebitato al cliente quando
   *  `piece.chargeScrap` è true. Conteggiato come voce di lavorazione,
   *  prezzato a €/mq d'acquisto × 1,30 (markup fisso). */
  scrap: number;
  total: number;
};

export const pieceWorkBreakdown = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): PieceWorkBreakdown => {
  const qty = Math.max(1, Math.floor(Number(piece.quantity) || 1));
  const out: PieceWorkBreakdown = {
    stampa: 0,
    taglio: 0,
    perimetrale: 0,
    altre: 0,
    seam: 0,
    custom: 0,
    print: 0,
    scrap: 0,
    total: 0,
  };
  for (const pp of piece.perimeters) {
    const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
    if (!op) continue;
    const virt: PerimeterLine = {
      id: pp.id,
      catalogId: op.id,
      name: op.name,
      pricePerMeter: op.pricePerMeter,
      priceFinal: op.priceFinal,
      priceUnit: op.priceUnit ?? "m",
      color: op.color,
      sides: pp.sides,
      width: piece.width,
      height: piece.height,
      dimUnit: piece.dimUnit,
      quantity: pp.quantity,
    };
    const virtShaped = virt as PerimeterLine & {
      shape?: typeof piece.shape;
      widthBottom?: number;
    };
    virtShaped.shape = piece.shape;
    virtShaped.widthBottom = piece.widthBottom;
    const cost = perimeterCost(virtShaped, customer);
    const cat = (op.category ?? "perimetrale") as keyof Pick<
      PieceWorkBreakdown,
      "stampa" | "taglio" | "perimetrale" | "altre"
    >;
    out[cat] += cost;
  }
  out.seam = pieceSeamTotal(piece, catalog, customer);
  out.custom = pieceCustomWorksTotal(piece);
  out.print = piecePrintTotal(piece, catalog);
  out.scrap = pieceLeftoverScrapSellCost(piece, catalog, customer);
  out.total =
    out.stampa + out.taglio + out.perimetrale + out.altre + out.seam + out.custom + out.print + out.scrap;
  // Applico la quantità del pezzo a TUTTE le voci
  out.stampa *= qty;
  out.taglio *= qty;
  out.perimetrale *= qty;
  out.altre *= qty;
  out.seam *= qty;
  out.custom *= qty;
  out.print *= qty;
  out.scrap *= qty;
  out.total *= qty;
  return out;
};

/** Aggrega il breakdown su un elenco di pezzi (utile per il riepilogo del reparto). */
export const aggregateWorkBreakdown = (
  pieces: PieceLine[],
  catalog: Catalog,
  customer?: CustomerType,
): PieceWorkBreakdown => {
  const acc: PieceWorkBreakdown = {
    stampa: 0, taglio: 0, perimetrale: 0, altre: 0,
    seam: 0, custom: 0, print: 0, scrap: 0, total: 0,
  };
  for (const p of pieces) {
    const b = pieceWorkBreakdown(p, catalog, customer);
    acc.stampa += b.stampa;
    acc.taglio += b.taglio;
    acc.perimetrale += b.perimetrale;
    acc.altre += b.altre;
    acc.seam += b.seam;
    acc.custom += b.custom;
    acc.print += b.print;
    acc.scrap += b.scrap;
    acc.total += b.total;
  }
  return acc;
};

/** Quantità del pezzo (default 1, mai sotto 1). */
const pieceQty = (piece: PieceLine): number => {
  const q = Number(piece.quantity);
  if (!isFinite(q) || q < 1) return 1;
  return Math.floor(q);
};

export const pieceTotal = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number =>
  // Lo sfrido (1,5 m linerai) si applica una sola volta per pezzo, non per copia.
  // Quindi: (materialeLavorabile + lavorazioni) × qty + sfrido × 1.
  ((pieceMaterialTotal(piece, catalog, customer) -
    pieceInitialScrapSellCost(piece, catalog, customer)) +
    pieceWorkTotal(piece, catalog, customer)) *
    pieceQty(piece) +
  pieceInitialScrapSellCost(piece, catalog, customer) +
  // Sfrido di nesting (leftover): addebitato per ogni copia (è materiale fisico
  // consumato in più ad ogni ripetizione del pezzo).
  pieceLeftoverScrapSellCost(piece, catalog, customer) * pieceQty(piece);

/** Suggerisce la quantità materiale (m) totale: usata da PieceCard come fallback. */
export const suggestedMaterialQty = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  const b = computePieceMaterial(piece, catalog, customer);
  return b.feasible ? b.totalMetersM : 0;
};

/** Costo materiale di un pezzo MOLTIPLICATO per la quantità (utile per riepiloghi reparto). */
export const pieceMaterialTotalQty = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  // Sfrido conteggiato una sola volta per pezzo (non × qty).
  const scrap = pieceInitialScrapSellCost(piece, catalog, customer);
  const working = pieceMaterialTotal(piece, catalog, customer) - scrap;
  return working * pieceQty(piece) + scrap;
};

/** Quota dello sfrido iniziale rotolo a prezzo di vendita per un singolo pezzo. */
export const pieceInitialScrapSellCost = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  if (piece.materialFromLab) return 0;
  const b = computePieceMaterial(piece, catalog, customer);
  return b.feasible ? b.initialScrapSellCost : 0;
};

/** Costo materiale dello SFRIDO DI NESTING (leftover dei teli) addebitato al cliente
 *  SOLO se piece.chargeScrap è true. È pari all'area di tessuto consumata in più
 *  rispetto al pezzo (= area teli − area pezzo) valutata al prezzo unitario del
 *  materiale (di vendita), SENZA aggiungere lavorazioni (stampa/perimetri).
 *  Lo sfrido iniziale 1,5 m è già conteggiato a parte. */
export const pieceLeftoverScrapSellCost = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  if (!piece.chargeScrap) return 0;
  if (piece.materialFromLab) return 0;
  const b = computePieceMaterial(piece, catalog, customer);
  if (!b.feasible || !b.material) return 0;
  const rollW = b.rollWidthM;
  const leftoverM2 = pieceLeftoverScrapAreaM2(piece, catalog, customer);
  if (leftoverM2 <= 0 || rollW <= 0) return 0;
  // Prezzo: SEMPRE €/mq d'acquisto × 1,3 (margine fisso per lo sfrido di lavorazione,
  // indipendente dal moltiplicatore cliente).
  const m = b.material;
  const purchase =
    typeof m.costPrice === "number"
      ? m.costPrice
      : piece.priceMode === "piece"
      ? m.pricePiece
      : m.priceCut;
  const priceUnit = materialPriceUnit(m);
  const purchasePerSqm = priceUnit === "mq" ? purchase : purchase / rollW;
  return leftoverM2 * purchasePerSqm * 1.3;
};

/** Area in m² dello sfrido di lavorazione (telo non sfruttato a pieno). */
export const pieceLeftoverScrapAreaM2 = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  if (!piece.chargeScrap) return 0;
  if (piece.materialFromLab) return 0;
  const b = computePieceMaterial(piece, catalog, customer);
  if (!b.feasible || !b.material) return 0;
  const rollW = b.rollWidthM;
  // Area teli (panels × largh.rotolo × lunghezza telo) − area effettiva del pezzo
  // posato sui teli (largh.pezzo × lunghezza telo). NON sottraggo l'area "stretta"
  // pieceWidth × pieceHeight perché questo conteggia anche il lato lungo: lo scarto
  // reale è solo la fetta di telo NON coperta dalla larghezza del pezzo.
  const teliAreaM2 = b.panels * rollW * b.panelLengthM;
  const usedAreaM2 = b.pieceWidthM * b.panelLengthM;
  const leftoverM2 = teliAreaM2 - usedAreaM2;
  return leftoverM2 > 0 ? leftoverM2 : 0;
};

/** Chiave del materiale sfrido di un pezzo (per dedup tra pezzi con stesso materiale). */
export const pieceScrapKey = (
  piece: PieceLine,
  catalog: Catalog,
  customer?: CustomerType,
): string | null => {
  if (piece.materialFromLab) return null;
  const b = computePieceMaterial(piece, catalog, customer);
  return b.feasible ? b.scrapKey : null;
};

/** Risparmio sfrido duplicato all'interno di un gruppo di pezzi che condividono lo stesso
 *  materiale: lo sfrido si conta una sola volta. Restituisce un valore ≥ 0 da SOTTRARRE
 *  alla somma dei `pieceTotal`/`pieceMaterialTotalQty` di una lista di pezzi. */
export const aggregateScrapDeduction = (
  pieces: PieceLine[],
  resolveCatalog: (p: PieceLine) => Catalog,
  resolveCustomer: (p: PieceLine) => CustomerType | undefined,
): number => {
  // Per ogni "scrapKey", trovo lo sfrido massimo (caso di varianti diverse risolte). Tipicamente
  // tutti i pezzi della stessa variante hanno lo stesso scrap. Tengo 1 sola occorrenza per chiave.
  const byKey = new Map<string, { scrap: number; count: number }>();
  for (const p of pieces) {
    const cat = resolveCatalog(p);
    const cust = resolveCustomer(p);
    const key = pieceScrapKey(p, cat, cust);
    if (!key) continue;
    const scrap = pieceInitialScrapSellCost(p, cat, cust);
    if (scrap <= 0) continue;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { scrap, count: 1 });
    else byKey.set(key, { scrap: Math.max(prev.scrap, scrap), count: prev.count + 1 });
  }
  let deduction = 0;
  for (const { scrap, count } of byKey.values()) {
    if (count > 1) deduction += scrap * (count - 1);
  }
  return deduction;
};