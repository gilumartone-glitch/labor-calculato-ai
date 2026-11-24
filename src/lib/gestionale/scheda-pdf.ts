/**
 * Disegno tecnico e lavorazioni di un pezzo nel PDF dei documenti: lo stesso disegno di Progettazione
 * (sagoma in proporzione, quote di base e altezza, lati lavorati evidenziati con il colore della lavorazione),
 * tracciato in vettoriale.
 */
import type jsPDF from "jspdf";
import type { PerimeterSide } from "@/components/calculator/types";
import { testoLatino } from "./fattura-pa";
import { areaPerimetro, caratteristicheScheda, coloreRgb, misureScheda, testoLavorazione, type SchedaTecnica } from "./scheda-tecnica";

type Rgb = [number, number, number];
const INCHIOSTRO: Rgb = [18, 46, 54];
const GRIGIO: Rgb = [110, 120, 124];
const CHIARO: Rgb = [205, 212, 214];
const numero = (n: number) => (Number.isFinite(n) ? n.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "-");
const t = (s: string | null | undefined, max = 300) => testoLatino(s, max);

/** Freccia piena con la punta in (x, y), rivolta nella direzione (dx, dy) unitaria. */
function punta(doc: jsPDF, x: number, y: number, dx: number, dy: number): void {
  const l = 1.7; const m = 0.55;
  doc.triangle(x, y, x - dx * l - dy * m, y - dy * l + dx * m, x - dx * l + dy * m, y - dy * l - dx * m, "F");
}

