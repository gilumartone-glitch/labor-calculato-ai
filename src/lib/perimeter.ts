import { CatalogPerimeterOp, PerimeterLine, PerimeterSide, PieceShape } from "@/components/calculator/types";
import { uid } from "./format";
import type { CustomerType } from "./pricing";

/** Preset standard di lavorazioni perimetrali; l'utente può modificarli/eliminarli */
export const PERIMETER_PRESETS: Omit<CatalogPerimeterOp, "id">[] = [
  { name: "Rinforzo, anelli e laccetti", pricePerMeter: 0, color: "hsl(12 76% 55%)" },
  { name: "Sacca", pricePerMeter: 0, color: "hsl(38 92% 50%)" },
  { name: "Orli", pricePerMeter: 0, color: "hsl(160 64% 40%)" },
  { name: "Piombo", pricePerMeter: 0, color: "hsl(220 14% 35%)" },
  { name: "Velcro", pricePerMeter: 0, color: "hsl(280 60% 55%)" },
  { name: "Cucitura", pricePerMeter: 0, color: "hsl(0 0% 20%)" },
  { name: "Tiro a Pacchetto", pricePerMeter: 0, color: "hsl(200 80% 45%)" },
];

export const buildPresetPerimeterOps = (): CatalogPerimeterOp[] =>
  PERIMETER_PRESETS.map((p) => ({ ...p, id: uid() }));

/** Preset specifici per il reparto Stampa (taglio + finiture stampa). */
export const PRINT_PERIMETER_PRESETS: Omit<CatalogPerimeterOp, "id">[] = [
  { name: "Taglio CNC", pricePerMeter: 0, priceUnit: "m", machine: "cnc", category: "taglio", color: "hsl(200 80% 50%)" },
  { name: "Taglio Laser", pricePerMeter: 0, priceUnit: "m", machine: "laser", category: "taglio", color: "hsl(340 75% 55%)" },
  { name: "Plastificazione", pricePerMeter: 0, priceUnit: "mq", category: "perimetrale", color: "hsl(160 64% 40%)" },
  { name: "Occhielli", pricePerMeter: 0, priceUnit: "m", category: "perimetrale", color: "hsl(38 92% 50%)" },
];

export const buildPrintPerimeterOps = (): CatalogPerimeterOp[] =>
  PRINT_PERIMETER_PRESETS.map((p) => ({ ...p, id: uid() }));

/** Restituisce i preset di lavorazioni adatti al reparto. */
export const buildPerimeterOpsForDept = (dept: string): CatalogPerimeterOp[] => {
  if (dept === "stampa") return buildPrintPerimeterOps();
  if (dept === "tappezzeria") return buildPresetPerimeterOps();
  return []; // falegnameria e altri: nessun preset
};

export type DimUnit = "cm" | "m" | "mm";

const factor = (u: DimUnit) => (u === "m" ? 1 : u === "cm" ? 0.01 : 0.001);

/** Converte un valore numerico da `from` a `to` (lineare). */
export const convertLength = (value: number, from: DimUnit, to: DimUnit): number => {
  if (!value || from === to) return value;
  const meters = value * factor(from);
  const out = meters / factor(to);
  // arrotondo a 4 decimali per evitare residui floating
  return Math.round(out * 10000) / 10000;
};

/** Lunghezza in metri di un singolo lato dato base/altezza nelle unità dimUnit */
export const sideLengthM = (
  side: PerimeterSide,
  width: number,
  height: number,
  dimUnit: "cm" | "m" | "mm",
): number => {
  const f = factor(dimUnit);
  if (side === "top" || side === "bottom") return width * f;
  return height * f;
};

/** Lunghezza totale (m) sommando i lati selezionati */
export const perimeterMeters = (line: PerimeterLine): number =>
  line.sides.reduce((acc, s) => acc + sideLengthM(s, line.width, line.height, line.dimUnit), 0);

/**
 * Area del pezzo in m² (senza margini).
 * Supporta forme: rect (default), triangle (b·h/2), trapezoid ((B+b)·h/2).
 * Per trapezio passa `widthBottom` come base minore (`width` = base maggiore).
 */
