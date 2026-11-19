import { supabase } from "@/integrations/supabase/client";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const esito = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};
const num = (v: unknown): number => (v == null ? 0 : Number(v));

/* ------------------------------------------------------------------ */
/* Tipi                                                                */
/* ------------------------------------------------------------------ */
export type TipoDocumento =
  | "preventivo" | "ordine" | "ddt" | "fattura" | "nota_credito" | "bolla_carico" | "fattura_fornitore";
export type StatoDocumento = "bozza" | "confermato" | "annullato";
export type TipoRiga = "articolo" | "lavorazione" | "libera" | "nota";

export const TIPI_DOCUMENTO: TipoDocumento[] = [
  "preventivo", "ordine", "ddt", "fattura", "nota_credito", "bolla_carico", "fattura_fornitore",
];

export const TIPO_LABEL: Record<TipoDocumento, string> = {
  preventivo: "Preventivo",
  ordine: "Ordine / Proforma",
  ddt: "DDT",
  fattura: "Fattura",
  nota_credito: "Nota di credito",
  bolla_carico: "Bolla di carico",
  fattura_fornitore: "Fattura fornitore",
};

export const TIPO_LABEL_PLURALE: Record<TipoDocumento, string> = {
  preventivo: "Preventivi",
  ordine: "Ordini / Proforma",
  ddt: "DDT",
  fattura: "Fatture",
  nota_credito: "Note di credito",
  bolla_carico: "Bolle di carico",
  fattura_fornitore: "Fatture fornitori",
};

/** Documenti del ciclo passivo: intestati a un fornitore. */
export const isPassivo = (t: TipoDocumento) => t === "bolla_carico" || t === "fattura_fornitore";

/** In quali documenti si può trasformare un documento confermato. */
export const TRASFORMAZIONI: Record<TipoDocumento, TipoDocumento[]> = {
  preventivo: ["ordine"],
  ordine: ["ddt", "fattura"],
  ddt: ["fattura"],
  fattura: ["nota_credito"],
  nota_credito: [],
  bolla_carico: ["fattura_fornitore"],
  fattura_fornitore: [],
};

export const TIPO_RIGA_LABEL: Record<TipoRiga, string> = {
  articolo: "Articolo",
  lavorazione: "Lavorazione",
  libera: "Riga libera",
  nota: "Nota",
};

export type Anagrafica = {
  id: string;
  codice: string;
  is_cliente: boolean;
  is_fornitore: boolean;
  ragione_sociale: string;
  partita_iva: string | null;
  codice_fiscale: string | null;
  codice_sdi: string | null;
  pec: string | null;
  email: string | null;
  telefono: string | null;
  indirizzo: string | null;
  cap: string | null;
  citta: string | null;
  provincia: string | null;
  nazione: string;
  pagamento: string | null;
  codice_mexal: string | null;
  note: string | null;
  archiviato_il: string | null;
};

export type DatiAnagrafica = Omit<Anagrafica, "id" | "codice" | "archiviato_il" | "codice_mexal">;

export type AliquotaIva = { id: string; codice: string; descrizione: string; percentuale: number; natura: string | null };

export type Intestatario = Partial<Pick<Anagrafica,
  "codice" | "ragione_sociale" | "partita_iva" | "codice_fiscale" | "codice_sdi" | "pec" | "indirizzo" | "cap" | "citta" | "provincia" | "nazione">>;

export type Documento = {
  id: string;
  tipo: TipoDocumento;
  stato: StatoDocumento;
  numero: number | null;
  anno: number | null;
  serie: string;
  data: string;
  anagrafica_id: string | null;
  intestatario: Intestatario | null;
  oggetto: string | null;
  riferimento_esterno: string | null;
  data_esterna: string | null;
  pagamento: string | null;
  validita_giorni: number | null;
  consegna_prevista: string | null;
  destinazione: string | null;
  causale_trasporto: string | null;
  aspetto_beni: string | null;
  colli: number | null;
  peso_kg: number | null;
  vettore: string | null;
  porto: string | null;
  note: string | null;
  note_interne: string | null;
  origine_id: string | null;
  design_draft_id: string | null;
  imponibile: number;
  imposta: number;
  totale: number;
  motivo_annullamento: string | null;
  created_at: string;
};

