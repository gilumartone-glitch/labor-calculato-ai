/**
 * Fattura elettronica: crea il file XML nel tracciato FatturaPA (FPR12 tra privati, FPA12 verso la PA).
 * Specifiche tecniche dell'Agenzia delle Entrate in vigore: versione 1.9.1 (dal 15/05/2026).
 * Qui dentro non c'è accesso al database: solo funzioni pure, così si provano una per una.
 */
import type { AliquotaIva, Intestatario, TipoDocumento } from "./documenti";
import { numeroDocumento, testoPercorso, type PassoPercorso } from "./documenti";
import type { CondizionePagamento } from "./scadenzario";
import { anteprimaScadenze } from "./scadenzario";

export const VERSIONE_SPECIFICHE = "1.9.1";

/* ------------------------------------------------------------------ */
/* Dati                                                                */
/* ------------------------------------------------------------------ */
export type DatiAzienda = {
  denominazione: string;
  partita_iva: string;
  codice_fiscale: string;
  /** RF01 ordinario, RF19 forfettario… */
  regime_fiscale: string;
  indirizzo: string;
  cap: string;
  comune: string;
  provincia: string;
  rea_ufficio: string;
  rea_numero: string;
  capitale_sociale: string;
  /** SU socio unico, SM più soci, vuoto se non applicabile */
  socio_unico: "" | "SU" | "SM";
  telefono: string;
  email: string;
  iban: string;
  banca: string;
};

export const AZIENDA_VUOTA: DatiAzienda = {
  denominazione: "", partita_iva: "", codice_fiscale: "", regime_fiscale: "RF01", indirizzo: "", cap: "", comune: "",
  provincia: "", rea_ufficio: "", rea_numero: "", capitale_sociale: "", socio_unico: "", telefono: "", email: "", iban: "", banca: "",
};

export const REGIMI_FISCALI: { codice: string; etichetta: string }[] = [
  { codice: "RF01", etichetta: "RF01 · Ordinario" },
  { codice: "RF02", etichetta: "RF02 · Contribuenti minimi" },
  { codice: "RF19", etichetta: "RF19 · Forfettario" },
];

/** I: immediata · D: differita · S: scissione dei pagamenti (split payment) */
export type EsigibilitaIva = "I" | "D" | "S";
export const ESIGIBILITA_LABEL: Record<EsigibilitaIva, string> = {
  I: "Immediata", D: "Differita", S: "Scissione dei pagamenti (split payment)",
};

export type RigaFattura = {
  tipo_riga: "articolo" | "lavorazione" | "libera" | "nota";
  codice: string | null;
  descrizione: string;
  dettagli: string | null;
  um: string | null;
  quantita: number;
  prezzo_unitario: number;
  sconto_pct: number;
  aliquota_id: string | null;
};

export type DatiFattura = {
  tipo: Extract<TipoDocumento, "fattura" | "nota_credito">;
  numero: number | null;
  anno: number | null;
  serie: string;
  data: string;
  oggetto: string | null;
  /** come il cliente chiama il suo ordine: OP, RdA, OC… */
  ordine_cliente_tipo: string | null;
  /** numero dell'ordine del cliente */
  riferimento_esterno: string | null;
  data_esterna: string | null;
  cig: string | null;
  cup: string | null;
  esigibilita_iva: EsigibilitaIva;
  bollo_virtuale: boolean;
  cliente: Intestatario;
  righe: RigaFattura[];
  aliquote: AliquotaIva[];
  condizione: Pick<CondizionePagamento, "rate" | "fine_mese" | "modalita"> | null;
  /** Nome dello spettacolo: il tracciato non ha un campo apposito, va in causale. */
  produzione: string | null;
  /** I documenti da cui discende, dal più vecchio: preventivo, conferma d'ordine, DDT (e la fattura, per una nota di credito). */
  percorso: PassoPercorso[];
};

