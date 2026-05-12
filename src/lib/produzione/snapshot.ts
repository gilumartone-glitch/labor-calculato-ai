import type { Catalog, DepartmentState, PieceLine } from "@/components/calculator/types";
import { computeNesting } from "@/lib/nesting";
import type { ProdDept } from "./types";

export type ProdSnapshot = {
  source?: "summary" | "department";
  deptKey?: string;
  deptLabel?: string;
  state?: DepartmentState;
  catalog?: Catalog;
  jobName?: string;
  totals?: { materials?: number; pieces?: number; total?: number };
  departments?: Array<{
    key: string;
    label: string;
    totals: { materials: number; total: number };
    state?: DepartmentState;
    catalog?: Catalog;
  }>;
};

export type SnapshotDept = {
  label: string;
  key: string;
  state?: DepartmentState;
  catalog?: Catalog;
};

export const collectSnapshotDepartments = (snap: ProdSnapshot | null): SnapshotDept[] => {
  if (!snap) return [];
  if (snap.source === "summary" && snap.departments) {
    return snap.departments.map((d) => ({ label: d.label, key: d.key, state: d.state, catalog: d.catalog }));
  }
  return [{ label: snap.deptLabel ?? snap.deptKey ?? "Reparto", key: snap.deptKey ?? "x", state: snap.state, catalog: snap.catalog }];
};

export type AggMaterial = {
  name: string;
  color: string;
  height: string;
  base: string;
  qty: number;
  unit: string;
  note?: string;
  unitPrice: number;
  priceUnit: string;
  cost: number;
  /** Etichette dei pezzi (codici) che usano questo materiale, con eventuali ripetizioni × qty. */
  pieceLabels: string[];
};

/** Aggrega i materiali necessari dallo snapshot (nesting + manuali). */
export const aggregateSnapshotMaterials = (depts: SnapshotDept[]): AggMaterial[] => {
  const map = new Map<string, AggMaterial>();
  for (const d of depts) {
    const cat = d.catalog;
    if (!d.state || !cat) continue;
    try {
      const groups = computeNesting(d.state.pieces ?? [], cat);
      for (const g of groups) {
        if (!g.material) continue;
        const heightLabel =
          g.format === "rotolo"
            ? `${(g.rollWidthM * 100).toFixed(0)} cm`
            : g.material.height
              ? `${g.material.height} ${g.material.heightUnit || "cm"}`
              : "—";
        const baseLabel =
          g.format === "lastra"
            ? g.sheetWidthM && g.sheetWidthM > 0
              ? `${(g.sheetWidthM * 100).toFixed(0)} cm`
              : g.material.baseWidth
                ? `${g.material.baseWidth} cm`
                : "—"
            : "— (rotolo)";
        const key = `${g.material.name}|${g.material.color}|${g.material.height}`;
        const prev = map.get(key);
        const qty = g.format === "lastra" ? g.totalAreaM2 : g.totalLengthM;
        const unit = g.format === "lastra" ? "m²" : "m";
        // Codici dei pezzi che ricadono in questo gruppo (deduplicati con conteggio).
        const labelCount = new Map<string, number>();
        for (const it of g.items ?? []) {
          labelCount.set(it.label, (labelCount.get(it.label) ?? 0) + 1);
        }
        const pieceLabels = Array.from(labelCount.entries()).map(([l, n]) => (n > 1 ? `${l} ×${n}` : l));
        if (prev) {
          prev.qty += qty;
          prev.cost += g.materialCostOptimized;
          for (const pl of pieceLabels) if (!prev.pieceLabels.includes(pl)) prev.pieceLabels.push(pl);
        } else {
          map.set(key, {
            name: g.material.name,
            color: g.material.color,
            height: heightLabel,
            base: baseLabel,
            qty,
            unit,
            unitPrice: g.unitPrice,
            priceUnit: g.format === "lastra" ? "m²" : "m",
            cost: g.materialCostOptimized,
            pieceLabels,
            note:
              g.format === "lastra" && g.sheetsNeeded
                ? `${g.sheetsNeeded} lastr${g.sheetsNeeded === 1 ? "a" : "e"}`
                : g.format === "rotolo" ? "rotolo (a metratura)" : undefined,
          });
        }
      }
    } catch {
      /* ignore */
    }
    for (const m of d.state.materials ?? []) {
      const key = `manual:${m.name}|${m.color}|${m.height}`;
      const prev = map.get(key);
      const qty = m.quantity ?? 0;
      const cost = qty * (m.unitCost ?? 0);
      if (prev) {
        prev.qty += qty;
        prev.cost += cost;
      } else {
        map.set(key, {
          name: m.name, color: m.color, height: m.height, base: "—", qty, unit: m.unit,
          unitPrice: m.unitCost ?? 0, priceUnit: m.unit, cost, note: "manuale",
          pieceLabels: [],
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
};

/** Tutti i pezzi dello snapshot, con label reparto e catalog di provenienza. */
export const collectSnapshotPieces = (depts: SnapshotDept[]) =>
  depts.flatMap((d) =>
    (d.state?.pieces ?? []).map((p) => ({
      piece: p as PieceLine,
      deptLabel: d.label,
      deptKey: d.key,
      catalog: d.catalog,
    })),
  );

/** Mappa il key reparto-calcolatore → ProdDept, considerando anche le lavorazioni dei pezzi. */
export const inferProdDeptsFromSnapshot = (snap: ProdSnapshot | null): ProdDept[] => {
  const depts = collectSnapshotDepartments(snap);
  const result = new Set<ProdDept>();
  for (const d of depts) {
    const baseKey = d.key.toLowerCase();
    // Reparto base
    if (baseKey === "tappezzeria") result.add("tappezzeria");
    else if (baseKey === "stampa") {
      // Per il "laboratorio stampa", individuiamo stampa e/o taglio dai pezzi.
      const pieces = d.state?.pieces ?? [];
      const cat = d.catalog;
      let hasStampa = false;
      let hasTaglio = false;
      for (const p of pieces) {
        if (p.printOpId) hasStampa = true;
        for (const pp of p.perimeters) {
          const op = cat?.perimeterOps.find((o) => o.id === pp.opId);
          const c = (op?.category ?? "").toLowerCase();
          if (c === "stampa") hasStampa = true;
          if (c === "taglio") hasTaglio = true;
        }
      }
      if (hasStampa) result.add("stampa");
      if (hasTaglio) result.add("taglio");
      // Se nessuna lavorazione specifica, default a stampa
      if (!hasStampa && !hasTaglio) result.add("stampa");
    } else if (baseKey === "falegnameria") result.add("falegnameria");
    else result.add("altro");
  }
  if (result.size === 0) result.add("altro");
  return Array.from(result);
};