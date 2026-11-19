import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readPlanningDescription } from "@/lib/planning-description";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";

function contents(snapshot: unknown) {
  const root = object(snapshot);
  const state = Array.isArray(root.departments) ? root : object(root.designState ?? root);
  const departments = Array.isArray(state.departments) ? state.departments : [];
  return departments.flatMap(value => {
    const department = object(value), data = object(department.state ?? department);
    const pieces = Array.isArray(data.pieces) ? data.pieces : [];
    const materials = Array.isArray(data.materials) ? data.materials : [];
    const operations = Array.isArray(data.operations) ? data.operations : [];
    return [...pieces, ...materials, ...operations].map(item => {
      const row = object(item);
      const dimensions = row.width && row.height ? `${text(row.width)} × ${text(row.height)} ${text(row.dimUnit)}` : "";
      return [text(department.label ?? department.key), text(row.productName ?? row.name ?? row.label), dimensions,
        row.quantity ? `Quantità ${text(row.quantity)}` : "", text(row.description ?? row.notes)].filter(Boolean).join(" · ");
    }).filter(Boolean);
  });
}

type Details = { title: string; customer: string; description: string; note: string; references: string; items: string[] };
export function PlanningProjectDetails({ commessaId, notes }: { commessaId?: string | null; notes?: string | null }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!commessaId) return;
    let cancelled = false;
    setDetails(null); setError(false);
    (async () => {
      const [commessa, orders] = await Promise.all([
        supabase.from("commesse").select("titolo, cliente, descrizione, note, pp_preventivo, pp_ordine, snapshot").eq("id", commessaId).maybeSingle(),
        supabase.from("production_orders").select("code, note, snapshot").eq("source_commessa_id", commessaId),
      ]);
      if (cancelled) return;
      if (commessa.error || orders.error) { setError(true); return; }
      const c = commessa.data;
      const items = Array.from(new Set([...(orders.data ?? []).flatMap(order => contents(order.snapshot)), ...contents(c?.snapshot)]));
      setDetails({ title: c?.titolo ?? "Progetto", customer: c?.cliente ?? "", description: c?.descrizione ?? "",
        note: [c?.note, ...(orders.data ?? []).map(order => order.note)].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join("\n"),
        references: [c?.pp_preventivo ? `Preventivo ${c.pp_preventivo}` : "", c?.pp_ordine ? `Ordine cliente ${c.pp_ordine}` : "", ...(orders.data ?? []).map(order => order.code)].filter(Boolean).join(" · "), items });
    })();
    return () => { cancelled = true; };
  }, [commessaId]);
  const manual = readPlanningDescription(notes ?? null);
  return <section className="space-y-2 border-b border-border pb-4 text-sm" aria-label="Dettagli progetto">
    <h3 className="font-semibold text-base">Di cosa si tratta</h3>
    {commessaId ? error ? <p role="alert" className="text-destructive">Non riesco a caricare i dettagli del progetto.</p> : !details ? <p className="text-muted-foreground">Caricamento dettagli…</p> : <>
      <p className="font-medium break-words">{details.title}</p>
      {details.customer && details.customer !== details.title && <p>Cliente: {details.customer}</p>}
      {details.references && <p className="text-muted-foreground break-words">{details.references}</p>}
      {details.description && <p className="whitespace-pre-wrap break-words">{details.description}</p>}
      {details.items.length > 0 && <ul className="space-y-2 max-h-60 overflow-y-auto">{details.items.map((item, index) => <li key={index} className="border-l-2 border-border pl-3 break-words">{item}</li>)}</ul>}
      {details.note && <p className="whitespace-pre-wrap break-words">{details.note}</p>}
      {!details.description && !details.items.length && !details.note && <p className="text-muted-foreground">Nessuna descrizione presente nel progetto.</p>}
    </> : <p className="whitespace-pre-wrap break-words">{manual.description || manual.notes || "Nessuna descrizione inserita."}</p>}
  </section>;
}