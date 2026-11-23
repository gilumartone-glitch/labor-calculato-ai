/**
 * Estratto conto di un cliente (o di un fornitore): i suoi documenti, quanto è stato saldato,
 * quanto resta e quanto è già scaduto. Si costruisce dalle scadenze: nessun dato a parte.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { numeroDocumento, type Intestatario, type TipoDocumento } from "./documenti";
import type { Scadenza, StatoScadenza, Verso } from "./scadenzario";
import { testoLatino, type DatiAzienda } from "./fattura-pa";
import { STILE_PDF, intestazioneAzienda, piePagina } from "./stampa-pdf";

const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type RataEstratto = { scadenza_id: string; numero_rata: number; data_scadenza: string; importo: number; pagato: number; residuo: number; stato: StatoScadenza; ultimo_pagamento: string | null };
export type DocumentoEstratto = {
  documento_id: string;
  tipo: TipoDocumento;
  numero: string;
  data: string;
  /** numero del documento del fornitore, per le fatture ricevute */
  riferimento: string | null;
  totale: number;
  pagato: number;
  residuo: number;
  scaduto: number;
  rate: RataEstratto[];
};
export type Estratto = {
  documenti: DocumentoEstratto[];
  totali: { totale: number; pagato: number; residuo: number; scaduto: number; aScadere: number };
};
export type FiltroEstratto = { verso: Verso; dal?: string | null; al?: string | null; soloAperte: boolean };

export type PartitaAnagrafica = { anagrafica_id: string; ragione_sociale: string; documenti: number; residuo: number; scaduto: number };

/** Chi ha partite con noi, con il saldo aperto e lo scaduto: prima chi deve di più. */
export function anagraficheConPartite(scadenze: Scadenza[], verso: Verso): PartitaAnagrafica[] {
  const per = new Map<string, PartitaAnagrafica & { doc: Set<string> }>();
  for (const s of scadenze) {
    if (s.verso !== verso || !s.anagrafica_id) continue;
    const p = per.get(s.anagrafica_id) ?? { anagrafica_id: s.anagrafica_id, ragione_sociale: s.ragione_sociale ?? "", documenti: 0, residuo: 0, scaduto: 0, doc: new Set<string>() };
    p.doc.add(s.documento_id);
    p.residuo += s.residuo;
    if (s.stato === "scaduta") p.scaduto += s.residuo;
    if (!p.ragione_sociale && s.ragione_sociale) p.ragione_sociale = s.ragione_sociale;
    per.set(s.anagrafica_id, p);
  }
  return [...per.values()]
    .map(({ doc, ...p }) => ({ ...p, documenti: doc.size, residuo: arrotonda2(p.residuo), scaduto: arrotonda2(p.scaduto) }))
    .sort((a, b) => b.residuo - a.residuo || a.ragione_sociale.localeCompare(b.ragione_sociale, "it"));
}

/** L'estratto conto di un'anagrafica. Le note di credito entrano con il segno meno. */
export function estrattoConto(scadenze: Scadenza[], anagraficaId: string, filtro: FiltroEstratto): Estratto {
  const per = new Map<string, DocumentoEstratto>();
  for (const s of scadenze) {
    if (s.anagrafica_id !== anagraficaId || s.verso !== filtro.verso) continue;
    if (filtro.dal && s.documento_data < filtro.dal) continue;
    if (filtro.al && s.documento_data > filtro.al) continue;
    const d = per.get(s.documento_id) ?? {
      documento_id: s.documento_id, tipo: s.documento_tipo,
      numero: numeroDocumento({ numero: s.documento_numero, anno: s.documento_anno, serie: s.documento_serie }),
      data: s.documento_data, riferimento: s.riferimento_esterno, totale: 0, pagato: 0, residuo: 0, scaduto: 0, rate: [],
    };
    d.totale += s.importo; d.pagato += s.pagato; d.residuo += s.residuo;
    if (s.stato === "scaduta") d.scaduto += s.residuo;
    d.rate.push({ scadenza_id: s.id, numero_rata: s.numero_rata, data_scadenza: s.data_scadenza, importo: s.importo, pagato: s.pagato, residuo: s.residuo, stato: s.stato, ultimo_pagamento: s.ultimo_pagamento });
    per.set(s.documento_id, d);
  }
  const documenti = [...per.values()]
    .map((d) => ({ ...d, totale: arrotonda2(d.totale), pagato: arrotonda2(d.pagato), residuo: arrotonda2(d.residuo), scaduto: arrotonda2(d.scaduto), rate: d.rate.sort((a, b) => a.numero_rata - b.numero_rata) }))
    .filter((d) => !filtro.soloAperte || d.residuo !== 0)
    .sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero, "it", { numeric: true }));
  const somma = (f: (d: DocumentoEstratto) => number) => arrotonda2(documenti.reduce((t, d) => t + f(d), 0));
  const residuo = somma((d) => d.residuo); const scaduto = somma((d) => d.scaduto);
  return { documenti, totali: { totale: somma((d) => d.totale), pagato: somma((d) => d.pagato), residuo, scaduto, aScadere: arrotonda2(residuo - scaduto) } };
}

