import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CatalogKind = "attrezzo" | "materiale";

export type CatalogEntry = {
  id: string;
  nome: string;
  categoria: string | null;
  descrizione: string | null;
  unita: string;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AssignmentItem = {
  id: string;
  commessa_id: string;
  kind: CatalogKind;
  ref_id: string | null;
  ref_nome: string;
  qty: number;
  unita: string;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const tableFor = (kind: CatalogKind) =>
  kind === "attrezzo" ? "montaggi_attrezzi" : "montaggi_materiali";

/** Hook: catalogo condiviso (attrezzi o materiali). */
export const useMontaggiCatalog = (kind: CatalogKind) => {
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from(tableFor(kind) as "montaggi_attrezzi")
      .select("*")
      .order("nome");
    setItems((data ?? []) as CatalogEntry[]);
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`catalog_${kind}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tableFor(kind) },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [kind, load]);

  const create = async (
    input: Pick<CatalogEntry, "nome"> & Partial<Omit<CatalogEntry, "id" | "created_at" | "updated_at" | "created_by">>,
  ) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Non autenticato");
    const { data, error } = await supabase
      .from(tableFor(kind) as "montaggi_attrezzi")
      .insert({
        nome: input.nome,
        categoria: input.categoria ?? null,
        descrizione: input.descrizione ?? null,
        unita: input.unita ?? "pz",
        note: input.note ?? null,
        created_by: u.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    return data as CatalogEntry;
  };

  const update = async (id: string, patch: Partial<CatalogEntry>) => {
    const { error } = await supabase
      .from(tableFor(kind) as "montaggi_attrezzi")
      .update(patch)
      .eq("id", id);
    if (error) throw error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from(tableFor(kind) as "montaggi_attrezzi")
      .delete()
      .eq("id", id);
    if (error) throw error;
  };

  return { items, loading, reload: load, create, update, remove };
};

/** Hook: attrezzi/materiali assegnati a una commessa. */
export const useAssignmentItems = (commessaId: string | null | undefined) => {
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!commessaId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("montaggi_assignment_items")
      .select("*")
      .eq("commessa_id", commessaId)
      .order("kind")
      .order("ref_nome");
    setItems((data ?? []) as AssignmentItem[]);
    setLoading(false);
  }, [commessaId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (input: {
    kind: CatalogKind;
    ref_id?: string | null;
    ref_nome: string;
    qty: number;
    unita?: string;
    note?: string | null;
  }) => {
    if (!commessaId) throw new Error("Nessuna commessa");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Non autenticato");
    const { error } = await supabase.from("montaggi_assignment_items").insert({
      commessa_id: commessaId,
      kind: input.kind,
      ref_id: input.ref_id ?? null,
      ref_nome: input.ref_nome,
      qty: input.qty,
      unita: input.unita ?? "pz",
      note: input.note ?? null,
      created_by: u.user.id,
    });
    if (error) throw error;
    await load();
  };

  const update = async (id: string, patch: Partial<AssignmentItem>) => {
    const { error } = await supabase
      .from("montaggi_assignment_items")
      .update(patch)
      .eq("id", id);
    if (error) throw error;
    await load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from("montaggi_assignment_items")
      .delete()
      .eq("id", id);
    if (error) throw error;
    await load();
  };

  return { items, loading, reload: load, add, update, remove };
};
