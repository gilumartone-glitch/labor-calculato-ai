import { uid } from "@/lib/format";

export const NET_TO_GROSS_RATIO = 0.82;
export const WORK_HOURS_PER_DAY = 8;
export const WORK_DAYS_PER_MONTH = 22;
export const SALARY_MONTHS = 13;
export const SHARED_WORKSHOP_MATERIALS_KEY = "officina:materiali-accessori-comuni:v1";

export type WorkshopMaterialCategory = "legno" | "plastica" | "accessori";
export type WorkshopMaterial = {
  id: string;
  category: WorkshopMaterialCategory;
  name: string;
  detail: string;
  thickness: number;
  width: number;
  height: number;
  sizeUnit: "cm" | "mm";
  unit: string;
  unitCost: number;
};

export type WorkshopWorker = {
  hourlyRate?: number;
  inpsPct: number;
  inailPct: number;
  tfrPct: number;
  extraCosts: number;
  annualHours: number;
};

export const starterWorkshopMaterials = (): WorkshopMaterial[] => [
  { id: uid(), category: "legno", name: "Multistrato", detail: "Pannello", thickness: 18, width: 252, height: 125, sizeUnit: "cm", unit: "pz", unitCost: 0 },
  { id: uid(), category: "legno", name: "MDF", detail: "Pannello grezzo", thickness: 18, width: 280, height: 207, sizeUnit: "cm", unit: "pz", unitCost: 0 },
  { id: uid(), category: "plastica", name: "Plexi trasparente", detail: "Lastra", thickness: 5, width: 205, height: 305, sizeUnit: "cm", unit: "pz", unitCost: 0 },
  { id: uid(), category: "accessori", name: "Viti / ferramenta", detail: "Voce personalizzata", thickness: 0, width: 0, height: 0, sizeUnit: "cm", unit: "pz", unitCost: 0 },
  { id: uid(), category: "accessori", name: "Tasselli / staffe / silicone", detail: "Materiale di posa", thickness: 0, width: 0, height: 0, sizeUnit: "cm", unit: "pz", unitCost: 0 },
];

export const workerBaseRal = (w: WorkshopWorker) =>
  (Math.max(0, w.hourlyRate ?? 0) * WORK_HOURS_PER_DAY * WORK_DAYS_PER_MONTH * SALARY_MONTHS) / NET_TO_GROSS_RATIO;
export const workerInps = (w: WorkshopWorker) => workerBaseRal(w) * (w.inpsPct / 100);
export const workerInail = (w: WorkshopWorker) => workerBaseRal(w) * (w.inailPct / 100);
export const workerTfr = (w: WorkshopWorker) => workerBaseRal(w) * (w.tfrPct / 100);
export const workerCompanyCost = (w: WorkshopWorker) => workerBaseRal(w) + workerInps(w) + workerInail(w) + workerTfr(w) + w.extraCosts;
export const workerHourlyCost = (w: WorkshopWorker) => workerCompanyCost(w) / Math.max(1, w.annualHours);

export const loadSharedWorkshopMaterials = <T extends WorkshopMaterial>(fallback: T[]): T[] => {
  try {
    const raw = localStorage.getItem(SHARED_WORKSHOP_MATERIALS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const saveSharedWorkshopMaterials = <T extends WorkshopMaterial>(materials: T[]) => {
  try {
    localStorage.setItem(SHARED_WORKSHOP_MATERIALS_KEY, JSON.stringify(materials));
  } catch {
    // ignore storage failures
  }
};