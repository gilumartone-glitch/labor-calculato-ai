import { describe, expect, it } from "vitest";
import { capienzaQr, creaQr } from "./qr";
import { creaPdfEtichette, indirizzoPezza, type EtichettaPezza } from "./etichette-pdf";

describe("codice QR", () => {
  it("la griglia cresce con il testo e ha i tre mirini agli angoli", () => {
    expect(creaQr("A")).toHaveLength(21);
    const q = creaQr("https://flow.tecnofra.it/gestionale?pezza=PZ000001");
    expect(q).toHaveLength(33);                       // versione 4
    const n = q.length;
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      expect(q[y].slice(x, x + 7).every(Boolean)).toBe(true);          // bordo scuro in alto
      expect(q[y + 1].slice(x + 1, x + 6).some(Boolean)).toBe(false);  // anello chiaro
      expect(q[y + 3][x + 3]).toBe(true);                              // centro scuro
    }
    expect(q[n - 1][n - 1] !== undefined && q.every((r) => r.length === n)).toBe(true);
  });
  it("lo stesso testo dà sempre lo stesso codice; testi diversi no", () => {
    expect(creaQr("PZ000001")).toEqual(creaQr("PZ000001"));
    expect(creaQr("PZ000001")).not.toEqual(creaQr("PZ000002"));
  });
  it("capienza per versione e rifiuto dei testi troppo lunghi", () => {
    expect([1, 4, 10].map(capienzaQr)).toEqual([14, 62, 213]);
    expect(() => creaQr("x".repeat(214))).toThrow(/troppo lungo/);
  });
});

describe("etichette delle pezze", () => {
  const e = (i: number): EtichettaPezza => ({ codice: `PZ${String(i).padStart(6, "0")}`, articolo: "Velluto Scala", variante: "Rosso · h 300 cm", codice_variante: "VEL-ROS-300", bagno: "B-1042", metri: 48.5, posizione: null, ignifugo: true });
  it("l'indirizzo nel codice porta alla pezza", () => {
    expect(indirizzoPezza("https://flow.tecnofra.it/", "PZ000007")).toBe("https://flow.tecnofra.it/gestionale?pezza=PZ000007");
  });
  it("24 etichette per foglio A4, una per pagina sul rotolo", () => {
    const tutte = Array.from({ length: 25 }, (_, i) => e(i + 1));
    expect(creaPdfEtichette(tutte, "a4-24", "https://flow.tecnofra.it").getNumberOfPages()).toBe(2);
    expect(creaPdfEtichette(tutte.slice(0, 8), "a4-8", "https://flow.tecnofra.it").getNumberOfPages()).toBe(1);
    expect(creaPdfEtichette(tutte.slice(0, 3), "rotolo-100x50", "https://flow.tecnofra.it").getNumberOfPages()).toBe(3);
  });
});
