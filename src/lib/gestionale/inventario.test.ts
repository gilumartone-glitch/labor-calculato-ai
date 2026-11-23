import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { inventarioAllaData, inventarioCsv, riepilogoInventario } from "./inventario";
import type { Articolo, Variante } from "./types";

const articoli = [
  { id: "A1", codice: "VEL", nome: "Velluto Scala", categoria: "tessuto", um: "m", note: null, archiviato_il: null },
  { id: "A2", codice: "FOR", nome: "Forex 5 mm", categoria: "pannello", um: "pz", note: null, archiviato_il: null },
] as Articolo[];
const v = (id: string, articolo_id: string, codice: string, costo_um: number | null, extra: Partial<Variante> = {}) =>
  ({ id, articolo_id, codice, colore: null, ignifugo: false, classe_reazione: null, certificato_rif: null, altezza_cm: null, peso_gm2: null, spessore_mm: null, finitura: null, formato_larghezza_mm: null, formato_altezza_mm: null, costo_um, prezzo_um: null, inventory_item_id: null, note: null, archiviato_il: null, ...extra }) as Variante;
const varianti = [v("V1", "A1", "VEL-ROS", 9.5, { colore: "rosso" }), v("V2", "A1", "VEL-NER", null, { colore: "nero" }), v("V3", "A2", "FOR-BIA", 12), v("V4", "A2", "FOR-NER", 12)];
const m = (variante_id: string, quantita: number, giorno: string) => ({ variante_id, quantita, creato_il: `${giorno}T10:00:00` });
const movimenti = [m("V1", 100, "2026-12-01"), m("V1", -30.5, "2026-12-20"), m("V1", -10, "2027-01-05"), m("V2", 40, "2026-12-10"), m("V3", 20, "2026-12-15"), m("V3", -20, "2026-12-28"), m("V4", -2, "2026-12-30")];

describe("inventario", () => {
  it("giacenze e valore alla data: i movimenti successivi non contano", () => {
    const righe = inventarioAllaData(movimenti, varianti, articoli, "2026-12-31");
    expect(righe.map((r) => [r.codice, r.giacenza, r.valore])).toEqual([["FOR-NER", -2, -24], ["VEL-NER", 40, null], ["VEL-ROS", 69.5, 660.25]]);
    expect(inventarioAllaData(movimenti, varianti, articoli, "2027-01-31").find((r) => r.codice === "VEL-ROS")?.giacenza).toBe(59.5);
    expect(inventarioAllaData(movimenti, varianti, articoli, "2026-11-30")).toEqual([]);
  });
  it("con «anche le vuote» compaiono le varianti a zero", () => {
    expect(inventarioAllaData(movimenti, varianti, articoli, "2026-12-31", true).map((r) => r.codice)).toContain("FOR-BIA");
  });
  it("riepilogo: valore per categoria, righe senza costo e giacenze negative", () => {
    const r = riepilogoInventario(inventarioAllaData(movimenti, varianti, articoli, "2026-12-31"));
    expect(r).toEqual({ categorie: [{ categoria: "pannello", righe: 1, valore: -24 }, { categoria: "tessuto", righe: 2, valore: 660.25 }], valore: 636.25, senzaCosto: 1, negative: 1 });
  });
  it("CSV", () => {
    const righe = inventarioCsv(inventarioAllaData(movimenti, varianti, articoli, "2026-12-31")).trimEnd().split("\r\n");
    expect(righe[0]).toBe("Categoria;Codice;Articolo;Variante;UM;Giacenza;Costo unitario;Valore");
    expect(righe[3]).toBe("Tessuto;VEL-ROS;Velluto Scala;rosso;m;69,500;9,5000;660,25");
    expect(righe[2]).toBe("Tessuto;VEL-NER;Velluto Scala;nero;m;40,000;;");
  });
});
