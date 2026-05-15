import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Megaphone, Plus, Trash2, Mail, Users, FolderTree, Send, Loader2, RefreshCw, Pencil, Tag, Upload, Download, Eye, Paperclip, Copy, X, ArrowUp, ArrowDown, ArrowUpDown, BarChart3, MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CONTACTS_CSV_TEMPLATE, parseCSV } from "@/lib/marketing/newsletter-template";
import * as XLSX from "xlsx";
import { NewsletterBlock, DEFAULT_BLOCKS, blocksToHtml } from "@/lib/marketing/blocks";
import { NewsletterBlockEditor } from "@/components/marketing/NewsletterBlockEditor";

type Category = { id: string; parent_id: string | null; name: string; color: string | null };
type Contact = { id: string; nome: string; email: string | null; telefono: string | null; azienda: string | null; note: string | null };
type Attachment = { name: string; url: string; size?: number };
type Newsletter = { id: string; subject: string; preview_text: string | null; from_name: string | null; from_email: string | null; content_html: string; status: string; category_ids: string[]; mailchimp_campaign_id: string | null; sent_at: string | null; recipients_count: number; updated_at: string; blocks: NewsletterBlock[]; attachments: Attachment[] };

const Marketing = () => {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState("newsletter");

  if (authLoading) return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-ink bg-paper">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary mb-1">// Marketing</div>
              <h1 className="font-display text-2xl font-semibold leading-none flex items-center gap-2"><Megaphone className="w-6 h-6" /> Marketing</h1>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="newsletter" className="gap-1.5"><Mail className="w-4 h-4" /> Newsletter</TabsTrigger>
            <TabsTrigger value="rubrica" className="gap-1.5"><Users className="w-4 h-4" /> Rubrica</TabsTrigger>
            <TabsTrigger value="categorie" className="gap-1.5"><FolderTree className="w-4 h-4" /> Categorie</TabsTrigger>
          </TabsList>
          <TabsContent value="newsletter" className="mt-6"><NewsletterPanel /></TabsContent>
          <TabsContent value="rubrica" className="mt-6"><ContactsPanel /></TabsContent>
          <TabsContent value="categorie" className="mt-6"><CategoriesPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

/* ----------------------------- CATEGORIE ----------------------------- */
const CategoriesPanel = () => {
  const { user } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Category> | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("marketing_categories").select("*").order("name");
    setCats((data ?? []) as Category[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error("Nome richiesto"); return; }
    if (editing.id) {
      const { error } = await supabase.from("marketing_categories").update({ name: editing.name, parent_id: editing.parent_id ?? null, color: editing.color ?? null }).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("marketing_categories").insert({ name: editing.name, parent_id: editing.parent_id ?? null, color: editing.color ?? null, created_by: user!.id });
      if (error) return toast.error(error.message);
    }
    toast.success("Salvato");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminare la categoria? Verranno rimosse anche le sottocategorie.")) return;
    await supabase.from("marketing_categories").delete().eq("id", id);
    load();
  };

  const roots = cats.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Organizza i contatti in categorie e sottocategorie. Le categorie diventano <span className="font-mono">tag</span> Mailchimp.</p>
        <Button size="sm" onClick={() => setEditing({ name: "", parent_id: null })}><Plus className="w-4 h-4 mr-1" /> Nuova categoria</Button>
      </div>
      {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (
        <div className="border-2 border-ink/15 rounded-sm bg-paper">
          {roots.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">Nessuna categoria.</div>}
          {roots.map((r) => (
            <div key={r.id} className="border-b border-ink/10 last:border-b-0">
              <CatRow cat={r} onEdit={setEditing} onDelete={remove} />
              <div className="pl-8">
                {childrenOf(r.id).map((c) => <CatRow key={c.id} cat={c} onEdit={setEditing} onDelete={remove} sub />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Modifica" : "Nuova"} categoria</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={100} /></div>
            <div>
              <Label>Categoria padre (opzionale)</Label>
              <select className="w-full h-10 border-2 border-ink/20 rounded-sm px-2 bg-paper" value={editing?.parent_id ?? ""} onChange={(e) => setEditing({ ...editing, parent_id: e.target.value || null })}>
                <option value="">— nessuna (categoria principale) —</option>
                {cats.filter((c) => !c.parent_id && c.id !== editing?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><Label>Colore (opzionale)</Label><Input type="color" value={editing?.color ?? "#cccccc"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-10 w-20" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* STATS & RESEND DIALOG */}
    </div>
  );
};

const CatRow = ({ cat, onEdit, onDelete, sub }: { cat: Category; onEdit: (c: Category) => void; onDelete: (id: string) => void; sub?: boolean }) => (
  <div className="flex items-center justify-between px-4 py-2.5 hover:bg-ink/5">
    <div className="flex items-center gap-2">
      {cat.color && <span className="w-3 h-3 rounded-sm border border-ink/20" style={{ background: cat.color }} />}
      <span className={sub ? "text-sm" : "font-semibold"}>{sub && "↳ "}{cat.name}</span>
    </div>
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(cat)}><Pencil className="w-3.5 h-3.5" /></Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(cat.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
    </div>
  </div>
);

/* ----------------------------- RUBRICA ----------------------------- */
const ContactsPanel = () => {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [contactCats, setContactCats] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(Partial<Contact> & { categoryIds?: string[] }) | null>(null);
  const [filter, setFilter] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<string>("");
  const [bulkMode, setBulkMode] = useState<"replace" | "add">("add");
  const [sortKey, setSortKey] = useState<"nome" | "email" | "azienda" | "categorie">("nome");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const SortIcon = ({ k }: { k: typeof sortKey }) =>
    sortKey !== k ? <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-50" /> :
    sortDir === "asc" ? <ArrowUp className="w-3 h-3 inline ml-1" /> : <ArrowDown className="w-3 h-3 inline ml-1" />;

  const load = async () => {
    setLoading(true);
    const [c, k, m] = await Promise.all([
      supabase.from("marketing_contacts").select("*").order("nome"),
      supabase.from("marketing_categories").select("*").order("name"),
      supabase.from("marketing_contact_categories").select("*"),
    ]);
    setContacts((c.data ?? []) as Contact[]);
    setCats((k.data ?? []) as Category[]);
    const map: Record<string, string[]> = {};
    (m.data ?? []).forEach((r: any) => { (map[r.contact_id] ||= []).push(r.category_id); });
    setContactCats(map);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const list = contacts.filter((c) => {
      if (filter && !`${c.nome} ${c.email} ${c.azienda}`.toLowerCase().includes(filter.toLowerCase())) return false;
      if (filterCat && !(contactCats[c.id] ?? []).includes(filterCat)) return false;
      return true;
    });
    const catName = (id: string) => cats.find((x) => x.id === id)?.name ?? "";
    const val = (c: Contact) => {
      if (sortKey === "categorie") return (contactCats[c.id] ?? []).map(catName).sort().join(",").toLowerCase();
      return ((c as any)[sortKey] ?? "").toString().toLowerCase();
    };
    list.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [contacts, filter, filterCat, contactCats, cats, sortKey, sortDir]);

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleSelAll = () => {
    setSelected((prev) => {
      const allIds = filtered.map((c) => c.id);
      const allSel = allIds.every((id) => prev.has(id));
      return allSel ? new Set() : new Set(allIds);
    });
  };

  const bulkMove = async () => {
    if (!bulkTarget) { toast.error("Seleziona la categoria di destinazione"); return; }
    const ids = Array.from(selected);
    if (ids.length === 0) { toast.error("Nessun contatto selezionato"); return; }
    try {
      if (bulkMode === "replace") {
        if (filterCat) {
          // sposta: rimuove la categoria filtrata e aggiunge la destinazione
          await supabase.from("marketing_contact_categories").delete().in("contact_id", ids).eq("category_id", filterCat);
        } else {
          // sostituisce tutte le categorie
          await supabase.from("marketing_contact_categories").delete().in("contact_id", ids);
        }
      }
      const rows = ids.map((cid) => ({ contact_id: cid, category_id: bulkTarget }));
      // upsert-like: ignora duplicati
      const { error } = await supabase.from("marketing_contact_categories").upsert(rows, { onConflict: "contact_id,category_id", ignoreDuplicates: true } as any);
      if (error) throw error;
      toast.success(`${ids.length} contatti aggiornati`);
      setSelected(new Set());
      setBulkTarget("");
      load();
    } catch (e: any) {
      toast.error(e.message || "Errore spostamento");
    }
  };

  const save = async () => {
    if (!editing?.nome?.trim()) { toast.error("Nome richiesto"); return; }
    let id = editing.id;
    const payload = { nome: editing.nome.trim(), email: editing.email?.trim() || null, telefono: editing.telefono?.trim() || null, azienda: editing.azienda?.trim() || null, note: editing.note?.trim() || null };
    if (id) {
      const { error } = await supabase.from("marketing_contacts").update(payload).eq("id", id);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase.from("marketing_contacts").insert({ ...payload, created_by: user!.id }).select("id").single();
      if (error) return toast.error(error.message);
      id = data.id;
    }
    // Aggiorna categorie
    await supabase.from("marketing_contact_categories").delete().eq("contact_id", id!);
    if ((editing.categoryIds ?? []).length > 0) {
      await supabase.from("marketing_contact_categories").insert(editing.categoryIds!.map((cid) => ({ contact_id: id!, category_id: cid })));
    }
    toast.success("Salvato");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminare il contatto?")) return;
    await supabase.from("marketing_contacts").delete().eq("id", id);
    load();
  };

  const syncMailchimp = async (id: string) => {
    setSyncing(id);
    try {
      const { data, error } = await supabase.functions.invoke("mailchimp-sync-contact", { body: { contact_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Sincronizzato su Mailchimp");
    } catch (e: any) {
      toast.error(e.message || "Errore sincronizzazione");
    } finally {
      setSyncing(null);
    }
  };

  const openNew = () => setEditing({ nome: "", email: "", categoryIds: [] });
  const openEdit = (c: Contact) => setEditing({ ...c, categoryIds: contactCats[c.id] ?? [] });

  const downloadCsvTemplate = () => {
    const blob = new Blob([CONTACTS_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "rubrica-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    try {
      let rows: Record<string, string>[] = [];
      const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
      if (isXlsx) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        rows = raw.map((r) => {
          const obj: Record<string, string> = {};
          Object.keys(r).forEach((k) => {
            obj[k.trim().toLowerCase()] = String(r[k] ?? "").trim();
          });
          return obj;
        });
      } else {
        const text = await file.text();
        rows = parseCSV(text);
      }
      if (rows.length === 0) { toast.error("CSV vuoto"); return; }
      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
      let ok = 0, skip = 0;
      const norm = (s: string) => s.toLowerCase().replace(/[\s\-_./]/g, "");
      const pick = (r: Record<string, string>, aliases: string[]) => {
        const keys = Object.keys(r);
        for (const a of aliases) {
          const want = norm(a);
          const k = keys.find((kk) => norm(kk) === want || norm(kk).includes(want));
          if (k && r[k]) return r[k];
        }
        return "";
      };
      if (rows.length > 0) {
        const firstKeys = Object.keys(rows[0]).join(", ");
        console.log("[import] colonne rilevate:", firstKeys, "righe:", rows.length);
      }
      for (const r of rows) {
        const email = pick(r, ["email", "mail", "posta", "indirizzoemail"]).trim();
        let nome = pick(r, ["nome", "name", "ragionesociale", "fullname", "contatto", "cliente"]).trim();
        if (!nome && email) nome = email.split("@")[0];
        if (!nome && !email) { skip++; continue; }
        const payload = {
          nome: nome || "(senza nome)",
          email: email || null,
          telefono: pick(r, ["telefono", "phone", "tel", "cellulare", "mobile"]).trim() || null,
          azienda: pick(r, ["azienda", "company", "societa", "ragionesociale", "ditta"]).trim() || null,
          note: pick(r, ["note", "notes", "annotazioni"]).trim() || null,
          created_by: user!.id,
        };
        const { data, error } = await supabase.from("marketing_contacts").insert(payload).select("id").single();
        if (error) { skip++; continue; }
        const catNames = pick(r, ["categorie", "categories", "categoria", "category", "tag", "tags"]).split(/[;|,]/).map((s) => s.trim()).filter(Boolean);
        const catIds = catNames.map((n) => catByName.get(n.toLowerCase())).filter(Boolean) as string[];
        if (catIds.length > 0) {
          await supabase.from("marketing_contact_categories").insert(catIds.map((cid) => ({ contact_id: data.id, category_id: cid })));
        }
        ok++;
      }
      if (ok === 0) {
        const cols = Object.keys(rows[0] ?? {}).join(", ") || "(nessuna)";
        toast.error(`Nessun contatto importato. Colonne trovate: ${cols}. Serve almeno "nome" o "email".`);
      } else {
        toast.success(`Importati ${ok} contatti${skip ? ` (${skip} saltati)` : ""}`);
      }
      load();
    } catch (e: any) {
      toast.error(e.message || "Errore import file");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Cerca nome / email / azienda" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-sm" />
        <select className="h-10 border-2 border-ink/20 rounded-sm px-2 bg-paper text-sm" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">Tutte le categorie</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "↳ " : ""}{c.name}</option>)}
        </select>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={downloadCsvTemplate} className="gap-1"><Download className="w-4 h-4" /> Template CSV</Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1"><Upload className="w-4 h-4" /> Importa CSV/XLSX</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Nuovo contatto</Button>
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-2 items-center p-2 border-2 border-ink/20 rounded-sm bg-accent/20">
          <span className="text-sm font-semibold">{selected.size} selezionati</span>
          <select className="h-9 border-2 border-ink/20 rounded-sm px-2 bg-paper text-sm" value={bulkMode} onChange={(e) => setBulkMode(e.target.value as any)}>
            <option value="add">Aggiungi a categoria</option>
            <option value="replace">{filterCat ? "Sposta da categoria filtrata" : "Sostituisci tutte le categorie"}</option>
          </select>
          <select className="h-9 border-2 border-ink/20 rounded-sm px-2 bg-paper text-sm" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>
            <option value="">Categoria destinazione…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "↳ " : ""}{c.name}</option>)}
          </select>
          <Button size="sm" onClick={bulkMove}>Applica</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Annulla</Button>
        </div>
      )}
      {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (
        <div className="border-2 border-ink/20 rounded-sm bg-paper overflow-hidden shadow-sm">
          <table className="w-full text-sm text-ink
            [&_th:nth-child(1)]:bg-[hsl(184_60%_70%)] [&_tbody_tr:nth-child(odd)_td:nth-child(1)]:bg-[hsl(184_55%_84%)] [&_tbody_tr:nth-child(even)_td:nth-child(1)]:bg-[hsl(184_50%_78%)]
            [&_th:nth-child(2)]:bg-[hsl(225_50%_72%)] [&_tbody_tr:nth-child(odd)_td:nth-child(2)]:bg-[hsl(225_45%_86%)] [&_tbody_tr:nth-child(even)_td:nth-child(2)]:bg-[hsl(225_40%_80%)]
            [&_th:nth-child(3)]:bg-[hsl(28_70%_70%)] [&_tbody_tr:nth-child(odd)_td:nth-child(3)]:bg-[hsl(28_65%_85%)] [&_tbody_tr:nth-child(even)_td:nth-child(3)]:bg-[hsl(28_60%_79%)]
            [&_th:nth-child(4)]:bg-[hsl(145_42%_66%)] [&_tbody_tr:nth-child(odd)_td:nth-child(4)]:bg-[hsl(145_38%_82%)] [&_tbody_tr:nth-child(even)_td:nth-child(4)]:bg-[hsl(145_34%_76%)]
            [&_th:nth-child(5)]:bg-[hsl(200_15%_72%)] [&_tbody_tr:nth-child(odd)_td:nth-child(5)]:bg-[hsl(200_15%_86%)] [&_tbody_tr:nth-child(even)_td:nth-child(5)]:bg-[hsl(200_12%_80%)]">
            <thead className="text-xs uppercase font-bold tracking-wider text-ink border-b-2 border-ink/30">
              <tr>
                <th className="px-3 py-2 w-10"><Checkbox checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))} onCheckedChange={toggleSelAll} /></th>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("nome")}>Nome<SortIcon k="nome" /></th>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("email")}>Email<SortIcon k="email" /></th>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("azienda")}>Azienda<SortIcon k="azienda" /></th>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("categorie")}>Categorie<SortIcon k="categorie" /></th>
                <th className="px-3 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-ink/10">
                  <td className="px-3 py-2"><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleSel(c.id)} /></td>
                  <td className="px-3 py-2 font-semibold">{c.nome}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.azienda ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(contactCats[c.id] ?? []).map((cid) => {
                        const cat = cats.find((x) => x.id === cid);
                        return cat ? <span key={cid} className="text-[10px] px-1.5 py-0.5 rounded-sm bg-ink/10">{cat.name}</span> : null;
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <select
                        className="h-8 border-2 border-ink/20 rounded-sm px-1 bg-paper text-xs max-w-[140px]"
                        value=""
                        title={filterCat ? "Sposta da categoria filtrata a..." : "Sposta in categoria (sostituisce)"}
                        onChange={async (e) => {
                          const target = e.target.value;
                          e.target.value = "";
                          if (!target) return;
                          const current = new Set(contactCats[c.id] ?? []);
                          if (filterCat) {
                            // sposta da categoria filtrata alla destinazione
                            await supabase.from("marketing_contact_categories").delete().eq("contact_id", c.id).eq("category_id", filterCat);
                            current.delete(filterCat);
                            current.add(target);
                            await supabase.from("marketing_contact_categories").insert({ contact_id: c.id, category_id: target });
                          } else {
                            // sostituisce tutte le categorie con la destinazione
                            await supabase.from("marketing_contact_categories").delete().eq("contact_id", c.id);
                            await supabase.from("marketing_contact_categories").insert({ contact_id: c.id, category_id: target });
                          }
                          toast.success("Contatto spostato");
                          load();
                        }}
                      >
                        <option value="">Sposta in…</option>
                        {cats
                          .filter((cat) => !(contactCats[c.id] ?? []).includes(cat.id))
                          .map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.parent_id ? "↳ " : ""}{cat.name}</option>
                          ))}
                      </select>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Sync Mailchimp" disabled={!c.email || syncing === c.id} onClick={() => syncMailchimp(c.id)}>
                        {syncing === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(c.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">Nessun contatto.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Modifica" : "Nuovo"} contatto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome *</Label><Input value={editing?.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} maxLength={150} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={editing?.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} maxLength={255} /></div>
              <div><Label>Telefono</Label><Input value={editing?.telefono ?? ""} onChange={(e) => setEditing({ ...editing, telefono: e.target.value })} maxLength={50} /></div>
            </div>
            <div><Label>Azienda</Label><Input value={editing?.azienda ?? ""} onChange={(e) => setEditing({ ...editing, azienda: e.target.value })} maxLength={150} /></div>
            <div><Label>Note</Label><Textarea value={editing?.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} maxLength={1000} rows={2} /></div>
            <div>
              <Label className="flex items-center gap-1"><Tag className="w-3 h-3" /> Categorie</Label>
              <div className="border border-ink/15 rounded-sm p-2 max-h-48 overflow-y-auto space-y-1">
                {cats.length === 0 && <div className="text-xs text-muted-foreground">Crea prima delle categorie nella sezione Categorie.</div>}
                {cats.map((c) => {
                  const checked = (editing?.categoryIds ?? []).includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={(v) => {
                        const cur = new Set(editing?.categoryIds ?? []);
                        if (v) cur.add(c.id); else cur.delete(c.id);
                        setEditing({ ...editing, categoryIds: Array.from(cur) });
                      }} />
                      <span className={c.parent_id ? "pl-3" : "font-semibold"}>{c.parent_id ? "↳ " : ""}{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ----------------------------- NEWSLETTER ----------------------------- */
const SAMPLE_DEFAULT = { FNAME: "Mario", LNAME: "Rossi", EMAIL: "mario.rossi@example.com", COMPANY: "Acme Srl" };

const renderMergeTags = (html: string, sample: Record<string, string>) => {
  if (!html) return "";
  return html
    .replace(/\*\|([A-Z0-9_:]+)\|\*/g, (_m, k) => sample[k] ?? "")
    .replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, k) => sample[k] ?? "");
};

const NewsletterPanel = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Newsletter[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Newsletter> | null>(null);
  const [working, setWorking] = useState(false);
  const [previewSample, setPreviewSample] = useState(SAMPLE_DEFAULT);
  const [testEmail, setTestEmail] = useState("");
  const attachRef = useRef<HTMLInputElement>(null);
  const [statsFor, setStatsFor] = useState<Newsletter | null>(null);
  const [statsData, setStatsData] = useState<any | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const load = async () => {
    setLoading(true);
    const [n, k] = await Promise.all([
      supabase.from("marketing_newsletters").select("*").order("updated_at", { ascending: false }),
      supabase.from("marketing_categories").select("*").order("name"),
    ]);
    setItems(((n.data ?? []) as any[]).map((r) => ({
      ...r,
      blocks: Array.isArray(r.blocks) ? (r.blocks as NewsletterBlock[]) : [],
      attachments: Array.isArray(r.attachments) ? (r.attachments as Attachment[]) : [],
      category_ids: Array.isArray(r.category_ids) ? r.category_ids : [],
    })) as Newsletter[]);
    setCats((k.data ?? []) as Category[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => setEditing({
    subject: "Oggetto della newsletter",
    preview_text: "",
    from_name: "Tecnofra",
    from_email: "",
    blocks: DEFAULT_BLOCKS.map((b) => ({ ...b })),
    attachments: [],
    category_ids: [],
    status: "bozza",
  });
  const openEdit = (n: Newsletter) => setEditing({
    ...n,
    blocks: n.blocks?.length ? n.blocks : DEFAULT_BLOCKS.map((b) => ({ ...b })),
    attachments: n.attachments ?? [],
  });

  const sample = useMemo(() => ({
    ...previewSample,
    "MC:SUBJECT": editing?.subject || "",
    UNSUB: "#unsubscribe-preview",
    UPDATE_PROFILE: "#update-profile-preview",
    "LIST:ADDRESS": "Tecnofra · Via Esempio 1 · Città",
  }), [previewSample, editing?.subject]);

  const blocks = (editing?.blocks ?? []) as NewsletterBlock[];
  const attachments = (editing?.attachments ?? []) as Attachment[];
  const computedHtml = useMemo(() => blocksToHtml(blocks, { attachments }), [blocks, attachments]);
  const previewHtml = useMemo(() => renderMergeTags(computedHtml, sample), [computedHtml, sample]);

  const save = async () => {
    if (!editing?.subject?.trim()) { toast.error("Oggetto richiesto"); return; }
    const payload: any = {
      subject: editing.subject.trim(),
      preview_text: editing.preview_text ?? null,
      from_name: editing.from_name ?? null,
      from_email: editing.from_email ?? null,
      content_html: computedHtml,
      blocks,
      attachments,
      category_ids: editing.category_ids ?? [],
    };
    if (editing.id) {
      const { error } = await supabase.from("marketing_newsletters").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Bozza salvata");
    } else {
      const { data, error } = await supabase.from("marketing_newsletters").insert({ ...payload, created_by: user!.id, status: "bozza" }).select().single();
      if (error) return toast.error(error.message);
      setEditing({ ...(data as any), blocks, attachments });
      toast.success("Bozza creata");
    }
    load();
  };

  const pushToMailchimp = async (sendNow: boolean) => {
    if (!editing?.id) { toast.error("Salva prima la bozza"); return; }
    if (sendNow && !confirm("Inviare la newsletter ORA a Mailchimp?")) return;
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke("mailchimp-send-newsletter", { body: { newsletter_id: editing.id, send_now: sendNow } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(sendNow ? "Inviata!" : "Campagna creata su Mailchimp (bozza)");
      load();
      if (sendNow) setEditing(null);
    } catch (e: any) {
      toast.error(e.message || "Errore Mailchimp");
    } finally {
      setWorking(false);
    }
  };

  const sendTest = async () => {
    if (!editing?.id) { toast.error("Salva prima la bozza"); return; }
    if (!testEmail.trim()) { toast.error("Inserisci un'email per il test"); return; }
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke("mailchimp-send-newsletter", { body: { newsletter_id: editing.id, test_email: testEmail.trim() } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Test inviato a ${testEmail}`);
    } catch (e: any) {
      toast.error(e.message || "Errore invio test");
    } finally {
      setWorking(false);
    }
  };

  const duplicate = async (n: Newsletter) => {
    const { data, error } = await supabase.from("marketing_newsletters").insert({
      subject: `Copia · ${n.subject}`,
      preview_text: n.preview_text,
      from_name: n.from_name,
      from_email: n.from_email,
      content_html: n.content_html,
      blocks: n.blocks ?? [],
      attachments: n.attachments ?? [],
      category_ids: n.category_ids ?? [],
      created_by: user!.id,
      status: "bozza",
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success("Duplicata");
    load();
    openEdit({ ...(data as any), blocks: n.blocks, attachments: n.attachments });
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminare la newsletter?")) return;
    await supabase.from("marketing_newsletters").delete().eq("id", id);
    load();
  };

  const openStats = async (n: Newsletter) => {
    setStatsFor(n);
    setStatsData(null);
    if (!n.mailchimp_campaign_id) return;
    setStatsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("mailchimp-send-newsletter", { body: { newsletter_id: n.id, action: "stats" } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStatsData(data.stats);
    } catch (e: any) {
      toast.error(e.message || "Errore caricamento statistiche");
    } finally {
      setStatsLoading(false);
    }
  };

  const resendTo = async (mode: "non_openers" | "bounced") => {
    if (!statsFor) return;
    const label = mode === "non_openers" ? "chi non l'ha aperta" : "chi non l'ha ricevuta (bounce)";
    if (!confirm(`Inviare di nuovo a ${label}? Verrà creata una nuova campagna su Mailchimp.`)) return;
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("mailchimp-send-newsletter", { body: { newsletter_id: statsFor.id, action: "resend", resend_mode: mode } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Re-invio avviato su Mailchimp");
    } catch (e: any) {
      toast.error(e.message || "Errore re-invio");
    } finally {
      setResending(false);
    }
  };

  const ATTACH_MAX_SIZE = 10 * 1024 * 1024; // 10MB per file
  const ATTACH_MAX_TOTAL = 25 * 1024 * 1024; // 25MB totali
  const ATTACH_MAX_COUNT = 10;
  const ATTACH_ALLOWED_EXT = ["pdf","doc","docx","xls","xlsx","ppt","pptx","csv","txt","zip","rar","7z","jpg","jpeg","png","gif","webp","svg"];
  const ATTACH_ALLOWED_MIME = [
    "application/pdf",
    "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/csv","text/plain",
    "application/zip","application/x-rar-compressed","application/x-7z-compressed","application/x-zip-compressed",
    "image/jpeg","image/png","image/gif","image/webp","image/svg+xml",
  ];
  const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024*1024 ? `${(b/1024).toFixed(1)} KB` : `${(b/1024/1024).toFixed(2)} MB`;

  const validateAttachment = (file: File): string | null => {
    if (file.size === 0) return "Il file è vuoto.";
    if (file.size > ATTACH_MAX_SIZE) return `"${file.name}" supera 10 MB (${fmtSize(file.size)}).`;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ext) return "Il file non ha un'estensione riconoscibile.";
    const mimeOk = !file.type || ATTACH_ALLOWED_MIME.includes(file.type);
    const extOk = ATTACH_ALLOWED_EXT.includes(ext);
    if (!extOk || !mimeOk) return `Tipo non consentito (.${ext}). Usa PDF, Office, immagini, CSV/TXT o archivi ZIP/RAR/7z.`;
    if (attachments.length >= ATTACH_MAX_COUNT) return `Massimo ${ATTACH_MAX_COUNT} allegati per newsletter.`;
    if (attachments.some((a) => a.name === file.name)) return `Esiste già un allegato con il nome "${file.name}".`;
    const totalAfter = attachments.reduce((s, a) => s + (a.size || 0), 0) + file.size;
    if (totalAfter > ATTACH_MAX_TOTAL) return `Dimensione totale allegati oltre 25 MB (${fmtSize(totalAfter)}).`;
    return null;
  };

  const uploadAttachment = async (file: File) => {
    const err = validateAttachment(file);
    if (err) { toast.error(err); return; }
    const path = `attachments/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage.from("marketing-attachments").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
    if (error) { toast.error(`Caricamento fallito: ${error.message}`); return; }
    const { data } = supabase.storage.from("marketing-attachments").getPublicUrl(path);
    setEditing({ ...editing, attachments: [...attachments, { name: file.name, url: data.publicUrl, size: file.size }] });
    toast.success(`"${file.name}" caricato (${fmtSize(file.size)}).`);
  };

  return (
    <div className="space-y-4">
      {/* STORICO */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Editor a blocchi con anteprima live. Le campagne vengono create su <span className="font-mono">Mailchimp</span>.</p>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Nuova newsletter</Button>
      </div>
      {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.length === 0 && <div className="col-span-full border-2 border-dashed border-ink/15 rounded-sm p-8 text-center text-sm text-muted-foreground">Nessuna newsletter.</div>}
          {items.map((n) => (
            <div key={n.id} className="border-2 border-ink/15 rounded-sm bg-paper p-4 hover:border-ink/30">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-display font-semibold truncate">{n.subject}</div>
                  <div className="text-xs text-muted-foreground truncate">{n.preview_text || "—"}</div>
                </div>
                <span className={`shrink-0 text-[10px] uppercase font-mono px-2 py-0.5 rounded-sm ${n.status === "inviata" ? "bg-emerald-100 text-emerald-800" : n.status === "pronta" ? "bg-amber-100 text-amber-800" : "bg-ink/10 text-ink/60"}`}>{n.status}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {(n.category_ids ?? []).length} categorie · {(n.attachments ?? []).length > 0 && `${(n.attachments ?? []).length} allegati · `}
                {n.sent_at ? `Inviata il ${new Date(n.sent_at).toLocaleDateString("it-IT")}` : `Aggiornata il ${new Date(n.updated_at).toLocaleDateString("it-IT")}`}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => openEdit(n)}><Pencil className="w-3 h-3" /> Apri</Button>
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => duplicate(n)}><Copy className="w-3.5 h-3.5" /> Duplica</Button>
                {n.mailchimp_campaign_id && (
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => openStats(n)} title="Statistiche & re-invio"><BarChart3 className="w-3.5 h-3.5" /> Stats</Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => remove(n.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* EDITOR FULLSCREEN */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-[1400px] w-[95vw] max-h-[95vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-ink/15 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Mail className="w-4 h-4" /> {editing?.id ? "Modifica" : "Nuova"} newsletter
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] min-h-0">
            {/* COLONNA SINISTRA: SETTINGS + BLOCCHI */}
            <div className="border-r border-ink/15 overflow-y-auto p-3 space-y-3 bg-muted/30">
              <div className="space-y-2">
                <div><Label className="text-xs">Oggetto *</Label><Input value={editing?.subject ?? ""} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} maxLength={150} className="h-8" /></div>
                <div><Label className="text-xs">Preview text</Label><Input value={editing?.preview_text ?? ""} onChange={(e) => setEditing({ ...editing, preview_text: e.target.value })} maxLength={150} className="h-8" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Da (nome)</Label><Input value={editing?.from_name ?? ""} onChange={(e) => setEditing({ ...editing, from_name: e.target.value })} className="h-8" /></div>
                  <div><Label className="text-xs">Da (email)</Label><Input type="email" value={editing?.from_email ?? ""} onChange={(e) => setEditing({ ...editing, from_email: e.target.value })} className="h-8" /></div>
                </div>
              </div>

              <div>
                <Label className="text-xs flex items-center gap-1"><Tag className="w-3 h-3" /> Categorie destinatari</Label>
                <div className="border border-ink/15 rounded-sm p-2 max-h-32 overflow-y-auto space-y-1 bg-paper">
                  {cats.length === 0 && <div className="text-xs text-muted-foreground">Crea prima delle categorie.</div>}
                  {cats.map((c) => {
                    const checked = (editing?.category_ids ?? []).includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          const cur = new Set(editing?.category_ids ?? []);
                          if (v) cur.add(c.id); else cur.delete(c.id);
                          setEditing({ ...editing, category_ids: Array.from(cur) });
                        }} />
                        <span className={c.parent_id ? "pl-3" : "font-semibold"}>{c.parent_id ? "↳ " : ""}{c.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Vuoto = tutta l'audience.</p>
              </div>

              <div>
                <Label className="text-xs flex items-center justify-between">
                  <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" /> Allegati ({attachments.length})</span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => attachRef.current?.click()}><Upload className="w-3 h-3" /> Carica</Button>
                </Label>
                <input ref={attachRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.rar,.7z,.jpg,.jpeg,.png,.gif,.webp,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = ""; }} />
                <div className="space-y-1 mt-1">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs bg-paper border border-ink/15 rounded-sm px-2 py-1">
                      <Paperclip className="w-3 h-3 shrink-0" />
                      <a href={a.url} target="_blank" rel="noreferrer" className="truncate flex-1 hover:underline">{a.name}</a>
                      <button onClick={() => setEditing({ ...editing, attachments: attachments.filter((_, j) => j !== i) })} className="text-destructive"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  {attachments.length === 0 && <p className="text-[10px] text-muted-foreground">Compaiono come link nel footer dell'email.</p>}
                  <p className="text-[10px] text-muted-foreground">Max 10 MB per file · 25 MB totali · 10 allegati. Tipi: PDF, Office, immagini, CSV/TXT, ZIP/RAR/7z.</p>
                </div>
              </div>

              <div className="border-t border-ink/15 pt-2">
                <Label className="text-xs font-semibold">Blocchi contenuto</Label>
                <div className="mt-1">
                  <NewsletterBlockEditor blocks={blocks} onChange={(b) => setEditing({ ...editing, blocks: b })} />
                </div>
              </div>
            </div>

            {/* COLONNA DESTRA: PREVIEW LIVE */}
            <div className="flex flex-col min-h-0 bg-ink/5">
              <div className="px-4 py-2 border-b border-ink/15 bg-paper text-xs space-y-1">
                <div className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-mono text-muted-foreground">Anteprima live</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">FNAME</span>
                    <Input value={previewSample.FNAME} onChange={(e) => setPreviewSample({ ...previewSample, FNAME: e.target.value })} className="h-6 w-24 text-xs" />
                    <span className="text-[10px] text-muted-foreground">LNAME</span>
                    <Input value={previewSample.LNAME} onChange={(e) => setPreviewSample({ ...previewSample, LNAME: e.target.value })} className="h-6 w-24 text-xs" />
                  </div>
                </div>
                <div><span className="font-mono text-muted-foreground">Da:</span> <strong>{editing?.from_name || "—"}</strong> &lt;{editing?.from_email || "—"}&gt;</div>
                <div><span className="font-mono text-muted-foreground">Oggetto:</span> <strong>{editing?.subject || "—"}</strong>{editing?.preview_text && <span className="text-muted-foreground italic ml-2">— {editing.preview_text}</span>}</div>
              </div>
              <iframe
                title="Anteprima newsletter"
                srcDoc={previewHtml}
                sandbox=""
                className="flex-1 w-full bg-white"
              />
            </div>
          </div>

          <DialogFooter className="px-4 py-3 border-t border-ink/15 shrink-0 flex-wrap gap-2">
            <div className="flex items-center gap-1 mr-auto">
              <Input type="email" placeholder="email per test" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} className="h-8 w-52 text-xs" />
              <Button size="sm" variant="outline" onClick={sendTest} disabled={working || !editing?.id} className="gap-1"><Send className="w-3.5 h-3.5" /> Test</Button>
            </div>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={working}>Chiudi</Button>
            <Button variant="outline" onClick={save} disabled={working}>Salva bozza</Button>
            <Button variant="outline" onClick={() => pushToMailchimp(false)} disabled={working || !editing?.id} className="gap-1">
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync Mailchimp
            </Button>
            <Button onClick={() => pushToMailchimp(true)} disabled={working || !editing?.id} className="gap-1 bg-primary">
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Invia ora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* STATS & RESEND DIALOG */}
      <Dialog open={!!statsFor} onOpenChange={(o) => { if (!o) { setStatsFor(null); setStatsData(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="w-4 h-4" /> Statistiche · {statsFor?.subject}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {statsLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Caricamento da Mailchimp…</div>}
            {!statsLoading && statsData && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="border border-ink/15 rounded-sm p-2"><div className="text-[10px] uppercase font-mono text-muted-foreground">Inviate</div><div className="text-xl font-display font-semibold">{statsData.emails_sent}</div></div>
                  <div className="border border-ink/15 rounded-sm p-2 bg-emerald-50"><div className="text-[10px] uppercase font-mono text-muted-foreground">Aperte</div><div className="text-xl font-display font-semibold text-emerald-700">{statsData.unique_opens}</div><div className="text-[10px] text-muted-foreground">{(statsData.open_rate * 100).toFixed(1)}%</div></div>
                  <div className="border border-ink/15 rounded-sm p-2 bg-sky-50"><div className="text-[10px] uppercase font-mono text-muted-foreground">Click</div><div className="text-xl font-display font-semibold text-sky-700">{statsData.unique_clicks}</div><div className="text-[10px] text-muted-foreground">{(statsData.click_rate * 100).toFixed(1)}%</div></div>
                  <div className="border border-ink/15 rounded-sm p-2 bg-rose-50"><div className="text-[10px] uppercase font-mono text-muted-foreground">Bounce</div><div className="text-xl font-display font-semibold text-rose-700">{statsData.bounces}</div><div className="text-[10px] text-muted-foreground">{statsData.hard_bounces} hard</div></div>
                </div>
                <div className="text-xs text-muted-foreground">Aperture totali: {statsData.opens_total} · Click totali: {statsData.clicks_total} · Disiscritti: {statsData.unsubscribed}</div>
                {statsData.send_time && <div className="text-xs text-muted-foreground">Inviata: {new Date(statsData.send_time).toLocaleString("it-IT")}</div>}

                <div className="border-t border-ink/15 pt-3 space-y-2">
                  <div className="text-xs font-semibold">Re-invia a:</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => resendTo("non_openers")} disabled={resending}>
                      {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailX className="w-3.5 h-3.5" />} Chi non l'ha aperta
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => resendTo("bounced")} disabled={resending}>
                      {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Chi non l'ha ricevuta
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Crea una nuova campagna su Mailchimp con oggetto "(promemoria)" indirizzata solo al segmento richiesto.</p>
                </div>
              </>
            )}
            {!statsLoading && !statsData && statsFor?.mailchimp_campaign_id && (
              <div className="text-sm text-muted-foreground">Nessun dato disponibile.</div>
            )}
            {!statsFor?.mailchimp_campaign_id && (
              <div className="text-sm text-muted-foreground">Questa newsletter non è ancora stata inviata.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Marketing;