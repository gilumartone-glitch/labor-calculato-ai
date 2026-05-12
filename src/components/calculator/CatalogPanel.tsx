import { useRef, useMemo } from "react";
import { Upload, FileSpreadsheet, Trash2, Download, CheckCircle2, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { Catalog, CatalogMaterial, CatalogOperation, PrintOp, CatalogPerimeterOp, CatalogPerimeterPreset } from "./types";
import { parseCatalogFile, emptyCatalog, loadCatalog } from "@/lib/catalog";
import { CatalogEditor } from "./CatalogEditor";
import { PerimeterCatalogEditor } from "./PerimeterCatalogEditor";

interface CatalogPanelProps {
  catalog: Catalog;
  onCatalogChange: (c: Catalog) => void;
  templateUrl: string;
  templateName: string;
  deptLabel: string;
  /** Chiave reparto per leggere eventuali backup localStorage */
  deptKey?: string;
}

export const CatalogPanel = ({
  catalog,
  onCatalogChange,
  templateUrl,
  templateName,
  deptLabel,
  deptKey,
}: CatalogPanelProps) => {
  // Deriva URL/nome del template XML dallo stesso percorso dell'xlsx
  const xmlTemplateUrl = templateUrl ? templateUrl.replace(/\.xlsx?$/i, ".xml") : "";
  const xmlTemplateName = templateName ? templateName.replace(/\.xlsx?$/i, ".xml") : "";
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    try {
      const result = await parseCatalogFile(file);
      onCatalogChange(result.catalog);
      toast.success(`Listino ${deptLabel} caricato`, {
        description: `${result.materialsCount} materiali · ${result.operationsCount} lavorazioni`,
      });
      result.warnings.forEach((w) => toast.warning(w));
    } catch (err) {
      toast.error("Errore caricamento file", {
        description: err instanceof Error ? err.message : "File non valido",
      });
    }
  };

  const hasData = catalog.materials.length + catalog.operations.length > 0;

  // Verifica se in questo browser c'è un backup locale con materiali/lavorazioni non ancora nel cloud
  const localBackup = deptKey ? loadCatalog(deptKey) : null;

  // Calcola quanti elementi sono presenti nel localStorage ma NON nel cloud (merge intelligente)
  const matKey = (m: CatalogMaterial) =>
    [m.name, m.color, m.height, m.thickness ?? "", m.fireproof ?? "", m.finish ?? ""]
      .map((x) => String(x ?? "").trim().toLowerCase())
      .join("|");
  const opKey = (o: CatalogOperation) =>
    [o.name, o.type, o.unit].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
  const printKey = (p: PrintOp) =>
    [p.type, p.mode].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
  const perimKey = (p: CatalogPerimeterOp) =>
    [p.name, p.category ?? "", p.priceUnit ?? "", p.machine ?? ""]
      .map((x) => String(x ?? "").trim().toLowerCase())
      .join("|");
  const presetKey = (p: CatalogPerimeterPreset) =>
    String(p.name ?? "").trim().toLowerCase();

  const missing = useMemo(() => {
    if (!localBackup) return {
      mats: [] as CatalogMaterial[],
      ops: [] as CatalogOperation[],
      prints: [] as PrintOp[],
      perims: [] as CatalogPerimeterOp[],
      presets: [] as CatalogPerimeterPreset[],
    };
    const cloudMatKeys = new Set(catalog.materials.map(matKey));
    const cloudOpKeys = new Set(catalog.operations.map(opKey));
    const cloudPrintKeys = new Set((catalog.printOps ?? []).map(printKey));
    const cloudPerimKeys = new Set((catalog.perimeterOps ?? []).map(perimKey));
    const cloudPresetKeys = new Set((catalog.perimeterPresets ?? []).map(presetKey));
    return {
      mats: localBackup.materials.filter((m) => !cloudMatKeys.has(matKey(m))),
      ops: localBackup.operations.filter((o) => !cloudOpKeys.has(opKey(o))),
      prints: (localBackup.printOps ?? []).filter((p) => !cloudPrintKeys.has(printKey(p))),
      perims: (localBackup.perimeterOps ?? []).filter((p) => !cloudPerimKeys.has(perimKey(p))),
      presets: (localBackup.perimeterPresets ?? []).filter((p) => !cloudPresetKeys.has(presetKey(p))),
    };
  }, [localBackup, catalog]);

  const totalMissing =
    missing.mats.length + missing.ops.length + missing.prints.length + missing.perims.length + missing.presets.length;
  const showImportLocal = totalMissing > 0;

  const importFromLocal = () => {
    if (!localBackup) return;
    const merged: Catalog = {
      ...catalog,
      materials: [...catalog.materials, ...missing.mats],
      operations: [...catalog.operations, ...missing.ops],
      printOps: [...(catalog.printOps ?? []), ...missing.prints],
      perimeterOps: [...(catalog.perimeterOps ?? []), ...missing.perims],
      perimeterPresets: [...(catalog.perimeterPresets ?? []), ...missing.presets],
      importedAt: catalog.importedAt ?? localBackup.importedAt,
      fileName: catalog.fileName ?? localBackup.fileName,
    };
    onCatalogChange(merged);
    const parts: string[] = [];
    if (missing.mats.length) parts.push(`${missing.mats.length} materiali`);
    if (missing.ops.length) parts.push(`${missing.ops.length} lavorazioni`);
    if (missing.prints.length) parts.push(`${missing.prints.length} stampe`);
    if (missing.perims.length) parts.push(`${missing.perims.length} perimetrali`);
    if (missing.presets.length) parts.push(`${missing.presets.length} preset`);
    toast.success(`Importati ${parts.join(" · ")} dal browser`, {
      description: "Aggiunti al cloud, visibili da tutti i dispositivi.",
    });
  };

  return (
    <div className="panel p-5 bg-paper">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 grid place-items-center bg-ink text-paper rounded-sm">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <div className="font-display text-lg font-semibold leading-none">
              Listino {deptLabel}
            </div>
            {hasData ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <CheckCircle2 className="w-3 h-3 text-primary" />
                <span className="font-mono">
                  {catalog.materials.length} materiali · {catalog.operations.length} lavorazioni
                </span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground mt-1">
                Nessun listino caricato
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {templateUrl && (
            <a
              href={templateUrl}
              download={templateName}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-primary transition-colors"
            >
              <Download className="w-3 h-3" />
              XLSX
            </a>
          )}
          {xmlTemplateUrl && (
            <a
              href={xmlTemplateUrl}
              download={xmlTemplateName}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-primary transition-colors"
            >
              <Download className="w-3 h-3" />
              XML
            </a>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-ink text-paper rounded-sm text-xs uppercase tracking-wider font-semibold hover:bg-primary transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          {hasData ? "Sostituisci listino" : "Carica .xlsx / .csv / .xml"}
        </button>
        <CatalogEditor
          catalog={catalog}
          onCatalogChange={onCatalogChange}
          deptLabel={deptLabel}
          deptKey={deptKey}
        />
        <PerimeterCatalogEditor
          catalog={catalog}
          onCatalogChange={onCatalogChange}
          deptLabel={deptLabel}
        />
        {hasData && (
          <button
            type="button"
            onClick={() => {
              const matCount = catalog.materials.length;
              const opCount = catalog.operations.length;
              const ok = window.confirm(
                `Svuotare il listino "${deptLabel}"?\n` +
                `Verranno rimossi ${matCount} materiali e ${opCount} lavorazioni.\n` +
                `L'operazione è IMMEDIATA e si propaga a tutti i dispositivi.`,
              );
              if (!ok) return;
              onCatalogChange(emptyCatalog());
              toast.success("Listino svuotato");
            }}
            aria-label="Svuota listino"
            className="w-9 h-9 grid place-items-center border border-ink/30 rounded-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showImportLocal && (
        <button
          type="button"
          onClick={importFromLocal}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-semibold hover:bg-primary/90 transition-colors"
          title="Recupera il listino salvato in questo browser e caricalo nel cloud"
        >
          <CloudUpload className="w-3.5 h-3.5" />
          Recupera {totalMissing} elementi mancanti da questo browser
        </button>
      )}

      {catalog.fileName && (
        <div className="mt-3 text-[10px] font-mono text-muted-foreground truncate">
          📄 {catalog.fileName}
        </div>
      )}
    </div>
  );
};