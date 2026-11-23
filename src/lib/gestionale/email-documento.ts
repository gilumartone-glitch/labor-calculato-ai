/**
 * Invio dei documenti per email. Per ora il Gestionale prepara il messaggio (destinatario, oggetto, testo),
 * scarica il PDF e apre il programma di posta dell'operatore, che sceglie lì la casella da cui spedire
 * e allega il file. L'invio diretto dall'app richiede le caselle configurate sul server.
 */
import { numeroDocumento, type TipoDocumento } from "./documenti";
import type { DatiAzienda } from "./fattura-pa";

const dataIt = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** «il preventivo n. 45/2026 del 12/11/2026», con l'articolo giusto. */
const NOME: Record<TipoDocumento, { articolo: string; nome: string }> = {
  preventivo: { articolo: "il", nome: "preventivo" },
  ordine: { articolo: "la", nome: "conferma d'ordine" },
  ddt: { articolo: "il", nome: "documento di trasporto" },
  fattura: { articolo: "la", nome: "fattura" },
  nota_credito: { articolo: "la", nome: "nota di credito" },
  bolla_carico: { articolo: "la", nome: "bolla di carico" },
  fattura_fornitore: { articolo: "la", nome: "fattura" },
};

export type DocumentoDaInviare = {
  tipo: TipoDocumento; numero: number | null; anno: number | null; serie: string; data: string;
  oggetto: string | null; produzione: string | null; ordine_cliente_tipo: string | null; riferimento_esterno: string | null;
  validita_giorni: number | null;
};

const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const riferimento = (d: DocumentoDaInviare) => (d.numero == null ? `${NOME[d.tipo].nome} in bozza` : `${NOME[d.tipo].nome} n. ${numeroDocumento(d)} del ${dataIt(d.data)}`);

export function oggettoEmail(d: DocumentoDaInviare, azienda: Pick<DatiAzienda, "denominazione">): string {
  return [maiuscola(riferimento(d)), d.produzione?.trim(), azienda.denominazione.trim()].filter(Boolean).join(" - ");
}

const CHIUSURA: Partial<Record<TipoDocumento, (d: DocumentoDaInviare) => string>> = {
  preventivo: (d) => `${d.validita_giorni ? `L'offerta è valida ${d.validita_giorni} giorni. ` : ""}Restiamo a disposizione per qualsiasi chiarimento.`,
  ordine: () => "Vi preghiamo di verificare i dati e di segnalarci eventuali differenze.",
  fattura: () => "Il documento allegato è una copia di cortesia: la fattura elettronica vi arriva tramite il Sistema di Interscambio.",
  nota_credito: () => "Il documento allegato è una copia di cortesia: l'originale vi arriva tramite il Sistema di Interscambio.",
};

export function testoEmail(d: DocumentoDaInviare, azienda: Pick<DatiAzienda, "denominazione" | "telefono" | "email">): string {
  const ordine = [d.ordine_cliente_tipo?.trim(), d.riferimento_esterno?.trim()].filter(Boolean).join(" ");
  const dettagli = [
    d.oggetto?.trim() ? `Oggetto: ${d.oggetto.trim()}` : "",
    d.produzione?.trim() ? `Produzione: ${d.produzione.trim()}` : "",
    ordine ? `Vostro ordine: ${ordine}` : "",
  ].filter(Boolean);
  const firma = [azienda.denominazione.trim(), [azienda.telefono.trim() ? `Tel. ${azienda.telefono.trim()}` : "", azienda.email.trim()].filter(Boolean).join(" - ")].filter(Boolean);
  return [
    "Buongiorno,",
    `in allegato ${NOME[d.tipo].articolo} ${riferimento(d)}.`,
    ...(dettagli.length ? ["", ...dettagli] : []),
    ...(CHIUSURA[d.tipo] ? ["", CHIUSURA[d.tipo]!(d)] : []),
    "", "Cordiali saluti", ...firma,
  ].join("\n");
}

/** Più indirizzi separati da virgola, punto e virgola o spazio. Restituisce quelli validi e quelli scartati. */
export function indirizzi(testo: string): { validi: string[]; scartati: string[] } {
  const validi: string[] = []; const scartati: string[] = [];
  for (const pezzo of testo.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pezzo) ? validi : scartati).push(pezzo);
  }
  return { validi: [...new Set(validi)], scartati };
}

/** Indirizzo «mailto:» che apre il programma di posta con tutto già compilato. */
export function collegamentoPosta(m: { a: string[]; cc?: string[]; oggetto: string; testo: string }): string {
  const parametri = [
    m.cc?.length ? `cc=${encodeURIComponent(m.cc.join(","))}` : "",
    `subject=${encodeURIComponent(m.oggetto)}`,
    `body=${encodeURIComponent(m.testo.replace(/\r?\n/g, "\r\n"))}`,
  ].filter(Boolean).join("&");
  return `mailto:${m.a.map(encodeURIComponent).join(",")}?${parametri}`;
}
