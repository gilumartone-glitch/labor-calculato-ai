import { describe, expect, it } from "vitest";
import type { Catalog, PieceLine } from "@/components/calculator/types";
import { areaPerimetro, caratteristicheScheda, coloreRgb, conDisegno, latiDisegno, lavorazioniScheda, leggiSchede, misureScheda, schedaDaPezzo, testoScheda } from "./scheda-tecnica";

const listino = {
  perimeterOps: [{ id: "orlo", name: "Orlo", color: "#ff0000", pricePerMeter: 2 }, { id: "occ", name: "Occhielli", color: "hsl(120 100% 25%)", pricePerMeter: 1 }],
  printOps: [{ id: "uvfr", type: "uv", mode: "fronte_retro", pricePerSqm: 9 }],
} as unknown as Catalog;
const pezzo = {
  id: "p1", productName: "Velluto", color: "nero", fireproof: "classe 1", width: 600, height: 400, dimUnit: "cm", quantity: 2, fullnessPct: 50,
  perimeters: [{ id: "a", opId: "orlo", sides: ["bottom", "top"] }, { id: "b", opId: "occ", sides: ["top"], quantity: 20 }, { id: "c", opId: "sparita", sides: [] }],
  customWorks: [{ id: "x", name: "Sacca per catena", price: 30 }], printOpId: "uvfr", note: "Consegna piegato",
} as unknown as PieceLine;

describe("scheda tecnica dal pezzo di Progettazione", () => {
  const s = schedaDaPezzo(pezzo, "Tappezzeria", listino);
  it("fotografa misure, caratteristiche e tutte le lavorazioni, senza prezzi", () => {
    expect(s).toMatchObject({ titolo: "Velluto", reparto: "Tappezzeria", forma: "rect", larghezza: 600, altezza: 400, unita: "cm", quantita: 2, colore: "nero", ignifugo: "classe 1", ricchezza: 50, nota: "Consegna piegato" });
    expect(lavorazioniScheda(s)).toEqual(["Stampa UV fronte/retro", "Orlo: alto, basso", "Occhielli: alto × 20", "Lavorazione", "Sacca per catena"]);
    expect(JSON.stringify(s)).not.toMatch(/price|30|pricePerMeter/);
    expect(caratteristicheScheda(s)).toEqual(["Colore nero", "Ignifugo classe 1", "Ricchezza 50%"]);
  });
  it("i lati del disegno portano nome e colore della lavorazione, nell'ordine alto-basso-sinistra-destra", () => {
    expect(latiDisegno(s)).toEqual([
      { side: "top", label: "Orlo", color: "#ff0000" }, { side: "bottom", label: "Orlo", color: "#ff0000" },
      { side: "top", label: "Occhielli", color: "hsl(120 100% 25%)" },
    ]);
  });
  it("il testo per il dettaglio della riga elenca ogni lavorazione", () => {
    expect(testoScheda(s)).toEqual([
      "Velluto — 600 × 400 cm · colore nero · ignifugo classe 1 · ricchezza 50% · 2 pz",
      "  - Stampa UV fronte/retro", "  - Orlo: alto, basso", "  - Occhielli: alto × 20", "  - Lavorazione", "  - Sacca per catena",
    ]);
  });
  it("trapezio, triangolo, quattro lati, pezzo essenziale senza listino", () => {
    const tr = schedaDaPezzo({ ...pezzo, shape: "trapezoid", widthBottom: 300, perimeters: [{ id: "a", opId: "orlo", sides: ["left", "right", "top", "bottom"] }] } as PieceLine, "Stampa", listino);
    expect(misureScheda(tr)).toBe("600 / 300 × 400 cm (trapezio)");
    expect(lavorazioniScheda(tr)[1]).toBe("Orlo: tutti i lati");
    expect(areaPerimetro(tr).area).toBeCloseTo(18); expect(areaPerimetro(tr).perimetro).toBeCloseTo(6 + 3 + 2 * Math.sqrt(1.5 ** 2 + 16));
    expect(misureScheda({ forma: "triangle", larghezza: 2, altezza: 1.5, unita: "m", baseMinore: null })).toBe("2 × 1,5 m (triangolo)");
    expect(areaPerimetro({ forma: "rect", larghezza: 600, altezza: 400, unita: "cm", baseMinore: null })).toEqual({ area: 24, perimetro: 20 });
    const nudo = schedaDaPezzo({ id: "n", productName: "", width: 100, height: 50, dimUnit: "cm", perimeters: [] } as unknown as PieceLine, "Falegnameria");
    expect(nudo).toMatchObject({ titolo: "Pezzo", quantita: 1, colore: null, stampa: null, lavorazioni: [], lavorazioniLibere: [] });
  });
});

describe("regole e letture", () => {
  it("il disegno va in tutti i documenti tranne fattura e nota di credito", () => {
    expect((["preventivo", "ordine", "ddt", "bolla_carico"] as const).every(conDisegno)).toBe(true);
    expect((["fattura", "nota_credito", "fattura_fornitore"] as const).some(conDisegno)).toBe(false);
  });
  it("dalla riga si leggono solo le schede vere", () => {
    expect(leggiSchede(null)).toEqual([]); expect(leggiSchede("x")).toEqual([]);
    expect(leggiSchede([{ titolo: "A", lavorazioni: [] }, { altro: 1 }, null])).toHaveLength(1);
  });
  it("colori del listino in RGB", () => {
    expect(coloreRgb("#f00")).toEqual([255, 0, 0]); expect(coloreRgb("#1E90FF")).toEqual([30, 144, 255]);
    expect(coloreRgb("rgb(10, 20, 30)")).toEqual([10, 20, 30]); expect(coloreRgb("hsl(120 100% 25%)")).toEqual([0, 128, 0]);
    expect(coloreRgb("hsl(0, 100%, 50%)")).toEqual([255, 0, 0]); expect(coloreRgb("boh")).toEqual([75, 82, 99]); expect(coloreRgb(null)).toEqual([75, 82, 99]);
  });
});