export type Controllo = { errori: string[]; avvisi: string[] };

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */
const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const imp2 = (n: number) => arrotonda2(n).toFixed(2);
/** Prezzi e quantità: da 2 a 8 decimali, senza zeri inutili oltre il secondo. */
const decimali = (n: number): string => {
  const s = (Math.round((n + Number.EPSILON) * 1e6) / 1e6).toFixed(6).replace(/0+$/, "");
  const [intero, dec = ""] = s.split(".");
  return `${intero}.${dec.padEnd(2, "0")}`;
};

const SOSTITUZIONI: Record<string, string> = {
  "€": "EUR", "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "™": "", "œ": "oe", "Œ": "OE",
  " ": " ", " ": " ", " ": " ", "×": "x", "≥": ">=", "≤": "<=", "→": "->",
};

/**
 * Il tracciato accetta solo caratteri latini di base (niente €, virgolette tipografiche, emoji):
 * quelli noti vengono tradotti, gli altri tolti. Gli spazi multipli diventano uno.
 */
export function testoLatino(testo: string | null | undefined, max: number): string {
  let s = "";
  for (const ch of (testo ?? "").normalize("NFC")) {
    if (ch in SOSTITUZIONI) { s += SOSTITUZIONI[ch]; continue; }
    const c = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\r" || ch === "\t") s += " ";
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)) s += ch;
  }
  return s.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (nome: string, valore: string | null | undefined): string => (valore == null || valore === "" ? "" : `<${nome}>${xml(valore)}</${nome}>`);
const blocco = (nome: string, contenuto: string): string => (contenuto === "" ? "" : `<${nome}>${contenuto}</${nome}>`);

const soloCifre = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase().replace(/^IT(?=\d{11}$)/, "");
const pivaValida = (s: string) => /^\d{11}$/.test(s);
const cfValido = (s: string) => /^\d{11}$/.test(s) || /^[A-Z0-9]{16}$/.test(s);
const nazioneDi = (c: Intestatario) => ((c.nazione ?? "IT").trim().toUpperCase() || "IT");

/** Numero come compare in fattura: 12/2027, oppure 12/A/2027 con la serie. */
export const numeroFattura = (d: Pick<DatiFattura, "numero" | "anno" | "serie">): string =>
  d.numero == null ? "BOZZA" : `${d.numero}${d.serie ? `/${d.serie}` : ""}/${d.anno}`;

/**
 * Progressivo del file: 5 caratteri, unico per ogni documento.
 * F o N (fattura / nota di credito), l'anno in una lettera, il numero in base 36.
 */
export function progressivoInvio(d: Pick<DatiFattura, "tipo" | "numero" | "anno">): string {
  if (d.numero == null || d.anno == null) return "PROVA";
  return `${d.tipo === "fattura" ? "F" : "N"}${(d.anno % 36).toString(36)}${d.numero.toString(36).padStart(3, "0")}`.toUpperCase();
}

export const nomeFileFattura = (azienda: Pick<DatiAzienda, "partita_iva">, d: Pick<DatiFattura, "tipo" | "numero" | "anno">): string =>
  `IT${soloCifre(azienda.partita_iva)}_${progressivoInvio(d)}.xml`;

/** Codice della modalità di pagamento, dalla parola usata nelle condizioni. Senza indicazione: bonifico. */
export function modalitaPagamento(modalita: string | null | undefined): string {
  const m = (modalita ?? "").toLowerCase();
  if (/ri\.?\s?ba|ricevuta banc/.test(m)) return "MP12";
  if (/contant/.test(m)) return "MP01";
  if (/assegno circ/.test(m)) return "MP03";
  if (/assegno/.test(m)) return "MP02";
  if (/carta|pos|paypal/.test(m)) return "MP08";
  if (/sdd|rid|addebito/.test(m)) return "MP19";
  if (/pagopa/.test(m)) return "MP23";
  return "MP05";
}

/** Codice destinatario di 6 caratteri = ufficio della Pubblica Amministrazione. */
const versoPA = (c: Intestatario) => (c.codice_sdi ?? "").trim().length === 6;