/** Campi di testata modificabili finché il documento è in bozza. */
export type Testata = Pick<Documento,
  "data" | "anagrafica_id" | "oggetto" | "riferimento_esterno" | "data_esterna" | "pagamento" | "validita_giorni"
  | "consegna_prevista" | "destinazione" | "causale_trasporto" | "aspetto_beni" | "colli" | "peso_kg" | "vettore"
  | "porto" | "note" | "note_interne">;

export type Riga = {
  id: string;
  documento_id: string;
  posizione: number;
  tipo_riga: TipoRiga;
  variante_id: string | null;
  codice: string | null;
  descrizione: string;
  dettagli: string | null;
  um: string | null;
  quantita: number;
  prezzo_unitario: number;
  sconto_pct: number;
  aliquota_id: string | null;
  importo: number;
};

/** Riga in modifica: senza id finché non è salvata. */
export type RigaBozza = Omit<Riga, "id" | "documento_id" | "posizione" | "importo"> & { id?: string };

export type RiepilogoIva = { aliquota_id: string; codice: string; descrizione: string; percentuale: number; imponibile: number; imposta: number };

/* ------------------------------------------------------------------ */
/* Funzioni pure                                                       */
/* ------------------------------------------------------------------ */
const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Importo di riga, come lo calcola il database. */
export const importoRiga = (r: Pick<RigaBozza, "tipo_riga" | "quantita" | "prezzo_unitario" | "sconto_pct">): number =>
  r.tipo_riga === "nota" ? 0 : arrotonda2(r.quantita * r.prezzo_unitario * (1 - r.sconto_pct / 100));

/** Totali di anteprima: imposta calcolata per aliquota, come in fattura elettronica. */
export const calcolaTotali = (righe: RigaBozza[], aliquote: AliquotaIva[]) => {
  const perAliquota = new Map<string, number>();
  let imponibile = 0;
  for (const r of righe) {
    const imp = importoRiga(r);
    imponibile += imp;
    if (r.aliquota_id && r.tipo_riga !== "nota") perAliquota.set(r.aliquota_id, (perAliquota.get(r.aliquota_id) ?? 0) + imp);
  }
  let imposta = 0;
  for (const [id, base] of perAliquota) {
    const pct = aliquote.find((a) => a.id === id)?.percentuale ?? 0;
    imposta += arrotonda2((arrotonda2(base) * pct) / 100);
  }
  imponibile = arrotonda2(imponibile);
  imposta = arrotonda2(imposta);
  return { imponibile, imposta, totale: arrotonda2(imponibile + imposta) };
};

/** "Preventivo n. 12/2026", oppure "Preventivo (bozza)". */
export const titoloDocumento = (d: Pick<Documento, "tipo" | "numero" | "anno" | "serie" | "stato">): string => {
  if (d.numero == null) return `${TIPO_LABEL[d.tipo]} (${d.stato === "annullato" ? "bozza annullata" : "bozza"})`;
  const serie = d.serie ? `/${d.serie}` : "";
  return `${TIPO_LABEL[d.tipo]} n. ${d.numero}${serie}/${d.anno}`;
};

export const rigaVuota = (aliquotaId: string | null): RigaBozza => ({
  tipo_riga: "libera", variante_id: null, codice: null, descrizione: "", dettagli: null, um: null,
  quantita: 1, prezzo_unitario: 0, sconto_pct: 0, aliquota_id: aliquotaId,
});

/* ------------------------------------------------------------------ */
/* Anagrafiche                                                         */
/* ------------------------------------------------------------------ */
export async function elencoAnagrafiche(): Promise<Anagrafica[]> {
  return esito<Anagrafica[]>(
    await db.from("gest_anagrafiche").select("*").is("archiviato_il", null).order("ragione_sociale"),
  );
}

export async function salvaAnagrafica(dati: DatiAnagrafica, id?: string): Promise<Anagrafica> {
  const q = id
    ? db.from("gest_anagrafiche").update(dati).eq("id", id)
    : db.from("gest_anagrafiche").insert(dati);
  return esito<Anagrafica>(await q.select("*").single());
}

export async function archiviaAnagrafica(id: string): Promise<void> {
  esito(await db.from("gest_anagrafiche").update({ archiviato_il: new Date().toISOString() }).eq("id", id));
}

export async function elencoAliquote(): Promise<AliquotaIva[]> {
  const righe = esito<AliquotaIva[]>(
    await db.from("gest_aliquote_iva").select("id, codice, descrizione, percentuale, natura").is("archiviato_il", null).order("percentuale", { ascending: false }),
  );
  return righe.map((a) => ({ ...a, percentuale: num(a.percentuale) }));
}

