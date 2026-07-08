export type DepartmentKey = "tappezzeria" | "stampa" | "falegnameria";

/* Listino caricato da Excel o inserito a mano */
export type CatalogMaterial = {
  id: string;
  name: string;        // Nome prodotto
  weight: string;      // Peso in g/m² (numerico come stringa)
  color: string;       // Colore
  height: string;      // Altezza numerica (stringa)
  heightUnit: string;  // Unità altezza: cm / m / mm
  composition: string; // Composizione (es. 100% cotone)
  fireproof: string;   // Tipo ignifugo (es. "Classe 1"); vuoto = non ignifugo
  unit: string;        // m, mq, pz…
  pricePiece: number;  // €/unità - pezza intera
  priceCut: number;    // €/unità - al taglio
  /** Prezzo di costo (acquisto) — usato SOLO per il calcolo del margine/guadagno.
   *  Quando presente significa che `pricePiece` e `priceCut` sono prezzi di
   *  VENDITA finali inseriti manualmente (Tappezzeria) e NON vanno moltiplicati
   *  per i moltiplicatori cliente Riv/Fin. */
  costPrice?: number;
  /** Formato del prodotto: "lastra" (rigida) o "rotolo" (tessuto/film) */
  format?: "lastra" | "rotolo";
  /** Spessore della variante (per entrambi i formati). */
  thickness?: string;
  /** Finitura della variante: Opaca, Lucida, Satinata, Specchio, Metallizzata, Spazzolata, ... */
  finish?: string;
  /** Unità di prezzo d'acquisto: "mq" (€/m²) o "ml" (€/metro lineare) */
  priceUnit?: "mq" | "ml";
  /** Lastra: base in unità `dimUnit`. */
  baseWidth?: string;
  /** Rotolo: lunghezza intera in unità `dimUnit`. */
  rollLength?: string;
  /** Unità delle dimensioni base/lunghezza (cm/mm/m). */
  dimUnit?: string;
  note?: string;
};

export type CatalogOperation = {
  id: string;
  name: string;
  type: "unità" | "ora";
  unit: string;
  price: number;
  note?: string;
};

/* Lavorazioni perimetrali (€/m applicato sui lati del pezzo) */
export type PerimeterSide = "top" | "bottom" | "left" | "right";

export type CatalogPerimeterOp = {
  id: string;
  name: string;
  pricePerMeter: number;
  /** Prezzo €/unità per Cliente Finale. Se assente si usa pricePerMeter (=Rivenditore). */
  priceFinal?: number;
  /** Unità di prezzo:
   *  - "m"   = €/metro lineare (sui lati selezionati)
   *  - "mq"  = €/m² (area del pezzo)
   *  - "pz"  = €/pezzo (quantità manuale)
   *  - "min" = €/minuto (quantità manuale)
   */
  priceUnit?: "m" | "mq" | "pz" | "min";
  /** Categoria della voce (per Stampa: stampa | taglio | perimetrale; default "perimetrale" per altri reparti). */
  category?: "stampa" | "taglio" | "perimetrale" | "altre" | string;
  /** Sotto-categoria (per Stampa: uv|solvente|laser ; per Taglio: cnc|laser|squadratrice). Opzionale per le altre. */
  subcategory?: string;
  /** Macchina di riferimento per le lavorazioni di taglio: "cnc" | "laser" */
  machine?: "cnc" | "laser";
  /** colore esadecimale o token usato per evidenziare il lato sul disegno */
  color?: string;
  note?: string;
};

/** Preset di lavorazioni perimetrali = combinazione riusabile { lavorazione, lati } */
export type PerimeterPresetItem = {
  /** id della CatalogPerimeterOp di riferimento */
  opId: string;
  sides: PerimeterSide[];
};

export type CatalogPerimeterPreset = {
  id: string;
  name: string;        // es. "LAV01"
  note?: string;       // descrizione es. "anelli sopra, sacca sotto"
  items: PerimeterPresetItem[];
};

export type Catalog = {
  materials: CatalogMaterial[];
  operations: CatalogOperation[];
  perimeterOps: CatalogPerimeterOp[];
  perimeterPresets: CatalogPerimeterPreset[];
  importedAt: string | null;
  fileName: string | null;
  /** Ricarico % applicato a tutto il reparto (solo Stampa per ora). Default 0. */
  markupPct?: number;
  /** Voci di stampa precompilate per reparto Stampa (UV/Solvente × Standard/F-R/Bianco) */
  printOps?: PrintOp[];
  /** Flag runtime (NON persistito): se true, NON addebitare lo sfrido iniziale
   *  del rotolo (es. Tappezzeria, dove il prezzo manuale lo include già). */
  __skipInitialScrap?: boolean;
};

