import type { ProdDept } from "./types";
import { DEPT_LABEL } from "./types";
import type { ProdSnapshot } from "./snapshot";
import { collectSnapshotDepartments, inferProdDeptsFromSnapshot } from "./snapshot";
import type { SubProject } from "@/components/calculator/types";
import { getProductWorks } from "@/components/calculator/types";

/** Una "lavorazione" concreta all'interno di un reparto (es. Falegnameria → Taglio).
 *  key = univoca; dept = reparto padre; category = etichetta della lavorazione (null se il reparto non è splittato). */
export type ProdTask = {
  key: string;
  dept: ProdDept;
  category: string | null;
  label: string;
  /** Se il task è specifico di un sub-progetto (es. assemblaggio_lab). */
  subProjectId?: string | null;
  /** Metadati opzionali (ore/€h) per task di assemblaggio in laboratorio. */
  meta?: { hours?: number; hourlyCost?: number; notes?: string };
};

/** Ordine "logico" delle lavorazioni: chi produce prima tende a bloccare chi assembla dopo. */
export const CATEGORY_ORDER: string[] = [
  "taglio",
  "cnc",
  "levigatura",
  "incollaggio",
  "assemblaggio",
  "verniciatura",
  "finitura",
  "controllo",
  "altro",
  "assemblaggio_lab",
];

const CATEGORY_LABEL: Record<string, string> = {
  taglio: "Taglio",
  cnc: "CNC",
  levigatura: "Levigatura",
  incollaggio: "Incollaggio",
  assemblaggio: "Assemblaggio",
  verniciatura: "Verniciatura",
  finitura: "Finitura",
  controllo: "Controllo qualità",
  altro: "Altre lavorazioni",
  assemblaggio_lab: "Assemblaggio in laboratorio",
};

const KEYWORDS: Array<[string, RegExp]> = [
  ["taglio", /\b(tagli|sezionatur|sega|troncatri|troncat)/i],
  ["cnc", /\b(cnc|pantografo|fresatur|frese)/i],
  ["levigatura", /\b(leviga|carteggi|smerigl|calibratur|piall)/i],
  ["incollaggio", /\b(incoll|bordatura|pressa)/i],
  ["assemblaggio", /\b(assembl|montaggi(?!o$)|giunt|avvit|imbottitur)/i],
  ["verniciatura", /\b(vernic|lacc|smaltatur|pittur|tint|impregnant)/i],
  ["finitura", /\b(finitur|lucidatur|cerat|oliat)/i],
  ["controllo", /\b(controllo|collaud|qualit)/i],
];

export const categoryLabel = (cat: string): string =>
  CATEGORY_LABEL[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);

const normalize = (name: string | undefined | null): string => {
  const s = String(name ?? "").trim();
  if (!s) return "altro";
  for (const [cat, re] of KEYWORDS) if (re.test(s)) return cat;
  return "altro";
};

/** Nessun reparto viene splittato automaticamente in sotto-lavorazioni:
 *  le sub-lavorazioni compaiono SOLO se l'utente le ha indicate esplicitamente
 *  tramite "Lavorazioni prodotto" nel sub-progetto. */

/** Restituisce le lavorazioni concrete da lanciare in Flow.
 *  - Un task per ogni reparto rilevato (nessuno split automatico).
 *  - In aggiunta, un task per ogni "Lavorazione prodotto" indicata dall'utente. */
export const inferProdTasksFromSnapshot = (
  snap: ProdSnapshot | null,
  deptLabel: (d: ProdDept) => string,
): ProdTask[] => {
  const depts = inferProdDeptsFromSnapshot(snap);
  const out: ProdTask[] = [];

  for (const dept of depts) {
    out.push({ key: dept, dept, category: null, label: deptLabel(dept) });
  }


  // === Lavorazioni prodotto (decorazione, assemblaggio, ignifugazione, ...) ===
  // Un task per riga; reparto scelto dall'utente; category = assemblaggio_lab
  // per riusare la logica "bloccato dalle altre lavorazioni del sub".
  const anySnap: any = snap as any;
  const subProjects: SubProject[] =
    (Array.isArray(anySnap?.subProjects) && anySnap.subProjects) ||
    (Array.isArray(anySnap?.designState?.subProjects) && anySnap.designState.subProjects) ||
    [];
  for (const sp of subProjects) {
    const works = getProductWorks(sp);
    for (const w of works) {
      const hours = Number(w.hours) || 0;
      if (hours <= 0 && !w.notes) continue;
      const dept = (w.dept || "falegnameria") as ProdDept;
      out.push({
        key: `assemblaggio_lab:${sp.id}:${w.id}`,
        dept,
        category: "assemblaggio_lab",
        label: `${w.name || "Lavorazione"} · ${sp.name} — ${DEPT_LABEL[dept] ?? dept}`,
        subProjectId: sp.id,
        meta: {
          hours,
          hourlyCost: Number(w.hourlyCost) || 0,
          notes: w.notes,
        },
      });
    }
  }
  return out;
};

/** Suggerisce il task bloccante di default.
 *  - Assemblaggio in laboratorio: bloccato dall'ULTIMO task delle altre lavorazioni
 *    dello stesso sub-progetto (topo-sort creerà catena di dipendenze).
 *  - Altri task splittati: task precedente nell'ordine logico dentro lo stesso reparto. */
export const suggestBlockerTask = (task: ProdTask, allTasks: ProdTask[]): string | null => {
  if (task.category === "assemblaggio_lab") {
    // Preferisci un task dello stesso sub-progetto (se i pezzi lo indicano);
    // in mancanza, prendi tutti i task NON assemblaggio_lab.
    const others = allTasks.filter((t) => t.key !== task.key && t.category !== "assemblaggio_lab");
    if (others.length === 0) return null;
    return others[others.length - 1].key;
  }
  if (!task.category) return null;
  const sameDept = allTasks.filter((t) => t.dept === task.dept && t.category && t.category !== "assemblaggio_lab");
  const idxSelf = sameDept.findIndex((t) => t.key === task.key);
  if (idxSelf <= 0) return null;
  return sameDept[idxSelf - 1].key;
};
