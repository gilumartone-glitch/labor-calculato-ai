/**
 * Stampa PDF dei documenti del Gestionale: preventivo, conferma d'ordine / proforma, DDT,
 * fattura (copia di cortesia), nota di credito, bolla di carico.
 * Una sola impaginazione per tutti: cambiano il titolo, le colonne e i riquadri in fondo.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  calcolaTotali, importoRiga, numeroDocumento, testoPercorso,
  type AliquotaIva, type Intestatario, type PassoPercorso, type RigaBozza, type TipoDocumento,
} from "./documenti";
import { anteprimaScadenze, type CondizionePagamento } from "./scadenzario";
import { testoLatino, type DatiAzienda, type EsigibilitaIva } from "./fattura-pa";
import { conDisegno, leggiSchede } from "./scheda-tecnica";
import { sezioneSchede } from "./scheda-pdf";

export type DatiStampa = {
  tipo: TipoDocumento;
  numero: number | null;
  anno: number | null;
  serie: string;
  data: string;
  accompagnatoria: boolean;
  cliente: Intestatario;
  oggetto: string | null;
  produzione: string | null;
  ordine_cliente_tipo: string | null;
  riferimento_esterno: string | null;
  data_esterna: string | null;
  cig: string | null;
  cup: string | null;
  pagamento: string | null;
  validita_giorni: number | null;
  consegna_prevista: string | null;
  destinazione: string | null;
  causale_trasporto: string | null;
  aspetto_beni: string | null;
  colli: number | null;
  peso_kg: number | null;
  vettore: string | null;
  porto: string | null;
  note: string | null;
  esigibilita_iva: EsigibilitaIva;
  bollo_virtuale: boolean;
  righe: RigaBozza[];
  aliquote: AliquotaIva[];
  condizione: Pick<CondizionePagamento, "descrizione" | "rate" | "fine_mese" | "modalita"> | null;
  percorso: PassoPercorso[];
};

const TITOLO: Record<TipoDocumento, string> = {
  preventivo: "PREVENTIVO",
  ordine: "CONFERMA D'ORDINE / FATTURA PROFORMA",
  ddt: "DOCUMENTO DI TRASPORTO",
  fattura: "FATTURA",
  nota_credito: "NOTA DI CREDITO",
  bolla_carico: "BOLLA DI CARICO",
  fattura_fornitore: "FATTURA FORNITORE",
};
const NOME_FILE: Record<TipoDocumento, string> = {
  preventivo: "Preventivo", ordine: "Conferma-ordine", ddt: "DDT", fattura: "Fattura", nota_credito: "Nota-di-credito",
  bolla_carico: "Bolla-di-carico", fattura_fornitore: "Fattura-fornitore",
};

const INCHIOSTRO: [number, number, number] = [18, 46, 54];
const GRIGIO: [number, number, number] = [110, 120, 124];
const FONDO: [number, number, number] = [238, 242, 243];
const MARGINE = 14;
const LARGHEZZA = 210 - MARGINE * 2;

const dataIt = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
// "always": il punto delle migliaia anche a quattro cifre (1.035,00), che in italiano di norma si omette
const SEMPRE = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;
const euro = (n: number) => `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, ...SEMPRE })} €`;
const quantita = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 3 });
const prezzo = (n: number) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4, ...SEMPRE });
/** I caratteri standard del PDF non hanno virgolette tipografiche, lineette lunghe, emoji: si traducono. */
const t = (s: string | null | undefined, max = 2000) => testoLatino(s, max);
const righeDiTesto = (s: string | null | undefined): string[] => (s ?? "").split(/\r?\n/).map((r) => t(r)).filter((r, i, a) => r !== "" || (i > 0 && i < a.length - 1));

/** Titolo completo: «FATTURA ACCOMPAGNATORIA n. 12/2027 del 15/01/2027». */
export function titoloStampa(d: Pick<DatiStampa, "tipo" | "numero" | "anno" | "serie" | "data" | "accompagnatoria">): string {
  const nome = d.tipo === "fattura" && d.accompagnatoria ? "FATTURA ACCOMPAGNATORIA" : TITOLO[d.tipo];
  return d.numero == null ? `${nome} - BOZZA del ${dataIt(d.data)}` : `${nome} n. ${numeroDocumento(d)} del ${dataIt(d.data)}`;
}

