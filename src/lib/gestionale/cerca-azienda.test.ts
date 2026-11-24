import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { compilaScheda, interpretaIndirizzo, interpretaRisposta, leggiPartitaIva, partitaIvaItalianaValida, type AziendaTrovata } from "./cerca-azienda";
import type { DatiAnagrafica } from "./documenti";

describe("partita IVA", () => {
  it("toglie spazi, punti e prefisso del Paese", () => {
    expect(leggiPartitaIva("IT 0015 9560 366")).toEqual({ paese: "IT", numero: "00159560366" });
    expect(leggiPartitaIva("00159560366")).toEqual({ paese: "IT", numero: "00159560366" });
    expect(leggiPartitaIva("fr40303265045")).toEqual({ paese: "FR", numero: "40303265045" });
    expect(leggiPartitaIva("811569869", "de")).toEqual({ paese: "DE", numero: "811569869" });
  });
  it("cifra di controllo italiana", () => {
    for (const ok of ["00159560366", "12485671007", "00000000000"]) expect(partitaIvaItalianaValida(ok)).toBe(true);
    for (const no of ["00159560367", "12485671008", "1234567890", "0015956036A", ""]) expect(partitaIvaItalianaValida(no)).toBe(false);
  });
});

describe("indirizzo da VIES", () => {
  it("via su una riga, CAP città provincia sull'altra", () => {
    expect(interpretaIndirizzo("VIA ABETONE INFERIORE 4 \n41053 MARANELLO MO\n")).toEqual({ indirizzo: "VIA ABETONE INFERIORE 4", cap: "41053", citta: "MARANELLO", provincia: "MO" });
    expect(interpretaIndirizzo("VIA NAZIONALE DELLE PUGLIE  12\n80013 CASALNUOVO DI NAPOLI NA")).toEqual({ indirizzo: "VIA NAZIONALE DELLE PUGLIE 12", cap: "80013", citta: "CASALNUOVO DI NAPOLI", provincia: "NA" });
  });
  it("tutto su una riga, senza provincia, estero, vuoto", () => {
    expect(interpretaIndirizzo("VIA ROMA 1 00100 ROMA RM")).toEqual({ indirizzo: "VIA ROMA 1", cap: "00100", citta: "ROMA", provincia: "RM" });
    expect(interpretaIndirizzo("VIA ROMA 1\n00100 ROMA")).toEqual({ indirizzo: "VIA ROMA 1", cap: "00100", citta: "ROMA", provincia: null });
    expect(interpretaIndirizzo("RUE DE LA PAIX 1\n75002 PARIS", "FR")).toEqual({ indirizzo: "RUE DE LA PAIX 1, 75002 PARIS", cap: null, citta: null, provincia: null });
    expect(interpretaIndirizzo(" \n")).toEqual({ indirizzo: null, cap: null, citta: null, provincia: null });
  });
});

describe("compilazione della scheda", () => {
  const trovata: AziendaTrovata = { trovata: true, fonte: "VIES", paese: "IT", partita_iva: "00159560366", denominazione: "FERRARI S.P.A.", indirizzo: "VIA ABETONE INFERIORE 4", cap: "41053", citta: "MARANELLO", provincia: "MO" };
  const vuota = { ragione_sociale: "", partita_iva: "IT 00159560366", indirizzo: null, cap: null, citta: null, provincia: null, nazione: "IT", senza_partita_iva: true, pec: "x@pec.it" } as unknown as DatiAnagrafica;
  it("scheda nuova: compila tutto e non tocca il resto", () => {
    const { scheda, compilati, diversi } = compilaScheda(vuota, trovata, false);
    expect(scheda).toMatchObject({ ragione_sociale: "FERRARI S.P.A.", partita_iva: "00159560366", indirizzo: "VIA ABETONE INFERIORE 4", cap: "41053", citta: "MARANELLO", provincia: "MO", senza_partita_iva: false, pec: "x@pec.it" });
    expect(compilati).toHaveLength(5); expect(diversi).toEqual([]);
  });
  it("dal Registro imprese arrivano anche codice fiscale, PEC e codice destinatario", () => {
    const completa = interpretaRisposta({ fonte: "Registro imprese", denominazione: "FERRARI S.P.A.", indirizzo: "VIA ABETONE INFERIORE 4", cap: "41053", citta: "MARANELLO", provincia: "MO", codice_fiscale: "00159560366", pec: "ferrari@legalmail.it", codice_sdi: "ABC1234", cessata: false }, "IT", "00159560366");
    const { scheda, compilati } = compilaScheda({ ...vuota, pec: null, codice_fiscale: null, codice_sdi: null } as DatiAnagrafica, completa, false);
    expect(scheda).toMatchObject({ codice_fiscale: "00159560366", pec: "ferrari@legalmail.it", codice_sdi: "ABC1234", citta: "MARANELLO" });
    expect(compilati).toEqual(["ragione sociale", "codice fiscale", "indirizzo", "CAP", "città", "provincia", "PEC", "codice destinatario"]);
    // la PEC già scritta a mano su una scheda esistente non si sovrascrive
    const r = compilaScheda({ ...vuota, ragione_sociale: "Ferrari", pec: "altra@pec.it" } as DatiAnagrafica, completa, true);
    expect(r.scheda.pec).toBe("altra@pec.it"); expect(r.diversi.join()).toContain("PEC: ferrari@legalmail.it");
  });
  it("risposta VIES: indirizzo grezzo interpretato, niente PEC", () => {
    const v = interpretaRisposta({ fonte: "VIES", denominazione: "X SRL", indirizzo_grezzo: "VIA ROMA 1\n00100 ROMA RM", avviso: "credito esaurito" }, "IT", "12485671007");
    expect(v).toMatchObject({ fonte: "VIES", cap: "00100", citta: "ROMA", provincia: "RM", pec: null, codice_sdi: null, avviso: "credito esaurito" });
  });
  it("scheda esistente: riempie i vuoti, segnala i diversi, non sovrascrive", () => {
    const esistente = { ...vuota, ragione_sociale: "Ferrari spa", citta: "Maranello", cap: "41100" } as DatiAnagrafica;
    const { scheda, compilati, diversi } = compilaScheda(esistente, trovata, true);
    expect(scheda.ragione_sociale).toBe("Ferrari spa"); expect(scheda.cap).toBe("41100"); expect(scheda.citta).toBe("Maranello");
    expect(compilati).toEqual(["indirizzo", "provincia"]);
    expect(diversi).toEqual(["ragione sociale: FERRARI S.P.A.", "CAP: 41053"]);
  });
});
