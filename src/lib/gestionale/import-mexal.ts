/**
 * Import dell'anagrafica clienti/fornitori esportata da Mexal ("Anagrafica Clienti Fornitori per Excel",
 * file XML in formato foglio di calcolo).
 *
 * Regola: nessun dato viene scartato. Ogni colonna del file finisce, così com'era, in `dati_origine`;
 * le colonne che il Gestionale conosce vengono anche copiate nei campi propri, ripulite.
 */

const NS = "urn:schemas-microsoft-com:office:spreadsheet";

/** Una riga del file: nome colonna → valore originale, senza alcuna modifica. */
export type RigaMexal = Record<string, string>;

export type LetturaMexal = {
  intestazioni: string[];
  righe: RigaMexal[];
  /** Righe del foglio che non sono schede (titolo, azienda, "Fine Stampa"…): riportate per trasparenza. */
  nonSchede: string[][];
};

export type AnagraficaImport = {
  codice: string;
  codice_mexal: string;
  is_cliente: boolean;
  is_fornitore: boolean;
  ragione_sociale: string;
  partita_iva: string | null;
  codice_fiscale: string | null;
  senza_partita_iva: boolean;
  indirizzo: string | null;
  cap: string | null;
  citta: string | null;
  provincia: string | null;
  nazione: string;
  codice_sdi: string | null;
  telefono: string | null;
  codice_pagamento: string | null;
  pagamento: string | null;
  banca_appoggio: string | null;
  abi: string | null;
  cab: string | null;
  banca_presentazione: string | null;
  codice_iva_esenzione: string | null;
  email: string | null;
  pec: string | null;
  fido: number | null;
  origine: "mexal";
  dati_origine: RigaMexal;
  importato_il: string;
};

const RE_CONTO = /^\d{3}\.\d+$/;
/** Segnaposto usati al posto di una partita IVA vera: solo zeri, eventualmente con IT e un 1 finale. */
const RE_PIVA_SEGNAPOSTO = /^(IT)?0+1?$/i;
const RE_CF_SEGNAPOSTO = /^[X.]+$/i;

const celle = (riga: Element): string[] => {
  const out: string[] = [];
  let col = 0;
  for (const c of Array.from(riga.children)) {
    if (c.localName !== "Cell") continue;
    const indice = c.getAttributeNS(NS, "Index") ?? c.getAttribute("ss:Index");
    if (indice) col = parseInt(indice, 10) - 1;
    while (out.length < col) out.push("");
    const dato = Array.from(c.children).find((x) => x.localName === "Data");
    out.push(dato?.textContent ?? "");
    col += 1;
    const unite = c.getAttributeNS(NS, "MergeAcross") ?? c.getAttribute("ss:MergeAcross");
    if (unite) col += parseInt(unite, 10);
  }
  return out;
};

/** Legge il file XML di Mexal. Lancia un errore se non riconosce il formato. */
export function leggiExportMexal(xml: string): LetturaMexal {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Il file non è un XML valido.");
  }
  const righeFoglio = Array.from(doc.getElementsByTagNameNS(NS, "Row")).map(celle);
  const iIntestazione = righeFoglio.findIndex((r) => (r[0] ?? "").trim() === "Conto" && r.length > 5);
  if (iIntestazione < 0) {
    throw new Error("Formato non riconosciuto: manca la riga di intestazione con la colonna «Conto».");
  }
  const intestazioni = righeFoglio[iIntestazione].map((h) => h.trim());
  const righe: RigaMexal[] = [];
  const nonSchede: string[][] = righeFoglio.slice(0, iIntestazione);

  for (const r of righeFoglio.slice(iIntestazione + 1)) {
    if (!RE_CONTO.test((r[0] ?? "").trim())) {
      if (r.some((c) => c.trim() !== "")) nonSchede.push(r);
      continue;
    }
    if (r.length > intestazioni.length) {
      throw new Error(`La scheda ${r[0]} ha più colonne dell'intestazione: import interrotto per non perdere dati.`);
    }
    const riga: RigaMexal = {};
    intestazioni.forEach((h, i) => { riga[h] = r[i] ?? ""; });
    righe.push(riga);
  }
  return { intestazioni, righe, nonSchede };
}

