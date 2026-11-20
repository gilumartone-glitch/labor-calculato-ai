import { supabase } from "@/integrations/supabase/client";
import type {
  Articolo, Variante, NuovoArticolo, NuovaVariante, GiacenzaVariante, GiacenzaBagno,
  PezzaGiacenza, Movimento,
} from "./types";

// Le tabelle gest_* non sono ancora nei tipi generati (src/integrations/supabase/types.ts):
// finché non vengono rigenerati, l'accesso passa da qui con i tipi dichiarati a mano.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numNull = (v: unknown): number | null => (v == null ? null : Number(v));

const esito = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};

const normalizzaVariante = (r: Variante): Variante => ({
  ...r,
  altezza_cm: numNull(r.altezza_cm),
  peso_gm2: numNull(r.peso_gm2),
  spessore_mm: numNull(r.spessore_mm),
  costo_um: numNull(r.costo_um),
  prezzo_um: numNull(r.prezzo_um),
});

export async function elencoArticoli(): Promise<Articolo[]> {
  return esito<Articolo[]>(
    await db.from("gest_articoli").select("*").is("archiviato_il", null).order("nome"),
  );
}

export async function elencoVarianti(): Promise<Variante[]> {
  const righe = esito<Variante[]>(
    await db.from("gest_varianti").select("*").is("archiviato_il", null).order("codice"),
  );
  return righe.map(normalizzaVariante);
}

export async function creaArticolo(dati: NuovoArticolo): Promise<Articolo> {
  return esito<Articolo>(await db.from("gest_articoli").insert(dati).select("*").single());
}

export async function creaVariante(dati: NuovaVariante): Promise<Variante> {
  return normalizzaVariante(esito<Variante>(await db.from("gest_varianti").insert(dati).select("*").single()));
}

/** Archiviazione: il record resta nel database e nello storico, ma esce dagli elenchi. */
export async function archiviaArticolo(id: string): Promise<void> {
  esito(await db.from("gest_articoli").update({ archiviato_il: new Date().toISOString() }).eq("id", id));
}

export async function archiviaVariante(id: string): Promise<void> {
  esito(await db.from("gest_varianti").update({ archiviato_il: new Date().toISOString() }).eq("id", id));
}

export async function giacenzeVarianti(): Promise<GiacenzaVariante[]> {
  const righe = esito<GiacenzaVariante[]>(await db.from("gest_giacenze_varianti").select("variante_id, giacenza, impegnato, disponibile"));
  return righe.map((r) => ({ variante_id: r.variante_id, giacenza: num(r.giacenza), impegnato: num(r.impegnato), disponibile: num(r.disponibile) }));
}

export async function giacenzeBagni(varianteId: string): Promise<GiacenzaBagno[]> {
  const righe = esito<GiacenzaBagno[]>(
    await db.from("gest_giacenze_bagno").select("*").eq("variante_id", varianteId).order("codice_bagno"),
  );
  return righe.map((r) => ({
    ...r,
    pezze: num(r.pezze),
    metri: num(r.metri),
    pezza_piu_lunga_m: numNull(r.pezza_piu_lunga_m),
  }));
}

export async function elencoPezze(varianteId: string): Promise<PezzaGiacenza[]> {
  const righe = esito<PezzaGiacenza[]>(
    await db.from("gest_giacenze_pezze").select("*").eq("variante_id", varianteId).order("created_at", { ascending: false }),
  );
  return righe.map((r) => ({
    ...r,
    lunghezza_iniziale_m: num(r.lunghezza_iniziale_m),
    residuo_m: num(r.residuo_m),
  }));
}

export async function caricaPezza(p: {
  varianteId: string;
  metri: number;
  codiceBagno?: string | null;
  posizione?: string | null;
  fornitore?: string | null;
  nota?: string | null;
}): Promise<{ id: string; codice: string }> {
  return esito<{ id: string; codice: string }>(
    await db.rpc("gest_carica_pezza", {
      _variante_id: p.varianteId,
      _metri: p.metri,
      _codice_bagno: p.codiceBagno ?? null,
      _posizione: p.posizione ?? null,
      _fornitore: p.fornitore ?? null,
      _nota: p.nota ?? null,
    }),
  );
}

/** Registra un taglio e restituisce i metri residui della pezza. */
export async function tagliaPezza(p: {
  pezzaId: string;
  metri: number;
  rifTipo?: string | null;
  rifId?: string | null;
  nota?: string | null;
}): Promise<number> {
  return num(
    esito<number>(
      await db.rpc("gest_taglia_pezza", {
        _pezza_id: p.pezzaId,
        _metri: p.metri,
        _rif_tipo: p.rifTipo ?? null,
        _rif_id: p.rifId ?? null,
        _nota: p.nota ?? null,
      }),
    ),
  );
}

export async function elencoMovimenti(limite = 200): Promise<Movimento[]> {
  const righe = esito<Movimento[]>(
    await db.from("gest_movimenti").select("*").order("id", { ascending: false }).limit(limite),
  );
  return righe.map((r) => ({ ...r, quantita: num(r.quantita) }));
}

export async function stornaMovimento(movimentoId: number, nota?: string): Promise<void> {
  esito(await db.rpc("gest_storna_movimento", { _movimento_id: movimentoId, _nota: nota ?? null }));
}
