import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useProdStore } from "@/lib/produzione/store";
import { AuditEntry } from "@/lib/produzione/types";

const COLOR_FOR = (a: string) => {
  if (a.includes("COMPLETATO") || a.includes("CHIUSO") || a.includes("EMESSA")) return "border-l-emerald-500";
  if (a.includes("URGENTE") || a.includes("BLOCC") || a === "PRIORITA_CAMBIATA") return "border-l-destructive";
  if (a.includes("AGGIORNATO") || a.includes("MODIFICATO") || a === "MAGAZZINO_AGGIORNATO") return "border-l-amber-500";
  if (a.includes("MESSAGGIO")) return "border-l-blue-500";
  return "border-l-ink/30";
};

const ProdLog = () => {
  const { profiles } = useProdStore();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);
      setEntries((data ?? []) as any);
    })();
    const ch = supabase.channel("audit-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, (p) => {
        setEntries((prev) => [p.new as AuditEntry, ...prev].slice(0, 500));
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const filtered = useMemo(() => entries.filter((e) =>
    !q.trim() || `${e.action} ${e.entity_id ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(q.toLowerCase())
  ), [entries, q]);

  const exportCsv = () => {
    const rows = [
      ["Timestamp", "Utente", "Azione", "Entità", "ID", "Dettaglio"],
      ...filtered.map((e) => [
        e.created_at,
        profileById.get(e.user_id)?.display_name ?? e.user_id,
        e.action, e.entity_type, e.entity_id ?? "", e.detail ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-log-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-2xl font-semibold">Log Attività</h1>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink/40" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca azione, ordine…" className="pl-7 h-9 w-72" />
            </div>
            <Button variant="outline" onClick={exportCsv} className="gap-1.5"><Download className="w-3.5 h-3.5" />CSV</Button>
          </div>
        </div>

        <div className="space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-[12px] font-mono uppercase">Nessuna attività</div>
          ) : filtered.map((e) => (
            <div key={e.id} className={`bg-paper border border-ink/15 border-l-4 ${COLOR_FOR(e.action)} rounded-sm px-3 py-2 flex items-start gap-3`}>
              <div className="font-mono text-[10px] text-ink/50 shrink-0 w-32">
                {format(new Date(e.created_at), "dd/MM HH:mm:ss", { locale: it })}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider font-bold text-ink/70 shrink-0 w-44 truncate">
                {e.action}
              </div>
              <div className="text-[11px] text-ink/60 shrink-0 w-28 truncate">
                {profileById.get(e.user_id)?.display_name ?? "Utente"}
              </div>
              <div className="text-[12px] text-ink flex-1 min-w-0">{e.detail}</div>
              {e.entity_id && <div className="font-mono text-[10px] text-ink/40 shrink-0">{e.entity_id.slice(0, 8)}</div>}
            </div>
          ))}
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdLog;