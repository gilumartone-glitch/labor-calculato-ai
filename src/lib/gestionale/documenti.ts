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
  ordine: "Conferma d'ordine / Proforma",
  ddt: "DDT",
  fattura: "Fattura",
  nota_credito: "Nota di credito",
  bolla_carico: "Bolla di carico",
  fattura_fornitore: "Fattura fornitore",
};

export const TIPO_LABEL_PLURALE: Record<TipoDocumento, string> = {
  preventivo: "Preventivi",
  ordine: "Conferme d'ordine / Proforma",
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
  codice_pagamento: string | null;
  senza_partita_iva: boolean;
  banca_appoggio: string | null;
  abi: string | null;
  cab: string | null;
  banca_presentazione: string | null;
  codice_iva_esenzione: string | null;
  fido: number | null;
  /** Esigibilità IVA abituale: I immediata, D differita, S scissione dei pagamenti */
  esigibilita_iva: "I" | "D" | "S";
  codice_mexal: string | null;
  /** Sistema di provenienza della scheda (es. "mexal") e copia fedele dei suoi campi originali. */
  origine: string | null;
  dati_origine: Record<string, string> | null;
  importato_il: string | null;
  note: string | null;
  archiviato_il: string | null;
};

export type DatiAnagrafica = Omit<Anagrafica,
  "id" | "codice" | "archiviato_il" | "codice_mexal" | "origine" | "dati_origine" | "importato_il">;

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
  condizione_pagamento_id: string | null;
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
  cig: string | null;
  cup: string | null;
  esigibilita_iva: "I" | "D" | "S";
  bollo_virtuale: boolean;
  /** Nome dello spettacolo o della produzione */
  produzione: string | null;
  /** Fattura che accompagna la merce: scarica il magazzino come un DDT */
  accompagnatoria: boolean;
  /** Conferma d'ordine: materiale impegnato liberato a mano */
  impegno_chiuso_il: string | null;
  imponibile: number;
  imposta: number;
  totale: number;
  motivo_annullamento: string | null;
  created_at: string;
};

/** Campi di testata modificabili finché il documento è in bozza. */
export type Testata = Pick<Documento,
  "data" | "anagrafica_id" | "oggetto" | "riferimento_esterno" | "data_esterna" | "pagamento" | "condizione_pagamento_id" | "validita_giorni"
  | "consegna_prevista" | "destinazione" | "causale_trasporto" | "aspetto_beni" | "colli" | "peso_kg" | "vettore"
  | "porto" | "note" | "note_interne" | "cig" | "cup" | "esigibilita_iva" | "bollo_virtuale" | "produzione" | "accompagnatoria">;

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

/**
 * Dettaglio pezze di una riga di tessuto.
 * Bolla di carico: le pezze arrivate (bagno, metri, posizione). DDT: le pezze da cui si taglia.
 */
export type PezzaRiga = {
  pezza_id: string | null;
  /** Codice della pezza, quando esiste già (DDT, o bolla confermata). */
  pezza_codice?: string | null;
  codice_bagno: string | null;
  posizione: string | null;
  metri: number;
};

/** Riga in modifica: senza id finché non è salvata. */
export type RigaBozza = Omit<Riga, "id" | "documento_id" | "posizione" | "importo"> & { id?: string; pezze?: PezzaRiga[] };

/** Documenti che alla conferma generano le scadenze di incasso o pagamento. */
export const generaScadenze = (t: TipoDocumento) => t === "fattura" || t === "nota_credito" || t === "fattura_fornitore";

/** Documenti che muovono il magazzino alla conferma. */
export const muoveMagazzino = (t: TipoDocumento, accompagnatoria = false) =>
  t === "bolla_carico" || t === "ddt" || (t === "fattura" && accompagnatoria);

/** Un documento da cui discende quello che si sta guardando. */
export type PassoPercorso = { id: string; tipo: TipoDocumento; numero: number | null; anno: number | null; serie: string; data: string; stato: StatoDocumento };

const NOME_NEL_PERCORSO: Record<TipoDocumento, string> = {
  preventivo: "Preventivo", ordine: "Conferma d'ordine", ddt: "DDT", fattura: "Fattura", nota_credito: "Nota di credito",
  bolla_carico: "Bolla di carico", fattura_fornitore: "Fattura fornitore",
};
const dataItaliana = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** "12/2026", oppure "12/A/2026" con la serie. */
export const numeroDocumento = (d: Pick<PassoPercorso, "numero" | "anno" | "serie">): string =>
  d.numero == null ? "bozza" : `${d.numero}${d.serie ? `/${d.serie}` : ""}/${d.anno}`;

/** "Preventivo n. 45/2026 del 12/11/2026 - Conferma d'ordine n. 12/2026 del 15/11/2026" */
export const testoPercorso = (passi: PassoPercorso[]): string =>
  passi.filter((p) => p.numero != null)
    .map((p) => `${NOME_NEL_PERCORSO[p.tipo]} n. ${numeroDocumento(p)} del ${dataItaliana(p.data)}`).join(" - ");

export const sommaPezze = (pezze: PezzaRiga[] | undefined): number =>
  Math.round(((pezze ?? []).reduce((s, p) => s + (Number(p.metri) || 0), 0) + Number.EPSILON) * 100) / 100;

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
const PAGINA = 1000;