type Gruppo = { aliquota: AliquotaIva; imponibile: number };

function riepilogo(d: DatiFattura): Gruppo[] {
  const gruppi = new Map<string, Gruppo>();
  for (const r of d.righe) {
    if (r.tipo_riga === "nota" || !r.aliquota_id) continue;
    const aliquota = d.aliquote.find((a) => a.id === r.aliquota_id);
    if (!aliquota) continue;
    const g = gruppi.get(aliquota.id) ?? { aliquota, imponibile: 0 };
    g.imponibile += importoRigaFattura(r);
    gruppi.set(aliquota.id, g);
  }
  return [...gruppi.values()].map((g) => ({ ...g, imponibile: arrotonda2(g.imponibile) }))
    .sort((a, b) => b.aliquota.percentuale - a.aliquota.percentuale);
}

const importoRigaFattura = (r: Pick<RigaFattura, "tipo_riga" | "quantita" | "prezzo_unitario" | "sconto_pct">): number =>
  r.tipo_riga === "nota" ? 0 : arrotonda2(r.quantita * r.prezzo_unitario * (1 - r.sconto_pct / 100));

/** Imponibile, imposta, totale del documento e quanto deve davvero pagare il cliente. */
export function totaliFattura(d: DatiFattura) {
  const gruppi = riepilogo(d);
  const imponibile = arrotonda2(gruppi.reduce((t, g) => t + g.imponibile, 0));
  const imposta = arrotonda2(gruppi.reduce((t, g) => t + arrotonda2((g.imponibile * g.aliquota.percentuale) / 100), 0));
  const totale = arrotonda2(imponibile + imposta);
  // con la scissione dei pagamenti l'IVA la versa il cliente all'Erario: non si incassa
  const daPagare = d.esigibilita_iva === "S" ? imponibile : totale;
  const senzaIva = arrotonda2(gruppi.filter((g) => g.aliquota.percentuale === 0).reduce((t, g) => t + g.imponibile, 0));
  return { imponibile, imposta, totale, daPagare, senzaIva };
}

