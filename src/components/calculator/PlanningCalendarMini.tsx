import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id: string;
  operator_id: string;
  date: string;
  hours: number;
  cantiere_label: string;
  reparto: string | null;
};

type ProfileLite = { id: string; display_name: string | null };

const fmt = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => {
  const x = new Date(d); const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
};

const colorForCantiere = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 38%)`;
};

interface Props {
  reparto: string;
  weeks?: number;
  startDate?: string;
  endDate?: string;
  deliveryDate?: string;
  onPickDate?: (field: "startDate" | "endDate" | "deliveryDate", date: string) => void;
}

/** Mini-calendario di sola lettura: mostra gli impegni già pianificati per il reparto. */
export const PlanningCalendarMini = ({
  reparto, weeks = 6, startDate, endDate, deliveryDate, onPickDate,
}: Props) => {
  const [origin, setOrigin] = useState<Date>(() => startOfWeek(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(false);

  const days = useMemo(() => Array.from({ length: weeks * 7 }, (_, i) => addDays(origin, i)), [origin, weeks]);
  const firstDay = fmt(days[0]);
  const lastDay = fmt(days[days.length - 1]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: planData }, { data: profData }] = await Promise.all([
        supabase.from("montaggi_planning")
          .select("id, operator_id, date, hours, cantiere_label, reparto")
          .eq("reparto", reparto)
          .gte("date", firstDay)
          .lte("date", lastDay),
        profiles.length === 0
          ? supabase.from("profiles").select("id, display_name")
          : Promise.resolve({ data: profiles } as any),
      ]);
      if (cancelled) return;
      setRows((planData ?? []) as Row[]);
      if (profData && profiles.length === 0) setProfiles(profData as ProfileLite[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reparto, firstDay, lastDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Indice giorno → righe
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const list = m.get(r.date) ?? [];
      list.push(r); m.set(r.date, list);
    }
    return m;
  }, [rows]);

  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p?.display_name ?? id.slice(0, 6);
  };

  const todayStr = fmt(new Date());
  const inRange = (ds: string) =>
    startDate && endDate && ds >= startDate && ds <= endDate;
  const isStart = (ds: string) => ds && ds === startDate;
  const isEnd = (ds: string) => ds && ds === endDate;
  const isDelivery = (ds: string) => ds && ds === deliveryDate;

  const handleClick = (ds: string) => {
    if (!onPickDate) return;
    // Logica intuitiva: se non c'è start → set start; se c'è start ma non end → set end; altrimenti reset start
    if (!startDate) onPickDate("startDate", ds);
    else if (!endDate || ds < startDate) onPickDate("startDate", ds);
    else onPickDate("endDate", ds);
  };

  return (
    <div className="border border-ink/15 rounded-sm bg-background">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-ink/10 bg-muted/30">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Calendario pianificazione · {reparto}{loading ? " · caricamento…" : ""}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOrigin(addDays(origin, -7 * weeks))}
            className="px-2 py-0.5 text-[10px] border border-ink/20 rounded-sm hover:bg-muted">←</button>
          <button type="button" onClick={() => setOrigin(startOfWeek(new Date()))}
            className="px-2 py-0.5 text-[10px] border border-ink/20 rounded-sm hover:bg-muted">Oggi</button>
          <button type="button" onClick={() => setOrigin(addDays(origin, 7 * weeks))}
            className="px-2 py-0.5 text-[10px] border border-ink/20 rounded-sm hover:bg-muted">→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-[9px] uppercase tracking-wider text-muted-foreground border-b border-ink/10">
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => (
          <div key={d} className="px-1.5 py-1 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const ds = fmt(day);
          const items = byDay.get(ds) ?? [];
          const isToday = ds === todayStr;
          const inRng = inRange(ds);
          const isS = isStart(ds), isE = isEnd(ds), isD = isDelivery(ds);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          // raggruppa per cantiere per chip compatte
          const byCantiere = new Map<string, Row[]>();
          for (const r of items) {
            const list = byCantiere.get(r.cantiere_label) ?? [];
            list.push(r); byCantiere.set(r.cantiere_label, list);
          }
          return (
            <button
              key={ds}
              type="button"
              onClick={() => handleClick(ds)}
              className={`relative text-left min-h-[54px] border-r border-b border-ink/10 px-1 py-0.5 transition-colors
                ${isWeekend ? "bg-muted/30" : "bg-background"}
                ${inRng ? "ring-2 ring-inset ring-primary/40 bg-primary/5" : ""}
                ${isS ? "!bg-primary/15" : ""}
                ${isE ? "!bg-primary/15" : ""}
                ${isD ? "!bg-emerald-500/15 ring-2 ring-inset ring-emerald-500/50" : ""}
                hover:bg-primary/10
              `}
              title={items.length > 0 ? items.map((r) => `${r.cantiere_label} · ${nameOf(r.operator_id)} (${r.hours}h)`).join("\n") : "Clicca per selezionare"}
            >
              <div className={`flex items-center justify-between text-[10px] ${isToday ? "font-bold text-primary" : "text-foreground"}`}>
                <span>{day.getDate()}/{day.getMonth() + 1}</span>
                {(isS || isE || isD) && (
                  <span className="text-[8px] font-bold uppercase tracking-wider">
                    {isS ? "Inizio" : isE ? "Fine" : "Cons."}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {Array.from(byCantiere.entries()).slice(0, 2).map(([cant, list]) => (
                  <div key={cant}
                    className="text-[8px] leading-tight px-1 py-[1px] rounded-sm text-white truncate"
                    style={{ background: colorForCantiere(cant) }}>
                    {cant} · {list.length}p
                  </div>
                ))}
                {byCantiere.size > 2 && (
                  <div className="text-[8px] text-muted-foreground">+{byCantiere.size - 2}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-2 py-1 border-t border-ink/10 text-[9px] text-muted-foreground flex items-center gap-3 flex-wrap">
        <span>Clicca un giorno per impostare inizio/fine.</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-primary/40" />in lavorazione</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/40" />consegna</span>
      </div>
    </div>
  );
};
