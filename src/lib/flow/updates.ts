import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UpdateTipo =
  | "nota"
  | "aggiornamento"
  | "completamento"
  | "richiesta_prolungamento"
  | "risposta_admin";

export type CommessaUpdate = {
  id: string;
  commessa_id: string;
  author_id: string;
  tipo: UpdateTipo;
  body: string;
  proposed_date: string | null;
  status: "pending" | "approvato" | "rifiutato" | null;
  decided_by: string | null;
  decided_at: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export const TIPO_LABEL: Record<UpdateTipo, string> = {
  nota: "Nota",
  aggiornamento: "Aggiornamento",
  completamento: "Cantiere completato",
  richiesta_prolungamento: "Richiesta prolungamento",
  risposta_admin: "Risposta admin",
};

export const useCommessaUpdates = (commessaId: string | null | undefined) => {
  const [items, setItems] = useState<CommessaUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!commessaId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("commessa_updates")
      .select("*")
      .eq("commessa_id", commessaId)
      .order("created_at", { ascending: false });
    if (!error) setItems((data ?? []) as unknown as CommessaUpdate[]);
    setLoading(false);
  }, [commessaId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!commessaId) return;
    const ch = supabase
      .channel(`commessa_updates_${commessaId}_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "commessa_updates", filter: `commessa_id=eq.${commessaId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [commessaId, load]);

  const create = async (input: {
    tipo: UpdateTipo;
    body: string;
    proposed_date?: string | null;
    parent_id?: string | null;
  }) => {
    if (!commessaId) throw new Error("Nessuna commessa");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Non autenticato");
    const payload: any = {
      commessa_id: commessaId,
      author_id: u.user.id,
      tipo: input.tipo,
      body: input.body,
      proposed_date: input.proposed_date ?? null,
      parent_id: input.parent_id ?? null,
      status: input.tipo === "richiesta_prolungamento" ? "pending" : null,
    };
    const { error } = await supabase.from("commessa_updates").insert(payload);
    if (error) throw error;
    await load();
  };

  const decide = async (id: string, decision: "approvato" | "rifiutato", reason?: string) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Non autenticato");
    const { error } = await supabase
      .from("commessa_updates")
      .update({ status: decision, decided_by: u.user.id, decided_at: new Date().toISOString() } as any)
      .eq("id", id);
    if (error) throw error;
    // crea risposta admin con il motivo
    if (reason && reason.trim()) {
      await supabase.from("commessa_updates").insert({
        commessa_id: items.find((x) => x.id === id)?.commessa_id,
        author_id: u.user.id,
        tipo: "risposta_admin",
        body: `${decision === "approvato" ? "✓ Approvata" : "✗ Rifiutata"}: ${reason.trim()}`,
        parent_id: id,
      } as any);
    }
    await load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("commessa_updates").delete().eq("id", id);
    if (error) throw error;
    await load();
  };

  return { items, loading, reload: load, create, decide, remove };
};
