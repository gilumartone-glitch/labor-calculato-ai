import { computeNesting } from "@/lib/nesting";
import type { Catalog, DepartmentState } from "@/components/calculator/types";
import { toMacroDept, type ProdDept } from "@/lib/produzione/types";

export type SnapshotMaterial = {
  key: string;
  label: string;
  detail?: string;
  /** Quantità totale stimata da ordinare/preparare. */
  qty?: number;
  /** Unità di misura della quantità ("m²" o "m"). */
  unit?: string;
  /** Codice/identificativo breve del materiale (es. PAN-300). */
  code?: string;
  /** Macro-reparto di provenienza del materiale (per bloccare solo i sub interessati). */
  dept?: ProdDept;
};

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
    const deptMacro = toMacroDept((d.key as ProdDept) ?? "altro");
    try {
      const groups = computeNesting(d.state.pieces ?? [], d.catalog);
      for (const g of groups) {
        if (!g.material) continue;
        const key = `${g.material.name}|${g.material.color || ""}|${g.material.height || ""}`;
        const qty = g.format === "lastra" ? g.totalAreaM2 : g.totalLengthM;
        const unit = g.format === "lastra" ? "m²" : "m";
        const heightTxt = g.material.height ? `${g.material.height} ${g.material.heightUnit || "cm"}` : null;
        const detail = [g.material.color, heightTxt].filter(Boolean).join(" · ");
        const existing = out.get(key);
        if (existing) {
          existing.qty = (existing.qty ?? 0) + (qty || 0);
          // Se lo stesso materiale è richiesto da più reparti, preferisci "laboratorio"
          // (è il fornitore interno di materia prima per gli altri reparti).
          if (existing.dept !== "laboratorio" && deptMacro === "laboratorio") {
            existing.dept = "laboratorio";
          }
        } else {
          // Codice "breve" derivato: prime lettere del nome + altezza (es. PANNO-300)
          const short = String(g.material.name).toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
          const code = heightTxt ? `${short}-${String(g.material.height).replace(/\D/g, "")}` : short;
          out.set(key, { key, label: g.material.name, detail, qty: qty || 0, unit, code, dept: deptMacro });
        }
      }
    } catch { /* ignore */ }
  }

  // Aggiungi i prodotti del carrello vendite (reparto magazzino).
  // Anche questi possono mancare e devono essere verificati prima della commessa.
  const carts: Record<string, any[]> =
    (snap?.salesCarts && typeof snap.salesCarts === "object") ? snap.salesCarts :
    (snap?.state?.salesCarts && typeof snap.state.salesCarts === "object") ? snap.state.salesCarts :
    (snap?.designState?.salesCarts && typeof snap.designState.salesCarts === "object") ? snap.designState.salesCarts :
    {};
  for (const cartKey of Object.keys(carts || {})) {
    const lines = Array.isArray(carts[cartKey]) ? carts[cartKey] : [];
    for (const l of lines) {
      const name: string = String(l?.name ?? "").trim();
      if (!name) continue;
      const variant: string = String(l?.variant ?? "").trim();
      const qty = Number(l?.qty) || 0;
      const unit: string = String(l?.unit ?? "pz").trim() || "pz";
      const key = `sale:${name}|${variant}|${unit}`;
      const detail = ["Vendita", variant].filter(Boolean).join(" · ");
      const short = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
      const existing = out.get(key);
      if (existing) {
        existing.qty = (existing.qty ?? 0) + qty;
      } else {
        out.set(key, { key, label: name, detail, qty, unit, code: short });
      }
    }
  }
  return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
};
