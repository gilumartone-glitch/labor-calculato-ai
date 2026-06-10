// Regole di dipendenza materiale → reparto.
// Configurabili in Impostazioni (Dipendenti → Gestione reparti).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProdDept } from "@/lib/produzione/types";

export type MaterialDependencyMode = "blocking" | "autonomous" | "ignore";

export type MaterialDependencyRule = {
  id: string;
  material_pattern: string;
  produced_by_dept: ProdDept;
  consumer_dept: ProdDept | null;
  mode: MaterialDependencyMode;
  note: string | null;
};

let cache: MaterialDependencyRule[] = [];
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const fire = () => listeners.forEach((l) => l());

export const loadMaterialDependencies = (force = false) => {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase
      .from("material_dependencies" as any)
      .select("id, material_pattern, produced_by_dept, consumer_dept, mode, note")
      .order("material_pattern");
    if (error) {
      console.warn("[material-deps] load error", error.message);
      loadPromise = null;
      return;
    }
    cache = (data ?? []) as any;
    fire();
  })();
  return loadPromise;
};

export const reloadMaterialDependencies = () => {
  loadPromise = null;
  return loadMaterialDependencies(true);
};

export const useMaterialDependencies = () => {
  const [, set] = useState(0);
  useEffect(() => {
    loadMaterialDependencies();
    const cb = () => set((v) => v + 1);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return {
    rules: cache,
    reload: reloadMaterialDependencies,
  };
};

export const getMaterialDependencyRules = () => cache;

/** Cerca la regola più specifica per (materiale, consumer). */
export const matchMaterialDependency = (
  materialName: string,
  consumerDept: ProdDept | undefined,
): MaterialDependencyRule | null => {
  const name = (materialName || "").toLowerCase();
  if (!name) return null;
  const matches = cache.filter((r) => {
    const pat = (r.material_pattern || "").toLowerCase().trim();
    if (!pat) return false;
    if (!name.includes(pat)) return false;
    if (r.consumer_dept && r.consumer_dept !== consumerDept) return false;
    return true;
  });
  if (matches.length === 0) return null;
  // priorità: regole con consumer_dept specifico vincono sulle generiche
  matches.sort((a, b) => {
    const sa = a.consumer_dept ? 0 : 1;
    const sb = b.consumer_dept ? 0 : 1;
    if (sa !== sb) return sa - sb;
    // pattern più lungo = più specifico
    return (b.material_pattern?.length ?? 0) - (a.material_pattern?.length ?? 0);
  });
  return matches[0];
};

export const upsertMaterialDependency = async (
  row: Partial<MaterialDependencyRule> & { id?: string },
) => {
  const payload: any = {
    material_pattern: row.material_pattern,
    produced_by_dept: row.produced_by_dept,
    consumer_dept: row.consumer_dept || null,
    mode: row.mode ?? "blocking",
    note: row.note ?? null,
  };
  if (row.id) {
    const { error } = await supabase.from("material_dependencies" as any).update(payload).eq("id", row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("material_dependencies" as any).insert(payload);
    if (error) throw error;
  }
  await reloadMaterialDependencies();
};

export const deleteMaterialDependency = async (id: string) => {
  const { error } = await supabase.from("material_dependencies" as any).delete().eq("id", id);
  if (error) throw error;
  await reloadMaterialDependencies();
};
