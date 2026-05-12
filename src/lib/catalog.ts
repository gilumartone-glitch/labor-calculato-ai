import * as XLSX from "xlsx";
import { Catalog, CatalogMaterial, CatalogOperation } from "@/components/calculator/types";
import { uid } from "./format";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_PREFIX = "officina:catalog:";

export const emptyCatalog = (): Catalog => ({
  materials: [],
  operations: [],
  perimeterOps: [],
  perimeterPresets: [],
  importedAt: null,
  fileName: null,
});

export const loadCatalog = (dept: string): Catalog => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + dept);
    if (!raw) return emptyCatalog();
    const parsed = JSON.parse(raw) as Partial<Catalog>;
    // back-compat: i cataloghi vecchi non hanno perimeterOps
    return {
      materials: parsed.materials ?? [],
      operations: parsed.operations ?? [],
      perimeterOps: parsed.perimeterOps ?? [],
      perimeterPresets: parsed.perimeterPresets ?? [],
      importedAt: parsed.importedAt ?? null,
      fileName: parsed.fileName ?? null,
      markupPct: parsed.markupPct ?? 0,
      printOps: parsed.printOps ?? [],
    };
  } catch {
    return emptyCatalog();
  }
};

export const saveCatalog = (dept: string, catalog: Catalog) => {
  localStorage.setItem(STORAGE_PREFIX + dept, JSON.stringify(catalog));
};

export const clearCatalog = (dept: string) => {
  localStorage.removeItem(STORAGE_PREFIX + dept);
};

/* ========== CLOUD SYNC (Lovable Cloud) ========== */

/** Carica un catalogo dal cloud. Ritorna null se non esiste. */
export const loadCatalogCloud = async (dept: string): Promise<Catalog | null> => {
  const { data, error } = await supabase
    .from("catalogs")
    .select("data")
    .eq("dept", dept)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = (data.data ?? {}) as Partial<Catalog>;
  return {
    materials: parsed.materials ?? [],
    operations: parsed.operations ?? [],
    perimeterOps: parsed.perimeterOps ?? [],
    perimeterPresets: parsed.perimeterPresets ?? [],
    importedAt: parsed.importedAt ?? null,
    fileName: parsed.fileName ?? null,
    markupPct: parsed.markupPct ?? 0,
    printOps: parsed.printOps ?? [],
  };
};

/** Salva un catalogo nel cloud (upsert per dept). */
export const saveCatalogCloud = async (dept: string, catalog: Catalog): Promise<void> => {
  const { data: userData } = await supabase.auth.getUser();
  const updated_by = userData?.user?.id ?? null;
  const { error } = await supabase
    .from("catalogs")
    .upsert(
      [{ dept, data: catalog as unknown as never, updated_by: updated_by ?? undefined }],
      { onConflict: "dept" },
    );
  if (error) throw error;
};

/* Normalizza un valore in stringa pulita */
const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const n = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const num = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return isFinite(num) ? num : 0;
};

/* Cerca una colonna per nome (case-insensitive, parziale) */
const findKey = (row: Record<string, unknown>, candidates: string[]): string | null => {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const k = keys.find((x) => x.toLowerCase().includes(cand.toLowerCase()));
    if (k) return k;
  }
  return null;
};

const parseBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const str = s(v).toLowerCase();
  return ["si", "sì", "yes", "y", "true", "1", "x"].includes(str);
};

export type ParseResult = {
  catalog: Catalog;
  materialsCount: number;
  operationsCount: number;
  warnings: string[];
};