/** Il disegno dentro il riquadro (x, y, larghezza, altezza), in millimetri. */
export function disegnaPezzo(doc: jsPDF, s: SchedaTecnica, x: number, y: number, larghezza: number, altezza: number): void {
  const piede = 5;
  doc.setDrawColor(...CHIARO); doc.setLineWidth(0.2); doc.setFillColor(250, 251, 251);
  doc.rect(x, y, larghezza, altezza, "FD");
  doc.line(x, y + altezza - piede, x + larghezza, y + altezza - piede);
  const { area, perimetro } = areaPerimetro(s);
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...GRIGIO);
  doc.text(`AREA ${numero(area)} m2`, x + 2, y + altezza - 1.6);
  doc.text(`PERIMETRO ${numero(perimetro)} m`, x + larghezza - 2, y + altezza - 1.6, { align: "right" });

  if (!(s.larghezza > 0) || !(s.altezza > 0)) {
    doc.text("misure non indicate", x + larghezza / 2, y + (altezza - piede) / 2, { align: "center" });
    return;
  }
  // spazio per le quote (sotto e a destra) e per i lati lavorati
  const padSx = 9; const padDx = 15; const padSu = 8; const padGiu = 13;
  const dentroW = larghezza - padSx - padDx; const dentroH = altezza - piede - padSu - padGiu;
  const rapporto = s.larghezza / s.altezza;
  let w = dentroW; let h = w / rapporto;
  if (h > dentroH) { h = dentroH; w = h * rapporto; }
  w = Math.max(w, 3); h = Math.max(h, 3);
  const px = x + padSx + (dentroW - w) / 2; const py = y + padSu + (dentroH - h) / 2;

  // diagonali di riferimento
  doc.setDrawColor(...CHIARO); doc.setLineWidth(0.15); doc.setLineDashPattern([0.8, 1.1], 0);
  doc.line(px, py, px + w, py + h); doc.line(px + w, py, px, py + h);
  doc.setLineDashPattern([], 0);

  // sagoma
  doc.setDrawColor(...INCHIOSTRO); doc.setLineWidth(0.45); doc.setFillColor(243, 246, 246);
  if (s.forma === "triangle") doc.triangle(px + w / 2, py, px + w, py + h, px, py + h, "FD");
  else if (s.forma === "trapezoid") {
    const minore = w * (s.baseMinore && s.larghezza > 0 ? Math.min(1, s.baseMinore / s.larghezza) : 0.6);
    const rientro = (w - minore) / 2;
    doc.lines([[w, 0], [-rientro, h], [-minore, 0]], px, py, [1, 1], "FD", true);
  } else doc.rect(px, py, w, h, "FD");

  // lati lavorati: un tratto colorato per lavorazione, affiancati verso l'esterno
  const perLato: Record<PerimeterSide, { nome: string; colore: Rgb }[]> = { top: [], bottom: [], left: [], right: [] };
  for (const l of s.lavorazioni) for (const lato of l.lati) perLato[lato].push({ nome: l.nome, colore: coloreRgb(l.colore) });
  const SPESSORE = 0.9; const PASSO = 1.3;
  doc.setLineCap("butt");
  (Object.keys(perLato) as PerimeterSide[]).forEach((lato) => {
    perLato[lato].forEach((v, i) => {
      const o = i * PASSO;
      doc.setDrawColor(...v.colore); doc.setLineWidth(SPESSORE);
      if (lato === "top") doc.line(px, py - o, px + w, py - o);
      else if (lato === "bottom") doc.line(px, py + h + o, px + w, py + h + o);
      else if (lato === "left") doc.line(px - o, py, px - o, py + h);
      else doc.line(px + w + o, py, px + w + o, py + h);
      if (i > 0) return;
      // etichetta: solo la prima lavorazione del lato, «+N» se ce ne sono altre
      const quante = perLato[lato].length;
      const scritta = t(quante > 1 ? `${v.nome} +${quante - 1}` : v.nome, 26).toUpperCase();
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.5); doc.setTextColor(...v.colore);
      const lunga = doc.getTextWidth(scritta);
      // se la scritta non sta lungo il lato si lascia solo il tratto colorato: il nome è nell'elenco accanto
      if (lunga > (lato === "top" || lato === "bottom" ? w : h) - 1.5) return;
      if (lato === "top") doc.text(scritta, px + w / 2, py - (quante - 1) * PASSO - 1.4, { align: "center" });
      else if (lato === "bottom") doc.text(scritta, px + 1, py + h - 1.2);
      else if (lato === "left") doc.text(scritta, px - (quante - 1) * PASSO - 1.3, py + h / 2 + lunga / 2, { angle: 90 });
      else if (w >= 14) doc.text(scritta, px + w - 1.2, py + h / 2 + lunga / 2, { angle: 90 });
    });
  });

  // quote: base sotto, altezza a destra
  const fuoriGiu = perLato.bottom.length * PASSO; const fuoriDx = perLato.right.length * PASSO;
  doc.setDrawColor(...INCHIOSTRO); doc.setFillColor(...INCHIOSTRO); doc.setTextColor(...INCHIOSTRO);
  const yq = py + h + fuoriGiu + 4.2;
  doc.setLineWidth(0.15);
  doc.line(px, py + h + 0.8, px, yq + 1.4); doc.line(px + w, py + h + 0.8, px + w, yq + 1.4);
  doc.setLineWidth(0.25); doc.line(px, yq, px + w, yq);
  punta(doc, px, yq, -1, 0); punta(doc, px + w, yq, 1, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  doc.text(`${s.forma === "trapezoid" ? "B " : ""}${numero(s.larghezza)} ${s.unita}`, px + w / 2, yq + 3.6, { align: "center" });
  if (s.forma === "trapezoid" && s.baseMinore) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
    doc.text(`b ${numero(s.baseMinore)} ${s.unita}`, px + w / 2, py + h - 1.5, { align: "center" });
  }
  const xq = px + w + fuoriDx + 4.2;
  doc.setLineWidth(0.15);
  doc.line(px + w + 0.8, py, xq + 1.4, py); doc.line(px + w + 0.8, py + h, xq + 1.4, py + h);
  doc.setLineWidth(0.25); doc.line(xq, py, xq, py + h);
  punta(doc, xq, py, 0, -1); punta(doc, xq, py + h, 0, 1);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  const quotaH = `${numero(s.altezza)} ${s.unita}`;
  doc.text(quotaH, xq + 3.8, py + h / 2 + doc.getTextWidth(quotaH) / 2, { angle: 90 });
}

const LARG_DISEGNO = 76; const ALT_DISEGNO = 56; const STACCO = 5;

