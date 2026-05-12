import { useState } from "react";
import { Plus, Trash2, X, Save, Pencil, Settings2, Layers, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Catalog, CatalogPerimeterOp, CatalogPerimeterPreset, PerimeterPresetItem, PerimeterSide } from "./types";
import { eur, uid } from "@/lib/format";
import { buildPresetPerimeterOps } from "@/lib/perimeter";

interface Props {
  catalog: Catalog;
  onCatalogChange: (c: Catalog) => void;
  deptLabel: string;
}

const PRESET_COLORS = [
  "hsl(12 76% 55%)",
  "hsl(38 92% 50%)",
  "hsl(160 64% 40%)",
  "hsl(220 14% 35%)",
  "hsl(280 60% 55%)",
  "hsl(200 80% 50%)",
  "hsl(340 75% 55%)",
];

const SIDES: PerimeterSide[] = ["top", "right", "bottom", "left"];
const SIDE_LABEL: Record<PerimeterSide, string> = { top: "Sopra", right: "Destra", bottom: "Sotto", left: "Sinistra" };

/** Sotto-categorie disponibili per ciascuna macro-categoria nel reparto Stampa/Laboratorio. */
const SUBCATEGORIES: Record<"stampa" | "taglio" | "perimetrale" | "altre", { k: string; label: string }[]> = {
  stampa: [
    { k: "uv", label: "Stampa UV" },
    { k: "solvente", label: "Stampa Solvente" },
    { k: "laser", label: "Stampa Laser" },
  ],
  taglio: [
    { k: "cnc", label: "Taglio CNC" },
    { k: "laser", label: "Taglio Laser" },
    { k: "squadratrice", label: "Squadratrice" },
    { k: "plotter", label: "Plotter" },
  ],
  perimetrale: [],
  altre: [],
};