/* ------------------------------------------------------------------ */
/* Controllo prima di creare il file                                   */
/* ------------------------------------------------------------------ */
export function controllaFattura(azienda: DatiAzienda, d: DatiFattura): Controllo {
  const errori: string[] = [];
  const avvisi: string[] = [];

  // chi emette
  if (!azienda.denominazione.trim()) errori.push("Dati azienda: manca la denominazione.");
  if (!pivaValida(soloCifre(azienda.partita_iva))) errori.push("Dati azienda: la partita IVA deve avere 11 cifre.");
  if (azienda.codice_fiscale.trim() && !cfValido(soloCifre(azienda.codice_fiscale))) errori.push("Dati azienda: codice fiscale non valido.");
  if (!/^RF\d{2}$/.test(azienda.regime_fiscale)) errori.push("Dati azienda: manca il regime fiscale.");
  if (!azienda.indirizzo.trim() || !azienda.comune.trim()) errori.push("Dati azienda: mancano indirizzo o comune della sede.");
  if (!/^\d{5}$/.test(azienda.cap.trim())) errori.push("Dati azienda: il CAP deve avere 5 cifre.");
  if (!/^[A-Za-z]{2}$/.test(azienda.provincia.trim())) errori.push("Dati azienda: la provincia è la sigla di 2 lettere.");
  if (Boolean(azienda.rea_ufficio.trim()) !== Boolean(azienda.rea_numero.trim())) errori.push("Dati azienda: del REA servono sia la provincia dell'ufficio sia il numero.");
  if (!azienda.rea_numero.trim()) avvisi.push("Dati azienda: senza numero REA l'iscrizione al Registro Imprese non compare in fattura (per una società è obbligatoria).");

  // cliente
  const c = d.cliente;
  const estero = nazioneDi(c) !== "IT";
  const piva = soloCifre(c.partita_iva);
  const cf = soloCifre(c.codice_fiscale);
  if (!(c.ragione_sociale ?? "").trim()) errori.push("Manca il cliente.");
  else {
    if (!(c.indirizzo ?? "").trim() || !(c.citta ?? "").trim()) errori.push("Cliente: mancano indirizzo o comune.");
    if (!estero) {
      if (!/^\d{5}$/.test((c.cap ?? "").trim())) errori.push("Cliente: il CAP deve avere 5 cifre.");
      if (!piva && !cf) errori.push("Cliente: serve la partita IVA oppure il codice fiscale.");
      if (piva && !pivaValida(piva)) errori.push("Cliente: la partita IVA deve avere 11 cifre.");
      if (cf && !cfValido(cf)) errori.push("Cliente: codice fiscale non valido (11 cifre o 16 caratteri).");
      const sdi = (c.codice_sdi ?? "").trim();
      if (sdi && !/^[A-Za-z0-9]{6,7}$/.test(sdi)) errori.push("Cliente: il codice destinatario ha 7 caratteri (6 per la Pubblica Amministrazione).");
      if (!sdi && !(c.pec ?? "").trim()) avvisi.push("Cliente senza codice destinatario né PEC: la fattura parte con 0000000 e il cliente la trova solo nel suo cassetto fiscale.");
    } else if (!piva && !cf) {
      avvisi.push("Cliente estero senza identificativo fiscale: nel file viene indicato un identificativo generico.");
    }
  }

  // documento
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data)) errori.push("Manca la data del documento.");
  if (d.numero == null) avvisi.push("Il documento è una bozza: il file è una prova e non va inviato.");
  const righeValore = d.righe.filter((r) => r.tipo_riga !== "nota");
  if (righeValore.length === 0) errori.push("Serve almeno una riga con un importo.");
  righeValore.forEach((r, i) => {
    const n = `Riga ${i + 1}`;
    const a = d.aliquote.find((x) => x.id === r.aliquota_id);
    if (!testoLatino(r.descrizione, 1000)) errori.push(`${n}: manca la descrizione.`);
    if (!a) errori.push(`${n}: manca l'aliquota IVA.`);
    else if (a.percentuale === 0 && !(a.natura ?? "").trim()) errori.push(`${n}: l'aliquota «${a.descrizione}» è senza IVA ma non ha il codice natura (N1…N7).`);
    if (r.quantita < 0 || r.prezzo_unitario < 0) errori.push(`${n}: quantità e prezzo non possono essere negativi (per stornare si usa la nota di credito).`);
  });
  if ((d.cig || d.cup) && !(d.riferimento_esterno ?? "").trim()) errori.push("Con CIG o CUP serve anche il riferimento all'ordine del cliente.");
  if (d.cig && !/^[A-Za-z0-9]{10}$/.test(d.cig.trim())) avvisi.push("Il CIG ha di norma 10 caratteri: controlla.");
  if (d.cup && !/^[A-Za-z0-9]{15}$/.test(d.cup.trim())) avvisi.push("Il CUP ha di norma 15 caratteri: controlla.");
  if (versoPA(c) && !d.cig) avvisi.push("Fattura alla Pubblica Amministrazione senza CIG: di norma viene rifiutata.");
  if (ordineCliente(d).troppoLungo) avvisi.push("Nome e numero dell'ordine del cliente superano i 20 caratteri del campo dedicato: lì va solo il numero, per intero sono riportati in causale.");
  if (d.tipo === "nota_credito" && !ultimo(d, "fattura")) avvisi.push("Nota di credito senza fattura di origine: nel file manca il riferimento alla fattura rettificata.");

  const t = totaliFattura(d);
  if (t.senzaIva > 77.47 && !d.bollo_virtuale) avvisi.push(`Ci sono ${imp2(t.senzaIva)} € senza IVA: sopra 77,47 € di norma serve il bollo da 2 € (non per reverse charge ed esportazioni). Chiedi al commercialista.`);
  if (d.esigibilita_iva === "S" && t.imposta === 0) avvisi.push("Scissione dei pagamenti indicata ma la fattura non ha IVA.");
  if (d.tipo === "fattura" && !azienda.iban.trim() && modalitaPagamento(d.condizione?.modalita) === "MP05") avvisi.push("Dati azienda: senza IBAN il cliente non trova in fattura dove fare il bonifico.");

  return { errori, avvisi };
}

