import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus, Trash2, Library, Package, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useLavorazioni,
  useLavorazioneTemplates,
  readDraftPieces,
  STATO_LABEL,
  type Lavorazione,
  type LavorazioneStato,
  type LavorazioneTemplate,
  type DraftPieceRef,
} from "@/lib/montaggi/lavorazioni";
import { TemplateManagerDialog } from "./TemplateManagerDialog";
import { fetchDipendenti, filterDipendentiByMacro, dipendenteHourlyCost, type Dipendente } from "@/lib/dipendenti";
import { eur } from "@/lib/format";

type Props = { draftId: string };

const STATI: LavorazioneStato[] = ["bloccato", "da_fare", "in_corso", "fatto"];
const REPARTO_KINDS = new Set(["stampa", "tappezzeria", "falegnameria"]);
const isLockedSource = (row: { source_kind: string; source_ref: any }) =>
  REPARTO_KINDS.has(row.source_kind) || !!row.source_ref?.grouped;

export const LavorazioniSection = ({ draftId }: Props) => {
  const { items, add, update, remove } = useLavorazioni(draftId);
  const { items: templates } = useLavorazioneTemplates();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [piecePickerOpen, setPiecePickerOpen] = useState(false);
  const [pieces, setPieces] = useState<DraftPieceRef[]>([]);
  const [selectedPieceKeys, setSelectedPieceKeys] = useState<Set<string>>(new Set());
  const [dips, setDips] = useState<Dipendente[]>([]);

  const pieceKey = (p: DraftPieceRef) => `${p.dept}-${p.id}`;
  const togglePieceSelection = (p: DraftPieceRef) => {
    setSelectedPieceKeys((prev) => {
      const next = new Set(prev);
      const k = pieceKey(p);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetchDipendenti(true).then((all) => {
      if (!cancelled) setDips(filterDipendentiByMacro(all, "montaggi"));
    });
    return () => { cancelled = true; };
  }, []);

  const operatorOptions = useMemo(
    () => dips.map((d) => ({ id: d.id, label: d.nome || "Operatore", hourly: dipendenteHourlyCost(d) })),
    [dips],
  );

  const openPiecePicker = () => {
    setPieces(readDraftPieces());
    setSelectedPieceKeys(new Set());
    setPiecePickerOpen(true);
  };

  const addGroupedFromPieces = async (selected: DraftPieceRef[]) => {
    if (selected.length === 0) return;
    if (selected.length === 1) { await addFromPiece(selected[0]); setPiecePickerOpen(false); return; }
    const deptLabels = Array.from(new Set(selected.map((p) => p.deptLabel.toLowerCase())));
    const descrizione = selected
      .map((p) => `• ${p.deptLabel}: ${p.productName}${p.quantity > 1 ? ` ×${p.quantity}` : ""} (${p.width}×${p.height} ${p.dimUnit})`)
      .join("\n");
    try {
      await add({
        template_id: null,
        causale: `Montaggio combinato (${selected.length} pezzi: ${deptLabels.join(", ")})`,
        descrizione,
        source_kind: "manuale",
        source_ref: { grouped: true, pieces: selected.map((p) => ({ piece_id: p.id, dept: p.dept, productName: p.productName, width: p.width, height: p.height, dimUnit: p.dimUnit, quantity: p.quantity })) } as any,
        ore: selected.length,
        costo_orario: 25,
        operatore_id: null,
        operatore_ids: [],
        stato: "bloccato",
        note: null,
      });
      toast.success(`Aggiunto montaggio combinato (${selected.length} pezzi)`);
      setPiecePickerOpen(false);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  const addFromTemplate = async (t: LavorazioneTemplate) => {
    try {
      await add({
        template_id: t.id,
        causale: t.nome,
        descrizione: t.descrizione,
        source_kind: "preset",
        source_ref: null,
        ore: Number(t.ore_stimate) || 0,
        costo_orario: Number(t.costo_orario_default) || 0,
        operatore_id: null,
        operatore_ids: [],
        stato: "da_fare",
        note: t.note,
      });
      toast.success(`Aggiunta lavorazione "${t.nome}"`);
      setTemplatePicker(false);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  const addFromPiece = async (p: DraftPieceRef) => {
    try {
      await add({
        template_id: null,
        causale: `Montaggio ${p.deptLabel.toLowerCase()}: ${p.productName}`,
        descrizione: p.description,
        source_kind: p.dept,
        source_ref: { piece_id: p.id, dept: p.dept, productName: p.productName, width: p.width, height: p.height, dimUnit: p.dimUnit, quantity: p.quantity },
        ore: 1,
        costo_orario: 25,
        operatore_id: null,
        operatore_ids: [],
        stato: "bloccato",
        note: null,
      });
      toast.success(`Aggiunto: ${p.productName}`);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  const addManual = async () => {
    try {
      await add({
        template_id: null,
        causale: "Nuova lavorazione",
        descrizione: "",
        source_kind: "manuale",
        source_ref: null,
        ore: 1,
        costo_orario: 25,
        operatore_id: null,
        operatore_ids: [],
        stato: "da_fare",
        note: null,
      });
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  const toggleOperatore = (row: Lavorazione, operatoreId: string) => {
    const current = row.operatore_ids ?? [];
    const next = current.includes(operatoreId)
      ? current.filter((id) => id !== operatoreId)
      : [...current, operatoreId];
    const hourlySum = next.reduce((s, id) => {
      const op = operatorOptions.find((x) => x.id === id);
      return s + (op?.hourly ?? 0);
    }, 0);
    update(row.id, {
      operatore_ids: next,
      operatore_id: next[0] ?? null,
      costo_orario: hourlySum > 0 ? hourlySum : row.costo_orario,
    });
  };

  const totalCost = items.reduce((s, x) => s + x.ore * x.costo_orario, 0);

  return (
    <div className="space-y-4">
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />Lavorazioni di montaggio</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Ogni voce è autonoma: causale, operatore, ore, stato e costo separati.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)}>
              <Wrench className="h-4 w-4" />Gestisci causali
            </Button>
            <Button size="sm" onClick={() => setChooserOpen(true)}>
              <Plus className="h-4 w-4" />Nuova
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && (
            <p className="rounded-sm border border-border bg-background p-3 text-sm text-muted-foreground">
              Nessuna lavorazione. Aggiungi una causale, importa un pezzo dagli altri reparti o crea una voce manuale.
            </p>
          )}
          {items.map((row) => (
            <div key={row.id} className="rounded-sm border border-border bg-background p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_180px_120px_40px] items-start">
                <div>
                  <Label className="text-xs">Causale</Label>
                  <Input value={row.causale} onChange={(e) => update(row.id, { causale: e.target.value })} />
                  {row.source_kind !== "manuale" && (
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      {row.source_kind === "preset" ? "Da causale" : `Da ${row.source_kind}`}
                    </Badge>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Stato</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={row.stato}
                    onChange={(e) => update(row.id, { stato: e.target.value as LavorazioneStato })}
                  >
                    {STATI.map((s) => <option key={s} value={s}>{STATO_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Totale</Label>
                  <div className="flex h-10 items-center font-mono font-semibold">{eur(row.ore * row.costo_orario)}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(row.id)} className="mt-5">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_140px_140px]">
                <div>
                  <Label className="text-xs">Operatori ({(row.operatore_ids ?? []).length})</Label>
                  <div className="max-h-32 overflow-y-auto rounded-md border border-input bg-background p-2 space-y-1">
                    {operatorOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nessun dipendente con macro-reparto Montaggi.</p>
                    )}
                    {operatorOptions.map((o) => {
                      const checked = (row.operatore_ids ?? []).includes(o.id);
                      return (
                        <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOperatore(row, o.id)}
                          />
                          <span className="flex-1">{o.label}</span>
                          <span className="text-xs text-muted-foreground">€{o.hourly.toFixed(2)}/h</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Ore</Label>
                  <Input type="number" min={0} step="0.25" value={row.ore}
                    onChange={(e) => update(row.id, { ore: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label className="text-xs">€/ora (squadra)</Label>
                  <Input type="number" min={0} step="0.5" value={row.costo_orario}
                    onChange={(e) => update(row.id, { costo_orario: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Note</Label>
                <Input value={row.note ?? ""} onChange={(e) => update(row.id, { note: e.target.value })} placeholder="Note operative…" />
              </div>
            </div>
          ))}
          {items.length > 0 && (
            <div className="flex items-center justify-between rounded-sm border border-dept bg-dept-soft/40 p-3">
              <span className="text-sm font-medium">Totale lavorazioni di montaggio</span>
              <span className="font-mono font-bold">{eur(totalCost)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <TemplateManagerDialog open={templateOpen} onOpenChange={setTemplateOpen} />

      {/* Chooser: Reparti o Causale */}
      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova lavorazione di montaggio</DialogTitle>
            <DialogDescription>Da dove vuoi partire?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => { setChooserOpen(false); openPiecePicker(); }}
              className="flex items-center gap-3 rounded-md border-2 border-border bg-background p-4 text-left hover:border-dept hover:bg-dept-soft"
            >
              <Package className="h-5 w-5" />
              <div>
                <div className="font-semibold">Da reparti</div>
                <div className="text-xs text-muted-foreground">Recupera un pezzo da Laboratorio, Tappezzeria o Falegnameria.</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setChooserOpen(false); setTemplatePicker(true); }}
              className="flex items-center gap-3 rounded-md border-2 border-border bg-background p-4 text-left hover:border-dept hover:bg-dept-soft"
            >
              <Library className="h-5 w-5" />
              <div>
                <div className="font-semibold">Da causale</div>
                <div className="text-xs text-muted-foreground">Scegli una causale salvata (es. Posa pavimento, Ignifugazione).</div>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Picker semplice di causale (senza editor) */}
      <Dialog open={templatePicker} onOpenChange={setTemplatePicker}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Scegli una causale</DialogTitle>
            <DialogDescription>Tocca una causale per aggiungere la lavorazione.</DialogDescription>
          </DialogHeader>
          {templates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessuna causale salvata. Usa "Gestisci causali" per crearne una.
            </p>
          )}
          <div className="space-y-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => addFromTemplate(t)}
                className="flex w-full items-center justify-between rounded-sm border border-border bg-background p-3 text-left hover:border-dept hover:bg-dept-soft"
              >
                <div>
                  <div className="font-medium">{t.nome}</div>
                  {t.descrizione && <div className="text-xs text-muted-foreground">{t.descrizione}</div>}
                  <div className="text-xs text-muted-foreground mt-0.5">{t.ore_stimate}h · €{t.costo_orario_default}/h</div>
                </div>
                <Plus className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" variant="outline" onClick={() => { setTemplatePicker(false); setTemplateOpen(true); }}>
              <Wrench className="h-4 w-4" />Crea/modifica causali
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={piecePickerOpen} onOpenChange={setPiecePickerOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Recupera lavorazioni dai reparti</DialogTitle>
            <DialogDescription>
              Seleziona uno o più pezzi: puoi aggiungerli separatamente o riunirli in un unico montaggio.
            </DialogDescription>
          </DialogHeader>
          {pieces.length === 0 && <p className="text-sm text-muted-foreground">Nessun pezzo trovato nel progetto attivo.</p>}
          <div className="space-y-3">
            {(["stampa", "tappezzeria", "falegnameria"] as const).map((d) => {
              const group = pieces.filter((p) => p.dept === d);
              if (group.length === 0) return null;
              return (
                <div key={d} className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">{group[0].deptLabel}</h4>
                  {group.map((p) => {
                    const k = pieceKey(p);
                    const checked = selectedPieceKeys.has(k);
                    return (
                      <label
                        key={k}
                        className={`flex w-full items-center gap-3 rounded-sm border bg-background p-3 text-sm cursor-pointer ${checked ? "border-dept bg-dept-soft" : "border-border hover:border-dept/60"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePieceSelection(p)}
                        />
                        <div className="flex-1">
                          <div className="font-medium">{p.productName}</div>
                          <div className="text-xs text-muted-foreground">{p.width}×{p.height} {p.dimUnit}{p.quantity > 1 ? ` · ×${p.quantity}` : ""}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {pieces.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {selectedPieceKeys.size === 0 ? "Nessun pezzo selezionato" : `${selectedPieceKeys.size} selezionati`}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedPieceKeys.size === 0}
                  onClick={async () => {
                    const sel = pieces.filter((p) => selectedPieceKeys.has(pieceKey(p)));
                    for (const p of sel) await addFromPiece(p);
                    setPiecePickerOpen(false);
                  }}
                >
                  Aggiungi separati
                </Button>
                <Button
                  size="sm"
                  disabled={selectedPieceKeys.size === 0}
                  onClick={() => {
                    const sel = pieces.filter((p) => selectedPieceKeys.has(pieceKey(p)));
                    addGroupedFromPieces(sel);
                  }}
                >
                  <Plus className="h-4 w-4" />Riunisci in un unico montaggio
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
};
