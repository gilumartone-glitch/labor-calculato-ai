import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Commessa, CommessaPriorita, CommessaReparto, CommessaStato, CommessaTipo, Profile, REPARTI, STATI } from "./types";
import { ContactSelect } from "@/components/produzione/ContactSelect";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Partial<Commessa> | null;
  profiles: Profile[];
  onSave: (
    data: Omit<Commessa, "id" | "created_by" | "created_at" | "updated_at" | "ordine" | "assegnatari">,
    assegnatariIds: string[],
    id?: string,
  ) => Promise<void>;
}

export const CommessaDialog = ({ open, onOpenChange, initial, profiles, onSave }: Props) => {
  const [titolo, setTitolo] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [cliente, setCliente] = useState("");
  const [importo, setImporto] = useState<number | "">("");
  const [dataScadenza, setDataScadenza] = useState("");
  const [reparto, setReparto] = useState<CommessaReparto>("generale");
  const [priorita, setPriorita] = useState<CommessaPriorita>("media");
  const [stato, setStato] = useState<CommessaStato>("da_fare");
  const [tipo, setTipo] = useState<CommessaTipo>("commessa");
  const [note, setNote] = useState("");
  const [fornitore, setFornitore] = useState("");
  const [assegnatariIds, setAssegnatariIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const FORN_RE = /^Fornitore:\s*(.+?)\n?\n?/;

  useEffect(() => {
    if (open) {
      setTitolo(initial?.titolo ?? "");
      const desc = initial?.descrizione ?? "";
      const m = desc.match(FORN_RE);
      setFornitore(m ? m[1].trim() : "");
      setDescrizione(m ? desc.replace(FORN_RE, "") : desc);
      setCliente(initial?.cliente ?? "");
      setImporto(typeof initial?.importo === "number" ? initial.importo : "");
      setDataScadenza(initial?.data_scadenza ?? "");
      setReparto((initial?.reparto as CommessaReparto) ?? "generale");
      setPriorita((initial?.priorita as CommessaPriorita) ?? "media");
      setStato((initial?.stato as CommessaStato) ?? "da_fare");
      setTipo((initial?.tipo as CommessaTipo) ?? "commessa");
      setNote(initial?.note ?? "");
      setAssegnatariIds(initial?.assegnatari?.map((a) => a.id) ?? []);
    }
  }, [open, initial]);

  const needsFornitore = reparto === "amministrazione" || reparto === "acquisti";


  const toggleAssignee = (id: string) =>
    setAssegnatariIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!titolo.trim()) {
      toast.error("Il titolo è obbligatorio");
      return;
    }
    if (needsFornitore && !fornitore.trim()) {
      toast.error("Indica il fornitore consigliato per il reparto Acquisti / Amministrazione");
      return;
    }
    setSaving(true);
    try {
      const descFinal = needsFornitore && fornitore.trim()
        ? `Fornitore: ${fornitore.trim()}\n\n${descrizione.trim()}`.trim()
        : descrizione.trim();
      await onSave(
        {
          titolo: titolo.trim(),
          descrizione: descFinal || null,
          cliente: reparto === "acquisti" ? (fornitore.trim() || null) : (cliente.trim() || null),
          importo: typeof importo === "number" && importo > 0 ? importo : null,
          data_scadenza: dataScadenza || null,

          reparto,
          priorita,
          stato,
          tipo,
          note: note.trim() || null,
        },
        assegnatariIds,
        initial?.id,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore di salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const isEdit = Boolean(initial?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-paper border-2 border-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {isEdit ? "Modifica" : "Nuova"} {tipo === "task" ? "task" : "commessa"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit ? "Aggiorna i campi e salva." : "Compila i campi e salva. Trascinerai la card tra le colonne del flow."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo */}
          <div>
            <div className="label-cap mb-1">Tipo</div>
            <div className="inline-flex border-2 border-ink rounded-sm overflow-hidden">
              {(["commessa", "task"] as CommessaTipo[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                    tipo === t ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  {t === "commessa" ? "Commessa" : "Task generico"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label-cap block mb-1">Titolo *</label>
            <input
              type="text"
              value={titolo}
              onChange={(e) => setTitolo(e.target.value)}
              placeholder={tipo === "task" ? "es. Chiamare cliente Rossi" : "es. Tende soggiorno casa Bianchi"}
              className="input-bare w-full text-sm"
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {reparto === "acquisti" ? (
              <div>
                <label className="label-cap block mb-1">Fornitore *</label>
                <ContactSelect
                  value={fornitore}
                  onChange={setFornitore}
                  type="fornitore"
                  size="sm"
                  unified
                />
              </div>
            ) : reparto === "amministrazione" ? (
              <>
                <div>
                  <label className="label-cap block mb-1">Cliente</label>
                  <ContactSelect value={cliente} onChange={setCliente} type="cliente" size="sm" unified />
                </div>
                <div>
                  <label className="label-cap block mb-1">Fornitore *</label>
                  <ContactSelect value={fornitore} onChange={setFornitore} type="fornitore" size="sm" unified />
                </div>
              </>
            ) : (
              <div>
                <label className="label-cap block mb-1">Cliente</label>
                <ContactSelect value={cliente} onChange={setCliente} type="cliente" size="sm" unified />
              </div>
            )}
            <div>
              <label className="label-cap block mb-1">Importo (€)</label>
              <input
                type="number"
                step="0.01"
                value={importo === "" ? "" : importo}
                onChange={(e) => setImporto(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="input-bare w-full text-right font-mono text-sm"
              />
            </div>
          </div>


          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-cap block mb-1">Reparto</label>
              <select
                value={reparto}
                onChange={(e) => setReparto(e.target.value as CommessaReparto)}
                className="input-bare w-full text-sm bg-paper"
              >
                {REPARTI.map((r) => (<option key={r.k} value={r.k}>{r.label}</option>))}
              </select>
            </div>
            <div>
              <label className="label-cap block mb-1">Priorità</label>
              <select
                value={priorita}
                onChange={(e) => setPriorita(e.target.value as CommessaPriorita)}
                className="input-bare w-full text-sm bg-paper"
              >
                <option value="bassa">Bassa</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
            </div>
            <div>
              <label className="label-cap block mb-1">Stato</label>
              <select
                value={stato}
                onChange={(e) => setStato(e.target.value as CommessaStato)}
                className="input-bare w-full text-sm bg-paper"
              >
                {STATI.map((s) => (<option key={s.k} value={s.k}>{s.label}</option>))}
              </select>
            </div>
          </div>




          <div>
            <label className="label-cap block mb-1">Scadenza</label>
            <input
              type="date"
              value={dataScadenza}
              onChange={(e) => setDataScadenza(e.target.value)}
              className="input-bare w-full text-sm bg-paper"
            />
          </div>

          <div>
            <label className="label-cap block mb-1">Descrizione</label>
            <textarea
              value={descrizione}
              onChange={(e) => setDescrizione(e.target.value)}
              rows={2}
              className="input-bare w-full text-sm resize-none"
            />
          </div>

          <div>
            <label className="label-cap block mb-1">Note interne</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="input-bare w-full text-sm resize-none"
            />
          </div>

          {profiles.length > 0 && (
            <div>
              <div className="label-cap mb-1">Assegnatari ({assegnatariIds.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {profiles.map((p) => {
                  const active = assegnatariIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleAssignee(p.id)}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-wider font-bold transition-colors ${
                        active ? "bg-ink text-paper border-ink" : "border-ink/30 text-ink/70 hover:border-ink"
                      }`}
                    >
                      <span className="w-4 h-4 grid place-items-center bg-current/10 rounded-full text-[8px] font-mono">
                        {(p.display_name ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                      {p.display_name ?? "Utente"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-ink/15">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-xs uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink px-3"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-ink transition-colors disabled:opacity-60"
            >
              {isEdit ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {isEdit ? "Aggiorna" : "Crea"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};