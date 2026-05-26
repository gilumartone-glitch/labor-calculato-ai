import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Variant = "ink" | "outline" | "compact";

export const ChangePasswordButton = ({
  variant = "outline",
  className = "",
}: { variant?: Variant; className?: string } = {}) => {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);

  const base = "inline-flex items-center gap-1.5 rounded-sm uppercase tracking-wider font-semibold transition-colors";
  const styles: Record<Variant, string> = {
    ink: "px-2.5 py-2 border-2 border-ink bg-background text-ink/70 text-[11px] hover:bg-ink hover:text-paper",
    outline: "px-3 py-2 border border-input bg-background text-foreground text-xs hover:bg-accent hover:text-accent-foreground",
    compact: "px-2 py-1 border border-ink/30 bg-paper text-ink/80 text-[10px] hover:bg-ink hover:text-paper",
  };

  const submit = async () => {
    if (pwd.length < 8) { toast.error("La password deve avere almeno 8 caratteri"); return; }
    if (pwd !== pwd2) { toast.error("Le password non coincidono"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);
    if (error) { toast.error(error.message || "Errore cambio password"); return; }
    toast.success("Password aggiornata");
    setPwd(""); setPwd2(""); setOpen(false);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className={`${base} ${styles[variant]} ${className}`} title="Cambia la tua password">
        <KeyRound className="w-3.5 h-3.5" />
        <span className="hidden md:inline">Password</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cambia password</DialogTitle>
            <DialogDescription className="text-xs">Almeno 8 caratteri. La modifica è immediata.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="np">Nuova password</Label>
              <Input id="np" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="np2">Conferma</Label>
              <Input id="np2" type="password" autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Annulla</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Aggiorna
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
