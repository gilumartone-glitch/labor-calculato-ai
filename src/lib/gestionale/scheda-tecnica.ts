/**
 * Scheda tecnica di un pezzo, così come esce da Progettazione: misure, forma, lati lavorati,
 * tutte le lavorazioni. Si salva sulla riga del documento come fotografia: il documento resta
 * uguale anche se poi il progetto o il listino cambiano, e passa da preventivo a conferma d'ordine,
 * DDT e fattura insieme alla riga.
 * Nei documenti si stampa con il disegno; in fattura e nota di credito solo le lavorazioni, senza disegno.
 */
import type { Catalog, PerimeterSide, PieceLine, PieceShape } from "@/components/calculator/types";
import type { TipoDocumento } from "./documenti";

export type LavorazioneScheda = {
  nome: string;
  /** lati su cui è applicata; vuoto = su tutto il pezzo */
  lati: PerimeterSide[];
  quantita: number | null;
  /** colore con cui il lato è evidenziato nel disegno */
  colore: string | null;
};

export type SchedaTecnica = {
  titolo: string;
  reparto: string;
  forma: PieceShape;
  larghezza: number;
  altezza: number;
  unita: "cm" | "m" | "mm";
  baseMinore: number | null;
  quantita: number;
  colore: string | null;
  ignifugo: string | null;
  spessore: string | null;
  finitura: string | null;
  /** arricciatura dei tendaggi, in percentuale */
  ricchezza: number | null;
  stampa: string | null;
  lavorazioni: LavorazioneScheda[];
  /** lavorazioni scritte a mano sul pezzo */
  lavorazioniLibere: string[];
  nota: string | null;
};

const LATO: Record<PerimeterSide, string> = { top: "alto", bottom: "basso", left: "sinistra", right: "destra" };
const ORDINE_LATI: PerimeterSide[] = ["top", "bottom", "left", "right"];
const STAMPA_TIPO: Record<string, string> = { uv: "UV", solvente: "solvente" };
const STAMPA_MODO: Record<string, string> = { standard: "", fronte_retro: "fronte/retro", bianco: "con bianco" };
const testo = (s: string | null | undefined) => (s ?? "").trim() || null;
const numero = (n: number) => (Number.isFinite(n) ? n.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "—");

/** I documenti con il disegno: tutti tranne fattura e nota di credito (e la fattura del fornitore). */
export const conDisegno = (tipo: TipoDocumento): boolean => tipo !== "fattura" && tipo !== "nota_credito" && tipo !== "fattura_fornitore";

/** Fotografia del pezzo di Progettazione. Il listino serve per i nomi e i colori delle lavorazioni. */
export function schedaDaPezzo(pezzo: PieceLine, reparto: string, listino?: Catalog): SchedaTecnica {
  const lavorazioni: LavorazioneScheda[] = (pezzo.perimeters ?? []).map((pp) => {
    const op = listino?.perimeterOps?.find((o) => o.id === pp.opId);
    return {
      nome: testo(op?.name) ?? "Lavorazione",
      lati: ORDINE_LATI.filter((l) => (pp.sides ?? []).includes(l)),
      quantita: pp.quantity && pp.quantity > 0 ? pp.quantity : null,
      colore: testo(op?.color),
    };
  });
  const stampa = pezzo.printOpId ? listino?.printOps?.find((p) => p.id === pezzo.printOpId) : undefined;
  const forma: PieceShape = pezzo.shape ?? "rect";
  return {
    titolo: testo(pezzo.productName) ?? "Pezzo", reparto,
    forma, larghezza: Number(pezzo.width) || 0, altezza: Number(pezzo.height) || 0, unita: pezzo.dimUnit ?? "cm",
    baseMinore: forma === "trapezoid" && pezzo.widthBottom ? Number(pezzo.widthBottom) : null,
    quantita: Number(pezzo.quantity) > 0 ? Number(pezzo.quantity) : 1,
    colore: testo(pezzo.color), ignifugo: testo(pezzo.fireproof), spessore: testo(pezzo.thickness), finitura: testo(pezzo.finish),
    ricchezza: pezzo.fullnessPct && pezzo.fullnessPct > 0 ? pezzo.fullnessPct : null,
    stampa: stampa ? ["Stampa", STAMPA_TIPO[stampa.type] ?? stampa.type, STAMPA_MODO[stampa.mode] ?? stampa.mode].filter(Boolean).join(" ") : null,
    lavorazioni,
    lavorazioniLibere: (pezzo.customWorks ?? []).map((c) => (c.name ?? "").trim()).filter(Boolean),
    nota: testo((pezzo as PieceLine & { note?: string }).note),
  };
}