/* Stampa: catalogo voci per il reparto Stampa */
export type PrintType = "uv" | "solvente";
export type PrintMode = "standard" | "fronte_retro" | "bianco";

export type PrintOp = {
  id: string;
  type: PrintType;
  mode: PrintMode;
  /** Prezzo d'acquisto €/m² */
  pricePerSqm: number;
  note?: string;
};

/* Forme supportate per i pezzi (utile per Stampa) */
export type PieceShape = "rect" | "triangle" | "trapezoid";

/* Righe del preventivo */
export type MaterialLine = {
  id: string;
  catalogId: string | null; // se selezionato dal listino
  name: string;
  weight: string;
  color: string;
  height: string;
  heightUnit: string;
  composition: string;
  fireproof: string;
  unit: string;
  priceMode: "piece" | "cut"; // pezza intera o al taglio
  quantity: number;
  unitCost: number;
  /** Se presente, è una riga generata automaticamente da un pezzo di un altro reparto
   *  (flag `materialFromLab` sul pezzo). Sola lettura. */
  ghostFromPieceId?: string;
  /** Etichetta del reparto/pezzo origine (es. "Tappezzeria · P02"). */
  ghostSourceLabel?: string;
};

export type TransportLine = {
  id: string;
  description: string;
  quantity: number;
  unitCost: number;
};

export type OperationLine = {
  id: string;
  catalogId: string | null;
  name: string;
  mode: "unità" | "ora";
  unit: string;
  quantity: number; // unità o ore
  rate: number;     // prezzo unitario o tariffa oraria
  /** Dimensioni del pezzo (per disegno tecnico) */
  width?: number;       // base
  height?: number;      // altezza
  dimUnit?: "cm" | "m" | "mm";
};

export type PerimeterLine = {
  id: string;
  catalogId: string | null;
  name: string;
  pricePerMeter: number;
  priceFinal?: number;
  priceUnit?: "m" | "mq" | "pz" | "min";
  color?: string;
  /** lati su cui è applicata */
  sides: PerimeterSide[];
  /** dimensioni del pezzo in unità dimUnit (servono per calcolare i metri) */
  width: number;
  height: number;
  dimUnit: "cm" | "m" | "mm";
  /** Quantità manuale per unità "pz" o "min". */
  quantity?: number;
};

