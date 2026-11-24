import { describe, expect, it } from "vitest";
import { documentiProposti, mancanzeCasella, normalizzaIndirizzo } from "./caselle-email";

describe("caselle email", () => {
  it("l'indirizzo si salva minuscolo e senza spazi; quelli sbagliati si rifiutano", () => {
    expect(normalizzaIndirizzo("  Commerciale@Tecnofra.IT ")).toBe("commerciale@tecnofra.it");
    for (const no of ["", "tecnofra.it", "a@b", "a b@tecnofra.it", "a@tecnofra.it,b@tecnofra.it"]) expect(normalizzaIndirizzo(no)).toBeNull();
  });
  it("proposta: contabili all'amministrazione, commerciali alle altre", () => {
    expect(documentiProposti("amministrazione@tecnofra.it")).toEqual(["fattura", "nota_credito", "estratto_conto"]);
    expect(documentiProposti("info@tecnofra.it")).toEqual(["preventivo", "ordine", "ddt"]);
  });
  it("dice cosa manca perché una casella possa spedire", () => {
    const smtp = { host: "mail.tecnofra.it", porta: 465 };
    expect(mancanzeCasella({ attiva: true, documenti: ["ddt"] }, true, smtp)).toEqual([]);
    expect(mancanzeCasella({ attiva: false, documenti: [] }, false, { host: " ", porta: 465 }))
      .toEqual(["manca il server di posta", "manca la password", "nessun documento abilitato", "disattivata"]);
  });
});
