import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, ListPlus, X, Save, Pencil, Layers, FileSpreadsheet, Download } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Catalog, CatalogMaterial } from "./types";
import { uid, eur } from "@/lib/format";
import { AutocompleteInput } from "./AutocompleteInput";
import { SelectWithAdd } from "./SelectWithAdd";
import { priceMultiplier } from "@/lib/pricing";

interface CatalogEditorProps {
  catalog: Catalog;
  onCatalogChange: (c: Catalog) => void;
  deptLabel: string;
  /** Reparto (per UI specifiche, es. tappezzeria usa 3 prezzi manuali). */
  deptKey?: string;
}

const HEIGHT_UNITS = ["cm", "m", "mm"];

type Variant = {
  id: string;
  color: string;
  /** Spessore della variante (es. "0.5 mm" / "3 mm"). */
  thickness: string;
  /** Finitura della variante (Opaca, Lucida, Satinata, Specchio, Metallizzata, Spazzolata). */
  finish: string;
  /** Tipo ignifugo (es. "Classe 1"). Vuoto = non ignifugo. */
  fireproof: string;
  /** Dimensione principale della variante:
   *  - per LASTRA: base
   *  - per ROTOLO: lunghezza
   *  Espressa nell'unità del prodotto (form.dimUnit). */
  dim1: string;
  /** Altezza della variante (sia lastra che rotolo), in form.dimUnit. */
  dim2: string;
  /** Prezzo di costo (acquisto) unico per la variante. I 4 prezzi di vendita
   *  (Riv/Fin × intero/taglio) vengono calcolati automaticamente dai moltiplicatori. */
  purchasePrice: number;
  /** Solo per Tappezzeria (schema "manuale"): prezzo di vendita rotolo intero. */
  sellPiece?: number;
  /** Solo per Tappezzeria (schema "manuale"): prezzo di vendita al taglio. */
  sellCut?: number;
};

type ProductForm = {
  /** chiave originale (nome + peso + composizione) per identificare il prodotto in editing */
  editingKey: string | null;
  name: string;
  unit: string;
  /** Formato del prodotto: lastra (rigida) o rotolo (tessuto/film) */
  format: "lastra" | "rotolo";
  /** Unità delle dimensioni delle varianti (cm/mm/m). */
  dimUnit: string;
  /** Unità in cui sono espressi i prezzi d'acquisto: mq o ml */
  priceUnit: "mq" | "ml";
  variants: Variant[];
};

const newVariant = (): Variant => ({
  id: uid(),
  color: "",
  thickness: "",
  finish: "",
  fireproof: "",
  dim1: "",
  dim2: "",
  purchasePrice: 0,
  sellPiece: 0,
  sellCut: 0,
});

const emptyForm = (): ProductForm => ({
  editingKey: null,
  name: "",
  unit: "m",
  format: "rotolo",
  dimUnit: "cm",
  priceUnit: "ml",
  variants: [newVariant()],
});

const productKey = (m: { name: string; format?: string }) =>
  `${m.name.trim().toLowerCase()}|${(m.format ?? "").trim()}`;

const collect = (mats: CatalogMaterial[], key: keyof CatalogMaterial) =>
  Array.from(
    new Set(mats.map((m) => String(m[key] ?? "")).filter((v) => v.trim() !== ""))
  ).sort();

