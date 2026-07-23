import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Users2 } from "lucide-react";

type Profile = { id: string; display_name: string | null };
type Share = { id: string; shared_with: string; profile?: Profile | null };

export const ShareDraftDialog = ({
  open, onOpenChange, draftId, draftName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draftId: string | null;
  draftName: string;
}) => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !draftId || !user) return;
    let cancelled = false;
    (async () => {
      const [{ data: profs }, { data: shr }] = await Promise.all([
        supabase.from("profiles").select("id, display_name").eq("approved", true).order("display_name"),
        supabase.from("design_draft_shares").select("id, shared_with").eq("draft_id", draftId),
      ]);
      if (cancelled) return;
      setProfiles((profs ?? []).filter((p: any) => p.id !== user.id) as Profile[]);
      setShares((shr ?? []) as Share[]);
    })();
    return () => { cancelled = true; };
  }, [open, draftId, user]);

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const availableProfiles = profiles.filter((p) => !shares.some((s) => s.shared_with === p.id));

  const addShare = async () => {
    if (!draftId || !user || !selected) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("design_draft_shares")
      .insert({ draft_id: draftId, shared_with: selected, created_by: user.id })
      .select()
      .single();
    setBusy(false);
    if (error) { toast.error("Errore: " + error.message); return; }
    setShares((prev) => [...prev, data as Share]);
    setSelected("");
    toast.success("Progetto condiviso");
  };

  const removeShare = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("design_draft_shares").delete().eq("id", id);
    setBusy(false);
    if (error) { toast.error("Errore: " + error.message); return; }
    setShares((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users2 className="w-5 h-5" />
            Condividi «{draftName}»
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Gli utenti invitati possono modificare il progetto insieme a te finché non viene inviato al Flow.
          </p>

          <div className="flex items-center gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Seleziona utente…" />
              </SelectTrigger>
              <SelectContent>
                {availableProfiles.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nessun utente disponibile</div>
                ) : availableProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name || p.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addShare} disabled={!selected || busy}>Condividi</Button>
          </div>

          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Collaboratori attuali ({shares.length})
            </div>
            {shares.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">Nessuna condivisione attiva</div>
            ) : (
              <ul className="space-y-1">
                {shares.map((s) => {
                  const p = profileMap.get(s.shared_with);
                  return (
                    <li key={s.id} className="flex items-center justify-between p-2 border border-ink/10 rounded-sm">
                      <span className="text-sm">{p?.display_name || s.shared_with.slice(0, 8)}</span>
                      <button
                        type="button"
                        onClick={() => removeShare(s.id)}
                        disabled={busy}
                        className="w-6 h-6 grid place-items-center text-muted-foreground hover:text-destructive"
                        title="Revoca accesso"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