export const pieceAreaM2 = (
  line: Pick<PerimeterLine, "width" | "height" | "dimUnit"> & {
    shape?: PieceShape;
    widthBottom?: number;
  },
): number => {
  const f = factor(line.dimUnit);
  const wM = line.width * f;
  const hM = line.height * f;
  const shape: PieceShape = line.shape ?? "rect";
  if (shape === "triangle") return (wM * hM) / 2;
  if (shape === "trapezoid") {
    const wbM = (line.widthBottom ?? line.width) * f;
    return ((wM + wbM) * hM) / 2;
  }
  return wM * hM;
};

/** Riconosce la lavorazione speciale "Tiro a Pacchetto" (case-insensitive). */
export const isTiroAPacchetto = (name: string): boolean =>
  (name || "").trim().toLowerCase() === "tiro a pacchetto";

/**
 * Calcola il numero di "file" (tiri verticali) in base alla larghezza del pezzo (m).
 * Regole:
 *  - i due laterali sono sempre conteggiati
 *  - passo target ≈ 1,5 m tra una fila e l'altra
 *  - il numero totale di file è SEMPRE DISPARI (così esiste sempre un centrale
 *    e i tiri risultano disposti simmetricamente)
 *  - minimo 3 file (sx + centro + dx)
 */
export const tiroFiles = (widthM: number): number => {
  if (!isFinite(widthM) || widthM <= 0) return 0;
  // numero di intervalli da ~1,5 m + 1 (per contare entrambi i laterali)
  const intervals = Math.max(2, Math.ceil(widthM / 1.5));
  let n = intervals + 1;
  // forza dispari
  if (n % 2 === 0) n += 1;
  return Math.max(3, n);
};

/**
 * Costo "Tiro a Pacchetto" = €/m × n.file × altezza pezzo (m).
 * width/height del pezzo nelle unità line.dimUnit.
 */
export const tiroCost = (line: PerimeterLine): number => {
  const f = factor(line.dimUnit);
  const widthM = line.width * f;
  const heightM = line.height * f;
  const files = tiroFiles(widthM);
  return files * heightM * line.pricePerMeter;
};

/** Costo totale di una lavorazione perimetrale.
 *  - priceUnit "m" (default): pricePerMeter × somma metri dei lati selezionati
 *  - priceUnit "mq": pricePerMeter × area del pezzo (m²); i lati restano informativi
 *  - priceUnit "pz": pricePerMeter × quantity (default 1)
 *  - priceUnit "min": pricePerMeter × quantity (default 0)
 *  - nome "Tiro a Pacchetto": calcolo speciale n.file × altezza × €/m
 *  Se `customer === "final"` e `line.priceFinal` è presente, usa quest'ultimo.
 */
export const perimeterCost = (line: PerimeterLine, customer?: CustomerType): number => {
  const price =
    customer === "final" && typeof line.priceFinal === "number"
      ? line.priceFinal
      : line.pricePerMeter;
  if (isTiroAPacchetto(line.name)) {
    return tiroCost({ ...line, pricePerMeter: price });
  }
  const unit = line.priceUnit ?? "m";
  if (unit === "mq") return pieceAreaM2(line) * price;
  if (unit === "pz") {
    // €/pezzo: di default 1 pezzo se non specificata una quantità manuale,
    // così la voce viene comunque conteggiata appena selezionata.
    const raw = Number(line.quantity);
    const q = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return q * price;
  }
  if (unit === "min") {
    const q = Math.max(0, Number(line.quantity) || 0);
    return q * price;
  }
  return perimeterMeters(line) * price;
};

export const SIDE_LABEL: Record<PerimeterSide, string> = {
  top: "Sopra",
  bottom: "Sotto",
  left: "Sinistra",
  right: "Destra",
};

export const SIDE_LABEL_SHORT: Record<PerimeterSide, string> = {
  top: "↑",
  bottom: "↓",
  left: "←",
  right: "→",
};