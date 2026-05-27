import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ContabContact, loadContabContacts, addContabContact } from "@/lib/produzione/contabilita-contacts";

type Props = {
  value: string;
  onChange: (name: string) => void;
  type: "cliente" | "fornitore";
  placeholder?: string;
  className?: string;
  /** Compatto per liste / per-row */
  size?: "sm" | "md";
  autoFocus?: boolean;
  /** Se true: i nuovi contatti vengono aggiunti come "entrambi" (cliente+fornitore) e la ricerca mostra anche l'altro tipo. */
  unified?: boolean;
};

/** Combobox cliente/fornitore con autocomplete da contabilita_state e + per aggiungere. */
export const ContactSelect = ({ value, onChange, type, placeholder, className, size = "md", autoFocus }: Props) => {
  const [contacts, setContacts] = useState<ContabContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { setQuery(value ?? ""); }, [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadContabContacts().then((list) => {
      if (cancelled) return;
      setContacts(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => c.type === type || c.type === "entrambi")
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [contacts, query, type]);

  useEffect(() => { setHighlight(-1); }, [query, open]);
  useEffect(() => {
    if (highlight >= 0 && itemsRef.current[highlight]) {
      itemsRef.current[highlight]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  const confirmHighlighted = () => {
    const item = filtered[highlight];
    if (!item) return false;
    onChange(item.name);
    setQuery(item.name);
    setOpen(false);
    return true;
  };

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const c = await addContabContact({ name, type });
      setContacts((prev) => prev.some((x) => x.id === c.id) ? prev : [...prev, c]);
      onChange(c.name);
      setQuery(c.name);
      setAddOpen(false);
      setAddName("");
      toast.success(`${type === "cliente" ? "Cliente" : "Fornitore"} aggiunto in anagrafica`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore aggiunta");
    } finally {
      setAdding(false);
    }
  };

  const inputCls = size === "sm" ? "h-8 text-[12px]" : "";

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || filtered.length === 0) return;
              if (e.key === "Tab" && !e.shiftKey) {
                // Tab → scendi nella lista (primo elemento o successivo)
                e.preventDefault();
                setHighlight((h) => (h < 0 ? 0 : (h + 1) % filtered.length));
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h < 0 ? 0 : (h + 1) % filtered.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h <= 0 ? filtered.length - 1 : h - 1));
              } else if (e.key === "Enter") {
                if (highlight >= 0) { e.preventDefault(); confirmHighlighted(); }
                else if (filtered.length === 1) { e.preventDefault(); onChange(filtered[0].name); setQuery(filtered[0].name); setOpen(false); }
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={placeholder ?? (type === "cliente" ? "Cerca cliente…" : "Cerca fornitore…")}
            className={inputCls}
            autoFocus={autoFocus}
          />
          {open && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border-2 border-ink/15 rounded-sm shadow-lg max-h-56 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 inline mr-1 animate-spin" /> Caricamento…</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-1.5"><Search className="w-3 h-3" /> Nessun {type} trovato. Usa il + per aggiungere.</div>
              ) : filtered.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  ref={(el) => (itemsRef.current[i] = el)}
                  onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setQuery(c.name); setOpen(false); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] border-b border-ink/5 last:border-0 ${i === highlight ? "bg-muted/70" : "hover:bg-muted/50"}`}
                >
                  <div className="font-medium">{c.name}</div>
                  {c.email && <div className="text-[10px] text-muted-foreground font-mono">{c.email}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={size === "sm" ? "h-8 w-8 shrink-0" : "shrink-0"}
          title={`Aggiungi nuovo ${type}`}
          onClick={() => { setAddName(query); setAddOpen(true); }}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuovo {type}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Nome / Ragione sociale *</Label>
            <Input value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus placeholder={type === "cliente" ? "es. Studio Rossi srl" : "es. Fornitura Lab spa"} />
            <div className="text-[10px] font-mono text-muted-foreground">Verrà aggiunto all'anagrafica condivisa con la Contabilità.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>Annulla</Button>
            <Button onClick={handleAdd} disabled={adding || !addName.trim()}>
              {adding ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />} Aggiungi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};