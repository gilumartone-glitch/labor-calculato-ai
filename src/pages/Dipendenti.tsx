import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, Users, Search, ArrowLeft } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MACRO_REPARTI, MICRO_BY_MACRO, microLabel, useRepartiConfig, addMacroReparto, addMicroReparto, deleteRepartoConfig, type MacroReparto } from "@/lib/reparti";
import type { Dipendente } from "@/lib/dipendenti";

const NET_TO_GROSS_RATIO = 0.82;
const WORK_HOURS_PER_DAY = 8;
const WORK_DAYS_PER_MONTH = 22;
const SALARY_MONTHS = 13;
const dipRal = (d: { hourly_rate: number }) =>
  (Math.max(0, d.hourly_rate ?? 0) * WORK_HOURS_PER_DAY * WORK_DAYS_PER_MONTH * SALARY_MONTHS) / NET_TO_GROSS_RATIO;
const dipCompanyCost = (d: { hourly_rate: number; inps_pct: number; inail_pct: number; tfr_pct: number; extra_costs: number }) => {
  const ral = dipRal(d);
  return ral + ral * (d.inps_pct / 100) + ral * (d.inail_pct / 100) + ral * (d.tfr_pct / 100) + (d.extra_costs || 0);
};
const dipHourlyCost = (d: { hourly_rate: number; inps_pct: number; inail_pct: number; tfr_pct: number; extra_costs: number; annual_hours: number }) =>
  dipCompanyCost(d) / Math.max(1, d.annual_hours);

type Profile = { id: string; display_name: string | null };

type Editable = Omit<Dipendente, "id"> & { id?: string };

const empty = (): Editable => ({
  nome: "",
  funzione: "",
  email: "",
  telefono: "",
  macro_reparti: [],
  reparti: [],
  profile_id: null,
  hourly_rate: 0,
  ral: 0,
  inps_pct: 30,
  inail_pct: 3,
  tfr_pct: 8.33,
  extra_costs: 0,
  annual_hours: 1720,
  attivo: true,
  note: "",
});

const eur = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

