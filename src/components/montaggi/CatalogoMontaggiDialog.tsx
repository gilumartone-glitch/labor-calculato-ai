import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMontaggiCatalog, type CatalogEntry, type CatalogKind } from "@/lib/montaggi/catalog";

type Props = { open: boolean; onClose: () => void; defaultKind?: CatalogKind };

export const CatalogoMontaggiDialog = ({ open, onClose, defaultKind = "attrezzo" }: Props) => {
  const [kind, setKind] = useState<CatalogKind>(defaultKind);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Catalogo Montaggi</DialogTitle>
        </DialogHeader>
        <Tabs value={kind} onValueChange={(v) => setKind(v as CatalogKind)}>
          <TabsList>
            <TabsTrigger value="attrezzo">Attrezzi</TabsTrigger>
            <TabsTrigger value="materiale">Materiali</TabsTrigger>
          </TabsList>
          <TabsContent value="attrezzo">
            <CatalogList kind="attrezzo" />
          </TabsContent>
          <TabsContent value="materiale">
            <CatalogList kind="materiale" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const CatalogList = ({ kind }: { kind: CatalogKind }) => {
  const { items, loading, create, update, remove } = useMontaggiCatalog(kind);
  const [draft, setDraft] = useState<{ nome: string; categoria: string; unita: string }>({
    nome: "",
    categoria: "",
    unita: "pz",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CatalogEntry>>({});

  const handleCreate = async () => {
    if (!draft.nome.trim()) return toast.info("Inserisci un nome");
    try {
      await create({ nome: draft.nome.trim(), categoria: draft.categoria.trim() || null, unita: draft.unita });
      setDraft({ nome: "", categoria: "", unita: "pz" });
      toast.success("Aggiunto al catalogo");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const startEdit = (item: CatalogEntry) => {
    setEditingId(item.id);
    setEditDraft({ nome: item.nome, categoria: item.categoria, unita: item.unita, descrizione: item.descrizione });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await update(editingId, editDraft);
      setEditingId(null);
      toast.success("Aggiornato");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Eliminare questa voce dal catalogo?")) return;
    try {
      await remove(id);
      toast.success("Eliminato");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4 py-4">
      <div className="grid grid-cols-[1fr_140px_90px_auto] gap-2 items-end p-3 rounded-sm border-2 border-dashed border-border bg-muted/30">
        <div>
          <Label className="text-xs">Nuovo {kind === "attrezzo" ? "attrezzo" : "materiale"}</Label>
          <Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} placeholder="Nome" />
        </div>
        <div>
          <Label className="text-xs">Categoria</Label>
          <Input value={draft.categoria} onChange={(e) => setDraft({ ...draft, categoria: e.target.value })} placeholder="(opzionale)" />
        </div>
        <div>
          <Label className="text-xs">Unità</Label>
          <Input value={draft.unita} onChange={(e) => setDraft({ ...draft, unita: e.target.value })} />
        </div>
        <Button onClick={handleCreate}><Plus className="h-4 w-4" />Aggiungi</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessuna voce ancora. Aggiungi la prima qui sopra.</p>
      ) : (
        <div className="rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-left px-3 py-2">Categoria</th>
                <th className="text-left px-3 py-2 w-20">Unità</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/20">
                  {editingId === item.id ? (
                    <>
                      <td className="px-2 py-1"><Input value={editDraft.nome ?? ""} onChange={(e) => setEditDraft({ ...editDraft, nome: e.target.value })} /></td>
                      <td className="px-2 py-1"><Input value={editDraft.categoria ?? ""} onChange={(e) => setEditDraft({ ...editDraft, categoria: e.target.value })} /></td>
                      <td className="px-2 py-1"><Input value={editDraft.unita ?? ""} onChange={(e) => setEditDraft({ ...editDraft, unita: e.target.value })} /></td>
                      <td className="px-2 py-1 flex gap-1">
                        <Button size="icon" variant="outline" onClick={saveEdit}><Check className="h-3 w-3" /></Button>
                        <Button size="icon" variant="outline" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-medium">{item.nome}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.categoria ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{item.unita}</td>
                      <td className="px-2 py-1 flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => startEdit(item)}><Pencil className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(item.id)}><Trash2 className="h-3 w-3" /></Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
