import { useEffect, useMemo, useState } from "react";
import { HardHat, Calendar, Star, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Commessa, Profile } from "./types";
import { CommessaDetailDialog } from "./CommessaDetailDialog";


const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }); } catch { return iso; }
};

type Cant = Commessa & { _responsabile?: Profile | null; _nextPlanDate?: string | null };

/** Striscia "Cantieri attivi" — commesse con reparto=montaggi o con planning entry nei prossimi 14gg. */
export const CantieriStrip = ({ onChanged }: { onChanged?: () => void }) => {
  const [cantieri, setCantieri] = useState<Cant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Commessa | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const load = async () => {
    setLoading(true);
    const today = new Date(); today.setHours(0,0,0,0);
    const in14 = new Date(today); in14.setDate(in14.getDate() + 14);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const [{ data: cs }, { data: plan }, { data: ass }, { data: profs }] = await Promise.all([
      supabase.from("commesse").select("*").neq("stato", "consegnato"),
      supabase.from("montaggi_planning").select("commessa_id, date").gte("date", fmt(today)).lte("date", fmt(in14)),
      supabase.from("commessa_assegnatari").select("commessa_id, user_id, responsabile"),
      supabase.from("profiles").select("id, display_name, avatar_url"),
    ]);
    const profById = new Map<string, Profile>((profs ?? []).map((p: any) => [p.id, p as Profile]));
    setProfiles((profs ?? []) as Profile[]);

    const planByCommessa = new Map<string, string>();
    for (const p of plan ?? []) {
      if (!p.commessa_id) continue;
      const prev = planByCommessa.get(p.commessa_id);
      if (!prev || (p.date as string) < prev) planByCommessa.set(p.commessa_id, p.date as string);
    }
    const respByCommessa = new Map<string, Profile | null>();
    const assByCommessa = new Map<string, Profile[]>();
    for (const a of ass ?? []) {
      const p = profById.get(a.user_id);
      if (a.responsabile) respByCommessa.set(a.commessa_id, p ?? null);
      const list = assByCommessa.get(a.commessa_id) ?? [];
      if (p) list.push(p);
      assByCommessa.set(a.commessa_id, list);
    }

    const out: Cant[] = (cs ?? [])
      .filter((c: any) => c.reparto === "montaggi" || planByCommessa.has(c.id))
      .map((c: any) => ({
        ...(c as Commessa),
        importo: c.importo === null ? null : Number(c.importo),
        assegnatari: assByCommessa.get(c.id) ?? [],
        _responsabile: respByCommessa.get(c.id) ?? null,
        _nextPlanDate: planByCommessa.get(c.id) ?? null,
      }));

    setCantieri(out);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const ch = supabase.channel(`cantieri_strip_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "commesse" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "montaggi_planning" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "commessa_assegnatari" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const ordered = useMemo(() => {
    return [...cantieri].sort((a, b) => {
      const da = a.data_scadenza ?? "9999-12-31";
      const db = b.data_scadenza ?? "9999-12-31";
      return da.localeCompare(db);
    });
  }, [cantieri]);

  if (loading && cantieri.length === 0) return null;
  if (ordered.length === 0) return null;

  return (
    <>
      <section className="border-2 border-dept rounded-sm bg-dept-soft/40">
        <div className="px-3 py-2 border-b-2 border-dept flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardHat className="w-4 h-4 text-dept" />
            <div className="font-display font-semibold text-sm">Cantieri attivi</div>
            <span className="font-mono text-[10px] text-muted-foreground">· {ordered.length}</span>
          </div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Montaggi · prossimi 14 giorni</div>
        </div>
        <div className="p-2 flex gap-2 overflow-x-auto">
          {ordered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { setSelected(c); setDetailOpen(true); }}
              className="min-w-[240px] max-w-[260px] text-left bg-paper border border-ink/15 hover:border-primary rounded-sm p-2.5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-semibold text-sm leading-tight truncate">{c.titolo}</div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
              </div>
              {c.cliente && <div className="text-[11px] text-muted-foreground truncate">{c.cliente}</div>}
              <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(c.data_scadenza)}</span>
                {c._nextPlanDate && <span className="text-primary">→ {fmtDate(c._nextPlanDate)}</span>}
              </div>
              {c._responsabile ? (
                <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-sm">
                  <Star className="w-3 h-3 fill-current" />{c._responsabile.display_name ?? "Resp."}
                </div>
              ) : (
                <div className="mt-1.5 text-[10px] text-amber-700">Nessun responsabile</div>
              )}
            </button>
          ))}
        </div>
      </section>

      <CommessaDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        commessa={selected}
        onChanged={() => { load(); onChanged?.(); }}
        onEdit={() => { setDetailOpen(false); setEditOpen(true); }}
      />
      <CommessaDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        commessa={selected}
        profiles={profiles}
        onSaved={async () => { await load(); onChanged?.(); }}
      />
    </>
  );
};
