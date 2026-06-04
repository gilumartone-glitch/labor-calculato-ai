import { useMemo, useState } from "react";
import { Plus, Trash2, Wrench, Package, Library } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAssignmentItems, useMontaggiCatalog, type CatalogKind } from "@/lib/montaggi/catalog";
import { CatalogoMontaggiDialog } from "./CatalogoMontaggiDialog";

type Props = { commessaId: string };

export const AttrezziMaterialiPicker = ({ commessaId }: Props) => {
  const [catalogOpen, setCatalogOpen] = useState<CatalogKind | null>(null);
  const { items, add, update, remove } = useAssignmentItems(commessaId);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <SectionPicker
          kind="attrezzo"
          title="Attrezzi"
          icon={<Wrench className="h-4 w-4" />}
          items={items.filter((i) => i.kind === "attrezzo")}
          onAdd={(p) => add({ ...p, kind: "attrezzo" })}
          onUpdate={update}
          onRemove={remove}
          onOpenCatalog={() => setCatalogOpen("attrezzo")}
        />
        <SectionPicker
          kind="materiale"
          title="Materiali"
          icon={<Package className="h-4 w-4" />}
          items={items.filter((i) => i.kind === "materiale")}
          onAdd={(p) => add({ ...p, kind: "materiale" })}
          onUpdate={update}
          onRemove={remove}
          onOpenCatalog={() => setCatalogOpen("materiale")}
        />
      </div>
      {catalogOpen && (
        <CatalogoMontaggiDialog open onClose={() => setCatalogOpen(null)} defaultKind={catalogOpen} />
      )}
    </>
  );
};

type SectionProps = {
  kind: CatalogKind;
  title: string;
  icon: React.ReactNode;
  items: Array<{ id: string; ref_id: string | null; ref_nome: string; qty: number; unita: string; note: string | null }>;
  onAdd: (p: { ref_id?: string | null; ref_nome: string; qty: number; unita?: string }) => Promise<void>;
  onUpdate: (id: string, patch: { qty?: number; note?: string | null }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onOpenCatalog: () => void;
};

const SectionPicker = ({ kind, title, icon, items, onAdd, onUpdate, onRemove, onOpenCatalog }: SectionProps) => {
  const { items: catalog, create } = useMontaggiCatalog(kind);
  const [pickerName, setPickerName] = useState("");
  const [pickerQty, setPickerQty] = useState<number>(1);

  const suggestions = useMemo(
    () =>
      catalog
        .filter((c) => !pickerName || c.nome.toLowerCase().includes(pickerName.toLowerCase()))
        .slice(0, 6),
    [catalog, pickerName],
  );

  const handleAdd = async () => {
    const nome = pickerName.trim();
    if (!nome) return toast.info("Inserisci un nome");
    try {
      const existing = catalog.find((c) => c.nome.toLowerCase() === nome.toLowerCase());
      let ref_id = existing?.id ?? null;
      let unita = existing?.unita ?? "pz";
      if (!existing) {
        // Aggiunge automaticamente al catalogo condiviso
        const created = await create({ nome, unita: "pz" });
        ref_id = created.id;
        toast.success(`"${nome}" aggiunto al catalogo`);
      }
      await onAdd({ ref_id, ref_nome: nome, qty: pickerQty, unita });
      setPickerName("");
      setPickerQty(1);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const pickFromCatalog = async (catalogId: string) => {
    const entry = catalog.find((c) => c.id === catalogId);
    if (!entry) return;
    try {
      await onAdd({ ref_id: entry.id, ref_nome: entry.nome, qty: 1, unita: entry.unita });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={onOpenCatalog}>
          <Library className="h-3.5 w-3.5" />Gestisci catalogo
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[1fr_80px_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Aggiungi {kind === "attrezzo" ? "attrezzo" : "materiale"}</Label>
            <Input
              list={`catalog-${kind}-${title}`}
              value={pickerName}
              onChange={(e) => setPickerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
              placeholder="Nome o scegli da catalogo…"
            />
            <datalist id={`catalog-${kind}-${title}`}>
              {suggestions.map((c) => (
                <option key={c.id} value={c.nome}>{c.categoria ?? ""}</option>
              ))}
            </datalist>
          </div>
          <div>
            <Label className="text-xs">Qtà</Label>
            <Input type="number" min={0} step={0.5} value={pickerQty} onChange={(e) => setPickerQty(Number(e.target.value))} />
          </div>
          <Button onClick={handleAdd}><Plus className="h-4 w-4" /></Button>
        </div>

        {catalog.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              📚 Catalogo ({catalog.length}) — click per inserire
            </summary>
            <div className="mt-2 flex flex-wrap gap-1">
              {catalog.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickFromCatalog(c.id)}
                  className="px-2 py-0.5 rounded-sm border border-border bg-background hover:bg-dept hover:text-dept-foreground transition text-xs"
                >
                  {c.nome}
                </button>
              ))}
            </div>
          </details>
        )}

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nessun {kind} assegnato</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((it) => (
              <li key={it.id} className="grid grid-cols-[1fr_80px_60px_auto] gap-2 items-center px-2 py-1 rounded-sm border border-border bg-background">
                <span className="text-sm font-medium truncate" title={it.ref_nome}>{it.ref_nome}</span>
                <Input
                  type="number"
                  step={0.5}
                  value={it.qty}
                  onChange={(e) => onUpdate(it.id, { qty: Number(e.target.value) })}
                  className="h-7 text-xs"
                />
                <span className="text-xs font-mono text-muted-foreground">{it.unita}</span>
                <Button size="icon" variant="ghost" onClick={() => onRemove(it.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