/* Pezzo = unità di lavoro con materiale + dimensioni + lavorazioni perimetrali */
export type PieceLine = {
  id: string;
  /** Tipo prodotto (== name del materiale del listino) */
  productName: string;
  color: string;
  fireproof: string;
  /** Altezza scelta automaticamente in base alle dimensioni richieste */
  matchedHeight: string;       // es. "300"
  matchedHeightUnit: string;   // es. "cm"
  /** Variante materiale risolta (per costo) */
  catalogMaterialId: string | null;
  /** Spessore selezionato (per filtrare la variante usata; opzionale) */
  thickness?: string;
  /** Finitura selezionata (per filtrare la variante usata; opzionale) */
  finish?: string;
  /** Variante esatta del materiale selezionata (id CatalogMaterial). Se presente,
   *  ha priorità su matching automatico (es. per scegliere uno specifico
   *  formato lastra base×h o un'altezza rotolo). */
  variantId?: string | null;
  /** Modalità prezzo materiale */
  priceMode: "piece" | "cut";
  /** Quantità (m) di materiale - di default lato base */
  materialQty: number;
  /** Dimensioni del pezzo */
  width: number;
  height: number;
  dimUnit: "cm" | "m" | "mm";
  /** Forma del pezzo (default "rect"). Per "trapezoid" usa anche widthBottom. */
  shape?: PieceShape;
  /** Per trapezio: lunghezza della base minore (in dimUnit). `width` = base maggiore. */
  widthBottom?: number;
  /** Stampa (solo per reparto Stampa): id voce PrintOp del listino */
  printOpId?: string | null;
  /** Quantità di copie identiche del pezzo (default 1). Moltiplica tutti i costi. */
  quantity?: number;
  /** Lavorazioni perimetrali applicate (riusano CatalogPerimeterOp + lati) */
  perimeters: { id: string; opId: string; sides: PerimeterSide[]; quantity?: number }[];
  /** Lavorazioni libere "una tantum": nome + prezzo forfettario inseriti al volo */
  customWorks?: { id: string; name: string; price: number }[];
  /** Permetti al sistema di ruotare il tessuto (scambiando trama/ordito) per risparmiare */
  allowRotation?: boolean;
  /** Se true, il sistema può spezzare il pezzo in più pannelli affiancati
   *  (con cuciture verticali su rotolo, o lastre giuntate). Default false:
   *  il pezzo DEVE entrare interamente nelle misure della lastra/rullo;
   *  se non entra, finisce tra i non piazzati e va segnalato. */
  allowSplit?: boolean;
  /** Se true, ruota la lastra del listino scambiando base ↔ altezza prima
   *  del nesting (es. lastra 305×122 cm → 122×305 cm). Solo per format
   *  "lastra". */
  rotateSheet?: boolean;
  /** Forza il calcolo anche se il pezzo non entra nel formato della variante scelta. */
  bypassFitCheck?: boolean;
  /** Se true, NON aggiunge i margini di lavorazione (+10cm × +20cm) al calcolo.
   *  Usato per il reparto Stampa/Laboratorio dove le misure inserite sono finali. */
  noMargins?: boolean;
  /** Se true, il materiale per questo pezzo viene PRELEVATO dal Laboratorio.
   *  In quel caso il costo materiale del pezzo è ZERO nel reparto corrente
   *  e una riga materiale equivalente (con +20cm h e +10cm w totali) appare
   *  automaticamente nel reparto Laboratorio. */
  materialFromLab?: boolean;
  /** Se valorizzato, identifica esplicitamente il pezzo del Laboratorio
   *  da cui prelevare materiale e dimensioni. Ha priorità sul matching
   *  automatico per nome/colore/variante. */
  linkedLabPieceId?: string | null;
  /** Se true, oltre al pezzo lavorato si addebita anche il MATERIALE di
   *  scarto del nesting (leftover dei teli, esclusi pezzo + sfrido iniziale
   *  1,5 m). Viene addebitato al solo prezzo del materiale, senza
   *  lavorazioni (stampa/perimetri). Tipico della Stampa. */
  chargeScrap?: boolean;
  /** PRENOTAZIONE SOFT — il grafico, in fase di preventivo, può scegliere
   *  uno specifico pezzo di magazzino (lastra intera o sfrido) da usare per
   *  questo PieceLine. È solo una preferenza memorizzata nello snapshot:
   *  non blocca nulla in magazzino finché l'ordine non passa in produzione,
   *  dove l'operatore può confermarla o sceglierne un'altra.
   *  Se assente, l'operatore sceglierà il pezzo al momento della lavorazione. */
  /** "item" / "scrap" per scelta singola omogenea; "mixed" quando si combinano
   *  più sfridi e/o lastre intere. In tal caso `pickedStockId` contiene token
   *  nel formato "kind:id" separati da virgole (es. "scrap:abc,scrap:def,item:xyz"). */
  pickedStockKind?: "item" | "scrap" | "mixed" | null;
  /** id della riga inventory_items o inventory_scrap_pieces. */
  pickedStockId?: string | null;
  /** Codice/etichetta leggibile della scelta (per visualizzazione offline). */
  pickedStockLabel?: string | null;
  /** Override del prezzo cliente €/m² applicato dal pulsante "Livella €/m²".
   *  Quando valorizzato, pieceTotal ignora materiale/lavorazioni/sfridi e
   *  restituisce areaM2 × qty × priceOverridePerSqm. */
  priceOverridePerSqm?: number | null;
  /** Margini manuali in cm da aggiungere alle dimensioni del pezzo per il
   *  calcolo del materiale. Quando `manualMargins` è true, queste sostituiscono
   *  completamente l'allowance automatica derivata dalle lavorazioni perimetrali. */
  marginExtraWCm?: number;
  marginExtraHCm?: number;
  /** Se true, usa i margini manuali (marginExtraWCm / marginExtraHCm) invece di
   *  calcolare l'abbondanza in base alle lavorazioni. Impostato automaticamente
   *  nei pezzi del reparto Tappezzeria. */
  manualMargins?: boolean;
  note?: string;
  /** Id del sub-progetto ("prodotto finito", es. Tavolino, Pavimento) a cui appartiene
   *  questa lavorazione. Null/undefined = voce "Generale" (retrocompatibilità: tutti
   *  i pezzi dei progetti già esistenti restano in questo gruppo implicito). */
  subProjectId?: string | null;
};