const NOME_TIPO: Partial<Record<TipoDocumento, string>> = { fattura: "Fattura", nota_credito: "Nota di credito", fattura_fornitore: "Fattura" };
export const nomeDocumentoEstratto = (d: Pick<DocumentoEstratto, "tipo" | "numero" | "riferimento">): string =>
  d.tipo === "fattura_fornitore" ? `Fattura ${d.riferimento || d.numero}` : `${NOME_TIPO[d.tipo] ?? d.tipo} n. ${d.numero}`;
export const STATO_ESTRATTO: Record<StatoScadenza, string> = { saldata: "Saldata", scaduta: "Scaduta", parziale: "Saldata in parte", aperta: "Da saldare" };
/** Come si legge lo stato di una rata: una nota di credito aperta è un credito del cliente, non un debito. */
export const statoRata = (r: Pick<RataEstratto, "stato" | "residuo">): string => (r.residuo < 0 ? "A credito" : STATO_ESTRATTO[r.stato]);

/* ------------------------------------------------------------------ */
/* PDF da mandare al cliente                                           */
/* ------------------------------------------------------------------ */
const dataIt = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const SEMPRE = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;
const euro = (n: number) => `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, ...SEMPRE })} €`;

export const nomeFileEstratto = (ragioneSociale: string, al: string): string =>
  `Estratto-conto_${testoLatino(ragioneSociale, 60).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente"}_${al}.pdf`;