const pulito = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

const nazione = (v: string | undefined): string => {
  const t = (v ?? "").trim();
  if (t === "" || t.toLowerCase() === "italia") return "IT";
  return t.toUpperCase();
};

const numero = (v: string | undefined): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Converte una riga di Mexal nella scheda del Gestionale. Il mastro 501 è cliente, il 601 fornitore. */
export function daMexal(riga: RigaMexal, adesso: string): AnagraficaImport {
  const conto = riga["Conto"].trim();
  const mastro = conto.split(".")[0];
  const fornitore = mastro === "601";
  const piva = pulito(riga["Partita Iva"]);
  const cf = pulito(riga["Codice Fiscale"]);
  return {
    codice: conto,
    codice_mexal: conto,
    is_cliente: !fornitore,
    is_fornitore: fornitore,
    ragione_sociale: pulito(riga["Ragione Sociale"]) ?? conto,
    partita_iva: piva && !RE_PIVA_SEGNAPOSTO.test(piva) ? piva.toUpperCase() : null,
    codice_fiscale: cf && !RE_CF_SEGNAPOSTO.test(cf) ? cf.toUpperCase() : null,
    senza_partita_iva: (riga["Senza p.Iva"] ?? "").trim().toUpperCase() === "S",
    indirizzo: pulito(riga["Indirizzo"]),
    cap: pulito(riga["CAP"]),
    citta: pulito(riga["Località"]),
    provincia: pulito(riga["Prov"]),
    nazione: nazione(riga["Nazione"]),
    codice_sdi: pulito(riga["Codice SDI"]),
    telefono: pulito(riga["Telefono"]),
    codice_pagamento: pulito(riga["Cod Pag"]),
    pagamento: pulito(riga["Pagamento"]),
    banca_appoggio: pulito(riga["Banca di appoggio"]),
    abi: pulito(riga["ABI"]),
    cab: pulito(riga["CAB"]),
    banca_presentazione: pulito(riga["Banca presentazione"]),
    codice_iva_esenzione: pulito(riga["Cod. Iva/Esenzione"]),
    email: pulito(riga["Email"]),
    pec: pulito(riga["PEC"]),
    fido: numero(riga["Fido"]),
    origine: "mexal",
    dati_origine: riga,
    importato_il: adesso,
  };
}

export type RiepilogoImport = {
  totale: number;
  clienti: number;
  fornitori: number;
  /** Schede con partita IVA segnaposto (zeri): il valore originale resta in dati_origine. */
  pivaSegnaposto: number;
  cfSegnaposto: number;
  altriMastri: string[];
  nonSchede: number;
};

export function riepilogoImport(lettura: LetturaMexal): RiepilogoImport {
  const mastri = new Set<string>();
  let clienti = 0, fornitori = 0, pivaSegnaposto = 0, cfSegnaposto = 0;
  for (const r of lettura.righe) {
    const mastro = r["Conto"].trim().split(".")[0];
    if (mastro === "601") fornitori += 1; else clienti += 1;
    if (mastro !== "501" && mastro !== "601") mastri.add(mastro);
    const piva = pulito(r["Partita Iva"]);
    if (piva && RE_PIVA_SEGNAPOSTO.test(piva)) pivaSegnaposto += 1;
    const cf = pulito(r["Codice Fiscale"]);
    if (cf && RE_CF_SEGNAPOSTO.test(cf)) cfSegnaposto += 1;
  }
  return {
    totale: lettura.righe.length, clienti, fornitori, pivaSegnaposto, cfSegnaposto,
    altriMastri: Array.from(mastri).sort(), nonSchede: lettura.nonSchede.length,
  };
}