/* ------------------------------------------------------------------ */
/* Il file XML                                                         */
/* ------------------------------------------------------------------ */
/**
 * Ordine del cliente: "OP 4500123". Il campo dedicato tiene 20 caratteri:
 * se nome e numero insieme non ci stanno, lì va il solo numero.
 */
function ordineCliente(d: Pick<DatiFattura, "ordine_cliente_tipo" | "riferimento_esterno">) {
  const numero = testoLatino(d.riferimento_esterno, 100);
  const completo = [testoLatino(d.ordine_cliente_tipo, 40), numero].filter(Boolean).join(" ");
  return { numero, completo, troppoLungo: numero !== "" && completo.length > 20 };
}

/** L'ultimo documento confermato di un certo tipo nel percorso. */
const ultimo = (d: Pick<DatiFattura, "percorso">, tipo: TipoDocumento): PassoPercorso | null =>
  [...d.percorso].reverse().find((p) => p.tipo === tipo && p.numero != null) ?? null;

function tipoDocumentoSdi(d: DatiFattura): string {
  if (d.tipo === "nota_credito") return "TD04";
  // fattura che nasce da un DDT di un giorno precedente: fattura differita
  const ddt = ultimo(d, "ddt");
  if (ddt && ddt.data < d.data) return "TD24";
  return "TD01";
}

/** Causale: blocchi da 200 caratteri al massimo. */
const causali = (testo: string): string => {
  const pulito = testoLatino(testo, 2000);
  const pezzi: string[] = [];
  for (let i = 0; i < pulito.length; i += 200) pezzi.push(pulito.slice(i, i + 200));
  return pezzi.map((p) => tag("Causale", p)).join("");
};

