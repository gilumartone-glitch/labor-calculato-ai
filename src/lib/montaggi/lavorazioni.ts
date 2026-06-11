import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LavorazioneStato = "bloccato" | "da_fare" | "in_corso" | "fatto";

export const STATO_LABEL: Record<LavorazioneStato, string> = {
  bloccato: "Bloccato",
  da_fare: "Da fare",
  in_corso: "In corso",
  fatto: "Fatto",
};

export type TemplateMateriale = {
  nome: string;
  quantita: number;
  unita?: string;
  costo_unitario?: number;
};

export type LavorazioneTemplate = {
  id: string;
  nome: string;
  descrizione: string | null;
  ore_stimate: number;
  costo_orario_default: number;
  materiali: TemplateMateriale[];
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type Lavorazione = {
  id: string;
  draft_id: string;
  template_id: string | null;
  causale: string;
  descrizione: string | null;
  source_kind: string;
  source_ref: any;
  ore: number;
  costo_orario: number;
  operatore_id: string | null;
  operatore_ids: string[];
  stato: LavorazioneStato;
  note: string | null;
  ordine: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** Hook: catalogo condiviso dei template/causali di montaggio. */
export const useLavorazioneTemplates = () => {
  const [items, setItems] = useState<LavorazioneTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("montaggi_lavorazione_templates")
      .select("*")
      .order("nome");
    if (!error) setItems((data ?? []) as any as LavorazioneTemplate[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`montaggi_templates:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "montaggi_lavorazione_templates" },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const create = async (input: Omit<LavorazioneTemplate, "id" | "created_at" | "updated_at" | "created_by">) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Non autenticato");
    const { data, error } = await supabase
      .from("montaggi_lavorazione_templates")
      .insert({
        nome: input.nome,
        descrizione: input.descrizione,
        ore_stimate: input.ore_stimate,
        costo_orario_default: input.costo_orario_default,
        materiali: input.materiali as any,
        note: input.note,
        created_by: u.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    return data as any as LavorazioneTemplate;
  };

  const update = async (id: string, patch: Partial<LavorazioneTemplate>) => {
    const payload: any = { ...patch };
    if (payload.materiali) payload.materiali = payload.materiali as any;
    const { error } = await supabase
      .from("montaggi_lavorazione_templates")
      .update(payload)
      .eq("id", id);
    if (error) throw error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from("montaggi_lavorazione_templates")
      .delete()
      .eq("id", id);
    if (error) throw error;
  };

  return { items, loading, reload: load, create, update, remove };
};

/** Hook: lavorazioni di montaggio per un draft. */
export const useLavorazioni = (draftId: string | null | undefined) => {
  const [items, setItems] = useState<Lavorazione[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!draftId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("montaggi_lavorazioni")
      .select("*")
      .eq("draft_id", draftId)
      .order("ordine")
      .order("created_at");
    if (!error) setItems((data ?? []) as any as Lavorazione[]);
    setLoading(false);
  }, [draftId]);

  useEffect(() => {
    load();
    if (!draftId) return;
    const channel = supabase
      .channel(`montaggi_lavorazioni:${draftId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "montaggi_lavorazioni", filter: `draft_id=eq.${draftId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [draftId, load]);

  const add = async (input: Omit<Lavorazione, "id" | "draft_id" | "created_by" | "created_at" | "updated_at" | "ordine"> & { ordine?: number }) => {
    if (!draftId) throw new Error("Nessun draft attivo");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Non autenticato");
    const nextOrdine = input.ordine ?? (items.reduce((m, x) => Math.max(m, x.ordine), -1) + 1);
    const { error } = await supabase.from("montaggi_lavorazioni").insert({
      draft_id: draftId,
      template_id: input.template_id,
      causale: input.causale,
      descrizione: input.descrizione,
      source_kind: input.source_kind ?? "manuale",
      source_ref: input.source_ref ?? null,
      ore: input.ore,
      costo_orario: input.costo_orario,
      operatore_id: input.operatore_id ?? null,
      operatore_ids: input.operatore_ids ?? [],
      stato: input.stato,
      note: input.note,
      ordine: nextOrdine,
      created_by: u.user.id,
    } as any);
    if (error) throw error;
    await load();
  };

  const update = async (id: string, patch: Partial<Lavorazione>) => {
    const { error } = await supabase
      .from("montaggi_lavorazioni")
      .update(patch as any)
      .eq("id", id);
    if (error) throw error;
    await load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from("montaggi_lavorazioni")
      .delete()
      .eq("id", id);
    if (error) throw error;
    await load();
  };

  return { items, loading, reload: load, add, update, remove };
};

/** Pezzi delle altre lavorazioni (laboratorio/tappezzeria/falegnameria) del draft attivo,
 *  letti da `officina:state`. Restituisce voci pronte per essere convertite in
 *  righe di lavorazione di montaggio. */
export type DraftPieceRef = {
  dept: "stampa" | "tappezzeria" | "falegnameria";
  deptLabel: string;
  id: string;
  productName: string;
  width: number;
  height: number;
  dimUnit: string;
  quantity: number;
  description: string;
};

const DEPT_LABEL: Record<DraftPieceRef["dept"], string> = {
  stampa: "Laboratorio",
  tappezzeria: "Tappezzeria",
  falegnameria: "Falegnameria",
};

export const readDraftPieces = (): DraftPieceRef[] => {
  try {
    const raw = localStorage.getItem("officina:state");
    if (!raw) return [];
    const s = JSON.parse(raw);
    const depts = s?.departments ?? {};
    const out: DraftPieceRef[] = [];
    (["stampa", "tappezzeria", "falegnameria"] as const).forEach((d) => {
      const list = Array.isArray(depts?.[d]?.pieces) ? depts[d].pieces : [];
      for (const p of list) {
        const qty = Number(p?.quantity) || 1;
        const w = Number(p?.width) || 0;
        const h = Number(p?.height) || 0;
        const unit = String(p?.dimUnit || "cm");
        const name = String(p?.productName || "Pezzo");
        out.push({
          dept: d,
          deptLabel: DEPT_LABEL[d],
          id: String(p?.id ?? `${d}-${out.length}`),
          productName: name,
          width: w,
          height: h,
          dimUnit: unit,
          quantity: qty,
          description: `${name}${w || h ? ` · ${w}×${h} ${unit}` : ""}${qty > 1 ? ` · ×${qty}` : ""}`,
        });
      }
    });
    return out;
  } catch {
    return [];
  }
};