/* ------------------------------------------------------------------ */
/* Documenti                                                           */
/* ------------------------------------------------------------------ */
const normalizzaDocumento = (d: Documento): Documento => ({
  ...d,
  imponibile: num(d.imponibile), imposta: num(d.imposta), totale: num(d.totale),
  peso_kg: d.peso_kg == null ? null : Number(d.peso_kg),
});

const normalizzaRiga = (r: Riga): Riga => ({
  ...r,
  quantita: num(r.quantita), prezzo_unitario: num(r.prezzo_unitario), sconto_pct: num(r.sconto_pct), importo: num(r.importo),
});

export async function elencoDocumenti(tipo: TipoDocumento, limite = 300): Promise<Documento[]> {
  const righe = esito<Documento[]>(
    await db.from("gest_documenti").select("*").eq("tipo", tipo)
      .order("data", { ascending: false }).order("created_at", { ascending: false }).limit(limite),
  );
  // Le bozze scartate (annullate senza aver mai avuto un numero) restano in archivio ma non in elenco.
  return righe.filter((d) => !(d.stato === "annullato" && d.numero == null)).map(normalizzaDocumento);
}

export async function leggiDocumento(id: string): Promise<{ documento: Documento; righe: Riga[]; iva: RiepilogoIva[] }> {
  const [doc, righe, iva] = await Promise.all([
    db.from("gest_documenti").select("*").eq("id", id).single(),
    db.from("gest_documenti_righe").select("*").eq("documento_id", id).order("posizione").order("created_at"),
    db.from("gest_documenti_iva").select("*").eq("documento_id", id).order("percentuale", { ascending: false }),
  ]);
  return {
    documento: normalizzaDocumento(esito<Documento>(doc)),
    righe: esito<Riga[]>(righe).map(normalizzaRiga),
    iva: esito<RiepilogoIva[]>(iva).map((r) => ({ ...r, percentuale: num(r.percentuale), imponibile: num(r.imponibile), imposta: num(r.imposta) })),
  };
}

export async function creaDocumento(tipo: TipoDocumento): Promise<string> {
  const d = esito<{ id: string }>(await db.from("gest_documenti").insert({ tipo }).select("id").single());
  return d.id;
}

/**
 * Salva testata e righe di una bozza: aggiorna le righe esistenti, inserisce le nuove,
 * elimina quelle tolte. L'ordine delle righe diventa la loro posizione.
 */
export async function salvaBozza(id: string, testata: Testata, righe: RigaBozza[], idRigheEsistenti: string[]): Promise<void> {
  esito(await db.from("gest_documenti").update(testata).eq("id", id));

  const tenute = new Set(righe.map((r) => r.id).filter((x): x is string => !!x));
  const daEliminare = idRigheEsistenti.filter((x) => !tenute.has(x));
  if (daEliminare.length > 0) {
    esito(await db.from("gest_documenti_righe").delete().in("id", daEliminare));
  }

  for (let i = 0; i < righe.length; i++) {
    const { id: rigaId, ...campi } = righe[i];
    const valori = { ...campi, posizione: i + 1 };
    if (rigaId) {
      esito(await db.from("gest_documenti_righe").update(valori).eq("id", rigaId));
    } else {
      esito(await db.from("gest_documenti_righe").insert({ ...valori, documento_id: id }));
    }
  }
}

export async function confermaDocumento(id: string): Promise<Documento> {
  return normalizzaDocumento(esito<Documento>(await db.rpc("gest_conferma_documento", { _documento_id: id })));
}

export async function annullaDocumento(id: string, motivo: string | null): Promise<void> {
  esito(await db.rpc("gest_annulla_documento", { _documento_id: id, _motivo: motivo }));
}

/** Crea una nuova bozza dal documento confermato e ne restituisce l'id. */
export async function trasformaDocumento(origineId: string, tipo: TipoDocumento): Promise<string> {
  return esito<string>(await db.rpc("gest_deriva_documento", { _origine_id: origineId, _tipo: tipo }));
}

export async function documentiCollegati(id: string): Promise<Documento[]> {
  const righe = esito<Documento[]>(await db.from("gest_documenti").select("*").eq("origine_id", id).order("created_at"));
  return righe.map(normalizzaDocumento);
}
