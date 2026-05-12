import { computeNesting } from "@/lib/nesting";
import type { Catalog, DepartmentState } from "@/components/calculator/types";

export type SnapshotMaterial = { key: string; label: string; detail?: string };

type DeptLike = { label?: string; key?: string; state?: DepartmentState; catalog?: Catalog };

const collectDepartments = (snap: any): DeptLike[] => {
  if (!snap) return [];
  if (snap.source === "summary" && Array.isArray(snap.departments)) {
    return snap.departments.map((d: any) => ({ label: d.label, key: d.key, state: d.state, catalog: d.catalog }));
  }
  return [{ label: snap.deptLabel ?? snap.deptKey, key: snap.deptKey, state: snap.state, catalog: snap.catalog }];
};

/** Estrae la lista materiali aggregata da uno snapshot di preventivo. */
export const extractMaterialsFromSnapshot = (snap: any): SnapshotMaterial[] => {
  const out = new Map<string, SnapshotMaterial>();
  const depts = collectDepartments(snap);
  for (const d of depts) {
    if (!d.state || !d.catalog) continue;
    try {
      const groups = computeNesting(d.state.pieces ?? [], d.catalog);
      for (const g of groups) {
        if (!g.material) continue;
        const key = `${g.material.name}|${g.material.color || ""}|${g.material.height || ""}`;
        const qty = g.format === "lastra" ? g.totalAreaM2 : g.totalLengthM;
        const unit = g.format === "lastra" ? "m²" : "m";
        const detail = [g.material.color, g.material.height ? `${g.material.height} ${g.material.heightUnit || "cm"}` : null, qty ? `${qty.toFixed(2)} ${unit}` : null]
          .filter(Boolean).join(" · ");
        if (!out.has(key)) out.set(key, { key, label: g.material.name, detail });
      }
    } catch { /* ignore */ }
  }
  return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
};