export const parseCatalogFile = async (file: File): Promise<ParseResult> => {
  // Supporto XML: stesso schema del template (<listino><materiali><materiale>...)
  const isXml =
    /\.xml$/i.test(file.name) ||
    file.type === "text/xml" ||
    file.type === "application/xml";
  if (isXml) {
    return parseCatalogXml(file);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const warnings: string[] = [];

  const findSheet = (needles: string[]) => {
    for (const sheetName of wb.SheetNames) {
      if (needles.some((n) => sheetName.toLowerCase().includes(n))) {
        return wb.Sheets[sheetName];
      }
    }
    return null;
  };

  let materialsSheet =
    findSheet(["materiali", "tessut", "listino"]) ?? wb.Sheets[wb.SheetNames[0]];
  const operationsSheet = findSheet(["lavorazion", "operation"]);

  const materials: CatalogMaterial[] = [];
  const operations: CatalogOperation[] = [];

  if (materialsSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(materialsSheet, {
      defval: "",
    });
    for (const row of rows) {
      const nameKey = findKey(row, ["nome", "prodotto", "tessuto", "materiale"]);
      const weightKey = findKey(row, ["peso", "weight", "grammatura"]);
      const colorKey = findKey(row, ["colore", "color"]);
      const heightKey = findKey(row, ["altezza", "formato", "spessore", "height"]);
      const compKey = findKey(row, ["composizione", "composition"]);
      const fireKey = findKey(row, ["ignifug", "fireproof"]);
      const unitKey = findKey(row, ["unit"]);
      const priceKey = findKey(row, ["prezzo", "costo", "price"]);
      const piecePriceKey = findKey(row, ["pezza", "intera"]);
      const cutPriceKey = findKey(row, ["taglio", "cut"]);
      const noteKey = findKey(row, ["note"]);

      if (!nameKey || (!priceKey && !piecePriceKey && !cutPriceKey)) continue;
      const name = s(row[nameKey]);
      if (!name) continue;
      const fallback = priceKey ? n(row[priceKey]) : 0;
      const pricePiece = piecePriceKey ? n(row[piecePriceKey]) : fallback;
      const priceCut = cutPriceKey ? n(row[cutPriceKey]) : fallback;

      materials.push({
        id: uid(),
        name,
        weight: weightKey ? s(row[weightKey]) : "",
        color: colorKey ? s(row[colorKey]) : "",
        height: heightKey ? s(row[heightKey]) : "",
        heightUnit: "cm",
        composition: compKey ? s(row[compKey]) : "",
        fireproof: fireKey ? s(row[fireKey]) : "",
        unit: unitKey ? s(row[unitKey]) || "m" : "m",
        pricePiece,
        priceCut,
        note: noteKey ? s(row[noteKey]) : "",
      });
    }
    if (!materials.length)
      warnings.push("Nessun materiale valido trovato nel foglio listino.");
  }

  if (operationsSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(operationsSheet, {
      defval: "",
    });
    for (const row of rows) {
      const nameKey = findKey(row, ["lavorazion", "nome", "operation"]);
      const typeKey = findKey(row, ["tipo", "type"]);
      const unitKey = findKey(row, ["unit"]);
      const priceKey = findKey(row, ["prezzo", "costo", "price"]);
      const noteKey = findKey(row, ["note"]);

      if (!nameKey || !priceKey) continue;
      const name = s(row[nameKey]);
      if (!name) continue;

      const rawType = typeKey ? s(row[typeKey]).toLowerCase() : "unità";
      const mode: "unità" | "ora" = rawType.startsWith("or") ? "ora" : "unità";

      operations.push({
        id: uid(),
        name,
        type: mode,
        unit: unitKey ? s(row[unitKey]) || (mode === "ora" ? "h" : "pz") : mode === "ora" ? "h" : "pz",
        price: n(row[priceKey]),
        note: noteKey ? s(row[noteKey]) : "",
      });
    }
  }

  return {
    catalog: {
      materials,
      operations,
      perimeterOps: [],
      perimeterPresets: [],
      importedAt: new Date().toISOString(),
      fileName: file.name,
    },
    materialsCount: materials.length,
    operationsCount: operations.length,
    warnings,
  };
};

/* ========== XML PARSER ========== */
const parseCatalogXml = async (file: File): Promise<ParseResult> => {
  const text = await file.text();
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("XML non valido: " + parseError.textContent);
  }
  const tag = (el: Element, name: string): string => {
    const child = el.getElementsByTagName(name)[0];
    return child ? (child.textContent ?? "").trim() : "";
  };
  const materials: CatalogMaterial[] = [];
  const operations: CatalogOperation[] = [];

  const matNodes = Array.from(doc.getElementsByTagName("materiale"));
  for (const el of matNodes) {
    const name = tag(el, "name") || tag(el, "nome");
    if (!name) continue;
    const pricePiece = n(tag(el, "pricePiece") || tag(el, "prezzo_pezza") || tag(el, "prezzo"));
    const priceCut = n(tag(el, "priceCut") || tag(el, "prezzo_taglio") || tag(el, "prezzo"));
    materials.push({
      id: uid(),
      name,
      weight: tag(el, "weight") || tag(el, "peso"),
      color: tag(el, "color") || tag(el, "colore"),
      height: tag(el, "height") || tag(el, "altezza"),
      heightUnit: "cm",
      composition: tag(el, "composition") || tag(el, "composizione"),
      fireproof: tag(el, "fireproof") || tag(el, "ignifugo"),
      unit: tag(el, "unit") || tag(el, "unità") || "m",
      pricePiece,
      priceCut,
      note: tag(el, "note"),
    });
  }

  const opNodes = Array.from(doc.getElementsByTagName("lavorazione"));
  for (const el of opNodes) {
    const name = tag(el, "name") || tag(el, "nome");
    if (!name) continue;
    const rawType = (tag(el, "type") || tag(el, "tipo") || "unità").toLowerCase();
    const mode: "unità" | "ora" = rawType.startsWith("or") ? "ora" : "unità";
    operations.push({
      id: uid(),
      name,
      type: mode,
      unit: tag(el, "unit") || (mode === "ora" ? "h" : "pz"),
      price: n(tag(el, "price") || tag(el, "prezzo")),
      note: tag(el, "note"),
    });
  }

  if (!materials.length && !operations.length) {
    warnings.push("Nessun <materiale> o <lavorazione> trovato nell'XML.");
  }

  return {
    catalog: {
      materials,
      operations,
      perimeterOps: [],
      perimeterPresets: [],
      importedAt: new Date().toISOString(),
      fileName: file.name,
    },
    materialsCount: materials.length,
    operationsCount: operations.length,
    warnings,
  };
};

/* Estrae le opzioni concatenate per i dropdown: Nome → Colore → Altezza */
export const getCatalogTree = (materials: CatalogMaterial[]) => {
  const names = Array.from(new Set(materials.map((m) => m.name))).sort();
  return {
    names,
    colorsFor: (name: string) =>
      Array.from(new Set(materials.filter((m) => m.name === name).map((m) => m.color))).filter(Boolean),
    heightsFor: (name: string, color: string) =>
      Array.from(
        new Set(
          materials
            .filter((m) => m.name === name && m.color === color)
            .map((m) => m.height)
        )
      ).filter(Boolean),
    fireproofsFor: (name: string, color: string, height: string) =>
      Array.from(
        new Set(
          materials
            .filter((m) => m.name === name && m.color === color && m.height === height)
            .map((m) => m.fireproof)
        )
      ),
    findVariant: (name: string, color: string, height: string, fireproof?: string) => {
      const matches = materials.filter(
        (m) => m.name === name && m.color === color && m.height === height
      );
      if (fireproof !== undefined) {
        const exact = matches.find((m) => (m.fireproof || "") === (fireproof || ""));
        if (exact) return exact;
      }
      return matches[0];
    },
  };
};