export function creaFatturaXml(azienda: DatiAzienda, d: DatiFattura): string {
  const { errori } = controllaFattura(azienda, d);
  if (errori.length > 0) throw new Error(`La fattura elettronica non si può creare:\n${errori.join("\n")}`);

  const c = d.cliente;
  const estero = nazioneDi(c) !== "IT";
  const pa = versoPA(c);
  const formato = pa ? "FPA12" : "FPR12";
  const pivaAzienda = soloCifre(azienda.partita_iva);
  const sdi = (c.codice_sdi ?? "").trim().toUpperCase();
  const codiceDestinatario = estero ? "XXXXXXX" : sdi || "0000000";
  const pec = !estero && !sdi ? (c.pec ?? "").trim() : "";
  const t = totaliFattura(d);
  const gruppi = riepilogo(d);

  const trasmissione = blocco("DatiTrasmissione",
    blocco("IdTrasmittente", tag("IdPaese", "IT") + tag("IdCodice", pivaAzienda))
    + tag("ProgressivoInvio", progressivoInvio(d))
    + tag("FormatoTrasmissione", formato)
    + tag("CodiceDestinatario", codiceDestinatario)
    + tag("PECDestinatario", pec));

  const cedente = blocco("CedentePrestatore",
    blocco("DatiAnagrafici",
      blocco("IdFiscaleIVA", tag("IdPaese", "IT") + tag("IdCodice", pivaAzienda))
      + tag("CodiceFiscale", soloCifre(azienda.codice_fiscale))
      + blocco("Anagrafica", tag("Denominazione", testoLatino(azienda.denominazione, 80)))
      + tag("RegimeFiscale", azienda.regime_fiscale))
    + blocco("Sede",
      tag("Indirizzo", testoLatino(azienda.indirizzo, 60)) + tag("CAP", azienda.cap.trim())
      + tag("Comune", testoLatino(azienda.comune, 60)) + tag("Provincia", azienda.provincia.trim().toUpperCase()) + tag("Nazione", "IT"))
    + (azienda.rea_numero.trim()
      ? blocco("IscrizioneREA",
        tag("Ufficio", azienda.rea_ufficio.trim().toUpperCase()) + tag("NumeroREA", testoLatino(azienda.rea_numero, 20))
        + tag("CapitaleSociale", azienda.capitale_sociale.trim() ? imp2(Number(azienda.capitale_sociale.replace(/\./g, "").replace(",", ".")) || 0) : "")
        + tag("SocioUnico", azienda.socio_unico) + tag("StatoLiquidazione", "LN"))
      : "")
    + blocco("Contatti", tag("Telefono", testoLatino(azienda.telefono, 12).replace(/[^0-9+]/g, "")) + tag("Email", azienda.email.trim())));

  const pivaCliente = soloCifre(c.partita_iva);
  const cfCliente = soloCifre(c.codice_fiscale);
  const idFiscaleCliente = estero
    ? blocco("IdFiscaleIVA", tag("IdPaese", nazioneDi(c))
      // l'identificativo estero va senza la sigla del paese davanti
      + tag("IdCodice", testoLatino((pivaCliente || cfCliente).replace(new RegExp(`^${nazioneDi(c)}`), "") || "OO99999999999", 28)))
    : pivaCliente ? blocco("IdFiscaleIVA", tag("IdPaese", "IT") + tag("IdCodice", pivaCliente)) : "";
  const cessionario = blocco("CessionarioCommittente",
    blocco("DatiAnagrafici",
      idFiscaleCliente
      + (estero ? "" : tag("CodiceFiscale", cfCliente))
      + blocco("Anagrafica", tag("Denominazione", testoLatino(c.ragione_sociale, 80))))
    + blocco("Sede",
      tag("Indirizzo", testoLatino(c.indirizzo, 60)) + tag("CAP", estero ? "00000" : (c.cap ?? "").trim())
      + tag("Comune", testoLatino(c.citta, 60))
      + (estero ? "" : tag("Provincia", /^[A-Za-z]{2}$/.test((c.provincia ?? "").trim()) ? (c.provincia ?? "").trim().toUpperCase() : ""))
      + tag("Nazione", nazioneDi(c))));

  const ordine = ordineCliente(d);
  const fatturaOrigine = ultimo(d, "fattura");
  const ddtOrigine = ultimo(d, "ddt");
  const generali = blocco("DatiGenerali",
    blocco("DatiGeneraliDocumento",
      tag("TipoDocumento", tipoDocumentoSdi(d)) + tag("Divisa", "EUR") + tag("Data", d.data) + tag("Numero", numeroFattura(d))
      + (d.bollo_virtuale ? blocco("DatiBollo", tag("BolloVirtuale", "SI") + tag("ImportoBollo", "2.00")) : "")
      + tag("ImportoTotaleDocumento", imp2(t.totale))
      // Oggetto, produzione e percorso dei documenti: il tracciato non ha campi dedicati, vanno in causale
      + causali(d.oggetto ?? "")
      + causali(d.produzione?.trim() ? `Produzione: ${d.produzione}` : "")
      + causali(ordine.troppoLungo ? `Ordine cliente: ${ordine.completo}` : "")
      + causali(testoPercorso(d.percorso) ? `Rif. ${testoPercorso(d.percorso)}` : ""))
    + (ordine.numero
      ? blocco("DatiOrdineAcquisto",
        tag("IdDocumento", testoLatino(ordine.troppoLungo ? ordine.numero : ordine.completo, 20)) + tag("Data", d.data_esterna)
        + tag("CodiceCUP", (d.cup ?? "").trim().toUpperCase()) + tag("CodiceCIG", (d.cig ?? "").trim().toUpperCase()))
      : "")
    + (d.tipo === "nota_credito" && fatturaOrigine
      ? blocco("DatiFattureCollegate", tag("IdDocumento", numeroDocumento(fatturaOrigine)) + tag("Data", fatturaOrigine.data))
      : "")
    + (d.tipo === "fattura" && ddtOrigine
      ? blocco("DatiDDT", tag("NumeroDDT", numeroDocumento(ddtOrigine)) + tag("DataDDT", ddtOrigine.data))
      : ""));

  let ultimaAliquota = gruppi[0]?.aliquota ?? null;
  const linee = d.righe.map((r, i) => {
    const nota = r.tipo_riga === "nota";
    const aliquota = nota ? ultimaAliquota : d.aliquote.find((a) => a.id === r.aliquota_id) ?? null;
    if (!nota && aliquota) ultimaAliquota = aliquota;
    const descrizione = testoLatino([r.descrizione, r.dettagli].filter(Boolean).join(" - "), 1000) || "-";
    const codice = testoLatino(r.codice, 35);
    return blocco("DettaglioLinee",
      tag("NumeroLinea", String(i + 1))
      + (codice && !nota ? blocco("CodiceArticolo", tag("CodiceTipo", "INT") + tag("CodiceValore", codice)) : "")
      + tag("Descrizione", descrizione)
      + (nota ? "" : tag("Quantita", decimali(r.quantita)) + tag("UnitaMisura", testoLatino(r.um, 10)))
      + tag("PrezzoUnitario", nota ? "0.00" : decimali(r.prezzo_unitario))
      + (!nota && r.sconto_pct > 0 ? blocco("ScontoMaggiorazione", tag("Tipo", "SC") + tag("Percentuale", imp2(r.sconto_pct))) : "")
      + tag("PrezzoTotale", imp2(importoRigaFattura(r)))
      + tag("AliquotaIVA", imp2(aliquota?.percentuale ?? 0))
      + tag("Natura", aliquota && aliquota.percentuale === 0 ? (aliquota.natura ?? "").trim() : ""));
  }).join("");

  const riepiloghi = gruppi.map((g) => {
    const senzaIva = g.aliquota.percentuale === 0;
    return blocco("DatiRiepilogo",
      tag("AliquotaIVA", imp2(g.aliquota.percentuale))
      + tag("Natura", senzaIva ? (g.aliquota.natura ?? "").trim() : "")
      + tag("ImponibileImporto", imp2(g.imponibile))
      + tag("Imposta", imp2((g.imponibile * g.aliquota.percentuale) / 100))
      // la scissione dei pagamenti non si applica alle operazioni senza IVA
      + tag("EsigibilitaIVA", senzaIva ? (d.esigibilita_iva === "S" ? "I" : d.esigibilita_iva) : d.esigibilita_iva)
      + tag("RiferimentoNormativo", senzaIva ? testoLatino(g.aliquota.descrizione, 100) : ""));
  }).join("");

  let pagamento = "";
  if (d.tipo === "fattura" && t.daPagare > 0) {
    const rate = anteprimaScadenze(t.daPagare, d.data, d.condizione);
    const mp = modalitaPagamento(d.condizione?.modalita);
    pagamento = blocco("DatiPagamento",
      tag("CondizioniPagamento", rate.length > 1 ? "TP01" : "TP02")
      + rate.map((r) => blocco("DettaglioPagamento",
        tag("ModalitaPagamento", mp) + tag("DataScadenzaPagamento", r.data) + tag("ImportoPagamento", imp2(r.importo))
        + (mp === "MP05" ? tag("IstitutoFinanziario", testoLatino(azienda.banca, 200)) + tag("IBAN", azienda.iban.replace(/\s+/g, "").toUpperCase()) : ""))).join(""));
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<p:FatturaElettronica versione="${formato}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" `
    + 'xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + blocco("FatturaElettronicaHeader", trasmissione + cedente + cessionario)
    + blocco("FatturaElettronicaBody", generali + blocco("DatiBeniServizi", linee + riepiloghi) + pagamento)
    + "</p:FatturaElettronica>\n";
}