export default function Dipendenti() {
  const { user, loading: authLoading } = useAuth();
  const { loading: permLoading, can, isAdmin } = usePermissions();
  const [items, setItems] = useState<Dipendente[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editable | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [filterMacro, setFilterMacro] = useState<MacroReparto | "">("");
  useRepartiConfig(); // mantiene il componente sincronizzato con i reparti

  const canWrite = isAdmin || can("dipendenti", "write") || can("flow", "write");


  const load = async () => {
    setLoading(true);
    const [{ data: dip }, { data: prof }] = await Promise.all([
      supabase.from("dipendenti").select("*").order("nome"),
      supabase.from("profiles").select("id, display_name").order("display_name"),
    ]);
    setItems((dip ?? []) as Dipendente[]);
    setProfiles((prof ?? []) as Profile[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user) load();
  }, [authLoading, user]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return items.filter((d) => {
      if (filterMacro && !d.macro_reparti.includes(filterMacro)) return false;
      if (!f) return true;
      return (d.nome + " " + (d.funzione ?? "")).toLowerCase().includes(f);
    });
  }, [items, filter, filterMacro]);


  const startNew = () => setEditing(empty());
  const startEdit = (d: Dipendente) => setEditing({ ...d });

  const save = async () => {
    if (!editing || !user) return;
    if (!editing.nome.trim()) {
      toast.error("Inserisci un nome");
      return;
    }
    setSaving(true);
    const payload = {
      nome: editing.nome.trim(),
      funzione: editing.funzione?.trim() || null,
      email: editing.email?.trim() || null,
      telefono: editing.telefono?.trim() || null,
      macro_reparti: editing.macro_reparti,
      reparti: editing.reparti,
      profile_id: editing.profile_id || null,
      hourly_rate: Number(editing.hourly_rate) || 0,
      ral: Number(editing.ral) || 0,
      inps_pct: Number(editing.inps_pct) || 0,
      inail_pct: Number(editing.inail_pct) || 0,
      tfr_pct: Number(editing.tfr_pct) || 0,
      extra_costs: Number(editing.extra_costs) || 0,
      annual_hours: Number(editing.annual_hours) || 1720,
      attivo: editing.attivo,
      note: editing.note?.trim() || null,
    };
    let error;
    if (editing.id) {
      ({ error } = await supabase.from("dipendenti").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("dipendenti").insert({ ...payload, created_by: user.id }));
    }
    setSaving(false);
    if (error) {
      toast.error("Errore salvataggio", { description: error.message });
      return;
    }
    toast.success(editing.id ? "Dipendente aggiornato" : "Dipendente aggiunto");
    setEditing(null);
    load();
  };

  const remove = async (d: Dipendente) => {
    if (!confirm(`Eliminare ${d.nome}?`)) return;
    const { error } = await supabase.from("dipendenti").delete().eq("id", d.id);
    if (error) {
      toast.error("Errore eliminazione", { description: error.message });
      return;
    }
    toast.success("Dipendente eliminato");
    load();
  };

  const toggleMacro = (m: MacroReparto) => {
    if (!editing) return;
    const has = editing.macro_reparti.includes(m);
    const macros = has ? editing.macro_reparti.filter((x) => x !== m) : [...editing.macro_reparti, m];
    // se rimuovo un macro, rimuovo anche i suoi micro dai reparti selezionati
    const validMicros = new Set<string>();
    macros.forEach((mm) => MICRO_BY_MACRO[mm as MacroReparto].forEach((x) => validMicros.add(x.k)));
    const reparti = editing.reparti.filter((r) => validMicros.has(r));
    setEditing({ ...editing, macro_reparti: macros, reparti });
  };

  const toggleMicro = (k: string) => {
    if (!editing) return;
    const has = editing.reparti.includes(k);
    setEditing({
      ...editing,
      reparti: has ? editing.reparti.filter((x) => x !== k) : [...editing.reparti, k],
    });
  };

  const availableMicros = useMemo(() => {
    if (!editing) return [];
    const list: { k: string; label: string; macro: MacroReparto }[] = [];
    editing.macro_reparti.forEach((m) => {
      MICRO_BY_MACRO[m as MacroReparto]?.forEach((x) => list.push({ ...x, macro: m as MacroReparto }));
    });
    return list;
  }, [editing]);

  if (authLoading || permLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!can("dipendenti", "read") && !isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center border-2 border-ink bg-paper p-8 rounded-sm">
          <h1 className="font-display text-2xl font-semibold mb-2">Accesso non consentito</h1>
          <p className="text-sm text-muted-foreground">Non hai i permessi per gestire i dipendenti.</p>
        </div>
      </div>
    );
  }

  return (

    <div className="min-h-screen bg-background">
      <header className="app-header border-b-2 border-ink bg-paper">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/hub" className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-ink">
              <ArrowLeft className="w-3 h-3" /> Hub
            </Link>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary mb-1">// Officina · Anagrafica</div>
              <h1 className="font-display text-2xl font-semibold leading-none flex items-center gap-2">
                <Users className="w-6 h-6" /> Dipendenti
              </h1>
            </div>
          </div>
          {canWrite && (
            <Button onClick={startNew}><Plus className="w-4 h-4" /> Nuovo dipendente</Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-10 space-y-6">
        <Card className="border-2 border-ink/20 bg-paper">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cerca per nome o funzione..." className="pl-8" />
              </div>
              <div className="inline-flex border-2 border-ink/30 rounded-sm overflow-hidden">
                <button onClick={() => setFilterMacro("")} className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold ${filterMacro === "" ? "bg-ink text-paper" : "text-ink/60"}`}>Tutti</button>
                {MACRO_REPARTI.map((m) => (
                  <button key={m.k} onClick={() => setFilterMacro(m.k)} className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold ${filterMacro === m.k ? "bg-ink text-paper" : "text-ink/60"}`}>{m.label}</button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {canWrite && <RepartiManager />}



        {loading ? (
          <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center border-2 border-dashed border-ink/20 bg-paper p-10 rounded-sm">
            <Users className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nessun dipendente. {canWrite && "Aggiungine uno con il pulsante in alto."}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((d) => (
              <Card key={d.id} className={`border-2 ${d.attivo ? "border-ink/20" : "border-ink/10 opacity-60"} bg-paper hover:border-ink transition-colors`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-lg font-semibold">{d.nome}</h3>
                        {d.funzione && <span className="text-xs text-muted-foreground">· {d.funzione}</span>}
                        {!d.attivo && <span className="text-[10px] uppercase font-bold text-muted-foreground border px-1.5 rounded-sm">Non attivo</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {d.macro_reparti.map((m) => (
                          <span key={m} className="px-1.5 py-0.5 text-[10px] uppercase font-bold bg-ink text-paper rounded-sm">{m}</span>
                        ))}
                        {d.reparti.map((r) => (
                          <span key={r} className="px-1.5 py-0.5 text-[10px] uppercase bg-muted text-ink/70 rounded-sm">{microLabel(r)}</span>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground font-mono">
                        Costo azienda/h: <strong>{eur(dipHourlyCost(d))}</strong> · Paga: {eur(d.hourly_rate)}/h
                        {d.email && <> · {d.email}</>}
                        {d.telefono && <> · {d.telefono}</>}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => startEdit(d)}>Modifica</Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(d)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {editing && (
        <div className="fixed inset-0 z-50 bg-ink/60 grid place-items-start sm:place-items-center p-3 overflow-auto">
          <Card className="w-full max-w-2xl border-2 border-ink bg-paper">
            <CardHeader>
              <CardTitle>{editing.id ? "Modifica dipendente" : "Nuovo dipendente"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Nome *</Label>
                  <Input value={editing.nome} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} />
                </div>
                <div>
                  <Label>Funzione</Label>
                  <Input value={editing.funzione ?? ""} onChange={(e) => setEditing({ ...editing, funzione: e.target.value })} placeholder="es. Capo squadra, Tappezziere..." />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                </div>
                <div>
                  <Label>Telefono</Label>
                  <Input value={editing.telefono ?? ""} onChange={(e) => setEditing({ ...editing, telefono: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Macroreparti</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {MACRO_REPARTI.map((m) => {
                    const active = editing.macro_reparti.includes(m.k);
                    return (
                      <button key={m.k} type="button" onClick={() => toggleMacro(m.k)}
                        className={`px-2.5 py-1 text-[11px] uppercase font-bold border-2 rounded-sm ${active ? "bg-ink text-paper border-ink" : "border-ink/30 text-ink/60"}`}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {availableMicros.length > 0 && (
                <div>
                  <Label>Reparti / settori specifici</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {availableMicros.map((m) => {
                      const active = editing.reparti.includes(m.k);
                      return (
                        <button key={m.k} type="button" onClick={() => toggleMicro(m.k)}
                          className={`px-2 py-1 text-[10px] uppercase font-bold border rounded-sm ${active ? "bg-ink text-paper border-ink" : "border-ink/30 text-ink/60"}`}>
                          {m.label} <span className="opacity-50">/{m.macro}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <Label>Profilo utente collegato (opzionale)</Label>
                <select value={editing.profile_id ?? ""} onChange={(e) => setEditing({ ...editing, profile_id: e.target.value || null })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— Nessuno (collaboratore senza login) —</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name ?? p.id.slice(0, 8)}</option>)}
                </select>
              </div>

              <div className="border-t pt-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Costi (per calcolo preventivi)</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <div><Label className="text-[10px]">Paga netta €/h</Label><Input type="number" step="0.01" value={editing.hourly_rate} onChange={(e) => setEditing({ ...editing, hourly_rate: Number(e.target.value) || 0 })} /></div>
                  <div><Label className="text-[10px]">INPS %</Label><Input type="number" step="0.01" value={editing.inps_pct} onChange={(e) => setEditing({ ...editing, inps_pct: Number(e.target.value) || 0 })} /></div>
                  <div><Label className="text-[10px]">INAIL %</Label><Input type="number" step="0.01" value={editing.inail_pct} onChange={(e) => setEditing({ ...editing, inail_pct: Number(e.target.value) || 0 })} /></div>
                  <div><Label className="text-[10px]">TFR %</Label><Input type="number" step="0.01" value={editing.tfr_pct} onChange={(e) => setEditing({ ...editing, tfr_pct: Number(e.target.value) || 0 })} /></div>
                  <div><Label className="text-[10px]">Costi extra €</Label><Input type="number" step="0.01" value={editing.extra_costs} onChange={(e) => setEditing({ ...editing, extra_costs: Number(e.target.value) || 0 })} /></div>
                  <div><Label className="text-[10px]">Ore annue</Label><Input type="number" value={editing.annual_hours} onChange={(e) => setEditing({ ...editing, annual_hours: Number(e.target.value) || 1720 })} /></div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Costo azienda calcolato</Label>
                    <div className="h-10 px-3 flex items-center rounded-md border bg-muted font-mono text-sm font-bold">{eur(dipHourlyCost(editing))}/h · {eur(dipCompanyCost(editing))}/anno</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input id="attivo" type="checkbox" checked={editing.attivo} onChange={(e) => setEditing({ ...editing, attivo: e.target.checked })} />
                <Label htmlFor="attivo" className="cursor-pointer">Dipendente attivo</Label>
              </div>

              <div>
                <Label>Note</Label>
                <Textarea value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Annulla</Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salva
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
