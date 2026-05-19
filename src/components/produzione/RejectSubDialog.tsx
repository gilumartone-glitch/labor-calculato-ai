import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { AlertTriangle, RotateCcw, ArrowLeftCircle } from "lucide-react";
import { ProdSubOrder, ProdOrder, DEPT_LABEL } from "@/lib/produzione/types";

export type RejectScope = "sub" | "order";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sub: ProdSubOrder | null;
  order: ProdOrder | null;
  onConfirm: (scope: RejectScope, reason: string) => Promise<void> | void;
};

export const RejectSubDialog = ({ open, onOpenChange, sub, order, onConfirm }: Props) => {
  const [scope, setScope] = useState<RejectScope>("order");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setScope("order"); setReason(""); setBusy(false);
      // Fix Radix bug: quando un altro Dialog si chiude appena prima, lascia
      // pointer-events:none sul <body> e blocca la digitazione qui.
      const id = window.setTimeout(() => { document.body.style.pointerEvents = ""; }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  if (!sub || !order) return null;

  const canSubmit = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftCircle className="w-5 h-5 text-amber-600" />
            Revisiona lavorazione
          </DialogTitle>
          <DialogDescription>
            La lavorazione <span className="font-mono font-bold">{sub.code}</span> ({DEPT_LABEL[sub.dept]}) verrà inviata in revisione al creatore dell'ordine.
            Spiega perché: la motivazione sarà visibile nella notifica e nel log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider font-bold">Cosa revisionare</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as RejectScope)} className="gap-2">
              <label className={`flex items-start gap-3 p-3 border-2 rounded-sm cursor-pointer transition-colors ${scope === "sub" ? "border-primary bg-primary/5" : "border-ink/15 hover:bg-muted/40"}`}>
                <RadioGroupItem value="sub" id="scope-sub" className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-display font-semibold text-sm">Solo questa lavorazione</div>
                  <div className="text-[11px] text-muted-foreground">
                    La lavorazione passa in revisione. L'ordine resta in officina, le altre lavorazioni continuano.
                  </div>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 border-2 rounded-sm cursor-pointer transition-colors ${scope === "order" ? "border-destructive bg-destructive/5" : "border-ink/15 hover:bg-muted/40"}`}>
                <RadioGroupItem value="order" id="scope-order" className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-display font-semibold text-sm flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                    Tutto il progetto torna in revisione
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    L'ordine <span className="font-mono">{order.code}</span> viene chiuso in officina e ricompare tra i progetti modificabili del creatore.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reject-reason" className="text-[11px] uppercase tracking-wider font-bold">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Es.: file stampa illeggibile / misure errate / materiale mancante…"
              rows={4}
              className="text-sm"
            />
            <div className="text-[10px] text-muted-foreground">Minimo 5 caratteri. Sii specifico così il creatore sa cosa correggere.</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Annulla</Button>
          <Button
            variant={scope === "order" ? "destructive" : "default"}
            disabled={!canSubmit || busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(scope, reason.trim()); }
              finally { setBusy(false); }
            }}
            className="gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            {scope === "order" ? "Revisiona progetto" : "Revisiona lavorazione"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};