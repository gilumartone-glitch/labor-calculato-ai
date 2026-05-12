import { useMemo, useState } from "react";
import { Plus, Search, Trash2, Users, Truck, ArrowLeft, Pencil, X, Link2, Unlink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { eur, uid } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Contact, ContactType, MovementLite, computeContactStats, getContactMovements, normalizeText } from "./contacts";

type Props = {
  contacts: Contact[];
  setContacts: (c: Contact[]) => void;
  movements: MovementLite[];
};

export const AnagraficaView = ({ contacts, setContacts, movements }: Props) => {
  const [section, setSection] = useState<"clienti" | "fornitori">("clienti");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);

  const filtered = useMemo(() => {
    const wanted: ContactType = section === "clienti" ? "cliente" : "fornitore";
    const q = normalizeText(search);
    return contacts
      .filter((c) => c.type === wanted || c.type === "entrambi")
      .filter((c) => !q || normalizeText(c.name).includes(q) || normalizeText(c.vat ?? "").includes(q))
      .map((c) => ({ contact: c, stats: computeContactStats(c, movements) }))
      .sort((a, b) => a.contact.name.localeCompare(b.contact.name, "it"));
  }, [contacts, section, search, movements]);

  const selected = useMemo(() => contacts.find((c) => c.id === selectedId) ?? null, [contacts, selectedId]);

  const upsert = (c: Contact) => {
    const exists = contacts.some((x) => x.id === c.id);
    setContacts(exists ? contacts.map((x) => (x.id === c.id ? c : x)) : [...contacts, c]);
  };
  const remove = (id: string) => {
    setContacts(contacts.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  if (selected) {
    return (
      <ContactDetail
        contact={selected}
        movements={movements}
        onBack={() => setSelectedId(null)}
        onEdit={() => setEditing(selected)}
        onDelete={() => { if (confirm(`Eliminare "${selected.name}" dall'anagrafica?`)) remove(selected.id); }}
        onUpdate={(c) => upsert(c)}
      />
    );
  }

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Anagrafica</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Clienti e fornitori · clicca un nome per la scheda dettagliata</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={section === "clienti" ? "default" : "outline"} onClick={() => setSection("clienti")}>
            <Users className="h-4 w-4" />Clienti ({contacts.filter((c) => c.type === "cliente" || c.type === "entrambi").length})
          </Button>
          <Button size="sm" variant={section === "fornitori" ? "default" : "outline"} onClick={() => setSection("fornitori")}>
            <Truck className="h-4 w-4" />Fornitori ({contacts.filter((c) => c.type === "fornitore" || c.type === "entrambi").length})
          </Button>
          <Button size="sm" onClick={() => setEditing({
            id: uid(), type: section === "clienti" ? "cliente" : "fornitore", name: "", createdAt: new Date().toISOString(),
          })}>
            <Plus className="h-4 w-4" />Nuovo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per nome o P.IVA…" />
        </div>
        {filtered.length === 0 ? (
          <div className="border-2 border-dashed border-dept/30 rounded-sm p-12 text-center text-muted-foreground">
            Nessun {section === "clienti" ? "cliente" : "fornitore"} {search ? "trovato" : "ancora inserito"}.
          </div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">P.IVA / CF</TableHead>
                  <TableHead className="text-right">Movimenti</TableHead>
                  <TableHead className="text-right">{section === "clienti" ? "Incassato" : "Pagato"}</TableHead>
                  <TableHead className="text-right">Esposizione</TableHead>
                  {section === "clienti" && <TableHead className="text-right">Fido sugg.</TableHead>}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(({ contact, stats }) => (
                  <TableRow key={contact.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelectedId(contact.id)}>
                    <TableCell className="font-medium">
                      {contact.name}
                      {contact.type === "entrambi" && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">cliente + fornitore</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground font-mono text-xs">{contact.vat ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{stats.count}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{eur(section === "clienti" ? stats.cassaIn : stats.cassaOut)}</TableCell>
                    <TableCell className={cn("text-right font-mono tabular-nums", stats.esposizione > 0 ? "text-amber-600" : stats.esposizione < 0 ? "text-destructive" : "")}>{eur(Math.abs(stats.esposizione))}</TableCell>
                    {section === "clienti" && <TableCell className="text-right font-mono tabular-nums text-primary">{eur(contact.fidoManual ?? stats.fidoSuggerito)}</TableCell>}
                    <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditing(contact); }}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {editing && <ContactEditDialog contact={editing} onSave={(c) => { upsert(c); setEditing(null); }} onCancel={() => setEditing(null)} onDelete={() => { remove(editing.id); setEditing(null); }} isNew={!contacts.some((x) => x.id === editing.id)} />}
    </Card>
  );
};

/* =============================== DETAIL =============================== */
const ContactDetail = ({ contact, movements, onBack, onEdit, onDelete, onUpdate }: {
  contact: Contact;
  movements: MovementLite[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (c: Contact) => void;
}) => {
  const stats = computeContactStats(contact, movements);
  const linked = getContactMovements(contact, movements).sort((a, b) => b.date.localeCompare(a.date));
  const fido = contact.fidoManual ?? stats.fidoSuggerito;
  const isCliente = contact.type === "cliente" || contact.type === "entrambi";
  const saldati = linked.filter((m) => m.status === "cassa");
  const daSaldare = linked.filter((m) => m.status === "previsto");
  const saldoRealizzato = stats.cassaIn - stats.cassaOut;        // dai movimenti già in cassa
  const saldoDaRealizzare = stats.previstoIn - stats.previstoOut; // dai previsti
  const saldoPrevisto = saldoRealizzato + saldoDaRealizzare;     // totale a fine ciclo

  // movimenti non collegati ma potenzialmente abbinabili (per linkare a mano)
  const [showLinker, setShowLinker] = useState(false);
  const linkedSet = new Set(linked.map((m) => m.id));
  const candidates = useMemo(() => movements
    .filter((m) => !linkedSet.has(m.id))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200), [movements, linkedSet]);

  const toggleLink = (movId: string, link: boolean) => {
    const linkedIds = new Set(contact.linkedIds ?? []);
    const excludedIds = new Set(contact.excludedIds ?? []);
    if (link) { linkedIds.add(movId); excludedIds.delete(movId); }
    else { excludedIds.add(movId); linkedIds.delete(movId); }
    onUpdate({ ...contact, linkedIds: [...linkedIds], excludedIds: [...excludedIds] });
  };

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" />Indietro</Button>
          <div>
            <CardTitle className="flex items-center gap-2">
              {contact.type === "fornitore" ? <Truck className="h-5 w-5" /> : <Users className="h-5 w-5" />}
              {contact.name}
            </CardTitle>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mt-1">
              {contact.type === "entrambi" ? "Cliente + Fornitore" : contact.type}
              {contact.vat && <> · P.IVA {contact.vat}</>}
            </p>
            {(contact.email || contact.phone || contact.address) && (
              <p className="text-xs text-muted-foreground mt-1">
                {[contact.email, contact.phone, contact.address].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" />Modifica</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />Elimina</Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="Movimenti" value={String(stats.count)} mono />
          <StatBox label={isCliente ? "Incassato" : "Pagato"} value={eur(isCliente ? stats.cassaIn : stats.cassaOut)} accent="primary" />
          <StatBox label={isCliente ? "Da incassare" : "Da pagare"} value={eur(isCliente ? stats.previstoIn : stats.previstoOut)} accent="amber" />
          <StatBox label="Saldo" value={eur(stats.saldo)} accent={stats.saldo >= 0 ? "primary" : "destructive"} />
        </div>

        {isCliente && (
          <Card className="border-2 border-amber-300 bg-amber-50/40">
            <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Media incassi mensili</div>
                <div className="font-mono text-lg font-bold tabular-nums">{eur(stats.monthlyAvgIn)}</div>
                <div className="text-[10px] text-muted-foreground">su {stats.monthsActive} mesi attivi</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Fido suggerito</div>
                <div className="font-mono text-lg font-bold tabular-nums text-primary">{eur(stats.fidoSuggerito)}</div>
                <div className="text-[10px] text-muted-foreground">media × 2</div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Fido manuale (opz.)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number" step="any"
                    placeholder={stats.fidoSuggerito.toFixed(2)}
                    value={contact.fidoManual ?? ""}
                    onChange={(e) => onUpdate({ ...contact, fidoManual: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="h-9 font-mono tabular-nums"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">In uso: <span className="font-mono">{eur(fido)}</span></div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Movimenti collegati ({linked.length})</h3>
          <Button size="sm" variant="outline" onClick={() => setShowLinker((v) => !v)}>
            <Link2 className="h-4 w-4" />{showLinker ? "Chiudi linker" : "Collega manualmente"}
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border-2 border-primary/40">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Saldati ({saldati.length})</CardTitle>
              <span className={cn("font-mono tabular-nums text-base font-bold", saldoRealizzato >= 0 ? "text-primary" : "text-destructive")}>
                {saldoRealizzato >= 0 ? "+" : "−"}{eur(Math.abs(saldoRealizzato))}
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[360px]">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-24">Data</TableHead>
                    <TableHead>Causale</TableHead>
                    <TableHead className="text-right w-28">Importo</TableHead>
                    <TableHead className="w-10" />
                  </TableRow></TableHeader>
                  <TableBody>
                    {saldati.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Nessun movimento saldato.</TableCell></TableRow>
                    ) : saldati.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.date}</TableCell>
                        <TableCell className="truncate max-w-[220px]">{m.description}</TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums", m.type === "entrata" ? "text-primary" : "text-destructive")}>{m.type === "entrata" ? "+" : "−"}{eur(m.amount)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" title="Scollega" onClick={() => toggleLink(m.id, false)}><Unlink className="h-3.5 w-3.5" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-amber-300">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Da saldare ({daSaldare.length})</CardTitle>
              <span className={cn("font-mono tabular-nums text-base font-bold", saldoDaRealizzare >= 0 ? "text-amber-600" : "text-destructive")}>
                {saldoDaRealizzare >= 0 ? "+" : "−"}{eur(Math.abs(saldoDaRealizzare))}
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[360px]">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-24">Data</TableHead>
                    <TableHead>Causale</TableHead>
                    <TableHead className="text-right w-28">Importo</TableHead>
                    <TableHead className="w-10" />
                  </TableRow></TableHeader>
                  <TableBody>
                    {daSaldare.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Nessun movimento previsto.</TableCell></TableRow>
                    ) : daSaldare.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.date}</TableCell>
                        <TableCell className="truncate max-w-[220px]">{m.description}</TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums", m.type === "entrata" ? "text-primary" : "text-destructive")}>{m.type === "entrata" ? "+" : "−"}{eur(m.amount)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" title="Scollega" onClick={() => toggleLink(m.id, false)}><Unlink className="h-3.5 w-3.5" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-2 border-dept bg-dept-soft/30">
          <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Saldo realizzato</div>
              <div className={cn("font-mono text-lg font-bold tabular-nums", saldoRealizzato >= 0 ? "text-primary" : "text-destructive")}>{eur(saldoRealizzato)}</div>
              <div className="text-[10px] text-muted-foreground">solo movimenti in cassa</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Da realizzare</div>
              <div className={cn("font-mono text-lg font-bold tabular-nums", saldoDaRealizzare >= 0 ? "text-amber-600" : "text-destructive")}>{eur(saldoDaRealizzare)}</div>
              <div className="text-[10px] text-muted-foreground">previsti non ancora incassati/pagati</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Saldo previsto</div>
              <div className={cn("font-mono text-lg font-bold tabular-nums", saldoPrevisto >= 0 ? "text-primary" : "text-destructive")}>{eur(saldoPrevisto)}</div>
              <div className="text-[10px] text-muted-foreground">realizzato + da realizzare</div>
            </div>
          </CardContent>
        </Card>

        {showLinker && (
          <Card className="border-2 border-dashed border-dept/40">
            <CardHeader className="pb-2"><CardTitle className="text-base">Collega un movimento esistente</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-24">Data</TableHead><TableHead>Causale</TableHead><TableHead className="text-right w-28">Importo</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
                  <TableBody>
                    {candidates.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.date}</TableCell>
                        <TableCell className="truncate max-w-[320px]">{m.description}</TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums", m.type === "entrata" ? "text-primary" : "text-destructive")}>{m.type === "entrata" ? "+" : "−"}{eur(m.amount)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" title="Collega" onClick={() => toggleLink(m.id, true)}><Plus className="h-3.5 w-3.5" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
};

const StatBox = ({ label, value, accent, mono }: { label: string; value: string; accent?: "primary" | "destructive" | "amber"; mono?: boolean }) => {
  const color = accent === "primary" ? "text-primary" : accent === "destructive" ? "text-destructive" : accent === "amber" ? "text-amber-600" : "";
  return (
    <div className="rounded-sm border-2 border-dept/40 bg-paper p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums mt-1", mono && "font-mono", color)}>{value}</div>
    </div>
  );
};

/* =============================== EDIT DIALOG =============================== */
const ContactEditDialog = ({ contact, onSave, onCancel, onDelete, isNew }: { contact: Contact; onSave: (c: Contact) => void; onCancel: () => void; onDelete: () => void; isNew: boolean }) => {
  const [draft, setDraft] = useState<Contact>(contact);
  const set = <K extends keyof Contact>(k: K, v: Contact[K]) => setDraft({ ...draft, [k]: v });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "Nuovo contatto" : "Modifica contatto"}</DialogTitle>
          <DialogDescription>Compila i dati anagrafici. Il nome è obbligatorio.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Tipo</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.type} onChange={(e) => set("type", e.target.value as ContactType)}>
              <option value="cliente">Cliente</option>
              <option value="fornitore">Fornitore</option>
              <option value="entrambi">Cliente e Fornitore</option>
            </select>
          </div>
          <div className="grid gap-1.5"><Label>Nome / Ragione sociale *</Label><Input value={draft.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>P.IVA / CF</Label><Input value={draft.vat ?? ""} onChange={(e) => set("vat", e.target.value || undefined)} /></div>
            <div className="grid gap-1.5"><Label>Telefono</Label><Input value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value || undefined)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Email</Label><Input type="email" value={draft.email ?? ""} onChange={(e) => set("email", e.target.value || undefined)} /></div>
          <div className="grid gap-1.5"><Label>Indirizzo</Label><Input value={draft.address ?? ""} onChange={(e) => set("address", e.target.value || undefined)} /></div>
          <div className="grid gap-1.5"><Label>Note</Label><Input value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value || undefined)} /></div>
        </div>
        <DialogFooter className="gap-2">
          {!isNew && <Button variant="destructive" onClick={onDelete} className="mr-auto"><Trash2 className="h-4 w-4" />Elimina</Button>}
          <Button variant="outline" onClick={onCancel}><X className="h-4 w-4" />Annulla</Button>
          <Button onClick={() => { if (draft.name.trim()) onSave({ ...draft, name: draft.name.trim() }); }} disabled={!draft.name.trim()}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};