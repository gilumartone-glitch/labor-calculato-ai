import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSharedCloudState } from "@/hooks/useSharedCloudState";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const REPARTI = [
  { k: "montaggi", label: "Montaggi" },
  { k: "stampa", label: "Stampa" },
  { k: "taglio", label: "Taglio" },
  { k: "tappezzeria", label: "Tappezzeria" },
  { k: "magazzino", label: "Magazzino" },
];

type Row = { id: string; cantiere_label: string; operator_id: string; date: string; hours: number; notes: string | null; reparto: string; commessa_id: string | null };
type Prof = { id: string; display_name: string | null; settori: string[] | null };

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => fmt(new Date());

const parseNotes = (n: string | null) => {
  const get = (k: string) => (n ?? "").match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  const rest = (n ?? "").split("\n").filter((l) => !/^(Cliente|Luogo):/.test(l)).join("\n").trim();
  return { cliente: get("Cliente"), luogo: get("Luogo"), note: rest };
};
const buildNotes = (cliente: string, luogo: string, note: string) =>
  [cliente && `Cliente: ${cliente}`, luogo && `Luogo: ${luogo}`, note].filter(Boolean).join("\n") || null;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
  defaultReparto?: string;
}

/** Creazione/modifica rapida di un cantiere o montaggio, senza progetto. */
export const QuickCantiereDialog = ({ open, onOpenChange, onSaved, defaultReparto = "montaggi" }: Props) => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Prof[]>([]);
  const calOps = useSharedCloudState<Array<{ id: string; name: string; userId?: string; reparti?: string[] }>>("montaggi:operai:v1", []);
  const [existing, setExisting] = useState<Row[]>([]);
  const [editLabel, setEditLabel] = useState<string>("");
  const [nome, setNome] = useState("");
  const [cliente, setCliente] = useState("");
  const [luogo, setLuogo] = useState("");
  const [note, setNote] = useState("");
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [hours, setHours] = useState(8);
  const [weekend, setWeekend] = useState(false);
  const [reparto, setReparto] = useState(defaultReparto);
  const [ops, setOps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dayOps, setDayOps] = useState<Record<string, string[]>>({});
  const [showDays, setShowDays] = useState(false);

  const reset = () => {
    setEditLabel(""); setNome(""); setCliente(""); setLuogo(""); setNote("");
    setFrom(todayStr()); setTo(todayStr()); setHours(8); setWeekend(false); setReparto(defaultReparto); setOps([]); setDayOps({}); setShowDays(false);
  };

  useEffect(() => {
    if (!open) return;
    reset();
    (async () => {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id, display_name, settori").order("display_name"),
        supabase.from("montaggi_planning").select("id, cantiere_label, operator_id, date, hours, notes, reparto, commessa_id")
          .is("commessa_id", null).gte("date", fmt(new Date(Date.now() - 60 * 864e5))).order("date"),
      ]);
      setProfiles((p ?? []) as Prof[]);
      setExisting((r ?? []) as Row[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const labels = useMemo(() => Array.from(new Set(existing.map((r) => r.cantiere_label))).sort(), [existing]);

  const loadExisting = (label: string) => {
    setEditLabel(label);
    if (!label) { reset(); return; }
    const rows = existing.filter((r) => r.cantiere_label === label);
    if (!rows.length) return;
    const dates = rows.map((r) => r.date).sort();
    const n = parseNotes(rows[0].notes);
    setNome(label); setCliente(n.cliente); setLuogo(n.luogo); setNote(n.note);
    setFrom(dates[0]); setTo(dates[dates.length - 1]);
    setHours(Number(rows[0].hours) || 8); setReparto(rows[0].reparto || defaultReparto);
    const all = Array.from(new Set(rows.map((r) => r.operator_id)));
    setOps(all);
    const per: Record<string, string[]> = {};
    for (const d of new Set(dates)) {
      const o = rows.filter((r) => r.date === d).map((r) => r.operator_id);
      if (o.length !== all.length) per[d] = o;
    }
    setDayOps(per); setShowDays(Object.keys(per).length > 0);
    setWeekend(rows.some((r) => { const d = new Date(r.date).getDay(); return d === 0 || d === 6; }));
  };

  const sortedProfiles = useMemo(() => {
    const inRep = (p: Prof) => (p.settori ?? []).includes(reparto);
    const profIds = new Set(profiles.map((p) => p.id));
    const extra: Prof[] = (calOps.state ?? [])
      .filter((o) => o?.id && !profIds.has(o.id) && !(o.userId && profIds.has(o.userId)))
      .map((o) => ({ id: o.id, display_name: o.name, settori: o.reparti ?? [] }));
    return [...profiles, ...extra].sort((a, b) => Number(inRep(b)) - Number(inRep(a)));
  }, [profiles, reparto, calOps.state]);

  const days = useMemo(() => {
    const out: string[] = [];
    if (!from || !to || to < from) return out;
    for (let d = new Date(from + "T00:00:00"); fmt(d) <= to; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (!weekend && (wd === 0 || wd === 6)) continue;
      out.push(fmt(d));
    }
    return out;
  }, [from, to, weekend]);
  const opsFor = (d: string) => dayOps[d] ?? ops;
  const toggleDayOp = (d: string, id: string) => setDayOps((m) => {
    const cur = m[d] ?? ops;
    return { ...m, [d]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });
  const nameOf = (id: string) => sortedProfiles.find((p) => p.id === id)?.display_name ?? "Operaio";

  const save = async () => {
    if (!user) return;
    if (!nome.trim()) { toast.error("Inserisci il nome del cantiere"); return; }
    if (!from || !to || to < from) { toast.error("Controlla le date"); return; }
    if (!days.length) { toast.error("Nessun giorno lavorativo nelle date scelte"); return; }
    setSaving(true);
    try {
      if (editLabel) {
        const ids = existing.filter((r) => r.cantiere_label === editLabel).map((r) => r.id);
        if (ids.length) {
          const { error } = await supabase.from("montaggi_planning").delete().in("id", ids);
          if (error) throw error;
        }
      }
      const notes = buildNotes(cliente.trim(), luogo.trim(), note.trim());
      const rows = days.flatMap((date) => opsFor(date).map((op) => ({
        commessa_id: null, cantiere_label: nome.trim(), operator_id: op, date, hours, notes, reparto, created_by: user.id,
      })));
      if (!rows.length) { toast.error("Scegli almeno un operaio"); setSaving(false); return; }
      const { error } = await supabase.from("montaggi_planning").insert(rows);
      if (error) throw error;
      toast.success(editLabel ? "Cantiere aggiornato" : "Cantiere creato");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Errore di salvataggio");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editLabel || !confirm(`Eliminare il cantiere "${editLabel}" da tutti i giorni?`)) return;
    const ids = existing.filter((r) => r.cantiere_label === editLabel).map((r) => r.id);
    const { error } = await supabase.from("montaggi_planning").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success("Cantiere eliminato"); onSaved?.(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{editLabel ? "Modifica cantiere" : "Nuovo cantiere / montaggio"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-base">
          {labels.length > 0 && (
            <label className="block">
              <span className="font-semibold">Modifica un cantiere esistente</span>
              <select value={editLabel} onChange={(e) => loadExisting(e.target.value)} className="mt-1 w-full h-11 border-2 border-input rounded-sm px-2 bg-background">
                <option value="">— Nuovo cantiere —</option>
                {labels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}

          <label className="block"><span className="font-semibold">Nome cantiere *</span>
            <Input className="mt-1 h-11 text-base" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Teatro San Carlo" autoFocus />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="font-semibold">Cliente</span>
              <Input className="mt-1 h-11 text-base" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </label>
            <label className="block"><span className="font-semibold">Luogo</span>
              <Input className="mt-1 h-11 text-base" value={luogo} onChange={(e) => setLuogo(e.target.value)} placeholder="Indirizzo / città" />
            </label>
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <label className="block"><span className="font-semibold">Dal</span>
              <Input type="date" className="mt-1 h-11 text-base" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
            </label>
            <label className="block"><span className="font-semibold">Al</span>
              <Input type="date" className="mt-1 h-11 text-base" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="block"><span className="font-semibold">Ore/giorno</span>
              <Input type="number" min={0.5} step={0.5} className="mt-1 h-11 text-base" value={hours} onChange={(e) => setHours(Number(e.target.value) || 0)} />
            </label>
            <label className="block"><span className="font-semibold">Reparto</span>
              <select value={reparto} onChange={(e) => setReparto(e.target.value)} className="mt-1 w-full h-11 border-2 border-input rounded-sm px-2 bg-background">
                {REPARTI.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} className="w-4 h-4" /> Includi sabato e domenica</label>

          <div>
            <div className="font-semibold mb-1">Operai * ({ops.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {sortedProfiles.map((p) => {
                const on = ops.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => setOps((o) => on ? o.filter((x) => x !== p.id) : [...o, p.id])}
                    className={`px-3 py-1.5 rounded-sm border-2 text-sm font-semibold ${on ? "bg-primary text-primary-foreground border-primary" : "border-input hover:border-primary"}`}>
                    {p.display_name ?? "Utente"}
                  </button>
                );
              })}
            </div>
          </div>

          {days.length > 0 && (
            <div className="border-2 border-input rounded-sm">
              <button type="button" onClick={() => setShowDays((v) => !v)} className="w-full text-left px-3 py-2 font-semibold">
                {showDays ? "▾" : "▸"} Operai per singola giornata ({days.length} giorni)
              </button>
              {showDays && (
                <div className="divide-y divide-border">
                  {days.map((d) => {
                    const cur = opsFor(d);
                    const label = new Date(d + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });
                    const pool = Array.from(new Set([...ops, ...cur]));
                    return (
                      <div key={d} className="px-3 py-2 flex flex-wrap items-center gap-1.5">
                        <span className="w-28 font-semibold capitalize">{label}</span>
                        {pool.map((id) => {
                          const on = cur.includes(id);
                          return (
                            <button key={id} type="button" onClick={() => toggleDayOp(d, id)}
                              className={`px-2.5 py-1 rounded-sm border-2 text-sm font-semibold ${on ? "bg-primary text-primary-foreground border-primary" : "border-input text-muted-foreground line-through"}`}>
                              {nameOf(id)}
                            </button>
                          );
                        })}
                        <select value="" onChange={(e) => e.target.value && toggleDayOp(d, e.target.value)} className="h-8 border-2 border-input rounded-sm px-1 bg-background text-sm">
                          <option value="">+ aggiungi</option>
                          {sortedProfiles.filter((p) => !cur.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.display_name ?? "Utente"}</option>)}
                        </select>
                        {dayOps[d] && <button type="button" className="text-sm underline text-muted-foreground" onClick={() => setDayOps((m) => { const n = { ...m }; delete n[d]; return n; })}>ripristina</button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <label className="block"><span className="font-semibold">Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full border-2 border-input rounded-sm p-2 bg-background" />
          </label>
        </div>

        <DialogFooter className="gap-2">
          {editLabel && <Button variant="destructive" onClick={remove} className="mr-auto"><Trash2 className="w-4 h-4" />Elimina</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={save} disabled={saving}><Plus className="w-4 h-4" />{editLabel ? "Salva modifiche" : "Crea cantiere"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
