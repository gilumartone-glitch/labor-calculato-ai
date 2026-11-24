import { describe, expect, it } from "vitest";
import type { Catalog, PieceLine } from "@/components/calculator/types";
import { areaPerimetro, caratteristicheScheda, coloreRgb, conDisegno, latiDisegno, chiavePezzo, dettagliScheda, lavorazioniPerLato, lavorazioniScheda, leggiSchede, misureScheda, righeSchematiche, schedaDaPezzo } from "./scheda-tecnica";

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
  it("le lavorazioni in forma schematica: sopra, sotto, sinistra, destra, poi le altre", () => {
    expect(righeSchematiche(s)).toEqual([
      "Sopra: Orlo, Occhielli × 20", "Sotto: Orlo", "Sinistra: —", "Destra: —",
      "Altre lavorazioni: Stampa UV fronte/retro, Lavorazione, Sacca per catena",
    ]);
    expect(dettagliScheda(s)).toEqual(["Colore nero · Ignifugo classe 1 · Ricchezza 50%", ...righeSchematiche(s), "Consegna piegato"]);
    const p = lavorazioniPerLato(s);
    expect(p.haLati).toBe(true);
    expect(p.lati.map((l) => [l.nome, l.voci.length])).toEqual([["Sopra", 2], ["Sotto", 1], ["Sinistra", 0], ["Destra", 0]]);
    expect(p.lati[0].voci[0]).toEqual({ nome: "Orlo", colore: "#ff0000" });
  });
  it("pezzo senza lavorazioni sui lati: niente schema a quattro righe", () => {
    const senza = schedaDaPezzo({ ...pezzo, perimeters: [], note: undefined } as unknown as PieceLine, "Stampa", listino);
    expect(righeSchematiche(senza)).toEqual(["Lavorazioni: Stampa UV fronte/retro, Sacca per catena"]);
    expect(righeSchematiche(schedaDaPezzo({ id: "n", productName: "X", width: 1, height: 1, dimUnit: "m", perimeters: [] } as unknown as PieceLine, "A"))).toEqual([]);
  });
  it("lo stesso pezzo si riconosce anche con un numero di copie diverso; basta una differenza per distinguerlo", () => {
    const altro = schedaDaPezzo({ ...pezzo, id: "p2", quantity: 5 } as unknown as PieceLine, "Tappezzeria", listino);
    expect(chiavePezzo(altro)).toBe(chiavePezzo(s));
    expect(chiavePezzo(schedaDaPezzo({ ...pezzo, color: "blu" } as unknown as PieceLine, "Tappezzeria", listino))).not.toBe(chiavePezzo(s));
    expect(chiavePezzo(schedaDaPezzo({ ...pezzo, perimeters: [] } as unknown as PieceLine, "Tappezzeria", listino))).not.toBe(chiavePezzo(s));
  });
  it("trapezio, triangolo, quattro lati, pezzo essenziale senza listino", () => {
    const tr = schedaDaPezzo({ ...pezzo, shape: "trapezoid", widthBottom: 300, perimeters: [{ id: "a", opId: "orlo", sides: ["left", "right", "top", "bottom"] }] } as PieceLine, "Stampa", listino);
    expect(misureScheda(tr)).toBe("600 / 300 × 400 cm (trapezio)");
    expect(lavorazioniScheda(tr)[1]).toBe("Orlo: tutti i lati");
    expect(righeSchematiche(tr).slice(0, 4)).toEqual(["Sopra: Orlo", "Sotto: Orlo", "Sinistra: Orlo", "Destra: Orlo"]);
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
