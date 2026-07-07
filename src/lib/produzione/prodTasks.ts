import type { ProdDept } from "./types";
import type { ProdSnapshot } from "./snapshot";
import { collectSnapshotDepartments, inferProdDeptsFromSnapshot } from "./snapshot";
import type { SubProject } from "@/components/calculator/types";

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

/** Reparti in cui ha senso spezzare le lavorazioni: quelli con operazioni "unità/ora"
 *  di natura diversa (falegnameria, laboratorio, tappezzeria). Stampa/taglio sono già
 *  reparti distinti nel modello, quindi non vanno spezzati ulteriormente. */
const SPLITTABLE: ReadonlySet<ProdDept> = new Set<ProdDept>([
  "falegnameria",
  "laboratorio",
  "tappezzeria",
]);

/** Restituisce le lavorazioni concrete da lanciare in Flow.
 *  Per ogni reparto rilevato:
 *  - se il reparto è "splittabile" e i pezzi contengono lavorazioni di ≥2 categorie distinte,
 *    emette un task per ciascuna categoria (in ordine logico);
 *  - altrimenti emette un unico task per il reparto (category = null → comportamento identico a oggi). */
export const inferProdTasksFromSnapshot = (
  snap: ProdSnapshot | null,
  deptLabel: (d: ProdDept) => string,
): ProdTask[] => {
  const depts = inferProdDeptsFromSnapshot(snap);
  const snapDepts = collectSnapshotDepartments(snap);
  const out: ProdTask[] = [];

  const snapDeptByKey = new Map<string, (typeof snapDepts)[number]>();
  for (const sd of snapDepts) snapDeptByKey.set(sd.key.toLowerCase(), sd);

  for (const dept of depts) {
    if (!SPLITTABLE.has(dept)) {
      out.push({ key: dept, dept, category: null, label: deptLabel(dept) });
      continue;
    }
    // Trova il reparto snapshot corrispondente (stessa chiave testuale del reparto ProdDept).
    const sd =
      snapDeptByKey.get(dept as string) ??
      (dept === "laboratorio" ? snapDeptByKey.get("laboratorio") : undefined) ??
      snapDeptByKey.get(dept as string);
    const pieces = sd?.state?.pieces ?? [];
    const opsDept = sd?.state?.operations ?? [];
    const cat = sd?.catalog;
    const cats = new Set<string>();
    // Operazioni "unità/ora" del reparto (vivono su DepartmentState.operations, non sui pezzi).
    for (const o of opsDept) {
      if (o.name) cats.add(normalize(o.name));
      else if (o.catalogId) {
        const cop = cat?.operations.find((x) => x.id === o.catalogId);
        if (cop?.name) cats.add(normalize(cop.name));
      }
    }
    for (const p of pieces) {
      // Perimetri: rispetta la category se valorizzata, altrimenti classifica dal nome.
      for (const perim of p.perimeters ?? []) {
        const pop = cat?.perimeterOps.find((x) => x.id === perim.opId);
        if (!pop) continue;
        if (pop.category && pop.category !== "perimetrale") {
          cats.add(normalize(pop.category === "stampa" ? "stampa" : pop.category));
        } else {
          cats.add(normalize(pop.name));
        }
      }
      // Lavorazioni libere del pezzo (customWorks).
      for (const cw of p.customWorks ?? []) cats.add(normalize(cw.name));
    }
    if (cats.size <= 1) {
      out.push({ key: dept, dept, category: null, label: deptLabel(dept) });
      continue;
    }
    const ordered = Array.from(cats).sort(
      (a, b) => (CATEGORY_ORDER.indexOf(a) + 999) - (CATEGORY_ORDER.indexOf(b) + 999),
    );
    for (const c of ordered) {
      out.push({
        key: `${dept}:${c}`,
        dept,
        category: c,
        label: `${deptLabel(dept)} — ${categoryLabel(c)}`,
      });
    }
  }

  // === Assemblaggio in laboratorio: un task per sub-progetto con assemblyLab attivo ===
  // I sub-progetti vivono nello snapshot (o in designState per gli snapshot produzione).
  const anySnap: any = snap as any;
  const subProjects: SubProject[] =
    (Array.isArray(anySnap?.subProjects) && anySnap.subProjects) ||
    (Array.isArray(anySnap?.designState?.subProjects) && anySnap.designState.subProjects) ||
    [];
  for (const sp of subProjects) {
    if (!sp?.assemblyLab?.enabled) continue;
    const hours = Number(sp.assemblyLab.hours) || 0;
    if (hours <= 0 && !sp.assemblyLab.notes) continue;
    out.push({
      key: `assemblaggio_lab:${sp.id}`,
      dept: "falegnameria",
      category: "assemblaggio_lab",
      label: `Assemblaggio lab · ${sp.name}`,
      subProjectId: sp.id,
      meta: {
        hours,
        hourlyCost: Number(sp.assemblyLab.hourlyCost) || 0,
        notes: sp.assemblyLab.notes,
      },
    });
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
