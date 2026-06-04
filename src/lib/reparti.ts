// Macro → micro reparti. Caricati dinamicamente da reparti_config (Supabase).
// Le costanti `MACRO_REPARTI` e `MICRO_BY_MACRO` sono mutabili: contengono
// i valori di default e vengono sostituite quando il caricamento da DB completa.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MacroReparto = string;
export type MicroItem = { k: string; label: string };
export type MacroItem = { k: MacroReparto; label: string };

const DEFAULT_MACROS: MacroItem[] = [
  { k: "laboratorio", label: "Laboratorio" },
  { k: "tappezzeria", label: "Tappezzeria" },
  { k: "montaggi", label: "Montaggi" },
  { k: "uffici", label: "Uffici" },
  { k: "magazzino", label: "Magazzino" },
];

const DEFAULT_MICROS: Record<string, MicroItem[]> = {
  laboratorio: [
    { k: "grafica", label: "Grafica" },
    { k: "stampa", label: "Stampa" },
    { k: "taglio", label: "Taglio" },
    { k: "confezione", label: "Confezione" },
  ],
  tappezzeria: [
    { k: "taglio_tessuti", label: "Taglio tessuti" },
    { k: "cucito", label: "Cucito" },
    { k: "montaggio_tende", label: "Montaggio tende" },
  ],
  montaggi: [
    { k: "trasporto", label: "Trasporto" },
    { k: "installazione", label: "Installazione" },
  ],
  uffici: [
    { k: "amministrazione", label: "Amministrazione" },
    { k: "commerciale", label: "Commerciale" },
    { k: "marketing", label: "Marketing" },
    { k: "progettazione", label: "Progettazione" },
  ],
  magazzino: [
    { k: "ricezione_merci", label: "Ricezione merci" },
    { k: "stoccaggio", label: "Stoccaggio" },
    { k: "spedizioni", label: "Spedizioni" },
    { k: "inventario", label: "Inventario" },
  ],
};

export const MACRO_REPARTI: MacroItem[] = [...DEFAULT_MACROS];
export const MICRO_BY_MACRO: Record<string, MicroItem[]> = JSON.parse(JSON.stringify(DEFAULT_MICROS));

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
const notify = () => { version++; listeners.forEach((l) => l()); };

const applyData = (rows: { kind: string; key: string; label: string; macro_key: string | null; ordine: number }[]) => {
  const macros = rows.filter((r) => r.kind === "macro").sort((a, b) => a.ordine - b.ordine || a.label.localeCompare(b.label));
  const micros = rows.filter((r) => r.kind === "micro");
  // sostituisci array in-place per preservare riferimento
  MACRO_REPARTI.length = 0;
  macros.forEach((m) => MACRO_REPARTI.push({ k: m.key, label: m.label }));
  Object.keys(MICRO_BY_MACRO).forEach((k) => delete MICRO_BY_MACRO[k]);
  macros.forEach((m) => { MICRO_BY_MACRO[m.key] = []; });
  micros
    .filter((m) => m.macro_key && MICRO_BY_MACRO[m.macro_key] !== undefined)
    .sort((a, b) => a.ordine - b.ordine || a.label.localeCompare(b.label))
    .forEach((m) => MICRO_BY_MACRO[m.macro_key as string].push({ k: m.key, label: m.label }));
  notify();
};

let loadPromise: Promise<void> | null = null;
export const loadRepartiConfig = (force = false) => {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase
      .from("reparti_config" as any)
      .select("kind, key, label, macro_key, ordine");
    if (error) {
      console.warn("[reparti] load error", error.message);
      loadPromise = null; // permetti retry
      return;
    }
    if (data && data.length) applyData(data as any);
    else loadPromise = null;
  })();
  return loadPromise;
};


export const reloadRepartiConfig = () => {
  loadPromise = null;
  return loadRepartiConfig(true);
};

export const useRepartiConfig = () => {
  const [, setV] = useState(version);
  useEffect(() => {
    loadRepartiConfig();
    const cb = () => setV(version);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return { macros: MACRO_REPARTI, microsByMacro: MICRO_BY_MACRO, reload: reloadRepartiConfig };
};

export const addMacroReparto = async (key: string, label: string) => {
  const { error } = await supabase.from("reparti_config" as any).insert({
    kind: "macro", key, label, ordine: MACRO_REPARTI.length + 1,
  });
  if (error) throw error;
  await reloadRepartiConfig();
};

export const addMicroReparto = async (macroKey: string, key: string, label: string) => {
  const { error } = await supabase.from("reparti_config" as any).insert({
    kind: "micro", key, label, macro_key: macroKey, ordine: (MICRO_BY_MACRO[macroKey]?.length ?? 0) + 1,
  });
  if (error) throw error;
  await reloadRepartiConfig();
};

export const deleteRepartoConfig = async (kind: "macro" | "micro", key: string) => {
  const { error } = await supabase.from("reparti_config" as any).delete().eq("kind", kind).eq("key", key);
  if (error) throw error;
  await reloadRepartiConfig();
};

export const microsOf = (m: MacroReparto) => (MICRO_BY_MACRO[m] ?? []).map((x) => x.k);

export const microLabel = (k: string): string => {
  for (const m of Object.values(MICRO_BY_MACRO)) {
    const f = m.find((x) => x.k === k);
    if (f) return f.label;
  }
  return k;
};

export type UserLite = { id: string; display_name: string | null; settori?: string[] | null };

/** Utenti che hanno almeno un micro del macro indicato. */
export const filterUsersByMacro = (users: UserLite[], macro: MacroReparto): UserLite[] => {
  const micros = new Set(microsOf(macro));
  return users.filter((u) => (u.settori ?? []).some((s) => micros.has(s)));
};

/** Utenti che hanno quel micro specifico. */
export const filterUsersByMicro = (users: UserLite[], micro: string): UserLite[] =>
  users.filter((u) => (u.settori ?? []).includes(micro));
