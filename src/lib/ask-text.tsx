import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** In-app replacement for window.prompt (unsupported in some browsers/webviews). Resolves null on cancel. */
export function askText(message: string, opts: { defaultValue?: string; type?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => { resolve(v); setTimeout(() => { root.unmount(); host.remove(); }, 0); };
    function Ask() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState(opts.defaultValue ?? "");
      const finish = (v: string | null) => { setOpen(false); done(v); };
      return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) finish(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Inserisci</DialogTitle><DialogDescription className="whitespace-pre-line">{message}</DialogDescription></DialogHeader>
            <Input autoFocus type={opts.type ?? "text"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") finish(value); }} />
            <DialogFooter><Button variant="outline" onClick={() => finish(null)}>Annulla</Button><Button onClick={() => finish(value)}>OK</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    root.render(<Ask />);
  });
}
