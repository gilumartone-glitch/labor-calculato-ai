import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Plus, Search, Trash2, CheckCircle2, Share2, Loader2, BookMarked, Inbox } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { listRecords, deleteRecord, updateRecord, markShareRead, listContacts, type ContactSuggestion } from "@/lib/record/api";
import { RECORD_TYPE_META, type PersonalRecord, type RecordType } from "@/lib/record/types";
import { eur } from "@/lib/format";
import RecordDialog from "@/components/record/RecordDialog";

const RecordPage = () => {
  const { user, loading: authLoading } = useAuth();
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [dbContacts, setDbContacts] = useState<ContactSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RecordType>("all");
  const [scope, setScope] = useState<"all" | "mine" | "shared">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "aperto" | "chiuso">("aperto");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalRecord | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listRecords();
      setRecords(data);
    } catch (e: any) {
      toast({ title: "Errore caricamento", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) refresh(); }, [user]);

  const knownContacts = useMemo(() => {
    const m = new Map<string, { name: string; kind: PersonalRecord["contact_kind"] }>();
    records.filter((r) => r.owner_id === user?.id).forEach((r) => {
      const k = r.contact_name.toLowerCase();
      if (!m.has(k)) m.set(k, { name: r.contact_name, kind: r.contact_kind });
    });
    return Array.from(m.values());
  }, [records, user]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return records.filter((r) => {
      if (scope === "mine" && r.owner_id !== user?.id) return false;
      if (scope === "shared" && r.owner_id === user?.id) return false;
      if (typeFilter !== "all" && r.record_type !== typeFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (ql && !(r.contact_name.toLowerCase().includes(ql) || r.title.toLowerCase().includes(ql) || (r.description ?? "").toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [records, q, typeFilter, statusFilter, scope, user]);

  const grouped = useMemo(() => {
    const m = new Map<string, PersonalRecord[]>();
    filtered.forEach((r) => {
      const key = r.contact_name;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (authLoading) return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  const handleToggleStatus = async (r: PersonalRecord) => {
    try {
      await updateRecord(r.id, { status: r.status === "aperto" ? "chiuso" : "aperto" });
      refresh();
    } catch (e: any) { toast({ title: "Errore", description: e.message, variant: "destructive" }); }
  };

  const handleDelete = async (r: PersonalRecord) => {
    if (!confirm("Eliminare questo record?")) return;
    try { await deleteRecord(r.id); refresh(); }
    catch (e: any) { toast({ title: "Errore", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-ink bg-paper">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/hub" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-ink">
              <ArrowLeft className="w-3 h-3" /> Hub
            </Link>
            <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><BookMarked className="w-6 h-6" /> Record</h1>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Nuovo record
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Cerca contatto, titolo, note…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i tipi</SelectItem>
              {(Object.keys(RECORD_TYPE_META) as RecordType[]).map((t) => (
                <SelectItem key={t} value={t}>{RECORD_TYPE_META[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="aperto">Aperti</SelectItem>
              <SelectItem value="chiuso">Chiusi</SelectItem>
              <SelectItem value="all">Tutti</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={(v) => setScope(v as any)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Miei + condivisi</SelectItem>
              <SelectItem value="mine">Solo miei</SelectItem>
              <SelectItem value="shared">Condivisi con me</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : grouped.length === 0 ? (
          <div className="text-center border-2 border-dashed border-muted p-10 rounded-sm">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nessun record. Premi "Nuovo record" per iniziare.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([contact, items]) => {
              const totaleAperto = items
                .filter((r) => r.status === "aperto" && r.amount != null)
                .reduce((acc, r) => acc + (RECORD_TYPE_META[r.record_type].sign * (r.amount ?? 0)), 0);
              return (
                <section key={contact} className="border-2 border-ink/15 rounded-sm bg-paper">
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                    <div className="font-display text-lg font-semibold">{contact}</div>
                    {totaleAperto !== 0 && (
                      <Badge variant={totaleAperto > 0 ? "default" : "destructive"}>
                        Saldo aperto: {eur(totaleAperto)}
                      </Badge>
                    )}
                  </div>
                  <div className="divide-y">
                    {items.map((r) => {
                      const meta = RECORD_TYPE_META[r.record_type];
                      const isMine = r.owner_id === user.id;
                      return (
                        <div key={r.id} className="p-3 flex items-start gap-3 hover:bg-muted/20"
                          onClick={() => { if (!isMine) markShareRead(r.id); }}>
                          <span className={`text-[10px] uppercase tracking-wider border px-1.5 py-0.5 rounded-sm ${meta.tone}`}>
                            {meta.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-medium ${r.status === "chiuso" ? "line-through text-muted-foreground" : ""}`}>{r.title || "(senza titolo)"}</span>
                              {r.amount != null && <span className="font-mono text-sm">{eur(meta.sign * r.amount)}</span>}
                              {r.due_date && <span className="text-xs text-muted-foreground">scad. {r.due_date}</span>}
                              {r.visibility === "all" && <Badge variant="outline" className="text-[10px]"><Share2 className="w-3 h-3 mr-1" />Tutti</Badge>}
                              {r.visibility === "shared" && <Badge variant="outline" className="text-[10px]"><Share2 className="w-3 h-3 mr-1" />Condiviso</Badge>}
                              {!isMine && <Badge variant="secondary" className="text-[10px]">condiviso con me</Badge>}
                            </div>
                            {r.description && <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">{r.description}</p>}
                            {r.tags.length > 0 && (
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {r.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {isMine && (
                              <>
                                <Button size="icon" variant="ghost" title={r.status === "aperto" ? "Segna chiuso" : "Riapri"} onClick={() => handleToggleStatus(r)}>
                                  <CheckCircle2 className={`w-4 h-4 ${r.status === "chiuso" ? "text-emerald-600" : ""}`} />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}>Modifica</Button>
                                <Button size="icon" variant="ghost" onClick={() => handleDelete(r)}><Trash2 className="w-4 h-4" /></Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      <RecordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        knownContacts={knownContacts}
        existing={editing}
        onSaved={refresh}
      />
    </div>
  );
};

export default RecordPage;