/** Tutte le anagrafiche attive. Legge a pagine: il database restituisce al massimo 1000 righe per richiesta. */
export async function elencoAnagrafiche(): Promise<Anagrafica[]> {
  const tutte: Anagrafica[] = [];
  for (let da = 0; ; da += PAGINA) {
    const pagina = esito<Anagrafica[]>(
      await db.from("gest_anagrafiche").select("*").is("archiviato_il", null)
        .order("ragione_sociale").order("id").range(da, da + PAGINA - 1),
    );
    tutte.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return tutte.map((a) => ({ ...a, fido: a.fido == null ? null : Number(a.fido) }));
}

/**
 * Importa (o aggiorna) le schede arrivate da un altro sistema, a blocchi.
 * La chiave è il codice conto di provenienza: reimportare lo stesso file aggiorna, non duplica.
 */
export async function importaAnagrafiche(
  schede: Array<Record<string, unknown> & { codice_mexal: string }>,
  avanzamento?: (fatte: number, totale: number) => void,
): Promise<number> {
  const BLOCCO = 200;
  let fatte = 0;
  for (let i = 0; i < schede.length; i += BLOCCO) {
    const blocco = schede.slice(i, i + BLOCCO);
    esito(await db.from("gest_anagrafiche").upsert(blocco, { onConflict: "codice_mexal" }));
    fatte += blocco.length;
    avanzamento?.(fatte, schede.length);
  }
  return fatte;
}

/** Quante schede attive arrivano da un dato sistema di provenienza. */
export async function contaAnagraficheImportate(origine: string): Promise<number> {
  const res = await db.from("gest_anagrafiche").select("id", { count: "exact", head: true }).eq("origine", origine);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
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

export async function leggiDocumento(id: string): Promise<{ documento: Documento; righe: Array<Riga & { pezze?: PezzaRiga[] }>; iva: RiepilogoIva[] }> {
  const [doc, righe, iva] = await Promise.all([
    db.from("gest_documenti").select("*").eq("id", id).single(),
    db.from("gest_documenti_righe").select("*").eq("documento_id", id).order("posizione").order("created_at"),
    db.from("gest_documenti_iva").select("*").eq("documento_id", id).order("percentuale", { ascending: false }),
  ]);
  const righeDoc = esito<Riga[]>(righe).map(normalizzaRiga);
  const pezzePerRiga = new Map<string, PezzaRiga[]>();
  if (righeDoc.length > 0) {
    type RigaPezzaDb = { riga_id: string; pezza_id: string | null; codice_bagno: string | null; posizione: string | null; metri: number; pezza: { codice: string } | null };
    const dettaglio = esito<RigaPezzaDb[]>(
      await db.from("gest_documenti_righe_pezze").select("riga_id, pezza_id, codice_bagno, posizione, metri, pezza:gest_pezze(codice)")
        .in("riga_id", righeDoc.map((r) => r.id)).order("ordine").order("created_at"),
    );
    for (const p of dettaglio) {
      const elenco = pezzePerRiga.get(p.riga_id) ?? [];
      elenco.push({ pezza_id: p.pezza_id, pezza_codice: p.pezza?.codice ?? null, codice_bagno: p.codice_bagno, posizione: p.posizione, metri: num(p.metri) });
      pezzePerRiga.set(p.riga_id, elenco);
    }
  }
  return {
    documento: normalizzaDocumento(esito<Documento>(doc)),
    righe: righeDoc.map((r) => (pezzePerRiga.has(r.id) ? { ...r, pezze: pezzePerRiga.get(r.id) } : r)),
    iva: esito<RiepilogoIva[]>(iva).map((r) => ({ ...r, percentuale: num(r.percentuale), imponibile: num(r.imponibile), imposta: num(r.imposta) })),
  };
}

export async function creaDocumento(
  tipo: TipoDocumento,
  iniziale: { oggetto?: string | null; design_draft_id?: string | null } = {},
): Promise<string> {
  const d = esito<{ id: string }>(await db.from("gest_documenti").insert({ tipo, ...iniziale }).select("id").single());
  return d.id;
}

/**
 * Salva testata e righe di una bozza: aggiorna le righe esistenti, inserisce le nuove,
 * elimina quelle tolte. L'ordine delle righe diventa la loro posizione.
 */
export async function salvaBozza(id: string, testata: Partial<Testata>, righe: RigaBozza[], idRigheEsistenti: string[]): Promise<void> {
  if (Object.keys(testata).length > 0) {
    esito(await db.from("gest_documenti").update(testata).eq("id", id));
  }

  const tenute = new Set(righe.map((r) => r.id).filter((x): x is string => !!x));
  const daEliminare = idRigheEsistenti.filter((x) => !tenute.has(x));
  if (daEliminare.length > 0) {
    esito(await db.from("gest_documenti_righe").delete().in("id", daEliminare));
  }

  for (let i = 0; i < righe.length; i++) {
    const { id: rigaEsistente, pezze, ...campi } = righe[i];
    const valori = { ...campi, posizione: i + 1 };
    let rigaId = rigaEsistente;
    if (rigaId) {
      esito(await db.from("gest_documenti_righe").update(valori).eq("id", rigaId));
    } else {
      rigaId = esito<{ id: string }>(
        await db.from("gest_documenti_righe").insert({ ...valori, documento_id: id }).select("id").single(),
      ).id;
    }
    // Dettaglio pezze: si riscrive per intero. `undefined` = la riga non lo gestisce, non si tocca.
    if (pezze !== undefined) {
      esito(await db.from("gest_documenti_righe_pezze").delete().eq("riga_id", rigaId));
      const valide = pezze.filter((p) => (Number(p.metri) || 0) > 0);
      if (valide.length > 0) {
        esito(await db.from("gest_documenti_righe_pezze").insert(valide.map((p, ordine) => ({
          riga_id: rigaId, pezza_id: p.pezza_id, codice_bagno: p.codice_bagno, posizione: p.posizione, metri: p.metri, ordine: ordine + 1,
        }))));
      }
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

/** I documenti da cui discende un documento, dal più vecchio al più recente. */
export async function percorsoDocumento(id: string): Promise<PassoPercorso[]> {
  return esito<PassoPercorso[]>(await db.rpc("gest_percorso_documento", { _documento_id: id })) ?? [];
}

/** Libera a mano (o rimette) il materiale impegnato da una conferma d'ordine. */
export async function chiudiImpegno(id: string, chiudi: boolean): Promise<void> {
  esito(await db.rpc("gest_chiudi_impegno", { _documento_id: id, _chiudi: chiudi }));
}

export async function documentiCollegati(id: string): Promise<Documento[]> {
  const righe = esito<Documento[]>(await db.from("gest_documenti").select("*").eq("origine_id", id).order("created_at"));
  return righe.map(normalizzaDocumento);
}