/** Lavorazione a livello di prodotto finito (sub-progetto): decorazione,
 *  assemblaggio, ignifugazione o qualsiasi altra fase custom scelta dall'utente.
 *  Reparto scelto liberamente. Ore/€h entrano nel preventivo. Responsabile,
 *  assegnatari e date sono opzionali in preventivo (si possono compilare al
 *  lancio nel Flow). */
export type ProductWork = {
  id: string;
  name: string;
  /** Chiave ProdDept (es. "falegnameria", "stampa", "tappezzeria", ...). */
  dept: string;
  hours: number;
  hourlyCost: number;
  responsibleId?: string | null;
  assigneeIds?: string[];
  startAt?: string | null;
  endAt?: string | null;
  deliveryAt?: string | null;
  notes?: string;
};

/** Un sub-progetto ("prodotto finito") raggruppa pezzi di più reparti
 *  all'interno di uno stesso progetto madre (es. il progetto "Tizio" contiene
 *  Tavolino, Pavimento, ecc.). Vive nello snapshot del draft, senza tabelle DB. */
export type SubProject = {
  id: string;
  name: string;
  order: number;
  note?: string;
  /** Lavorazioni prodotto (decorazione, assemblaggio, ignifugazione, altro).
   *  Ognuna ha reparto proprio e costo che entra nel preventivo. */
  productWorks?: ProductWork[];
  /** LEGACY — vecchio singolo assemblaggio in laboratorio. Se presente e
   *  `productWorks` è vuoto viene promosso a prima riga della nuova lista. */
  assemblyLab?: {
    enabled: boolean;
    hours: number;
    hourlyCost: number;
    notes?: string;
  };
  /** Se valorizzato, il sub-progetto è stato inviato al Flow (commessa creata).
   *  In questo stato la voce è bloccata (rinomina/elimina/lavorazioni disabilitati);
   *  per modificare bisogna far tornare indietro l'ordine dal Flow. */
  launchedCommessaId?: string | null;
  launchedAt?: string | null;
};

/** Restituisce le lavorazioni prodotto effettive del sub, promuovendo il
 *  vecchio `assemblyLab` a prima riga se `productWorks` è ancora vuoto. */
export const getProductWorks = (sp: SubProject | null | undefined): ProductWork[] => {
  if (!sp) return [];
  if (Array.isArray(sp.productWorks) && sp.productWorks.length > 0) return sp.productWorks;
  const legacy = sp.assemblyLab;
  if (legacy?.enabled) {
    return [{
      id: "legacy-assembly-lab",
      name: "Assemblaggio in laboratorio",
      dept: "falegnameria",
      hours: Number(legacy.hours) || 0,
      hourlyCost: Number(legacy.hourlyCost) || 0,
      notes: legacy.notes,
    }];
  }
  return [];
};

export type DepartmentState = {
  materials: MaterialLine[];
  operations: OperationLine[];
  perimeters: PerimeterLine[];
  pieces: PieceLine[];
  transports: TransportLine[];
  /** Stato del pannello di nesting: override formato per gruppo e bin misti per gruppo.
   *  Persistito nello snapshot in modo che la produzione veda lo stesso nesting del preventivo. */
  nestingState?: {
    overrides?: Record<string, any | null>;
    mixedBins?: Record<string, any[] | null>;
    /** Per gruppo materiale (key del nesting): se true, addebita lo sfrido di
     *  ogni lastra del gruppo al cliente (area lastre − area pezzi). */
    chargeNestingScrap?: Record<string, boolean>;
    /** TAPPEZZERIA — se true, disattiva la ridistribuzione del costo materiale
     *  del nesting (comprensivo di margini) sulle card Lavorazioni. In quel caso
     *  ogni pezzo mostra il costo materiale naive calcolato per-pezzo. */
    bypassRedistribution?: boolean;
  };
};

export type DepartmentTotals = {
  materials: number;
  operations: number;
  perimeters: number;
  pieces: number;
  transports: number;
  total: number;
};