export const PerimeterCatalogEditor = ({ catalog, onCatalogChange, deptLabel }: Props) => {
  const [open, setOpen] = useState(false);
  const isStampa = deptLabel === "stampa";
  type StampaTab = "stampa" | "taglio" | "perimetrale" | "altre" | "presets";
  type GenericTab = "ops" | "presets";
  const [tab, setTab] = useState<StampaTab | GenericTab>(isStampa ? "stampa" : "ops");
  /** Sotto-categoria attiva per i tab che la supportano (stampa, taglio). */
  const [subTab, setSubTab] = useState<string>("uv");

  // Op state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPriceDealer, setDraftPriceDealer] = useState<number>(0);
  const [draftColor, setDraftColor] = useState<string>(PRESET_COLORS[0]);
  const [draftUnit, setDraftUnit] = useState<"m" | "mq" | "pz" | "min">("m");
  const [draftCategory, setDraftCategory] = useState<"stampa" | "taglio" | "perimetrale" | "altre">("perimetrale");
  const [draftSubcategory, setDraftSubcategory] = useState<string>("");

  // Preset state
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetItems, setPresetItems] = useState<PerimeterPresetItem[]>([]);

  const ops = catalog.perimeterOps ?? [];
  const presets = catalog.perimeterPresets ?? [];

  const reset = () => {
    setEditingId(null);
    setDraftName("");
    setDraftPriceDealer(0);
    setDraftColor(PRESET_COLORS[ops.length % PRESET_COLORS.length]);
    setDraftUnit("m");
    // Mantengo la categoria corrente del tab attivo (se in Stampa)
    if (isStampa && (tab === "stampa" || tab === "taglio" || tab === "perimetrale" || tab === "altre")) {
      setDraftCategory(tab);
      setDraftSubcategory(SUBCATEGORIES[tab][0]?.k ?? "");
    } else {
      setDraftCategory("perimetrale");
      setDraftSubcategory("");
    }
  };

  const startEdit = (op: CatalogPerimeterOp) => {
    setEditingId(op.id);
    setDraftName(op.name);
    setDraftPriceDealer(op.pricePerMeter);
    setDraftColor(op.color || PRESET_COLORS[0]);
    setDraftUnit(op.priceUnit ?? "m");
    const cat = op.category;
    setDraftCategory(
      cat === "stampa" || cat === "taglio" || cat === "perimetrale" || cat === "altre" ? cat : "perimetrale",
    );
    setDraftSubcategory(op.subcategory ?? "");
  };

  const save = () => {
    if (!draftName.trim()) return toast.error("Il nome è obbligatorio");
    if (draftPriceDealer < 0) return toast.error("Prezzo non valido");
    // Quando siamo nel reparto Stampa, la categoria/sub-categoria deve seguire
    // il tab e il sub-tab attivi (l'utente sta inserendo dentro quella sezione).
    const effectiveCategory: "stampa" | "taglio" | "perimetrale" | "altre" = isStampa
      ? (tab === "stampa" || tab === "taglio" || tab === "perimetrale" || tab === "altre"
          ? tab
          : draftCategory)
      : "perimetrale";
    const effectiveSubcategory = isStampa && (effectiveCategory === "stampa" || effectiveCategory === "taglio")
      ? (subTab || draftSubcategory || SUBCATEGORIES[effectiveCategory][0]?.k)
      : undefined;
    const next: CatalogPerimeterOp = {
      id: editingId ?? uid(),
      name: draftName.trim(),
      pricePerMeter: draftPriceDealer,
      priceFinal: draftPriceDealer,
      priceUnit: draftUnit,
      color: draftColor,
      category: effectiveCategory,
      subcategory: effectiveSubcategory,
    };
    const updated = editingId ? ops.map((o) => (o.id === editingId ? next : o)) : [...ops, next];
    onCatalogChange({ ...catalog, perimeterOps: updated });
    toast.success(editingId ? "Lavorazione aggiornata" : "Lavorazione aggiunta");
    reset();
  };

  const remove = (id: string) => {
    onCatalogChange({ ...catalog, perimeterOps: ops.filter((o) => o.id !== id) });
    if (editingId === id) reset();
    toast.success("Eliminata");
  };

  const restorePresets = () => {
    onCatalogChange({ ...catalog, perimeterOps: buildPresetPerimeterOps() });
    reset();
    toast.success("Lavorazioni preset ripristinate");
  };

  /* Preset (combinazione lavorazioni + lati) */
  const resetPreset = () => {
    setEditingPresetId(null);
    setPresetName("");
    setPresetItems([]);
  };

  const startEditPreset = (p: CatalogPerimeterPreset) => {
    setEditingPresetId(p.id);
    setPresetName(p.name);
    setPresetItems(p.items.map((i) => ({ opId: i.opId, sides: [...i.sides] })));
  };

  const togglePresetSide = (idx: number, side: PerimeterSide) => {
    setPresetItems((arr) =>
      arr.map((it, i) =>
        i === idx
          ? { ...it, sides: it.sides.includes(side) ? it.sides.filter((s) => s !== side) : [...it.sides, side] }
          : it,
      ),
    );
  };

  const setPresetItemOp = (idx: number, opId: string) => {
    setPresetItems((arr) => arr.map((it, i) => (i === idx ? { ...it, opId } : it)));
  };

  const addPresetItem = () => {
    if (ops.length === 0) return toast.error("Aggiungi prima una lavorazione al listino");
    setPresetItems((arr) => [...arr, { opId: ops[0].id, sides: [] }]);
  };

  const removePresetItem = (idx: number) => {
    setPresetItems((arr) => arr.filter((_, i) => i !== idx));
  };

  const savePreset = () => {
    if (!presetName.trim()) return toast.error("Il nome del preset è obbligatorio");
    // I lati sono richiesti SOLO per lavorazioni perimetrali a €/m (è l'unico caso
    // in cui la quantità dipende dai lati selezionati). Per tutte le altre
    // (stampa/taglio/altre, oppure perimetrali a €/mq, €/pz, €/min) i lati sono
    // facoltativi/non applicabili → la voce è valida anche senza selezione.
    const valid = presetItems.filter((i) => {
      const op = ops.find((o) => o.id === i.opId);
      if (!op) return false;
      const cat = op.category ?? "perimetrale";
      const unit = op.priceUnit ?? "m";
      const sidesRequired = cat === "perimetrale" && unit === "m";
      return sidesRequired ? i.sides.length > 0 : true;
    });
    if (valid.length === 0)
      return toast.error("Aggiungi almeno una lavorazione (per le perimetrali €/m seleziona anche i lati)");
    const next: CatalogPerimeterPreset = {
      id: editingPresetId ?? uid(),
      name: presetName.trim(),
      items: valid,
    };
    const updated = editingPresetId
      ? presets.map((p) => (p.id === editingPresetId ? next : p))
      : [...presets, next];
    onCatalogChange({ ...catalog, perimeterPresets: updated });
    toast.success(editingPresetId ? "Preset aggiornato" : "Preset creato");
    resetPreset();
  };

  const removePreset = (id: string) => {
    onCatalogChange({ ...catalog, perimeterPresets: presets.filter((p) => p.id !== id) });
    if (editingPresetId === id) resetPreset();
    toast.success("Preset eliminato");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) { reset(); resetPreset(); }
        else if (!editingId && !draftName) setDraftColor(PRESET_COLORS[ops.length % PRESET_COLORS.length]);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 px-3 py-2 border-2 border-ink rounded-sm text-xs uppercase tracking-wider font-semibold hover:bg-ink hover:text-paper transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Listino lavorazioni
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-paper border-2 border-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Listino lavorazioni · {deptLabel}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tipi €/m applicati ai lati del pezzo + preset riusabili (combinazioni di lavorazioni e lati).
          </p>
          {(ops.length > 0 || presets.length > 0) && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Azzerare TUTTO il listino lavorazioni di "${deptLabel}"?\nVerranno cancellate ${ops.length} lavorazioni e ${presets.length} preset.\nL'azione non è reversibile.`)) {
                    onCatalogChange({ ...catalog, perimeterOps: [], perimeterPresets: [] });
                    reset();
                    resetPreset();
                    toast.success("Listino lavorazioni azzerato");
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-1 border border-destructive/40 rounded-sm text-[10px] uppercase tracking-wider font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset listino lavorazioni
              </button>
            </div>
          )}
        </DialogHeader>

        {/* Tab bar: per Stampa abbiamo 3 categorie + preset; altrimenti lavorazioni + preset */}
        <div className="inline-flex border-2 border-ink rounded-sm overflow-hidden self-start flex-wrap">
          {isStampa ? (
            <>
              {([
                { k: "stampa", label: "Stampa" },
                { k: "taglio", label: "Taglio" },
                { k: "perimetrale", label: "Lav. perimetrali" },
                { k: "altre", label: "Altre lavorazioni" },
              ] as const).map(({ k, label }) => {
                const count = ops.filter((o) => (o.category ?? "perimetrale") === k).length;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setTab(k);
                      // imposta sub-tab di default per stampa/taglio
                      if (k === "stampa" || k === "taglio") {
                        setSubTab(SUBCATEGORIES[k][0]?.k ?? "");
                      }
                    }}
                    className={`px-4 py-2 text-[11px] uppercase tracking-wider font-bold transition-colors ${tab === k ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"}`}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setTab("ops")}
              className={`px-4 py-2 text-[11px] uppercase tracking-wider font-bold transition-colors ${tab === "ops" ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"}`}
            >
              Lavorazioni ({ops.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab("presets")}
            className={`px-4 py-2 text-[11px] uppercase tracking-wider font-bold transition-colors ${tab === "presets" ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"}`}
          >
            Preset ({presets.length})
          </button>
        </div>

        {/* Sub-tab di sottocategoria per Stampa e Taglio */}
        {isStampa && (tab === "stampa" || tab === "taglio") && (
          <div className="inline-flex border border-ink/40 rounded-sm overflow-hidden self-start flex-wrap mt-1">
            {SUBCATEGORIES[tab].map(({ k, label }) => {
              const c = ops.filter((o) => (o.category ?? "perimetrale") === tab && (o.subcategory ?? "") === k).length;
              const active = subTab === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setSubTab(k); setDraftSubcategory(k); }}
                  className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${active ? "bg-primary text-primary-foreground" : "text-ink/60 hover:text-ink"}`}
                >
                  {label} ({c})
                </button>
              );
            })}
          </div>
        )}

        {(tab === "ops" || tab === "stampa" || tab === "taglio" || tab === "perimetrale" || tab === "altre") && (
          <>
            <div className="border-2 border-ink/20 rounded-sm p-4 bg-background">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold mb-3">
                // {editingId ? "Modifica" : "Nuova lavorazione"}
                {isStampa && tab !== "ops" && (
                  <span className="ml-2 text-ink">
                    · {tab === "stampa" ? "Stampa" : tab === "taglio" ? "Taglio" : tab === "perimetrale" ? "Perimetrale" : "Altre"}
                    {(tab === "stampa" || tab === "taglio") && SUBCATEGORIES[tab].find((s) => s.k === subTab)
                      ? ` / ${SUBCATEGORIES[tab].find((s) => s.k === subTab)?.label}`
                      : ""}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-12 gap-3 items-end">
                <div className="col-span-12 md:col-span-5">
                  <label className="label-cap block mb-1">Nome *</label>
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="es. Orli"
                    className="input-bare w-full text-sm"
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <label className="label-cap block mb-1">€/{draftUnit} *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={draftPriceDealer === 0 ? "" : draftPriceDealer}
                    onChange={(e) => setDraftPriceDealer(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="input-bare w-full text-right font-mono text-sm"
                  />
                </div>
                <div className="col-span-12 md:col-span-4">
                  <label className="label-cap block mb-1">Unità</label>
                  <div className="inline-flex border border-ink/40 rounded-sm overflow-hidden flex-wrap">
                    {(["m", "mq", "pz", "min"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setDraftUnit(u)}
                        className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                          draftUnit === u ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                        }`}
                        title={
                          u === "m" ? "€/Mt — metri lineari sui lati selezionati" :
                          u === "mq" ? "€/Mq — area del pezzo" :
                          u === "pz" ? "€/Pz — quantità manuale" :
                          "€/Min — quantità manuale (minuti)"
                        }
                      >
                        €/{u === "m" ? "Mt" : u === "mq" ? "Mq" : u === "pz" ? "Pz" : "Min"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-12">
                  <label className="label-cap block mb-1">Colore</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraftColor(c)}
                        aria-label="Scegli colore"
                        className={`w-6 h-6 rounded-sm border-2 transition-all ${draftColor === c ? "border-ink scale-110" : "border-ink/20 hover:border-ink/60"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-ink/15">
                {editingId && (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-xs uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink px-3"
                  >
                    Annulla
                  </button>
                )}
                <button
                  type="button"
                  onClick={save}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-ink transition-colors"
                >
                  {editingId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {editingId ? "Aggiorna" : "Aggiungi"}
                </button>
              </div>
            </div>

            {(() => {
              // Filtra le voci in base al tab attivo (Stampa)
              const hasSub = isStampa && (tab === "stampa" || tab === "taglio");
              const filteredOps = isStampa && tab !== "ops"
                ? ops.filter((o) => {
                    if ((o.category ?? "perimetrale") !== tab) return false;
                    if (hasSub && subTab) return (o.subcategory ?? "") === subTab;
                    return true;
                  })
                : ops;
              const subLabel = hasSub
                ? SUBCATEGORIES[tab as "stampa" | "taglio"].find((s) => s.k === subTab)?.label ?? ""
                : "";
              const sectionLabel = isStampa
                ? tab === "stampa" ? `Stampa · ${subLabel}`
                : tab === "taglio" ? `Taglio · ${subLabel}`
                : tab === "perimetrale" ? "Lavorazioni perimetrali"
                : "Altre lavorazioni"
                : "Lavorazioni";
              return (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                      // {sectionLabel} · {filteredOps.length}
                    </div>
                    {!isStampa && (
                      <button
                        type="button"
                        onClick={restorePresets}
                        className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-primary"
                        title="Sostituisce le lavorazioni con i preset standard"
                      >
                        Ripristina preset standard
                      </button>
                    )}
                  </div>

                  {filteredOps.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-ink/20 rounded-sm">
                      {isStampa
                        ? `Nessuna voce in "${sectionLabel.toLowerCase()}". Aggiungine una qui sopra.`
                        : "Nessuna lavorazione. Aggiungine una o ripristina i preset."}
                    </div>
                  ) : (
                    <div className="border border-ink/20 rounded-sm divide-y divide-ink/10">
                      {filteredOps.map((op) => (
                    <div key={op.id} className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40">
                      <span
                        className="w-3 h-3 rounded-sm border border-ink/30 shrink-0"
                        style={{ backgroundColor: op.color || "transparent" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{op.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                          {(() => {
                            const u = op.priceUnit ?? "m";
                            const uLabel = u === "m" ? "Mt" : u === "mq" ? "Mq" : u === "pz" ? "Pz" : "Min";
                            return `${eur(op.pricePerMeter)} / ${uLabel}`;
                          })()}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(op)}
                          aria-label="Modifica"
                          className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-ink hover:text-paper hover:border-ink transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(op.id)}
                          aria-label="Elimina"
                          className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
                </div>
              );
            })()}
          </>
        )}

        {tab === "presets" && (
          <>
            <div className="border-2 border-ink/20 rounded-sm p-4 bg-background">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold mb-3">
                // {editingPresetId ? "Modifica preset" : "Nuovo preset"}
              </div>
              <div className="grid grid-cols-12 gap-3 items-end mb-3">
                <div className="col-span-12 md:col-span-7">
                  <label className="label-cap block mb-1">Nome preset *</label>
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="es. LAV01 · Tenda standard"
                    className="input-bare w-full text-sm"
                  />
                </div>
                <div className="col-span-12 md:col-span-5 text-right">
                  <button
                    type="button"
                    onClick={addPresetItem}
                    disabled={ops.length === 0}
                    className="inline-flex items-center gap-2 px-3 py-2 border-2 border-ink rounded-sm text-[11px] uppercase tracking-wider font-bold hover:bg-ink hover:text-paper transition-colors disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Aggiungi lavorazione
                  </button>
                </div>
              </div>

              {presetItems.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-ink/20 rounded-sm">
                  Aggiungi almeno una lavorazione e seleziona i lati su cui applicarla.
                </div>
              ) : (
                <div className="space-y-2">
                  {presetItems.map((it, i) => {
                    const op = ops.find((o) => o.id === it.opId);
                    /** Etichetta breve di categoria per riconoscere la lavorazione
                     *  (es. "Stampa · UV", "Taglio · CNC", "Perimetrale"). Niente prezzi. */
                    const catLabel = (o: CatalogPerimeterOp): string => {
                      const cat = (o.category ?? "perimetrale") as keyof typeof SUBCATEGORIES;
                      const subs = SUBCATEGORIES[cat] ?? [];
                      const subLabel = subs.find((s) => s.k === (o.subcategory ?? ""))?.label;
                      const catBase =
                        cat === "stampa" ? "Stampa"
                        : cat === "taglio" ? "Taglio"
                        : cat === "altre" ? "Altre"
                        : "Perimetrale";
                      return subLabel ? `${catBase} · ${subLabel.replace(/^Stampa |^Taglio /, "")}` : catBase;
                    };
                    /** I lati hanno senso solo per lavorazioni perimetrali a €/m. */
                    const opCat = (op?.category ?? "perimetrale");
                    const showSides = opCat === "perimetrale" && (op?.priceUnit ?? "m") === "m";
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border border-ink/15 rounded-sm">
                        <div className={`col-span-12 ${showSides ? "md:col-span-5" : "md:col-span-11"}`}>
                          <label className="label-cap block mb-1">Lavorazione</label>
                          <select
                            value={it.opId}
                            onChange={(e) => setPresetItemOp(i, e.target.value)}
                            className="input-bare w-full text-sm bg-paper"
                          >
                            {ops.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name} · {catLabel(o)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {showSides && (
                          <div className="col-span-10 md:col-span-6">
                            <label className="label-cap block mb-1 inline-flex items-center gap-1">
                              <Layers className="w-3 h-3" />
                              Lati ({it.sides.length}/4)
                            </label>
                            <div className="grid grid-cols-4 gap-1">
                              {SIDES.map((s) => {
                                const active = it.sides.includes(s);
                                return (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => togglePresetSide(i, s)}
                                    className={`px-2 py-1.5 rounded-sm border text-[10px] uppercase tracking-wider font-bold transition-colors ${
                                      active ? "border-current text-paper" : "border-ink/30 text-ink/60 hover:border-ink"
                                    }`}
                                    style={active ? { backgroundColor: op?.color || "hsl(220 14% 35%)", borderColor: "transparent" } : undefined}
                                  >
                                    {SIDE_LABEL[s]}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="col-span-2 md:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => removePresetItem(i)}
                            className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                            aria-label="Rimuovi"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-ink/15">
                {editingPresetId && (
                  <button type="button" onClick={resetPreset} className="text-xs uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink px-3">
                    Annulla
                  </button>
                )}
                <button
                  type="button"
                  onClick={savePreset}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-ink transition-colors"
                >
                  {editingPresetId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {editingPresetId ? "Aggiorna preset" : "Salva preset"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
                // Preset salvati · {presets.length}
              </div>
              {presets.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-ink/20 rounded-sm">
                  Nessun preset. Creane uno qui sopra.
                </div>
              ) : (
                <div className="border border-ink/20 rounded-sm divide-y divide-ink/10">
                  {presets.map((p) => (
                    <div key={p.id} className="px-3 py-2.5 flex items-start gap-3 hover:bg-muted/40">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{p.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                          {p.items.map((it) => {
                            const op = ops.find((o) => o.id === it.opId);
                            return `${op?.name ?? "?"} (${it.sides.map((s) => SIDE_LABEL[s].toLowerCase()).join("+")})`;
                          }).join(" · ")}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" onClick={() => startEditPreset(p)} aria-label="Modifica"
                          className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-ink hover:text-paper hover:border-ink transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => removePreset(p.id)} aria-label="Elimina"
                          className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

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
  );
};
