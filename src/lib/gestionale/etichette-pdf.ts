/**
 * Etichette delle pezze con codice QR. Inquadrando il codice con il telefono si apre
 * il Gestionale direttamente su quella pezza.
 */
import jsPDF from "jspdf";
import { creaQr } from "./qr";
import { testoLatino } from "./fattura-pa";

export type EtichettaPezza = {
  codice: string;
  articolo: string;
  /** colore, altezza, peso, ignifugo… */
  variante: string;
  codice_variante: string;
  bagno: string | null;
  metri: number;
  posizione: string | null;
  ignifugo: boolean;
};

export type FormatoEtichette = "a4-24" | "a4-8" | "rotolo-100x50";
export const FORMATI_ETICHETTE: { codice: FormatoEtichette; etichetta: string }[] = [
  { codice: "a4-24", etichetta: "Foglio A4 · 24 etichette 70 × 37 mm" },
  { codice: "a4-8", etichetta: "Foglio A4 · 8 etichette 105 × 74 mm" },
  { codice: "rotolo-100x50", etichetta: "Stampante a rotolo · 100 × 50 mm" },
];

const GEOMETRIA: Record<FormatoEtichette, { pagina: [number, number]; colonne: number; righe: number; larghezza: number; altezza: number; margineAlto: number }> = {
  "a4-24": { pagina: [210, 297], colonne: 3, righe: 8, larghezza: 70, altezza: 37, margineAlto: 0.5 },
  "a4-8": { pagina: [210, 297], colonne: 2, righe: 4, larghezza: 105, altezza: 74, margineAlto: 0.5 },
  "rotolo-100x50": { pagina: [100, 50], colonne: 1, righe: 1, larghezza: 100, altezza: 50, margineAlto: 0 },
};

/** Indirizzo che finisce nel codice QR. */
export const indirizzoPezza = (base: string, codice: string): string =>
  `${base.replace(/\/+$/, "")}/gestionale?pezza=${encodeURIComponent(codice)}`;

const metriIt = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });

function disegnaQr(doc: jsPDF, testo: string, x: number, y: number, lato: number) {
  const moduli = creaQr(testo);
  const passo = lato / (moduli.length + 8);          // 4 moduli di margine chiaro per parte
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, lato, lato, "F");
  doc.setFillColor(0, 0, 0);
  moduli.forEach((riga, r) => {
    // i moduli scuri vicini si uniscono in un solo rettangolo: file più leggero e senza fessure in stampa
    for (let c = 0; c < riga.length; c++) {
      if (!riga[c]) continue;
      let fine = c;
      while (fine + 1 < riga.length && riga[fine + 1]) fine++;
      doc.rect(x + (c + 4) * passo, y + (r + 4) * passo, (fine - c + 1) * passo, passo * 1.02, "F");
      c = fine;
    }
  });
}

export function creaPdfEtichette(etichette: EtichettaPezza[], formato: FormatoEtichette, base: string): jsPDF {
  const g = GEOMETRIA[formato];
  const doc = new jsPDF({ unit: "mm", format: g.pagina, orientation: g.pagina[0] > g.pagina[1] ? "landscape" : "portrait" });
  const perPagina = g.colonne * g.righe;
  const grande = g.altezza >= 45;
  etichette.forEach((e, i) => {
    if (i > 0 && i % perPagina === 0) doc.addPage(g.pagina, g.pagina[0] > g.pagina[1] ? "landscape" : "portrait");
    const k = i % perPagina;
    const x0 = (k % g.colonne) * g.larghezza;
    const y0 = g.margineAlto + Math.floor(k / g.colonne) * g.altezza;
    const bordo = grande ? 4 : 2.5;
    const latoQr = g.altezza - bordo * 2;
    disegnaQr(doc, indirizzoPezza(base, e.codice), x0 + bordo, y0 + bordo, latoQr);

    const x = x0 + bordo + latoQr + (grande ? 3 : 1.5);
    const larg = x0 + g.larghezza - bordo - x;
    let y = y0 + bordo + (grande ? 6 : 4);
    const riga = (testo: string, corpo: number, forte = false, max = 1) => {
      if (!testo) return;
      doc.setFont("helvetica", forte ? "bold" : "normal"); doc.setFontSize(corpo); doc.setTextColor(0, 0, 0);
      for (const r of (doc.splitTextToSize(testoLatino(testo, 200).replace(/²/g, "2"), larg) as string[]).slice(0, max)) { doc.text(r, x, y); y += corpo * 0.42; }
    };
    riga(e.codice, grande ? 17 : 11, true);
    y += grande ? 1.5 : 0.6;
    riga(e.articolo, grande ? 11 : 7.5, true, grande ? 2 : 1);
    riga(e.variante, grande ? 9.5 : 6.5, false, 2);
    riga([e.bagno ? `Bagno ${e.bagno}` : "", e.posizione ? `Pos. ${e.posizione}` : ""].filter(Boolean).join(" · "), grande ? 9.5 : 6.5);
    y += grande ? 1.5 : 0.7;
    riga(`${metriIt(e.metri)} m al carico`, grande ? 12 : 8, true);
    if (e.ignifugo) {
      // «IGNIFUGO» in negativo, in basso a destra: si vede da lontano
      const testo = "IGNIFUGO"; const corpo = grande ? 9 : 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(corpo);
      const w = doc.getTextWidth(testo) + 3; const h = corpo * 0.5 + 1;
      const bx = x0 + g.larghezza - bordo - w; const by = y0 + g.altezza - bordo - h;
      doc.setFillColor(0, 0, 0); doc.rect(bx, by, w, h, "F");
      doc.setTextColor(255, 255, 255); doc.text(testo, bx + 1.5, by + h - 1.3);
    }
  });
  return doc;
}