export const misureScheda = (s: Pick<SchedaTecnica, "forma" | "larghezza" | "altezza" | "unita" | "baseMinore">): string =>
  s.forma === "trapezoid" && s.baseMinore
    ? `${numero(s.larghezza)} / ${numero(s.baseMinore)} × ${numero(s.altezza)} ${s.unita} (trapezio)`
    : `${numero(s.larghezza)} × ${numero(s.altezza)} ${s.unita}${s.forma === "triangle" ? " (triangolo)" : ""}`;

/** «Orlo: alto, basso × 2». */
export function testoLavorazione(l: LavorazioneScheda): string {
  const dove = l.lati.length === 0 ? "" : l.lati.length === 4 ? "tutti i lati" : l.lati.map((x) => LATO[x]).join(", ");
  return [l.nome, dove ? `: ${dove}` : "", l.quantita ? ` × ${numero(l.quantita)}` : ""].join("");
}

/** Tutte le lavorazioni del pezzo, una per voce: stampa, perimetrali con i lati, libere. */
export function lavorazioniScheda(s: SchedaTecnica): string[] {
  return [...(s.stampa ? [s.stampa] : []), ...s.lavorazioni.map(testoLavorazione), ...s.lavorazioniLibere];
}

/** Caratteristiche del pezzo, in ordine: «Colore nero», «Ignifugo classe 1»… */
export function caratteristicheScheda(s: SchedaTecnica): string[] {
  return [
    s.colore ? `Colore ${s.colore}` : "", s.ignifugo ? `Ignifugo ${s.ignifugo}` : "", s.spessore ? `Spessore ${s.spessore}` : "",
    s.finitura ? `Finitura ${s.finitura}` : "", s.ricchezza ? `Ricchezza ${numero(s.ricchezza)}%` : "",
  ].filter(Boolean);
}

/** Il pezzo in testo, per il dettaglio della riga (è ciò che compare anche in fattura). */
export function testoScheda(s: SchedaTecnica): string[] {
  const testa = [`${s.titolo} — ${misureScheda(s)}`, ...caratteristicheScheda(s).map((c) => c.charAt(0).toLowerCase() + c.slice(1)), s.quantita > 1 ? `${numero(s.quantita)} pz` : ""].filter(Boolean).join(" · ");
  return [testa, ...lavorazioniScheda(s).map((l) => `  - ${l}`)];
}

/** Area (m²) e perimetro (m), come nel disegno di Progettazione. */
export function areaPerimetro(s: Pick<SchedaTecnica, "forma" | "larghezza" | "altezza" | "unita" | "baseMinore">): { area: number; perimetro: number } {
  const f = s.unita === "m" ? 1 : s.unita === "cm" ? 0.01 : 0.001;
  const w = s.larghezza * f; const h = s.altezza * f; const wb = (s.baseMinore ?? s.larghezza) * f;
  if (s.forma === "triangle") return { area: (w * h) / 2, perimetro: w + 2 * Math.sqrt((w / 2) ** 2 + h ** 2) };
  if (s.forma === "trapezoid") return { area: ((w + wb) * h) / 2, perimetro: w + wb + 2 * Math.sqrt(((w - wb) / 2) ** 2 + h ** 2) };
  return { area: w * h, perimetro: (w + h) * 2 };
}

/** I lati evidenziati nel disegno: un tratto per ogni lavorazione su quel lato. */
export function latiDisegno(s: SchedaTecnica): { side: PerimeterSide; label: string; color: string }[] {
  return s.lavorazioni.flatMap((l) => l.lati.map((side) => ({ side, label: l.nome, color: l.colore ?? "hsl(220 14% 35%)" })));
}

/** Legge quello che è salvato sulla riga, scartando ciò che non è una scheda. */
export function leggiSchede(valore: unknown): SchedaTecnica[] {
  if (!Array.isArray(valore)) return [];
  return valore.filter((s): s is SchedaTecnica => !!s && typeof s === "object" && typeof (s as SchedaTecnica).titolo === "string" && Array.isArray((s as SchedaTecnica).lavorazioni));
}

/** Colore del listino (hex, rgb o hsl) in RGB per il PDF; grigio scuro se non si capisce. */
export function coloreRgb(c: string | null | undefined): [number, number, number] {
  const s = (c ?? "").trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((x) => x + x).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((v) => Math.min(255, v)) as [number, number, number];
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s);
  if (hsl) {
    const h = (Number(hsl[1]) % 360) / 360; const sat = Number(hsl[2]) / 100; const l = Number(hsl[3]) / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat; const p = 2 * l - q;
    const canale = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [canale(h + 1 / 3), canale(h), canale(h - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
  }
  return [75, 82, 99];
}
