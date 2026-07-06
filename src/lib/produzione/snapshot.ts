import type { Catalog, DepartmentState, PieceLine } from "@/components/calculator/types";
import { loadCatalogCloud } from "@/lib/catalog";
import { computeNesting, mergeCatalogs } from "@/lib/nesting";
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

export type CurrentCatalogMap = Partial<Record<"tappezzeria" | "stampa" | "falegnameria", Catalog>>;

export const loadCurrentProductionCatalogs = async (): Promise<CurrentCatalogMap> => {
  const entries = await Promise.all(
    (["tappezzeria", "stampa", "falegnameria"] as const).map(async (dept) => [dept, await loadCatalogCloud(dept)] as const),
  );
  return Object.fromEntries(entries.filter(([, catalog]) => !!catalog)) as CurrentCatalogMap;
};

/** Arricchisce i reparti salvati negli ordini vecchi con il listino corrente.
 *  Così il nesting in lavorazione vede anche formati aggiunti dopo la creazione
 *  del progetto (es. 600×205 oltre a 305×205). Il catalogo corrente vince a pari id. */
export const mergeSnapshotDepartmentsWithCurrentCatalogs = (
  depts: SnapshotDept[],
  currentCatalogs: CurrentCatalogMap,
): SnapshotDept[] =>
  depts.map((dept) => {
    const key = dept.key as keyof CurrentCatalogMap;
    const current = currentCatalogs[key];
    if (!current) return dept;
    return {
      ...dept,
      catalog: dept.catalog ? mergeCatalogs([current, dept.catalog]) ?? dept.catalog : current,
    };
  });

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

/** Mappa il key reparto-calcolatore → ProdDept, considerando anche le lavorazioni dei pezzi.
 *  IMPORTANTE: i reparti senza pezzi né materiali vengono esclusi (non c'è nulla
 *  da lavorare o da vendere, quindi non vanno portati in Flow). */
export const inferProdDeptsFromSnapshot = (snap: ProdSnapshot | null): ProdDept[] => {
  const depts = collectSnapshotDepartments(snap);
  // Mappa key reparto → totale dal summary (se disponibile), per filtrare i vuoti.
  const totalsByKey = new Map<string, number>();
  let anyNonZeroTotal = false;
  if (snap?.source === "summary" && snap.departments) {
    for (const d of snap.departments) {
      const t = d.totals?.total ?? 0;
      totalsByKey.set(d.key.toLowerCase(), t);
      if (t > 0) anyNonZeroTotal = true;
    }
  }
  // Il magazzino entra in Flow SOLO quando c'è qualcosa da far uscire
  // (carrello vendite con righe). Il fatto che la sezione "magazzino" abbia
  // un totale per costi materiale NON è un motivo per creare attività di magazzino.
  const anySnap: any = snap as any;
  const carts: Record<string, any[]> =
    (anySnap?.salesCarts && typeof anySnap.salesCarts === "object") ? anySnap.salesCarts :
    (anySnap?.state?.salesCarts && typeof anySnap.state.salesCarts === "object") ? anySnap.state.salesCarts :
    (anySnap?.designState?.salesCarts && typeof anySnap.designState.salesCarts === "object") ? anySnap.designState.salesCarts :
    {};
  const hasSalesLines = Object.keys(carts).some((k) => Array.isArray(carts[k]) && carts[k].length > 0);
  const result = new Set<ProdDept>();
  for (const d of depts) {
    const baseKey = d.key.toLowerCase();
    const pieces = d.state?.pieces ?? [];
    const materials = d.state?.materials ?? [];
    const total = totalsByKey.get(baseKey);
    const noContent = pieces.length === 0 && materials.length === 0;
    const zeroTotal = anyNonZeroTotal && (total === undefined || total <= 0);
    // Magazzino/vendite: includi SOLO se ci sono righe nei salesCarts
    // (cioè qualcosa da spedire/consegnare). Niente materiali in arrivo → niente magazzino.
    if (baseKey === "magazzino" || baseKey === "vendite") {
      if (hasSalesLines) result.add("magazzino");
      continue;
    }
    if (noContent || zeroTotal) continue;
    if (baseKey === "tappezzeria") result.add("tappezzeria");
    else if (baseKey === "stampa") {
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
      if (!hasStampa && !hasTaglio && pieces.length > 0) result.add("stampa");
    } else if (baseKey === "falegnameria") result.add("falegnameria");
    else result.add("altro");
  }
  return Array.from(result);
};