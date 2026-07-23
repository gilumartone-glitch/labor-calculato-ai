import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { eur, num } from "@/lib/format";
import type { Catalog, DepartmentState, DepartmentTotals, SubProject } from "@/components/calculator/types";
import { getProductWorks } from "@/components/calculator/types";
import { DEPT_LABEL } from "@/lib/produzione/types";

export type QuoteMode = "cliente" | "interno";

export type DeptForQuote = {
  key: string;
  label: string;
  totals: DepartmentTotals;
  state?: DepartmentState;
  catalog?: Catalog;
};

export type QuoteInput = {
  jobName: string;
  quantity: number;
  margin: number;
  vat: number;
  applyVat: boolean;
  departments: DeptForQuote[];
  subProjects?: SubProject[];
  deptMargins?: Record<string, number>;
};

const eurStr = (n: number) => eur(n).replace(/\u00A0/g, " ");

const marginFor = (k: string, input: QuoteInput) =>
  input.deptMargins?.[k] ?? input.margin;

const marginBaseFor = (d: DeptForQuote) =>
  Math.max(0, d.totals.total - (d.totals.transports ?? 0));

const applyMarginToLine = (cost: number, marginPct: number) =>
  cost * (1 + marginPct / 100);

export const generateQuotePdf = (input: QuoteInput, mode: QuoteMode) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  const isCliente = mode === "cliente";

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(isCliente ? "PREVENTIVO" : "PREVENTIVO INTERNO", 14, 18);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(input.jobName || "Progetto", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Data: ${new Date().toLocaleDateString("it-IT")}`, pageW - 14, 18, { align: "right" });
  if (input.quantity > 1) doc.text(`Quantità: ${input.quantity} pz`, pageW - 14, 24, { align: "right" });
  doc.setTextColor(0);

  let cursorY = 34;
  let subtotalCost = 0;
  let subtotalWithMargin = 0;

  for (const d of input.departments) {
    if (d.totals.total <= 0) continue;
    const st = d.state;
    if (!st) continue;

    const rows: any[] = [];
    const m = marginFor(d.key, input);

    // Materiali
    for (const ml of st.materials ?? []) {
      const cost = ml.quantity * ml.unitCost;
      if (cost <= 0) continue;
      const priceFinal = applyMarginToLine(cost, m);
      rows.push(
        isCliente
          ? [ml.name || "Materiale", `${num(ml.quantity, 2)} ${ml.unit || ""}`, "", eurStr(priceFinal)]
          : [ml.name || "Materiale", `${num(ml.quantity, 2)} ${ml.unit || ""}`, eurStr(ml.unitCost), eurStr(cost), eurStr(priceFinal)]
      );
    }

    // Pezzi (aggregati)
    for (const p of st.pieces ?? []) {
      const qty = Number(p.quantity) || 1;
      const dim = `${num(p.width, 1)}×${num(p.height, 1)} ${p.dimUnit}`;
      const label = `${p.productName || "Pezzo"} — ${dim}${p.color ? " · " + p.color : ""}${qty > 1 ? ` · ${qty} pz` : ""}`;
      // costo pezzo: usiamo il totale reparto/pieces come approx? Meglio: skip line-level cost
      // Semplificazione: mostriamo solo descrittivo; il totale reparto è già mostrato.
      rows.push(
        isCliente
          ? [label, `${qty} pz`, "", ""]
          : [label, `${qty} pz`, "", "", ""]
      );
    }

    // Lavorazioni (operations)
    for (const op of st.operations ?? []) {
      const cost = op.quantity * op.rate;
      if (cost <= 0) continue;
      const priceFinal = applyMarginToLine(cost, m);
      rows.push(
        isCliente
          ? [op.name || "Lavorazione", `${num(op.quantity, 2)} ${op.mode === "ora" ? "h" : op.unit}`, "", eurStr(priceFinal)]
          : [op.name || "Lavorazione", `${num(op.quantity, 2)} ${op.mode === "ora" ? "h" : op.unit}`, eurStr(op.rate), eurStr(cost), eurStr(priceFinal)]
      );
    }

    // Trasporti
    for (const t of st.transports ?? []) {
      const cost = t.quantity * t.unitCost;
      if (cost <= 0) continue;
      rows.push(
        isCliente
          ? [t.description || "Trasporto", `${num(t.quantity, 2)}`, "", eurStr(cost)]
          : [t.description || "Trasporto", `${num(t.quantity, 2)}`, eurStr(t.unitCost), eurStr(cost), eurStr(cost)]
      );
    }

    if (rows.length === 0 && d.totals.total <= 0) continue;

    const deptTotalCost = d.totals.total;
    const deptTotalFinal = d.totals.total + marginBaseFor(d) * (m / 100);
    subtotalCost += deptTotalCost;
    subtotalWithMargin += deptTotalFinal;

    // Section header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setFillColor(20, 20, 20);
    doc.setTextColor(255);
    doc.rect(14, cursorY, pageW - 28, 8, "F");
    doc.text(d.label.toUpperCase(), 17, cursorY + 5.5);
    doc.text(eurStr(deptTotalFinal), pageW - 17, cursorY + 5.5, { align: "right" });
    doc.setTextColor(0);
    cursorY += 8;

    autoTable(doc, {
      startY: cursorY,
      head: [
        isCliente
          ? ["Descrizione", "Qtà", "", "Prezzo"]
          : ["Descrizione", "Qtà", "€/u", "Costo", "Prezzo cliente"],
      ],
      body: rows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      columnStyles: isCliente
        ? { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } }
        : { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });

    cursorY = (doc as any).lastAutoTable.finalY + 6;

    if (cursorY > 250) { doc.addPage(); cursorY = 20; }
  }

  // Lavorazioni prodotto (sub-progetti)
  const productWorkRows: any[] = [];
  let productWorksCost = 0;
  for (const sp of input.subProjects ?? []) {
    for (const w of getProductWorks(sp)) {
      const hours = Number(w.hours) || 0;
      const rate = Number(w.hourlyCost) || 0;
      const cost = hours * rate;
      if (cost <= 0) continue;
      productWorksCost += cost;
      const priceFinal = applyMarginToLine(cost, input.margin);
      const label = `${sp.name} — ${w.name || "Lavorazione"} (${DEPT_LABEL[w.dept as keyof typeof DEPT_LABEL] ?? w.dept})`;
      productWorkRows.push(
        isCliente
          ? [label, `${num(hours, 1)} h`, "", eurStr(priceFinal)]
          : [label, `${num(hours, 1)} h`, eurStr(rate), eurStr(cost), eurStr(priceFinal)]
      );
    }
  }
  if (productWorkRows.length > 0) {
    const finalTotal = applyMarginToLine(productWorksCost, input.margin);
    subtotalCost += productWorksCost;
    subtotalWithMargin += finalTotal;
    if (cursorY > 240) { doc.addPage(); cursorY = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setFillColor(180, 130, 20);
    doc.setTextColor(255);
    doc.rect(14, cursorY, pageW - 28, 8, "F");
    doc.text("LAVORAZIONI PRODOTTO", 17, cursorY + 5.5);
    doc.text(eurStr(finalTotal), pageW - 17, cursorY + 5.5, { align: "right" });
    doc.setTextColor(0);
    cursorY += 8;
    autoTable(doc, {
      startY: cursorY,
      head: [
        isCliente
          ? ["Descrizione", "Qtà", "", "Prezzo"]
          : ["Descrizione", "Qtà", "€/h", "Costo", "Prezzo cliente"],
      ],
      body: productWorkRows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      margin: { left: 14, right: 14 },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 6;
  }

  // Totale finale
  if (cursorY > 240) { doc.addPage(); cursorY = 20; }
  const net = subtotalWithMargin;
  const vatAmount = input.applyVat ? net * (input.vat / 100) : 0;
  const total = net + vatAmount;
  const perPiece = input.quantity > 0 ? total / input.quantity : total;

  cursorY += 4;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(14, cursorY, pageW - 14, cursorY);
  cursorY += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  if (!isCliente) {
    doc.text(`Costo totale interno: ${eurStr(subtotalCost)}`, 14, cursorY); cursorY += 5;
    doc.text(`Margine (${num(input.margin, 1)}% base): ${eurStr(subtotalWithMargin - subtotalCost)}`, 14, cursorY); cursorY += 5;
  }
  doc.text(`Imponibile: ${eurStr(net)}`, pageW - 14, cursorY, { align: "right" }); cursorY += 5;
  if (input.applyVat) {
    doc.text(`IVA ${num(input.vat, 1)}%: ${eurStr(vatAmount)}`, pageW - 14, cursorY, { align: "right" }); cursorY += 5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`TOTALE: ${eurStr(total)}`, pageW - 14, cursorY + 4, { align: "right" });
  if (input.quantity > 1) {
    cursorY += 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Cadauno (${input.quantity} pz): ${eurStr(perPiece)}`, pageW - 14, cursorY, { align: "right" });
  }

  const fileSuffix = isCliente ? "cliente" : "interno";
  const safeName = (input.jobName || "preventivo").replace(/[^\w\-]+/g, "_");
  doc.save(`preventivo_${safeName}_${fileSuffix}.pdf`);
};
