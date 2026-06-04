import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { createRecord, updateRecord, shareRecord, unshareRecord, listSharesForRecords, listProfiles, type UserLite } from "@/lib/record/api";
import { RECORD_TYPE_META, type ContactKind, type PersonalRecord, type RecordType, type RecordVisibility } from "@/lib/record/types";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  knownContacts: { name: string; kind: ContactKind }[];
  existing?: PersonalRecord | null;
  onSaved: () => void;
};

export default function RecordDialog({ open, onOpenChange, knownContacts, existing, onSaved }: Props) {
  const { user } = useAuth();
  const [contactName, setContactName] = useState("");
  const [contactKind, setContactKind] = useState<ContactKind>("cliente");
  const [recordType, setRecordType] = useState<RecordType>("promemoria");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [eventAt, setEventAt] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<RecordVisibility>("private");
  const [profiles, setProfiles] = useState<UserLite[]>([]);
  const [shareWith, setShareWith] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    listProfiles().then(setProfiles).catch(() => {});
    if (existing) {
      setContactName(existing.contact_name);
      setContactKind(existing.contact_kind);
      setRecordType(existing.record_type);
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setAmount(existing.amount != null ? String(existing.amount) : "");
      setDueDate(existing.due_date ?? "");
      setEventAt(existing.event_at ? existing.event_at.slice(0, 16) : "");
      setTags((existing.tags ?? []).join(", "));
      setVisibility(existing.visibility);
      listSharesForRecords([existing.id]).then((s) => setShareWith(new Set(s.map((x) => x.shared_with)))).catch(() => {});
    } else {
      setContactName(""); setContactKind("cliente"); setRecordType("promemoria");
      setTitle(""); setDescription(""); setAmount(""); setDueDate(""); setEventAt("");
      setTags(""); setVisibility("private"); setShareWith(new Set());
    }
  }, [open, existing]);

  const meta = RECORD_TYPE_META[recordType];

  const contactSuggestions = useMemo(
    () => knownContacts.filter((c) => contactName.length >= 2 && c.name.toLowerCase().includes(contactName.toLowerCase())).slice(0, 6),
    [contactName, knownContacts],
  );

  const handleSave = async () => {
    if (!user) return;
    if (!contactName.trim()) { toast({ title: "Inserisci il contatto" }); return; }
    if (!title.trim()) { toast({ title: "Inserisci un titolo" }); return; }
    if (meta.monetary && !amount) { toast({ title: "Inserisci l'importo" }); return; }
    setSaving(true);
    try {
      const payload = {
        owner_id: user.id,
        contact_name: contactName.trim(),
        contact_kind: contactKind,
        record_type: recordType,
        title: title.trim(),
        description: description.trim() || null,
        amount: meta.monetary ? Number(amount) : null,
        currency: "EUR",
        due_date: dueDate || null,
        event_at: eventAt ? new Date(eventAt).toISOString() : null,
        status: existing?.status ?? "aperto" as const,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility,
      };
      const rec = existing
        ? await updateRecord(existing.id, payload)
        : await createRecord(payload);

      if (visibility === "shared") {
        const existingShares = await listSharesForRecords([rec.id]);
        const existingSet = new Set(existingShares.map((s) => s.shared_with));
        for (const uid of shareWith) {
          if (!existingSet.has(uid)) await shareRecord(rec.id, uid, user.id);
        }
        for (const s of existingShares) {
          if (!shareWith.has(s.shared_with)) await unshareRecord(rec.id, s.shared_with);
        }
      } else {
        const existingShares = await listSharesForRecords([rec.id]);
        for (const s of existingShares) await unshareRecord(rec.id, s.shared_with);
      }
      toast({ title: existing ? "Record aggiornato" : "Record creato" });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Errore", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Modifica record" : "Nuovo record"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Contatto (cliente o fornitore)</Label>
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Es. APA Srl" autoFocus />
            {contactSuggestions.length > 0 && (
              <div className="mt-1 border rounded-sm bg-popover">
                {contactSuggestions.map((c) => (
                  <button key={c.name} type="button" onClick={() => { setContactName(c.name); setContactKind(c.kind); }}
                    className="block w-full text-left px-2 py-1 text-sm hover:bg-muted">
                    {c.name} <span className="text-xs text-muted-foreground">· {c.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo contatto</Label>
              <Select value={contactKind} onValueChange={(v) => setContactKind(v as ContactKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cliente">Cliente</SelectItem>
                  <SelectItem value="fornitore">Fornitore</SelectItem>
                  <SelectItem value="entrambi">Entrambi</SelectItem>
                  <SelectItem value="altro">Altro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Tipo di record</Label>
            <RadioGroup value={recordType} onValueChange={(v) => setRecordType(v as RecordType)} className="grid grid-cols-2 gap-2 mt-1">
              {(Object.keys(RECORD_TYPE_META) as RecordType[]).map((t) => (
                <label key={t} className={`flex items-center gap-2 border rounded-sm p-2 cursor-pointer ${recordType === t ? "border-primary" : ""}`}>
                  <RadioGroupItem value={t} />
                  <span className="text-sm">{RECORD_TYPE_META[t].label}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label>Titolo</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Breve descrizione" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {meta.monetary && (
              <div>
                <Label>Importo (€)</Label>
                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            )}
            <div>
              <Label>Scadenza</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Data evento</Label>
              <Input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Note</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div>
            <Label>Tag (separati da virgola)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="urgente, fattura, 2026" />
          </div>

          <div className="border-t pt-3">
            <Label>Condivisione</Label>
            <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as RecordVisibility)} className="flex gap-3 mt-1">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="private" /> Privato</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="shared" /> Utenti scelti</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="all" /> Tutti</label>
            </RadioGroup>
            {visibility === "shared" && (
              <div className="mt-2 grid grid-cols-2 gap-1 max-h-40 overflow-y-auto border rounded-sm p-2">
                {profiles.filter((p) => p.id !== user?.id).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={shareWith.has(p.id)}
                      onCheckedChange={(c) => {
                        const next = new Set(shareWith);
                        if (c) next.add(p.id); else next.delete(p.id);
                        setShareWith(next);
                      }}
                    />
                    {p.display_name ?? p.id.slice(0, 8)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
