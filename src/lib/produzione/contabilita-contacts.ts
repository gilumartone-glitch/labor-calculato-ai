import { supabase } from "@/integrations/supabase/client";

export type ContabContact = {
  id: string;
  type: "cliente" | "fornitore" | "entrambi";
  name: string;
  email?: string;
  phone?: string;
  vat?: string;
  createdAt: string;
};

const KEY = "main";

/** Carica i contatti dall'anagrafica condivisa (contabilita_state.data.contacts). */
export async function loadContabContacts(): Promise<ContabContact[]> {
  const { data, error } = await supabase
    .from("contabilita_state")
    .select("data")
    .eq("key", KEY)
    .maybeSingle();
  if (error || !data?.data) return [];
  const arr = (data.data as any).contacts;
  if (!Array.isArray(arr)) return [];
  return arr.map((c: any) => ({
    id: String(c.id ?? crypto.randomUUID()),
    type: c.type === "fornitore" || c.type === "entrambi" ? c.type : "cliente",
    name: String(c.name ?? "").trim(),
    email: c.email,
    phone: c.phone,
    vat: c.vat,
    createdAt: c.createdAt ?? new Date().toISOString(),
  })).filter((c) => c.name);
}

/** Aggiunge un contatto all'anagrafica condivisa. */
export async function addContabContact(input: { name: string; type: "cliente" | "fornitore" | "entrambi"; email?: string; phone?: string }): Promise<ContabContact> {
  const name = input.name.trim();
  if (!name) throw new Error("Nome contatto richiesto");
  const { data, error } = await supabase
    .from("contabilita_state")
    .select("data")
    .eq("key", KEY)
    .maybeSingle();
  if (error) throw error;
  const state = (data?.data as any) ?? {};
  const list: any[] = Array.isArray(state.contacts) ? state.contacts : [];
  // Dedup per nome (case-insensitive) e tipo compatibile
  const exists = list.find((c) => String(c.name ?? "").trim().toLowerCase() === name.toLowerCase());
  if (exists) {
    // Estendi tipo se diverso
    if (exists.type !== input.type && exists.type !== "entrambi") {
      exists.type = "entrambi";
      const next = { ...state, contacts: list };
      await supabase.from("contabilita_state").upsert([{ key: KEY, data: next as never }], { onConflict: "key" });
    }
    return {
      id: String(exists.id),
      type: exists.type,
      name: String(exists.name),
      email: exists.email, phone: exists.phone, vat: exists.vat,
      createdAt: exists.createdAt ?? new Date().toISOString(),
    };
  }
  const created: ContabContact = {
    id: crypto.randomUUID(),
    type: input.type,
    name,
    email: input.email,
    phone: input.phone,
    createdAt: new Date().toISOString(),
  };
  const next = { ...state, contacts: [...list, created] };
  const { error: e2 } = await supabase
    .from("contabilita_state")
    .upsert([{ key: KEY, data: next as never }], { onConflict: "key" });
  if (e2) throw e2;
  return created;
}