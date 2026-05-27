import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type Snapshot = {
  id: string;
  created_at: string;
  created_by: string | null;
  movements_count: number;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  remoteKey: string;
  /** Chiamata quando l'utente vuole ripristinare uno snapshot: riceve il `data` jsonb originale. */
  onRestore: (data: unknown) => Promise<void> | void;
};

export function SnapshotsDialog({ open, onOpenChange, remoteKey, onRestore }: Props) {
  const [items, setItems] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("contabilita_state_snapshots")
        .select("id, created_at, created_by, movements_count")
        .eq("key", remoteKey)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        toast.error("Impossibile caricare le versioni: " + error.message);
        setItems([]);
      } else {
        setItems((data ?? []) as Snapshot[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, remoteKey]);

  const handleRestore = async (snapId: string) => {
    if (!confirm("Ripristinare questa versione? Lo stato attuale verrà salvato automaticamente come nuova versione, così potrai sempre tornare indietro.")) return;
    setRestoringId(snapId);
    try {
      const { data, error } = await supabase
        .from("contabilita_state_snapshots")
        .select("data")
        .eq("id", snapId)
        .maybeSingle();
      if (error || !data?.data) throw new Error(error?.message ?? "Snapshot vuoto");
      await onRestore(data.data);
      toast.success("Versione ripristinata");
      onOpenChange(false);
    } catch (e) {
      toast.error("Ripristino fallito: " + (e as Error).message);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Versioni precedenti della contabilità</DialogTitle>
          <DialogDescription>
            Vengono conservate le ultime 50 versioni. Ogni salvataggio crea automaticamente uno snapshot.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carico…
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nessuna versione disponibile.</p>
          ) : (
            <ul className="divide-y">
              {items.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {new Date(s.created_at).toLocaleString("it-IT", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.movements_count} movimenti
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestore(s.id)}
                    disabled={restoringId !== null}
                  >
                    {restoringId === s.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><RotateCcw className="h-4 w-4 mr-1" /> Ripristina</>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