export const CatalogEditor = ({ catalog, onCatalogChange, deptLabel, deptKey }: CatalogEditorProps) => {
  const isTappezzeria = deptKey === "tappezzeria";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm());
  const [search, setSearch] = useState("");
  const xlsxFileRef = useRef<HTMLInputElement>(null);

  // Stato per la mappatura colonne quando l'auto-detect non riesce
  type MapField =
    | "name" | "unit" | "format" | "dimUnit" | "priceUnit"
    | "thickness" | "color" | "finish" | "dim1" | "dim2" | "purchasePrice";
  type MappingState = {
    fileName: string;
    columns: string[];
    rows: Record<string, unknown>[];
    mapping: Record<MapField, string>;
  };
  const [mapping, setMapping] = useState<MappingState | null>(null);

  const mats = catalog.materials;

  // Raggruppa il listino per "prodotto base"
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; weight: string; composition: string; unit: string; items: CatalogMaterial[] }>();
    for (const m of mats) {
      const k = productKey(m);
      const g = map.get(k);
      if (g) g.items.push(m);
      else map.set(k, { name: m.name, weight: m.weight, composition: m.composition, unit: m.unit, items: [m] });
    }
    return Array.from(map.entries()).map(([key, g]) => ({ key, ...g }));
  }, [mats]);

  const reset = () => setForm(emptyForm());

  const updateVariant = (id: string, patch: Partial<Variant>) =>
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));

  const addVariantRow = () =>
    setForm((f) => ({ ...f, variants: [...f.variants, newVariant()] }));

  const removeVariantRow = (id: string) =>
    setForm((f) => ({
      ...f,
      variants: f.variants.length > 1 ? f.variants.filter((v) => v.id !== id) : f.variants,
    }));

  const loadProduct = (key: string) => {
    const g = grouped.find((x) => x.key === key);
    if (!g) return;
    const first = g.items[0];
    const fmt = (first?.format as "lastra" | "rotolo") || "rotolo";
    setForm({
      editingKey: key,
      name: g.name,
      unit: g.unit || "m",
      format: fmt,
      dimUnit: first?.dimUnit || first?.heightUnit || "cm",
      priceUnit: (first?.priceUnit as "mq" | "ml") || "ml",
      variants: g.items.map((m) => ({
        id: m.id,
        color: m.color,
        thickness: m.thickness ?? "",
        finish: m.finish ?? "",
        fireproof: m.fireproof ?? "",
        dim1: (fmt === "lastra" ? (m.baseWidth ?? "") : (m.rollLength ?? "")) || "",
        dim2: m.height ?? "",
        // Per il nuovo schema (Tappezzeria) il costo è in `costPrice`. Per lo
        // schema legacy il "prezzo di costo" è in pricePiece/priceCut.
        purchasePrice:
          typeof m.costPrice === "number"
            ? m.costPrice
            : (m.pricePiece || m.priceCut || 0),
        sellPiece: m.pricePiece || 0,
        sellCut: m.priceCut || 0,
      })),
    });
    toast.info(`In modifica: ${g.name}`);
  };

  const removeProduct = (key: string) => {
    const remaining = mats.filter((m) => productKey(m) !== key);
    onCatalogChange({ ...catalog, materials: remaining });
    if (form.editingKey === key) reset();
    toast.success("Prodotto eliminato");
  };

  const save = () => {
    if (!form.name.trim()) {
      toast.error("Il nome del prodotto è obbligatorio");
      return;
    }
    // Se non sono state inserite varianti compilate, salviamo comunque il
    // prodotto creando una "variante singola" con i soli dati base. Questo
    // permette di registrare prodotti senza necessità di varianti multiple.
    let validVariants = form.variants.filter(
      (v) =>
        v.purchasePrice > 0 ||
        (v.sellPiece ?? 0) > 0 ||
        (v.sellCut ?? 0) > 0 ||
        v.color.trim() ||
        v.thickness.trim() ||
        v.finish.trim() ||
        v.fireproof.trim() ||
        v.dim1.trim() ||
        v.dim2.trim(),
    );
    if (validVariants.length === 0) {
      // Nessuna variante: creo una riga "vuota" così il prodotto compare comunque
      validVariants = [newVariant()];
    }

    const newItems: CatalogMaterial[] = validVariants.map((v) => ({
      id: uid(),
      name: form.name.trim(),
      // weight/composition non sono più gestiti dal form (legacy schema)
      weight: "",
      composition: "",
      color: v.color.trim(),
      // Dimensioni per variante: ognuna ha le proprie misure
      height: v.dim2.trim(),
      heightUnit: form.dimUnit,
      fireproof: v.fireproof.trim(),
      unit: form.unit.trim() || "m",
      // Tappezzeria: salviamo i prezzi di vendita MANUALI in pricePiece/priceCut
      // e il costo (per margine) in costPrice. Per gli altri reparti (legacy)
      // il "purchasePrice" è il costo, e i prezzi di vendita Riv/Fin × int/tag
      // sono calcolati a runtime.
      pricePiece: isTappezzeria ? (v.sellPiece ?? 0) : v.purchasePrice,
      priceCut: isTappezzeria ? (v.sellCut ?? 0) : v.purchasePrice,
      ...(isTappezzeria ? { costPrice: v.purchasePrice } : {}),
      format: form.format,
      thickness: v.thickness.trim(),
      finish: v.finish.trim(),
      priceUnit: form.priceUnit,
      baseWidth: form.format === "lastra" ? v.dim1.trim() : "",
      rollLength: form.format === "rotolo" ? v.dim1.trim() : "",
      dimUnit: form.dimUnit,
      note: "",
    }));

    // se in editing, rimuovo le righe del prodotto originale
    const base = form.editingKey
      ? mats.filter((m) => productKey(m) !== form.editingKey)
      : mats;

    onCatalogChange({
      ...catalog,
      materials: [...base, ...newItems],
      importedAt: catalog.importedAt ?? new Date().toISOString(),
    });
    toast.success(
      form.editingKey ? "Prodotto aggiornato" : `Prodotto salvato (${newItems.length} varianti)`
    );
    reset();
  };

  // Suggerimenti autocomplete
  const sNames = collect(mats, "name");
  const sUnits = collect(mats, "unit");
  const sColors = collect(mats, "color");
  const sHeights = collect(mats, "height");
  const sThickness = collect(mats, "thickness");
  const FINISH_OPTIONS = ["Opaca", "Lucida", "Satinata", "Specchio", "Metallizzata", "Spazzolata"];
  const sFinish = Array.from(new Set([...FINISH_OPTIONS, ...collect(mats, "finish" as keyof CatalogMaterial)]));
  const FIREPROOF_OPTIONS = ["", "Classe 1", "Classe 1IM", "B1", "M1"];
  const sFireproof = Array.from(new Set([...FIREPROOF_OPTIONS, ...collect(mats, "fireproof")]));

  const numFromCell = (v: unknown): number => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(",", "."));
    return isFinite(n) ? n : 0;
  };

  const findCol = (row: Record<string, unknown>, candidates: string[]): string | null => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
      const k = keys.find((x) => x.toLowerCase().replace(/\s+/g, "").includes(cand.toLowerCase().replace(/\s+/g, "")));
      if (k) return k;
    }
    return null;
  };

  const importExcelVariants = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        toast.error("Il file non contiene fogli");
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (rows.length === 0) {
        toast.error("Nessuna riga trovata nel foglio");
        return;
      }

      const sample = rows[0];
      const columns = Object.keys(sample);
      const auto: Record<MapField, string> = {
        name: findCol(sample, ["nomeprodotto", "nome", "prodotto", "name"]) ?? "",
        unit: findCol(sample, ["unitàprezzo", "unitaprezzo", "priceunit"]) ?? "",
        format: findCol(sample, ["formato", "format"]) ?? "",
        dimUnit: findCol(sample, ["unitàdimensioni", "unitadimensioni", "dimunit"]) ?? "",
        priceUnit: findCol(sample, ["prezzidacquisto", "prezzidacqui", "priceunitlabel"]) ?? "",
        thickness: findCol(sample, ["spessore", "thickness"]) ?? "",
        color: findCol(sample, ["colore", "color"]) ?? "",
        finish: findCol(sample, ["finitura", "finish"]) ?? "",
        dim1: findCol(sample, ["base", "lunghezza"]) ?? "",
        dim2: findCol(sample, ["altezza", "^h$", "height"]) ?? "",
        purchasePrice:
          findCol(sample, ["costo", "prezzocosto", "acquisto", "purchaseprice", "prezzo"]) ??
          "",
      };

      // Apri il mapping se manca il nome prodotto (il prezzo è opzionale: si può
      // importare un file solo per aggiornare formati/dimensioni)
      const needMapping = !auto.name;
      if (needMapping) {
        setMapping({ fileName: file.name, columns, rows, mapping: auto });
        toast.info("Mappa le colonne per continuare l'import");
        return;
      }

      applyMappingAndImport(rows, auto, file.name);
    } catch (err) {
      console.error(err);
      toast.error("Impossibile leggere il file Excel");
    }
  };

  const applyMappingAndImport = (
    rows: Record<string, unknown>[],
    map: Record<MapField, string>,
    fileName: string,
  ) => {
    // Raggruppa le righe per (name, unit, format, dimUnit): le righe con gli
    // stessi 4 valori appartengono allo stesso prodotto e generano varianti.
    type Group = {
      name: string;
      unit: string;
      format: "lastra" | "rotolo";
      dimUnit: string;
      priceUnit: "mq" | "ml";
      variants: {
        color: string;
        thickness: string;
        finish: string;
        dim1: string;
        dim2: string;
        purchasePrice: number;
      }[];
    };
    const norm = (v: unknown) => String(v ?? "").trim();
    const normFormat = (v: unknown): "lastra" | "rotolo" => {
      const s = norm(v).toLowerCase();
      return s.startsWith("la") ? "lastra" : "rotolo";
    };
    const normPriceUnit = (v: unknown): "mq" | "ml" => {
      const s = norm(v).toLowerCase();
      if (s.includes("mq") || s.includes("m²") || s === "m2") return "mq";
      return "ml";
    };
    const normDimUnit = (v: unknown) => {
      const s = norm(v).toLowerCase();
      if (s === "mm" || s === "m" || s === "cm") return s;
      return "cm";
    };

    const groups = new Map<string, Group>();
    let skipped = 0;
    for (const row of rows) {
      const name = map.name ? norm(row[map.name]) : "";
      const unit = map.unit ? norm(row[map.unit]) : "m";
      const format = map.format ? normFormat(row[map.format]) : "rotolo";
      const dimUnit = map.dimUnit ? normDimUnit(row[map.dimUnit]) : "cm";
      const priceUnit = map.priceUnit ? normPriceUnit(row[map.priceUnit]) : (format === "lastra" ? "mq" : "ml");
      const purchasePrice = map.purchasePrice ? numFromCell(row[map.purchasePrice]) : 0;
      const color = map.color ? norm(row[map.color]) : "";
      const thickness = map.thickness ? norm(row[map.thickness]) : "";
      const finish = map.finish ? norm(row[map.finish]) : "";
      const dim1 = map.dim1 ? norm(row[map.dim1]) : "";
      const dim2 = map.dim2 ? norm(row[map.dim2]) : "";

      // Riga senza nome prodotto: scarta. Il prezzo può essere 0 quando si
      // sta solo aggiornando dati come formato/dimensioni di un prodotto esistente.
      if (!name) {
        skipped++;
        continue;
      }

      const key = `${name.toLowerCase()}|${unit}|${format}|${dimUnit}`;
      let g = groups.get(key);
      if (!g) {
        g = { name, unit: unit || "m", format, dimUnit, priceUnit, variants: [] };
        groups.set(key, g);
      }
      g.variants.push({ color, thickness, finish, dim1, dim2, purchasePrice });
    }

    if (groups.size === 0) {
      toast.error("Nessun prodotto valido nel file (serve almeno il nome prodotto)");
      return;
    }

    // MERGE: se un prodotto con la stessa chiave (name|format) esiste già,
    // aggiorniamo solo i campi non vuoti delle varianti corrispondenti
    // (matchate su colore+spessore+finitura). Le varianti nuove vengono aggiunte.
    const updatedMaterials = [...catalog.materials];
    const variantKey = (v: { color?: string; thickness?: string; finish?: string }) =>
      `${(v.color ?? "").trim().toLowerCase()}|${(v.thickness ?? "").trim().toLowerCase()}|${(v.finish ?? "").trim().toLowerCase()}`;
    const merge = (s: string, fallback: string) => (s && s.trim() !== "" ? s : fallback);
    const mergeNum = (n: number, fallback: number) => (n && n > 0 ? n : fallback);

    let touchedProducts = 0;
    let updatedVariants = 0;
    let addedVariants = 0;

    for (const g of groups.values()) {
      const pKey = productKey({ name: g.name, format: g.format });
      const existingIdx = updatedMaterials
        .map((m, i) => (productKey(m) === pKey ? i : -1))
        .filter((i) => i >= 0);
      const productExists = existingIdx.length > 0;
      if (productExists) touchedProducts++;

      for (const v of g.variants) {
        const vKey = variantKey(v);
        const matchIdx = existingIdx.find((i) => variantKey(updatedMaterials[i]) === vKey);
        if (matchIdx !== undefined) {
          // Aggiorna solo i campi non vuoti (preserva quelli già esistenti)
          const old = updatedMaterials[matchIdx];
          updatedMaterials[matchIdx] = {
            ...old,
            name: g.name,
            unit: merge(g.unit, old.unit),
            format: g.format,
            priceUnit: g.priceUnit ?? old.priceUnit,
            dimUnit: merge(g.dimUnit, old.dimUnit ?? old.heightUnit),
            heightUnit: merge(g.dimUnit, old.heightUnit),
            color: merge(v.color, old.color),
            thickness: merge(v.thickness, old.thickness ?? ""),
            finish: merge(v.finish, old.finish ?? ""),
            height: merge(v.dim2, old.height),
            baseWidth: g.format === "lastra" ? merge(v.dim1, old.baseWidth ?? "") : old.baseWidth,
            rollLength: g.format === "rotolo" ? merge(v.dim1, old.rollLength ?? "") : old.rollLength,
            pricePiece: mergeNum(v.purchasePrice, old.pricePiece),
            priceCut: mergeNum(v.purchasePrice, old.priceCut),
          };
          updatedVariants++;
        } else {
          updatedMaterials.push({
            id: uid(),
            name: g.name,
            weight: "",
            composition: "",
            color: v.color,
            height: v.dim2,
            heightUnit: g.dimUnit,
            fireproof: "",
            unit: g.unit,
            pricePiece: v.purchasePrice,
            priceCut: v.purchasePrice,
            format: g.format,
            thickness: v.thickness,
            finish: v.finish,
            priceUnit: g.priceUnit,
            baseWidth: g.format === "lastra" ? v.dim1 : "",
            rollLength: g.format === "rotolo" ? v.dim1 : "",
            dimUnit: g.dimUnit,
            note: "",
          });
          addedVariants++;
        }
      }
    }

    onCatalogChange({
      ...catalog,
      materials: updatedMaterials,
      importedAt: new Date().toISOString(),
      fileName,
    });

    const productCount = groups.size;
    const newProducts = productCount - touchedProducts;
    const parts: string[] = [];
    if (newProducts > 0) parts.push(`${newProducts} prodotto/i nuovi`);
    if (touchedProducts > 0) parts.push(`${touchedProducts} aggiornati`);
    if (addedVariants > 0) parts.push(`+${addedVariants} varianti`);
    if (updatedVariants > 0) parts.push(`${updatedVariants} aggiornate`);
    toast.success(
      `Import da ${fileName} · ${parts.join(" · ") || "nessuna modifica"}` +
        (skipped ? ` (${skipped} righe scartate)` : ""),
    );
    setMapping(null);
  };

  const downloadVariantsTemplate = () => {
    const data = [
      [
        "nome prodotto",
        "unità prezzo",
        "formato",
        "unità dimensioni",
        "prezzi d'acquisto",
        "colore",
        "spessore",
        "finitura",
        "base",
        "h",
        "costo",
      ],
      ["Forex", "mq", "lastra", "cm", "€/mq", "Bianco", "3 mm", "Opaca", 305, 200, 12.5],
      ["PVC adesivo", "ml", "rotolo", "m", "€/ml", "Trasparente", "0,1 mm", "Lucida", 1.37, 50, 14.0],
      ["Plexiglass", "mq", "lastra", "cm", "€/mq", "Trasparente", "5 mm", "Satinata", 200, 100, 35.0],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [
      { wch: 18 }, // nome prodotto
      { wch: 12 }, // unità prezzo
      { wch: 10 }, // formato
      { wch: 14 }, // unità dimensioni
      { wch: 16 }, // prezzi d'acquisto
      { wch: 16 }, // colore
      { wch: 12 }, // spessore
      { wch: 14 }, // finitura
      { wch: 8 },  // base
      { wch: 8 },  // h
      { wch: 10 }, // costo
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Varianti");
    XLSX.writeFile(wb, "template-varianti.xlsx");
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 px-3 py-2 border-2 border-ink rounded-sm text-xs uppercase tracking-wider font-semibold hover:bg-ink hover:text-paper transition-colors"
        >
          <ListPlus className="w-3.5 h-3.5" />
          Gestisci listino
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto bg-paper border-2 border-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            Listino {deptLabel}
            {form.editingKey && (
              <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 bg-primary text-primary-foreground rounded-sm">
                in modifica
              </span>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Crea un prodotto base e aggiungi tutte le sue varianti (colore × spessore × finitura).
            {isTappezzeria ? (
              <>
                {" "}Per ogni variante inserisci <strong>costo</strong> (usato solo per il calcolo
                del guadagno), <strong>prezzo rotolo</strong> e <strong>prezzo taglio</strong> (i prezzi di vendita).
              </>
            ) : (
              <>
                {" "}Per ogni variante inserisci il <strong>prezzo di costo</strong>: il sistema calcola
                automaticamente i 4 prezzi di vendita (Riv./Fin. × intero/taglio).
              </>
            )}
          </p>
        </DialogHeader>

        {/* Form prodotto base */}
        <div className="border-2 border-ink/20 rounded-sm p-4 bg-background">
          <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold mb-3">
            // Prodotto base
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Riga 1: Nome · Unità prezzo · Formato · €/mq o €/ml */}
            <div className="col-span-2">
              <label className="label-cap block mb-1">Nome prodotto *</label>
              <AutocompleteInput
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                suggestions={sNames}
                placeholder="es. Forex bianco"
              />
            </div>
            <div>
              <label className="label-cap block mb-1">Unità prezzo</label>
              <SelectWithAdd
                value={form.unit}
                onChange={(v) => setForm({ ...form, unit: v })}
                options={[...new Set([...sUnits, "m", "mq", "pz", "ml", "kg"])]}
                placeholder="m / mq / pz"
                allowEmpty={false}
              />
            </div>
            <div>
              <label className="label-cap block mb-1">Formato</label>
              <div className="flex border border-ink/40 rounded-sm overflow-hidden">
                {(["lastra", "rotolo"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setForm({ ...form, format: fmt })}
                    className={`flex-1 px-2 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                      form.format === fmt ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                    }`}
                  >
                    {fmt === "lastra" ? "Lastra" : "Rotolo"}
                  </button>
                ))}
              </div>
            </div>
            {/* Riga 2: Unità dimensioni varianti (le dimensioni sono per variante, sotto) */}
            <div>
              <label className="label-cap block mb-1">Unità dimensioni</label>
              <div className="flex border border-ink/40 rounded-sm overflow-hidden">
                {HEIGHT_UNITS.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setForm({ ...form, dimUnit: u })}
                    className={`flex-1 px-2 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                      form.dimUnit === u ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            {/* Riga 3: solo €/mq | €/ml (lo spessore è ora una proprietà di variante) */}
            <div>
              <label className="label-cap block mb-1">Prezzi d'acquisto in</label>
              <div className="flex border border-ink/40 rounded-sm overflow-hidden">
                {(["mq", "ml"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setForm({ ...form, priceUnit: u })}
                    title={u === "mq" ? "€/m² (metro quadro)" : "€/ml (metro lineare)"}
                    className={`flex-1 px-2 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                      form.priceUnit === u ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                    }`}
                  >
                    €/{u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Varianti */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold inline-flex items-center gap-1">
                <Layers className="w-3 h-3" />
                // Varianti · {form.variants.length}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={downloadVariantsTemplate}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-ink"
                  title="Scarica un template Excel con le colonne corrette"
                >
                  <Download className="w-3.5 h-3.5" /> Template
                </button>
                <input
                  ref={xlsxFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importExcelVariants(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => xlsxFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink hover:text-primary"
                  title="Importa varianti da file Excel (.xlsx / .csv)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Importa Excel
                </button>
                <button
                  type="button"
                  onClick={addVariantRow}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary hover:text-ink"
                >
                  <Plus className="w-3.5 h-3.5" /> Aggiungi variante
                </button>
              </div>
            </div>

            <div className="mb-3 px-3 py-2 bg-muted/30 border border-dashed border-ink/20 rounded-sm font-mono text-[10px] text-muted-foreground">
              // Excel · colonne richieste: <span className="text-ink font-bold">spessore · colore · finitura · prezzo costo</span>
              <span className="block mt-1">
                Le <span className="text-ink font-bold">dimensioni</span> ({form.format === "lastra" ? "base × altezza" : "altezza rotolo"})
                sono indipendenti per ogni variante: compilale nelle righe sotto.
                {form.format === "rotolo" && (
                  <span className="block mt-0.5 text-muted-foreground/80">
                    Il rotolo è venduto a metratura: serve solo l'altezza del rullo.
                  </span>
                )}
              </span>
              {isTappezzeria ? (
                <span className="block mt-1 text-muted-foreground/80">
                  Tappezzeria: il <strong>costo</strong> serve solo al calcolo del guadagno. I clienti vedono <strong>prezzo rotolo</strong> e <strong>prezzo taglio</strong>.
                </span>
              ) : (
                <span className="block mt-1 text-muted-foreground/80">
                  I 4 prezzi di vendita (Riv./Fin. × intero/taglio) sono calcolati automaticamente.
                </span>
              )}
            </div>

            <div className="border border-ink/20 rounded-sm divide-y divide-ink/10 overflow-visible">
              {/* header */}
              <div className="hidden md:grid grid-cols-24 gap-2 px-3 py-2 bg-muted/50 text-[10px] uppercase tracking-wider font-bold text-muted-foreground" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                <div className="col-span-3">Colore</div>
                <div className="col-span-2">Spessore</div>
                <div className="col-span-2">Finitura</div>
                <div className="col-span-2">Ignifugo</div>
                {form.format === "lastra" && (
                  <div className="col-span-2 text-right" title="Base lastra">
                    {`Base (${form.dimUnit})`}
                  </div>
                )}
                <div
                  className={`${form.format === "lastra" ? "col-span-2" : "col-span-4"} text-right`}
                  title={form.format === "rotolo" ? "Altezza rotolo (larghezza del rullo)" : "Altezza"}
                >
                  {form.format === "rotolo" ? `Altezza (${form.dimUnit})` : `H (${form.dimUnit})`}
                </div>
                <div className="col-span-3 text-right" title={`Prezzo di costo in €/${form.priceUnit}`}>
                  Costo €/{form.priceUnit}
                </div>
                {isTappezzeria ? (
                  <>
                    <div className="col-span-3 text-right" title="Prezzo di vendita rotolo intero">
                      Prezzo rotolo €/{form.priceUnit}
                    </div>
                    <div className="col-span-3 text-right" title="Prezzo di vendita al taglio">
                      Prezzo taglio €/{form.priceUnit}
                    </div>
                  </>
                ) : (
                  <div className="col-span-6 text-center" title="Prezzi di vendita calcolati (Riv/Fin × intero/taglio)">
                    Vendita auto · Riv | Fin
                  </div>
                )}
                <div className="col-span-2"></div>
              </div>

              {form.variants.map((v) => {
                const cost = v.purchasePrice || 0;
                const rivIntero = cost * priceMultiplier("dealer", "piece");
                const rivTaglio = cost * priceMultiplier("dealer", "cut");
                const finIntero = cost * priceMultiplier("final", "piece");
                const finTaglio = cost * priceMultiplier("final", "cut");
                return (
                  <div key={v.id} className="grid gap-2 px-3 py-2 items-center" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                    <div className="col-span-24 md:col-span-3">
                      <SelectWithAdd
                        value={v.color}
                        onChange={(val) => updateVariant(v.id, { color: val })}
                        options={sColors}
                        placeholder="Colore"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-2">
                      <AutocompleteInput
                        value={v.thickness}
                        onChange={(val) => updateVariant(v.id, { thickness: val })}
                        suggestions={sThickness}
                        placeholder="es. 0,5 mm"
                        className="w-full"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-2">
                      <SelectWithAdd
                        value={v.finish}
                        onChange={(val) => updateVariant(v.id, { finish: val })}
                        options={sFinish}
                        placeholder="Finitura"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-2">
                      <SelectWithAdd
                        value={v.fireproof}
                        onChange={(val) => updateVariant(v.id, { fireproof: val })}
                        options={sFireproof}
                        placeholder="Ignifugo"
                      />
                    </div>
                    {form.format === "lastra" && (
                      <div className="col-span-8 md:col-span-2">
                        <input
                          type="number"
                          step="0.1"
                          value={v.dim1 || ""}
                          onChange={(e) => updateVariant(v.id, { dim1: e.target.value })}
                          placeholder="base"
                          className="input-bare w-full text-right font-mono text-sm"
                        />
                      </div>
                    )}
                    <div className={form.format === "lastra" ? "col-span-8 md:col-span-2" : "col-span-8 md:col-span-4"}>
                      <input
                        type="number"
                        step="0.1"
                        value={v.dim2 || ""}
                        onChange={(e) => updateVariant(v.id, { dim2: e.target.value })}
                        placeholder={form.format === "rotolo" ? "altezza" : "h"}
                        className="input-bare w-full text-right font-mono text-sm"
                      />
                    </div>
                    <div className="col-span-8 md:col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        value={v.purchasePrice === 0 ? "" : v.purchasePrice}
                        onChange={(e) => updateVariant(v.id, { purchasePrice: parseFloat(e.target.value) || 0 })}
                        placeholder="costo"
                        className="input-bare w-full text-right font-mono text-sm"
                      />
                    </div>
                    {isTappezzeria ? (
                      <>
                        <div className="col-span-12 md:col-span-3">
                          <input
                            type="number"
                            step="0.01"
                            value={(v.sellPiece ?? 0) === 0 ? "" : v.sellPiece}
                            onChange={(e) => updateVariant(v.id, { sellPiece: parseFloat(e.target.value) || 0 })}
                            placeholder="rotolo"
                            className="input-bare w-full text-right font-mono text-sm"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-3">
                          <input
                            type="number"
                            step="0.01"
                            value={(v.sellCut ?? 0) === 0 ? "" : v.sellCut}
                            onChange={(e) => updateVariant(v.id, { sellCut: parseFloat(e.target.value) || 0 })}
                            placeholder="taglio"
                            className="input-bare w-full text-right font-mono text-sm"
                          />
                        </div>
                      </>
                    ) : (
                    <div className="col-span-24 md:col-span-6">
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-2 py-1 bg-muted/40 border border-ink/10 rounded-sm font-mono text-[10px]">
                        <div className="col-span-2 grid grid-cols-[1fr_auto_auto] gap-x-2 text-muted-foreground">
                          <span></span>
                          <span className="text-right uppercase tracking-wider">Riv</span>
                          <span className="text-right uppercase tracking-wider">Fin</span>
                        </div>
                        <div className="col-span-2 grid grid-cols-[1fr_auto_auto] gap-x-2 items-baseline">
                          <span className="text-muted-foreground" title="Prezzo per pezza/rotolo intero">int</span>
                          <span className="text-right tabular-nums">{eur(rivIntero)}</span>
                          <span className="text-right tabular-nums text-primary font-semibold">{eur(finIntero)}</span>
                        </div>
                        <div className="col-span-2 grid grid-cols-[1fr_auto_auto] gap-x-2 items-baseline">
                          <span className="text-muted-foreground" title="Prezzo al taglio">tag</span>
                          <span className="text-right tabular-nums">{eur(rivTaglio)}</span>
                          <span className="text-right tabular-nums text-primary font-semibold">{eur(finTaglio)}</span>
                        </div>
                      </div>
                    </div>
                    )}
                    <div className="col-span-24 md:col-span-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeVariantRow(v.id)}
                        disabled={form.variants.length <= 1}
                        aria-label="Rimuovi variante"
                        className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive disabled:opacity-30 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Azioni salva */}
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-ink/15">
            <button
              type="button"
              onClick={reset}
              className="text-xs uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink px-3"
            >
              {form.editingKey ? "Annulla modifica" : "Pulisci"}
            </button>
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-ink transition-colors shadow-sm"
            >
              <Save className="w-4 h-4" />
              {form.editingKey ? "Aggiorna prodotto" : "Salva nel listino"}
            </button>
          </div>
        </div>

        {/* Lista prodotti raggruppati */}
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              // Prodotti nel listino · {grouped.length} ({mats.length} varianti)
            </div>
            {grouped.length > 0 && (
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca qui…"
                className="input-bare text-sm bg-paper w-56"
              />
            )}
          </div>
          {(() => {
            const q = search.trim().toLowerCase();
            const visible = q
              ? grouped.filter((g) => {
                  if (g.name.toLowerCase().includes(q)) return true;
                  return g.items.some((m) =>
                    [m.color, m.thickness, m.finish, m.format, m.height, m.baseWidth, m.rollLength]
                      .filter(Boolean)
                      .some((s) => String(s).toLowerCase().includes(q)),
                  );
                })
              : grouped;
            return grouped.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-ink/20 rounded-sm">
              Nessun prodotto. Compila il form qui sopra e clicca "Salva nel listino".
            </div>
          ) : visible.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-ink/20 rounded-sm">
              Nessun prodotto corrisponde a "{search}".
            </div>
          ) : (
            <div className="border border-ink/20 rounded-sm divide-y divide-ink/10 max-h-72 overflow-y-auto">
              {visible.map((g) => (
                <div key={g.key} className="px-3 py-2.5 hover:bg-muted/40">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{g.name}</div>
                      <div className="flex flex-wrap gap-x-3 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">
                        {g.items[0]?.format && (
                          <span className="text-ink font-semibold">
                            {g.items[0].format}
                            {g.items[0].priceUnit ? ` · €/${g.items[0].priceUnit}` : ""}
                          </span>
                        )}
                        <span className="text-primary font-semibold">{g.items.length} varianti</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {g.items.map((m) => {
                          const u = m.dimUnit || m.heightUnit || "";
                          const dimsLabel =
                            m.format === "rotolo"
                              ? m.height
                                ? `h ${m.height} ${u}`
                                : ""
                              : (m.baseWidth || m.height)
                                ? `${m.baseWidth || "?"}×${m.height || "?"} ${u}`
                                : "";
                          return (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-background border border-ink/15 rounded-sm text-[10px] font-mono"
                            >
                              {m.color && <span>{m.color}</span>}
                              {m.thickness && (
                                <span className="text-muted-foreground">· {m.thickness}</span>
                              )}
                              {m.finish && (
                                <span className="text-muted-foreground">· {m.finish}</span>
                              )}
                              {dimsLabel && (
                                <span className="text-muted-foreground">· {dimsLabel}</span>
                              )}
                              <span className="font-semibold">
                                {typeof m.costPrice === "number" ? (
                                  <>· costo {eur(m.costPrice)}/{m.priceUnit ?? m.unit} · rot {eur(m.pricePiece)} · tag {eur(m.priceCut)}</>
                                ) : (
                                  <>· costo {eur(m.pricePiece)}/{m.priceUnit ?? m.unit}</>
                                )}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => loadProduct(g.key)}
                        aria-label="Modifica"
                        title="Modifica"
                        className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-ink hover:text-paper hover:border-ink transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeProduct(g.key)}
                        aria-label="Elimina prodotto"
                        title="Elimina prodotto"
                        className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
          })()}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-2 px-4 py-2 border-2 border-ink rounded-sm text-xs uppercase tracking-wider font-semibold hover:bg-ink hover:text-paper transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Chiudi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Dialog di mappatura colonne Excel */}
    <Dialog open={!!mapping} onOpenChange={(v) => { if (!v) setMapping(null); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto bg-paper border-2 border-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Mappa colonne Excel
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {mapping?.fileName} · {mapping?.rows.length ?? 0} righe · associa ogni campo a una colonna del file.
          </p>
        </DialogHeader>

        {mapping && (
          <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
              // Prodotto (le righe con stessi 4 valori → varianti dello stesso prodotto)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                { key: "name", label: "Nome prodotto *" },
                { key: "unit", label: "Unità prezzo (m / mq …)" },
                { key: "format", label: "Formato (lastra/rotolo)" },
                { key: "dimUnit", label: "Unità dimensioni (cm/mm/m)" },
                { key: "priceUnit", label: "Prezzi d'acquisto (€/mq · €/ml)" },
              ] as { key: MapField; label: string }[]).map(({ key, label }) => (
                <div key={key}>
                  <label className="label-cap block mb-1">{label}</label>
                  <select
                    value={mapping.mapping[key]}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        mapping: { ...mapping.mapping, [key]: e.target.value },
                      })
                    }
                    className="input-bare w-full text-sm bg-paper py-2"
                  >
                    <option value="">— ignora —</option>
                    {mapping.columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-4 mb-1">
              // Variante (cambiano da riga a riga all'interno dello stesso prodotto)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                { key: "thickness", label: "Spessore" },
                { key: "color", label: "Colore" },
                { key: "finish", label: "Finitura" },
                { key: "dim1", label: "Base / Lunghezza" },
                { key: "dim2", label: "H (altezza)" },
                { key: "purchasePrice", label: "Prezzo costo *" },
              ] as { key: MapField; label: string }[]).map(({ key, label }) => (
                <div key={key}>
                  <label className="label-cap block mb-1">{label}</label>
                  <select
                    value={mapping.mapping[key]}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        mapping: { ...mapping.mapping, [key]: e.target.value },
                      })
                    }
                    className="input-bare w-full text-sm bg-paper py-2"
                  >
                    <option value="">— ignora —</option>
                    {mapping.columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                // Anteprima · prime 5 righe
              </div>
              <div className="border border-ink/20 rounded-sm overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/50">
                    <tr>
                      {mapping.columns.map((c) => (
                        <th key={c} className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground border-r border-ink/10 last:border-r-0">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-ink/10">
                        {mapping.columns.map((c) => (
                          <td key={c} className="px-2 py-1 border-r border-ink/10 last:border-r-0 truncate max-w-[160px]">
                            {String(r[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => setMapping(null)}
            className="text-xs uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink px-3"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => {
              if (!mapping) return;
              if (!mapping.mapping.name) {
                toast.error("Seleziona la colonna del nome prodotto");
                return;
              }
              if (!mapping.mapping.purchasePrice) {
                toast.error("Seleziona la colonna del prezzo di costo");
                return;
              }
              applyMappingAndImport(mapping.rows, mapping.mapping, mapping.fileName);
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-ink transition-colors shadow-sm"
          >
            <Save className="w-4 h-4" />
            Importa prodotti
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