/** Le righe di testo accanto al disegno (o da sole, in fattura): servono anche per misurare l'altezza. */
function vociScheda(doc: jsPDF, s: SchedaTecnica, larghezza: number): { testo: string; stile: "titolo" | "grigio" | "normale" | "voce" | "nota"; colore?: Rgb }[] {
  const voci: ReturnType<typeof vociScheda> = [];
  const spezza = (testo: string, larg: number) => doc.splitTextToSize(t(testo, 400) || " ", larg) as string[];
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  for (const r of spezza(`${s.titolo}${s.quantita > 1 ? `  x ${numero(s.quantita)}` : ""}`, larghezza)) voci.push({ testo: r, stile: "titolo" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  for (const r of spezza([misureScheda(s), ...caratteristicheScheda(s)].join("  ·  "), larghezza)) voci.push({ testo: r, stile: "normale" });
  const lavorazioni: { testo: string; colore?: Rgb }[] = [
    ...(s.stampa ? [{ testo: s.stampa }] : []),
    ...s.lavorazioni.map((l) => ({ testo: testoLavorazione(l), colore: l.lati.length > 0 ? coloreRgb(l.colore) : undefined })),
    ...s.lavorazioniLibere.map((l) => ({ testo: l })),
  ];
  voci.push({ testo: lavorazioni.length > 0 ? "LAVORAZIONI" : "NESSUNA LAVORAZIONE", stile: "grigio" });
  for (const l of lavorazioni) spezza(l.testo, larghezza - 5).forEach((r, i) => voci.push({ testo: r, stile: "voce", colore: i === 0 ? l.colore ?? GRIGIO : undefined }));
  if (s.nota) { doc.setFont("helvetica", "italic"); for (const r of spezza(s.nota, larghezza)) voci.push({ testo: r, stile: "nota" }); }
  return voci;
}
const PASSO_VOCE = { titolo: 4.8, grigio: 5.2, normale: 4.3, voce: 4.2, nota: 4.2 } as const;

/**
 * Scrive nel PDF i pezzi delle righe. Con `disegno` ogni pezzo ha il suo disegno a sinistra e le lavorazioni a destra;
 * senza (fattura) non si usa: lì le lavorazioni stanno già nel dettaglio della riga.
 * Restituisce la quota da cui proseguire.
 */
export function sezioneSchede(doc: jsPDF, gruppi: { riga: string; schede: SchedaTecnica[] }[], y: number, opzioni: { margine: number; larghezza: number; fondoPagina: number }): number {
  const { margine, larghezza, fondoPagina } = opzioni;
  const pieni = gruppi.filter((g) => g.schede.length > 0);
  if (pieni.length === 0) return y;
  const nuovaPagina = () => { doc.addPage(); y = margine; };
  if (y + 14 + ALT_DISEGNO > fondoPagina) nuovaPagina(); else y += 3;
  doc.setFillColor(...INCHIOSTRO); doc.rect(margine, y, larghezza, 7, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
  doc.text("DISEGNI E LAVORAZIONI", margine + 3, y + 4.9);
  y += 11;

  const xTesto = margine + LARG_DISEGNO + 5; const largTesto = larghezza - LARG_DISEGNO - 5;
  let pezzo = 0;
  for (const g of pieni) {
    for (const s of g.schede) {
      pezzo++;
      const voci = vociScheda(doc, s, largTesto);
      const altoTesto = 6 + voci.reduce((a, v) => a + PASSO_VOCE[v.stile], 0);
      const alto = Math.max(ALT_DISEGNO, altoTesto);
      if (y + alto > fondoPagina) nuovaPagina();
      disegnaPezzo(doc, s, margine, y, LARG_DISEGNO, ALT_DISEGNO);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRIGIO);
      doc.text(t(`PEZZO ${pezzo} - ${g.riga}${s.reparto && s.reparto !== g.riga ? ` - ${s.reparto}` : ""}`, 90).toUpperCase(), xTesto, y + 3);
      let yt = y + 8.2;
      for (const v of voci) {
        if (v.stile === "titolo") { doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INCHIOSTRO); }
        else if (v.stile === "grigio") { yt += 1; doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRIGIO); }
        else if (v.stile === "nota") { doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...GRIGIO); }
        else { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INCHIOSTRO); }
        if (v.stile === "voce") {
          if (v.colore) { doc.setFillColor(...v.colore); doc.rect(xTesto, yt - 2.5, 2.6, 2.6, "F"); }
          doc.text(v.testo, xTesto + 5, yt);
        } else doc.text(v.testo, xTesto, yt);
        yt += PASSO_VOCE[v.stile] - (v.stile === "grigio" ? 1 : 0);
      }
      y += alto + STACCO;
      doc.setDrawColor(...CHIARO); doc.setLineWidth(0.15); doc.line(margine, y - STACCO / 2, margine + larghezza, y - STACCO / 2);
    }
  }
  return y;
}