/** Nome del file: «Preventivo_45-2026_Teatro-Prova-srl.pdf». */
export function nomeFilePdf(d: Pick<DatiStampa, "tipo" | "numero" | "anno" | "serie" | "cliente">): string {
  const numero = d.numero == null ? "bozza" : numeroDocumento(d).replace(/\//g, "-");
  const cliente = t(d.cliente.ragione_sociale, 60).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [NOME_FILE[d.tipo], numero, cliente].filter(Boolean).join("_") + ".pdf";
}

/** I riferimenti stampati su ogni documento: gli stessi dati che vanno in fattura elettronica. */
export function riferimentiStampa(d: DatiStampa): [string, string][] {
  const ordine = [t(d.ordine_cliente_tipo), t(d.riferimento_esterno)].filter(Boolean).join(" ");
  const passivo = d.tipo === "bolla_carico" || d.tipo === "fattura_fornitore";
  const voci: [string, string][] = [
    [passivo ? "Documento fornitore" : "Ordine cliente", ordine ? `${ordine}${d.data_esterna ? ` del ${dataIt(d.data_esterna)}` : ""}` : ""],
    ["Produzione", t(d.produzione)],
    ["CIG", t(d.cig)],
    ["CUP", t(d.cup)],
    ["Riferimenti", testoPercorso(d.percorso)],
    ["Pagamento", d.tipo === "ddt" || d.tipo === "bolla_carico" ? "" : t(d.condizione?.descrizione ?? d.pagamento)],
    ["Validità offerta", d.tipo === "preventivo" && d.validita_giorni ? `${d.validita_giorni} giorni` : ""],
    ["Consegna prevista", d.tipo === "ordine" ? dataIt(d.consegna_prevista) : ""],
  ];
  return voci.filter(([, v]) => v !== "");
}

const senzaPrezzi = (tipo: TipoDocumento) => tipo === "ddt" || tipo === "bolla_carico";
const conTrasporto = (d: Pick<DatiStampa, "tipo" | "accompagnatoria">) => d.tipo === "ddt" || (d.tipo === "fattura" && d.accompagnatoria);

/** Logo e dati dell'azienda in testa alla pagina. Restituisce la quota da cui proseguire. */
export function intestazioneAzienda(doc: jsPDF, azienda: DatiAzienda, logo?: string | null): number {
  let y = MARGINE;
  const stile = (peso: "normal" | "bold", corpo: number, colore: [number, number, number] = INCHIOSTRO) => {
    doc.setFont("helvetica", peso); doc.setFontSize(corpo); doc.setTextColor(...colore);
  };
  let xAzienda = MARGINE;
  if (logo) {
    try { doc.addImage(logo, "PNG", MARGINE, y, 24, 24); xAzienda = MARGINE + 29; } catch { /* senza logo */ }
  }
  stile("bold", 14);
  doc.text(t(azienda.denominazione, 80) || "Dati azienda da compilare", xAzienda, y + 6);
  stile("normal", 8.5, GRIGIO);
  const sede = [t(azienda.indirizzo), [azienda.cap.trim(), t(azienda.comune), azienda.provincia.trim() ? `(${azienda.provincia.trim().toUpperCase()})` : ""].filter(Boolean).join(" ")].filter(Boolean).join(" - ");
  const fiscale = [
    azienda.partita_iva.trim() ? `P.IVA ${azienda.partita_iva.trim()}` : "",
    azienda.codice_fiscale.trim() && azienda.codice_fiscale.trim() !== azienda.partita_iva.trim() ? `C.F. ${azienda.codice_fiscale.trim()}` : "",
    azienda.rea_numero.trim() ? `REA ${azienda.rea_ufficio.trim().toUpperCase()}-${azienda.rea_numero.trim()}` : "",
    azienda.capitale_sociale.trim() ? `Cap. soc. ${azienda.capitale_sociale.trim()} €` : "",
  ].filter(Boolean).join(" · ");
  const contatti = [azienda.telefono.trim() ? `Tel. ${azienda.telefono.trim()}` : "", azienda.email.trim()].filter(Boolean).join(" · ");
  [sede, fiscale, contatti].filter(Boolean).forEach((riga, i) => doc.text(riga, xAzienda, y + 11.5 + i * 4.2));
  y += 28;

  return y;
}

/** Riga e numero di pagina in fondo a ogni pagina. */
export function piePagina(doc: jsPDF, sinistra: string, destra: string): void {
  const pagine = doc.getNumberOfPages();
  for (let p = 1; p <= pagine; p++) {
    doc.setPage(p);
    doc.setDrawColor(...INCHIOSTRO); doc.setLineWidth(0.3);
    doc.line(MARGINE, 297 - 12, MARGINE + LARGHEZZA, 297 - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIGIO);
    doc.text(sinistra, MARGINE, 297 - 8);
    doc.text(`${destra} · pag. ${p} di ${pagine}`, MARGINE + LARGHEZZA, 297 - 8, { align: "right" });
  }
}

export const STILE_PDF = { INCHIOSTRO, GRIGIO, FONDO, MARGINE, LARGHEZZA };

export function creaPdfDocumento(azienda: DatiAzienda, d: DatiStampa, logo?: string | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const fondoPagina = 297 - 16;
  let y = MARGINE;
  const spazio = (serve: number) => { if (y + serve > fondoPagina) { doc.addPage(); y = MARGINE; } };
  const stile = (peso: "normal" | "bold", corpo: number, colore: [number, number, number] = INCHIOSTRO) => {
    doc.setFont("helvetica", peso); doc.setFontSize(corpo); doc.setTextColor(...colore);
  };

  y = intestazioneAzienda(doc, azienda, logo);

  /* ---- Titolo ---- */
  doc.setFillColor(...INCHIOSTRO);
  doc.rect(MARGINE, y, LARGHEZZA, 9, "F");
  stile("bold", 11.5, [255, 255, 255]);
  doc.text(titoloStampa(d), MARGINE + 3, y + 6.1);
  y += 13;

  /* ---- Cliente e riferimenti, affiancati ---- */
  const c = d.cliente;
  const passivo = d.tipo === "bolla_carico" || d.tipo === "fattura_fornitore";
  const colSx = MARGINE; const colDx = MARGINE + LARGHEZZA / 2 + 3; const largCol = LARGHEZZA / 2 - 3;
  const yBlocchi = y;
  stile("normal", 7.5, GRIGIO);
  doc.text(passivo ? "FORNITORE" : "SPETT.LE", colSx, y);
  let ySx = y + 5;
  stile("bold", 10.5);
  for (const riga of doc.splitTextToSize(t(c.ragione_sociale, 120) || "—", largCol)) { doc.text(riga, colSx, ySx); ySx += 4.8; }
  stile("normal", 9);
  const cliente = [
    t(c.indirizzo),
    [c.cap ?? "", t(c.citta), c.provincia ? `(${c.provincia})` : "", c.nazione && c.nazione !== "IT" ? c.nazione : ""].filter(Boolean).join(" "),
    [c.partita_iva ? `P.IVA ${c.partita_iva}` : "", c.codice_fiscale && c.codice_fiscale !== c.partita_iva ? `C.F. ${c.codice_fiscale}` : ""].filter(Boolean).join(" · "),
    [c.codice_sdi ? `Cod. destinatario ${c.codice_sdi}` : "", c.pec ? `PEC ${c.pec}` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean);
  for (const voce of cliente) for (const riga of doc.splitTextToSize(voce, largCol)) { doc.text(riga, colSx, ySx); ySx += 4.3; }
  if (t(d.destinazione)) {
    ySx += 2;
    stile("normal", 7.5, GRIGIO); doc.text("DESTINAZIONE DELLA MERCE", colSx, ySx); ySx += 4.3;
    stile("normal", 9);
    for (const voce of righeDiTesto(d.destinazione)) for (const riga of doc.splitTextToSize(voce, largCol)) { doc.text(riga, colSx, ySx); ySx += 4.3; }
  }

  let yDx = yBlocchi;
  const riferimenti = riferimentiStampa(d);
  if (riferimenti.length > 0) {
    stile("normal", 7.5, GRIGIO);
    doc.text("RIFERIMENTI", colDx, yDx);
    yDx += 5;
    for (const [nome, valore] of riferimenti) {
      stile("normal", 8.5, GRIGIO); doc.text(nome, colDx, yDx);
      stile("normal", 9);
      const righe = doc.splitTextToSize(valore, largCol - 31);
      for (const riga of righe) { doc.text(riga, colDx + 31, yDx); yDx += 4.3; }
    }
  }
  y = Math.max(ySx, yDx) + 3;

  if (t(d.oggetto)) {
    stile("normal", 7.5, GRIGIO); doc.text("OGGETTO", MARGINE, y); y += 4.6;
    stile("bold", 10);
    for (const riga of doc.splitTextToSize(t(d.oggetto), LARGHEZZA)) { doc.text(riga, MARGINE, y); y += 4.8; }
    y += 2;
  }

  /* ---- Righe ---- */
  const soloQuantita = senzaPrezzi(d.tipo);
  const sconti = d.righe.some((r) => r.tipo_riga !== "nota" && r.sconto_pct > 0);
  const codici = d.righe.some((r) => t(r.codice));
  const ivaDi = (r: RigaBozza) => {
    const a = d.aliquote.find((x) => x.id === r.aliquota_id);
    return a ? (a.percentuale === 0 ? a.codice : `${quantita(a.percentuale)}%`) : "";
  };
  const offerta = d.tipo === "preventivo" || d.tipo === "ordine";
  const testa = [
    ...(codici ? ["Codice"] : []), "Descrizione", "UM", "Q.tà",
    // nelle offerte si dice sempre che prezzi e importi sono senza IVA
    ...(soloQuantita ? [] : [offerta ? "Prezzo\n+ IVA" : "Prezzo", ...(sconti ? ["Sc. %"] : []), offerta ? "Importo\n+ IVA" : "Importo", "IVA"]),
  ];
  const corpo = d.righe.map((r) => {
    const nota = r.tipo_riga === "nota";
    const descrizione = [t(r.descrizione), ...righeDiTesto(r.dettagli).map((x) => `   ${x}`)].filter(Boolean).join("\n");
    return [
      ...(codici ? [nota ? "" : t(r.codice, 20)] : []),
      descrizione,
      nota ? "" : t(r.um, 6),
      nota ? "" : quantita(r.quantita),
      ...(soloQuantita ? [] : [
        nota ? "" : prezzo(r.prezzo_unitario),
        ...(sconti ? [nota || r.sconto_pct === 0 ? "" : quantita(r.sconto_pct)] : []),
        nota ? "" : euro(importoRiga(r)),
        nota ? "" : ivaDi(r),
      ]),
    ];
  });
  const iDescr = codici ? 1 : 0;
  const colonne: Record<number, { halign?: "right" | "center"; cellWidth?: number }> = {};
  if (codici) colonne[0] = { cellWidth: 23 };
  colonne[iDescr + 1] = { halign: "center", cellWidth: 10 };
  colonne[iDescr + 2] = { halign: "right", cellWidth: 15 };
  if (!soloQuantita) {
    let i = iDescr + 3;
    colonne[i++] = { halign: "right", cellWidth: 19 };
    if (sconti) colonne[i++] = { halign: "right", cellWidth: 11 };
    colonne[i++] = { halign: "right", cellWidth: 24 };
    colonne[i++] = { halign: "center", cellWidth: 11 };
  }
  autoTable(doc, {
    startY: y,
    margin: { left: MARGINE, right: MARGINE, bottom: 18 },
    head: [testa],
    body: corpo.length > 0 ? corpo : [testa.map((_, i) => (i === iDescr ? "Nessuna riga" : ""))],
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: INCHIOSTRO, cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 }, lineColor: [205, 212, 214], lineWidth: { bottom: 0.15 }, valign: "top" },
    headStyles: { fillColor: FONDO, fontStyle: "bold", fontSize: 8, textColor: INCHIOSTRO, lineWidth: 0 },
    columnStyles: colonne,
    didParseCell: (cella) => {
      if (cella.section === "head") cella.cell.styles.halign = colonne[cella.column.index]?.halign ?? "left";
      // le note descrittive si riconoscono dal corsivo
      if (cella.section === "body" && d.righe[cella.row.index]?.tipo_riga === "nota") cella.cell.styles.fontStyle = "italic";
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  /* ---- Totali e scadenze ---- */
  if (!soloQuantita) {
    const tot = calcolaTotali(d.righe, d.aliquote);
    const basi = new Map<string, number>();
    for (const r of d.righe) if (r.aliquota_id && r.tipo_riga !== "nota") basi.set(r.aliquota_id, (basi.get(r.aliquota_id) ?? 0) + importoRiga(r));
    const split = d.esigibilita_iva === "S" && (d.tipo === "fattura" || d.tipo === "nota_credito" || d.tipo === "ordine" || d.tipo === "preventivo");
    const bollo = d.bollo_virtuale && (d.tipo === "fattura" || d.tipo === "nota_credito");
    const daPagare = split ? tot.imponibile : tot.totale;
    const voci: [string, string, boolean][] = [[offerta ? "Imponibile (IVA esclusa)" : "Imponibile", euro(tot.imponibile), false]];
    for (const [id, base] of basi) {
      const a = d.aliquote.find((x) => x.id === id);
      if (!a) continue;
      voci.push([a.percentuale === 0 ? t(a.descrizione, 60) : `IVA ${quantita(a.percentuale)}% su ${euro(base)}`, euro(Math.round(base * a.percentuale) / 100), false]);
    }
    // righe senza aliquota in un'offerta: l'IVA va comunque dichiarata, anche se non si può calcolare
    const senzaAliquota = d.righe.filter((r) => r.tipo_riga !== "nota" && !r.aliquota_id).reduce((s, r) => s + importoRiga(r), 0);
    if (offerta && Math.abs(senzaAliquota) >= 0.005) voci.push([`+ IVA di legge su ${euro(senzaAliquota)}`, "da aggiungere", false]);
    voci.push([d.tipo === "nota_credito" ? "TOTALE NOTA DI CREDITO" : !offerta ? "TOTALE DOCUMENTO" : Math.abs(senzaAliquota) >= 0.005 ? "TOTALE" : "TOTALE IVA COMPRESA", offerta && Math.abs(senzaAliquota) >= 0.005 ? `${euro(tot.totale)} + IVA` : euro(tot.totale), true]);
    if (split) voci.push(["NETTO A PAGARE", euro(daPagare), true]);

    const xTot = MARGINE + LARGHEZZA - 84;
    const altezzaTot = voci.length * 5.4 + 4;
    const mostraScadenze = (d.tipo === "fattura" || d.tipo === "ordine") && daPagare > 0;
    const rate = mostraScadenze ? anteprimaScadenze(daPagare, d.data, d.condizione) : [];
    spazio(Math.max(altezzaTot, rate.length * 4.4 + 16) + 4);
    const yTot = y;
    doc.setFillColor(...FONDO);
    doc.rect(xTot, y, 84, altezzaTot, "F");
    let yv = y + 5.6;
    for (const [nome, valore, forte] of voci) {
      stile(forte ? "bold" : "normal", forte ? 10 : 9);
      for (const riga of doc.splitTextToSize(nome, 52).slice(0, 1)) doc.text(riga, xTot + 3, yv);
      doc.text(valore, xTot + 81, yv, { align: "right" });
      yv += 5.4;
    }

    let yp = yTot + 3;
    const largPag = LARGHEZZA - 84 - 6;
    if (mostraScadenze) {
      stile("normal", 7.5, GRIGIO); doc.text("SCADENZE DI PAGAMENTO", MARGINE, yp); yp += 4.8;
      stile("normal", 9);
      for (const r of rate) { doc.text(`${dataIt(r.data)}`, MARGINE, yp); doc.text(euro(r.importo), MARGINE + 48, yp, { align: "right" }); yp += 4.4; }
      if (azienda.iban.trim()) {
        yp += 1;
        for (const riga of doc.splitTextToSize(`IBAN ${azienda.iban.trim()}${azienda.banca.trim() ? ` - ${t(azienda.banca)}` : ""}`, largPag)) { doc.text(riga, MARGINE, yp); yp += 4.4; }
      }
    }
    const avvisi = [
      split ? "Operazione con scissione dei pagamenti, art. 17-ter DPR 633/72: l'IVA è versata dal cliente." : "",
      bollo ? "Imposta di bollo assolta in modo virtuale (2,00 €)." : "",
    ].filter(Boolean);
    stile("normal", 8, GRIGIO);
    for (const a of avvisi) for (const riga of doc.splitTextToSize(a, largPag)) { doc.text(riga, MARGINE, yp + 1); yp += 3.9; }
    y = Math.max(yTot + altezzaTot, yp) + 6;
  }

  /* ---- Trasporto (DDT e fattura accompagnatoria) ---- */
  if (conTrasporto(d)) {
    spazio(46);
    const celle: [string, string][] = [
      ["Causale del trasporto", t(d.causale_trasporto)], ["Aspetto dei beni", t(d.aspetto_beni)],
      ["N. colli", d.colli != null ? String(d.colli) : ""], ["Peso (kg)", d.peso_kg != null ? quantita(d.peso_kg) : ""],
      ["Porto", t(d.porto)], ["Trasporto a cura di / Vettore", t(d.vettore)],
    ];
    const largCella = LARGHEZZA / 3;
    doc.setDrawColor(190, 198, 200); doc.setLineWidth(0.2);
    celle.forEach(([nome, valore], i) => {
      const x = MARGINE + (i % 3) * largCella; const yy = y + Math.floor(i / 3) * 12;
      doc.rect(x, yy, largCella, 12);
      stile("normal", 7, GRIGIO); doc.text(nome.toUpperCase(), x + 1.5, yy + 3.6);
      stile("normal", 9.5); doc.text(doc.splitTextToSize(valore, largCella - 3)[0] ?? "", x + 1.5, yy + 9);
    });
    y += 24;
    ["Data e ora del ritiro", "Firma del conducente", "Firma del destinatario"].forEach((nome, i) => {
      const x = MARGINE + i * largCella;
      doc.rect(x, y, largCella, 16);
      stile("normal", 7, GRIGIO); doc.text(nome.toUpperCase(), x + 1.5, y + 3.6);
    });
    y += 21;
  }

  /* ---- Note ---- */
  const note = righeDiTesto(d.note);
  if (note.length > 0) {
    spazio(12);
    stile("normal", 7.5, GRIGIO); doc.text("NOTE", MARGINE, y); y += 4.6;
    stile("normal", 9);
    for (const voce of note) for (const riga of doc.splitTextToSize(voce || " ", LARGHEZZA)) { spazio(5); doc.text(riga, MARGINE, y); y += 4.3; }
  }

  /* ---- Disegni e lavorazioni dei pezzi (non in fattura e nota di credito: lì le lavorazioni sono nel dettaglio delle righe) ---- */
  if (conDisegno(d.tipo)) {
    y = sezioneSchede(doc, d.righe.map((r) => ({ riga: t(r.descrizione, 60), schede: leggiSchede(r.schede_tecniche) })), y, { margine: MARGINE, larghezza: LARGHEZZA, fondoPagina });
  }

  /* ---- Piè di pagina su ogni pagina ---- */
  const avvertenza: Partial<Record<TipoDocumento, string>> = {
    ordine: "Documento non valido ai fini fiscali.",
    fattura: "Copia di cortesia: l'originale è la fattura elettronica trasmessa al Sistema di Interscambio.",
    nota_credito: "Copia di cortesia: l'originale è il documento elettronico trasmesso al Sistema di Interscambio.",
  };
  const pagine = doc.getNumberOfPages();
  for (let p = 1; p <= pagine; p++) {
    doc.setPage(p);
    doc.setDrawColor(...INCHIOSTRO); doc.setLineWidth(0.3);
    doc.line(MARGINE, 297 - 12, MARGINE + LARGHEZZA, 297 - 12);
    stile("normal", 7.5, GRIGIO);
    doc.text(avvertenza[d.tipo] ?? t(azienda.denominazione, 80), MARGINE, 297 - 8);
    doc.text(`${titoloStampa(d).split(" del ")[0]} · pag. ${p} di ${pagine}`, MARGINE + LARGHEZZA, 297 - 8, { align: "right" });
  }
  return doc;
}