export function creaPdfEstrattoConto(
  azienda: DatiAzienda, controparte: Intestatario, estratto: Estratto,
  opzioni: FiltroEstratto & { alGiorno: string }, logo?: string | null,
): jsPDF {
  const { INCHIOSTRO, GRIGIO, FONDO, MARGINE, LARGHEZZA } = STILE_PDF;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const stile = (peso: "normal" | "bold", corpo: number, colore: [number, number, number] = INCHIOSTRO) => { doc.setFont("helvetica", peso); doc.setFontSize(corpo); doc.setTextColor(...colore); };
  const t = (s: string | null | undefined, max = 300) => testoLatino(s, max);
  const cliente = opzioni.verso === "incasso";
  let y = intestazioneAzienda(doc, azienda, logo);

  doc.setFillColor(...INCHIOSTRO);
  doc.rect(MARGINE, y, LARGHEZZA, 9, "F");
  stile("bold", 11.5, [255, 255, 255]);
  doc.text(`ESTRATTO CONTO al ${dataIt(opzioni.alGiorno)}`, MARGINE + 3, y + 6.1);
  y += 13;

  stile("normal", 7.5, GRIGIO); doc.text(cliente ? "SPETT.LE" : "FORNITORE", MARGINE, y);
  const xDx = MARGINE + LARGHEZZA / 2 + 3;
  doc.text("CONTENUTO", xDx, y);
  let ySx = y + 5; let yDx = y + 5;
  stile("bold", 10.5);
  for (const r of doc.splitTextToSize(t(controparte.ragione_sociale, 120) || "—", LARGHEZZA / 2 - 3)) { doc.text(r, MARGINE, ySx); ySx += 4.8; }
  stile("normal", 9);
  [
    t(controparte.indirizzo),
    [controparte.cap ?? "", t(controparte.citta), controparte.provincia ? `(${controparte.provincia})` : ""].filter(Boolean).join(" "),
    [controparte.partita_iva ? `P.IVA ${controparte.partita_iva}` : "", controparte.codice_fiscale && controparte.codice_fiscale !== controparte.partita_iva ? `C.F. ${controparte.codice_fiscale}` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean).forEach((r) => { doc.text(r, MARGINE, ySx); ySx += 4.3; });
  [
    opzioni.soloAperte ? "Solo i documenti ancora da saldare" : "Tutti i documenti, saldati e da saldare",
    opzioni.dal || opzioni.al ? `Documenti ${opzioni.dal ? `dal ${dataIt(opzioni.dal)} ` : ""}${opzioni.al ? `al ${dataIt(opzioni.al)}` : ""}`.trim() : "Senza limiti di data",
    `${estratto.documenti.length} ${estratto.documenti.length === 1 ? "documento" : "documenti"}`,
  ].forEach((r) => { doc.text(r, xDx, yDx); yDx += 4.3; });
  y = Math.max(ySx, yDx) + 4;

  const corpo: string[][] = [];
  const stati: (StatoScadenza | null)[] = [];
  for (const d of estratto.documenti) {
    d.rate.forEach((r, i) => {
      corpo.push([
        i === 0 ? nomeDocumentoEstratto(d) : "", i === 0 ? dataIt(d.data) : "",
        dataIt(r.data_scadenza), euro(r.importo), r.pagato !== 0 ? euro(r.pagato) : "", r.residuo !== 0 ? euro(r.residuo) : "",
        statoRata(r) + (r.stato === "saldata" && r.ultimo_pagamento ? ` il ${dataIt(r.ultimo_pagamento)}` : ""),
      ]);
      stati.push(r.stato);
    });
  }
  autoTable(doc, {
    startY: y,
    margin: { left: MARGINE, right: MARGINE, bottom: 18 },
    head: [["Documento", "Data", "Scadenza", "Importo", cliente ? "Incassato" : "Pagato", "Da saldare", "Stato"]],
    body: corpo.length > 0 ? corpo : [["Nessun documento", "", "", "", "", "", ""]],
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: INCHIOSTRO, cellPadding: { top: 1.7, bottom: 1.7, left: 1.5, right: 1.5 }, lineColor: [205, 212, 214], lineWidth: { bottom: 0.15 } },
    headStyles: { fillColor: FONDO, fontStyle: "bold", fontSize: 8 },
    columnStyles: { 1: { cellWidth: 20 }, 2: { cellWidth: 20 }, 3: { halign: "right", cellWidth: 25 }, 4: { halign: "right", cellWidth: 25 }, 5: { halign: "right", cellWidth: 25 }, 6: { cellWidth: 34 } },
    didParseCell: (c) => {
      if (c.section === "head" && c.column.index >= 3 && c.column.index <= 5) c.cell.styles.halign = "right";
      if (c.section !== "body") return;
      const stato = stati[c.row.index];
      if (c.column.index === 0) c.cell.styles.fontStyle = "bold";
      if (stato === "scaduta" && c.column.index >= 5 && c.cell.raw !== "A credito") { c.cell.styles.fontStyle = "bold"; c.cell.styles.textColor = [176, 32, 32]; }
      if (stato === "saldata") c.cell.styles.textColor = c.column.index === 0 ? INCHIOSTRO : GRIGIO;
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const voci: [string, string, boolean][] = [
    ["Totale documenti", euro(estratto.totali.totale), false],
    [cliente ? "Già incassato" : "Già pagato", euro(estratto.totali.pagato), false],
    ["DA SALDARE", euro(estratto.totali.residuo), true],
    ["di cui già scaduto", euro(estratto.totali.scaduto), estratto.totali.scaduto !== 0],
    ["di cui non ancora scaduto", euro(estratto.totali.aScadere), false],
  ];
  if (y + voci.length * 5.4 + 30 > 297 - 16) { doc.addPage(); y = MARGINE; }
  const xTot = MARGINE + LARGHEZZA - 84;
  doc.setFillColor(...FONDO);
  doc.rect(xTot, y, 84, voci.length * 5.4 + 4, "F");
  let yv = y + 5.6;
  for (const [nome, valore, forte] of voci) {
    stile(forte ? "bold" : "normal", forte ? 10 : 9);
    doc.text(nome, xTot + 3, yv); doc.text(valore, xTot + 81, yv, { align: "right" });
    yv += 5.4;
  }
  if (cliente) {
    let yp = y + 3;
    const larg = LARGHEZZA - 84 - 6;
    if (azienda.iban.trim()) {
      stile("normal", 7.5, GRIGIO); doc.text("PER IL PAGAMENTO", MARGINE, yp); yp += 4.8;
      stile("normal", 9);
      for (const r of doc.splitTextToSize(`IBAN ${azienda.iban.trim()}${azienda.banca.trim() ? ` - ${t(azienda.banca)}` : ""}`, larg)) { doc.text(r, MARGINE, yp); yp += 4.4; }
      for (const r of doc.splitTextToSize(`Intestato a ${t(azienda.denominazione, 80)}`, larg)) { doc.text(r, MARGINE, yp); yp += 4.4; }
      yp += 1.5;
    }
    stile("normal", 8, GRIGIO);
    for (const r of doc.splitTextToSize(`Situazione aggiornata al ${dataIt(opzioni.alGiorno)}. Se nel frattempo avete già provveduto al pagamento, non tenete conto di questa comunicazione.`, larg)) { doc.text(r, MARGINE, yp); yp += 3.9; }
  }

  piePagina(doc, t(azienda.denominazione, 80), `Estratto conto ${t(controparte.ragione_sociale, 40)}`);
  return doc;
}
