import { supabase } from "@/integrations/supabase/client";
import { CatalogMaterial } from "@/components/calculator/types";
import { InvItem, ScrapPiece } from "./types";

/* ------------------------------------------------------------------ *
 *  Conversioni unità → mm                                             *
 * ------------------------------------------------------------------ */
const toMm = (val: string | number | undefined | null, unit?: string): number | null => {
  if (val === undefined || val === null || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  const u = (unit || "mm").toLowerCase();
  if (u === "m") return n * 1000;
  if (u === "cm") return n * 10;
  return n; // mm
};

/** Estrae (W, H) in mm dalla stringa `format` tipo "3050x2030", "3050 x 2030 mm", "305x203 cm" */
const parseFormat = (fmt?: string): { w: number; h: number } | null => {
  if (!fmt) return null;
  const m = fmt.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/i);
  if (!m) return null;
  const a = parseFloat(m[1].replace(",", "."));
  const b = parseFloat(m[2].replace(",", "."));
  const u = (m[3] || "mm").toLowerCase();
  const mul = u === "m" ? 1000 : u === "cm" ? 10 : 1;
  return { w: a * mul, h: b * mul };
};

/** Restituisce dimensioni lastra intera in mm dal listino (se possibile). */
export const sheetSizeFromCatalog = (mat: CatalogMaterial | undefined | null): { w: number; h: number } | null => {
  if (!mat) return null;
  const fromFormat = parseFormat(mat.format as any);
  if (fromFormat) return fromFormat;
  const w = toMm(mat.baseWidth, mat.dimUnit);
  const h = toMm(mat.height, mat.heightUnit);
  if (w && h) return { w, h };
  return null;
};

/* ------------------------------------------------------------------ *
 *  Matching pezzi richiesti contro pezzi disponibili                  *
 * ------------------------------------------------------------------ */
export type ReqPiece = { w_mm: number; h_mm: number; allowRotate?: boolean };

export type Suggestion = {
  kind: "intera" | "sfrido";
  /** id riga magazzino */
  inventory_id: string;
  /** se sfrido, il pezzo specifico */
  piece?: ScrapPiece;
  /** dimensioni effettive del supporto */
  source_w: number;
  source_h: number;
  /** orientamento del pezzo richiesto: false = come richiesto, true = ruotato 90° */
  rotated: boolean;
  /** mm² scartati = source - richiesto */
  waste_mm2: number;
  /** % di utilizzo (richiesto / fonte) */
  utilization: number;
};

const fits = (req: ReqPiece, src: { w: number; h: number }): { ok: boolean; rotated: boolean } => {
  if (req.w_mm <= src.w && req.h_mm <= src.h) return { ok: true, rotated: false };
  if (req.allowRotate !== false && req.h_mm <= src.w && req.w_mm <= src.h)
    return { ok: true, rotated: true };
  return { ok: false, rotated: false };
};

/** Suggerisce, per UNA riga di magazzino + listino, fonti utili. Ordinate per spreco minimo. */
export const suggestSourcesForRow = (
  inv: InvItem,
  scraps: ScrapPiece[],
  sheet: { w: number; h: number } | null,
  req: ReqPiece,
): Suggestion[] => {
  const out: Suggestion[] = [];
  const reqArea = req.w_mm * req.h_mm;

  // 1) lastre intere (se ci stanno)
  if (sheet && inv.qty_intera > 0) {
    const f = fits(req, sheet);
    if (f.ok) {
      const srcArea = sheet.w * sheet.h;
      out.push({
        kind: "intera",
        inventory_id: inv.id,
        source_w: sheet.w,
        source_h: sheet.h,
        rotated: f.rotated,
        waste_mm2: srcArea - reqArea,
        utilization: reqArea / srcArea,
      });
    }
  }

  // 2) sfridi liberi
  for (const p of scraps) {
    if (p.status !== "libero") continue;
    const f = fits(req, { w: p.w_mm, h: p.h_mm });
    if (!f.ok) continue;
    const srcArea = p.w_mm * p.h_mm;
    out.push({
      kind: "sfrido",
      inventory_id: inv.id,
      piece: p,
      source_w: p.w_mm,
      source_h: p.h_mm,
      rotated: f.rotated,
      waste_mm2: srcArea - reqArea,
      utilization: reqArea / srcArea,
    });
  }

  // privilegia sfrido (≃ utilizzo > 0.5) prima di lastre intere a parità di waste basso
  out.sort((a, b) => {
    // pezzi quasi perfetti (≥ 80% utilizzo) prima
    const aHigh = a.utilization >= 0.8 ? 0 : 1;
    const bHigh = b.utilization >= 0.8 ? 0 : 1;
    if (aHigh !== bHigh) return aHigh - bHigh;
    // poi sfrido prima di intera
    if (a.kind !== b.kind) return a.kind === "sfrido" ? -1 : 1;
    // poi spreco minore
    return a.waste_mm2 - b.waste_mm2;
  });
  return out;
};

/* ------------------------------------------------------------------ *
 *  Codice progressivo per i pezzi: SF-{INVCODE}-A, -B, ...            *
 * ------------------------------------------------------------------ */
export const nextScrapCode = (invCode: string, existing: ScrapPiece[]): string => {
  const used = new Set(existing.map((p) => p.code));
  // A..Z, poi AA..AZ
  const letters = (i: number): string => {
    let s = "";
    let n = i;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };
  for (let i = 0; i < 26 * 27; i++) {
    const code = `SF-${invCode}-${letters(i)}`;
    if (!used.has(code)) return code;
  }
  return `SF-${invCode}-${Date.now()}`;
};

/** Formatta dimensioni mm → "120×80 cm" (lavoriamo in centimetri lato UI). */
export const fmtMm = (w: number, h: number) =>
  `${Math.round(w / 10)}×${Math.round(h / 10)} cm`;

/* ------------------------------------------------------------------ *
 *  Riserva / consumo pezzi                                            *
 * ------------------------------------------------------------------ */
export async function reservePiece(pieceId: string, orderId: string, subId?: string) {
  return supabase
    .from("inventory_scrap_pieces")
    .update({ status: "riservato", reserved_for_order: orderId, reserved_for_sub: subId ?? null })
    .eq("id", pieceId);
}

export async function consumePiece(pieceId: string) {
  return supabase.from("inventory_scrap_pieces").update({ status: "usato" }).eq("id", pieceId);
}

export async function freePiece(pieceId: string) {
  return supabase
    .from("inventory_scrap_pieces")
    .update({ status: "libero", reserved_for_order: null, reserved_for_sub: null })
    .eq("id", pieceId);
}
