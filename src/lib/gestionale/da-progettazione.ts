import { num } from "@/lib/format";
import type { Catalog, DepartmentState, DepartmentTotals, PieceLine, SubProject } from "@/components/calculator/types";
import { pieceTotal } from "@/lib/piece";
import type { CustomerType } from "@/lib/pricing";
import { getProductWorks } from "@/components/calculator/types";
import type { AliquotaIva, RigaBozza } from "./documenti";
import { chiavePezzo, dettagliScheda, misureScheda, schedaDaPezzo, type SchedaTecnica } from "./scheda-tecnica";
import { supabase } from "@/integrations/supabase/client";
import { confermaDocumento, creaDocumento, salvaBozza, type Anagrafica, type Documento, type Testata } from "./documenti";

/**
 * Riepilogo di una scheda di Progettazione, così come lo mostra il «Riepilogo generale»:
 * stessi dati che alimentano la stampa del preventivo cliente.
 */
/** Un prodotto venduto a magazzino: nome, caratteristiche (variante), unità di misura, quantità e prezzo all'unità. */
export type VoceVendita = { nome: string; variante: string | null; um: string | null; quantita: number; prezzo: number };

export type RiepilogoProgetto = {
  jobName: string;
  quantity: number;
  margin: number;
  vat: number;
  applyVat: boolean;
  /** `catalog`: il listino del reparto, per i nomi e i colori delle lavorazioni nel disegno */
  departments: { key: string; label: string; totals: DepartmentTotals; state?: DepartmentState; catalog?: Catalog; /** listino applicato al reparto: rivenditore o cliente finale */ customer?: CustomerType; /** reparto Vendite: i prodotti venduti, con il prezzo all'unità di misura (prima del margine) */ vendite?: VoceVendita[] }[];
  subProjects?: SubProject[];
  deptMargins?: Record<string, number>;
};

export type PreventivoDaProgetto = {
  oggetto: string | null;
  righe: RigaBozza[];
  /** Imponibile atteso: coincide al centesimo con il «netto» del Riepilogo generale. */
  netto: number;
  /** Aliquota non trovata tra quelle del Gestionale: le righe restano senza IVA e va scelta a mano. */
  aliquotaMancante: number | null;
};

const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const arrotonda4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Peso del pezzo per ripartire il totale pezzi del reparto: il suo prezzo di listino; se non si riesce a calcolare, le copie. */
function pesoPezzo(pezzo: PieceLine, listino: Catalog | undefined, cliente: CustomerType | undefined): number {
  try {
    const v = listino ? pieceTotal(pezzo, listino, cliente) : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

type Voce = { descrizione: string; dettagli: string | null; um: string | null; quantita: number; costo: number; conMargine: boolean; tipo: "lavorazione" | "libera"; schede?: SchedaTecnica[] };

/**
 * Le voci di un reparto, una per una: ogni pezzo (i pezzi identici si sommano), ogni materiale,
 * ogni lavorazione, ogni trasporto. I costi dei pezzi sono la ripartizione del totale pezzi del reparto
 * in proporzione al prezzo di ciascuno, così la somma resta quella di Progettazione.
 */
function vociReparto(d: RiepilogoProgetto["departments"][number]): Voce[] {
  const st = d.state;
  const voci: Voce[] = [];
  // Vendite: una riga per prodotto, con le sue caratteristiche e il prezzo all'unità di misura
  for (const v of d.vendite ?? []) {
    if (!(v.quantita > 0)) continue;
    voci.push({ descrizione: v.nome.trim() || "Vendita", dettagli: v.variante?.trim() || null, um: v.um?.trim() || null, quantita: v.quantita, costo: v.quantita * (Number(v.prezzo) || 0), conMargine: true, tipo: "libera" });
  }
  if (!st) return voci;

  const pezzi = st.pieces ?? [];
  const totalePezzi = Number(d.totals.pieces) || 0;
  if (pezzi.length > 0 && totalePezzi > 0) {
    const copie = (p: PieceLine) => (Number(p.quantity) > 0 ? Number(p.quantity) : 1);
    let pesi = pezzi.map((p) => pesoPezzo(p, d.catalog, d.customer));
    if (pesi.some((x) => x <= 0)) pesi = pezzi.map(copie);
    const somma = pesi.reduce((a, x) => a + x, 0);
    const uniti = new Map<string, Voce>();
    pezzi.forEach((p, i) => {
      const scheda = schedaDaPezzo(p, d.label, d.catalog);
      const chiave = chiavePezzo(scheda);
      const costo = totalePezzi * pesi[i] / somma;
      const gia = uniti.get(chiave);
      if (gia) {
        // stesso pezzo: una riga sola, con le copie sommate
        gia.quantita += scheda.quantita; gia.costo += costo;
        gia.schede = [{ ...gia.schede![0], quantita: gia.quantita }];
      } else {
        uniti.set(chiave, {
          descrizione: `${scheda.titolo} — ${misureScheda(scheda)}`, dettagli: dettagliScheda(scheda).join("\n") || null,
          um: "pz", quantita: scheda.quantita, costo, conMargine: true, tipo: "lavorazione", schede: [scheda],
        });
      }
    });
    voci.push(...uniti.values());
  }
  for (const m of st.materials ?? []) {
    const costo = m.quantity * m.unitCost;
    if (costo <= 0) continue;
    const specifiche = [m.color ? `Colore ${m.color}` : "", m.fireproof ? `Ignifugo ${m.fireproof}` : ""].filter(Boolean).join(" · ");
    voci.push({ descrizione: m.name || "Materiale", dettagli: specifiche || null, um: m.unit || null, quantita: m.quantity, costo, conMargine: true, tipo: "libera" });
  }
  for (const op of st.operations ?? []) {
    const costo = op.quantity * op.rate;
    if (costo <= 0) continue;
    voci.push({ descrizione: op.name || "Lavorazione", dettagli: null, um: op.unit || (op.mode === "ora" ? "h" : null), quantita: op.quantity, costo, conMargine: true, tipo: "lavorazione" });
  }
  const perimetrali = Number(d.totals.perimeters) || 0;
  if (perimetrali > 0) voci.push({ descrizione: "Lavorazioni perimetrali", dettagli: null, um: null, quantita: 1, costo: perimetrali, conMargine: true, tipo: "lavorazione" });
  for (const t of st.transports ?? []) {
    const costo = t.quantity * t.unitCost;
    if (costo <= 0) continue;
    voci.push({ descrizione: t.description || "Trasporto", dettagli: null, um: null, quantita: t.quantity, costo, conMargine: false, tipo: "libera" });
  }
  return voci;
}

/**
 * Trasforma il riepilogo di Progettazione nelle righe di un preventivo del Gestionale, voce per voce:
 * una riga per ogni pezzo (i pezzi identici si sommano), per ogni materiale, lavorazione e trasporto,
 * con il margine del reparto già dentro il prezzo. Ogni pezzo porta la sua scheda tecnica (disegno e lavorazioni).
 * La somma delle righe coincide al centesimo con il netto mostrato in Progettazione.
 */
export function preventivoDaProgettazione(input: RiepilogoProgetto, aliquote: AliquotaIva[]): PreventivoDaProgetto {
  const aliquota = input.applyVat ? aliquote.find((a) => a.percentuale === input.vat) ?? null : null;
  const aliquotaId = aliquota?.id ?? null;
  const margineDi = (k: string) => input.deptMargins?.[k] ?? input.margin;

  const righe: RigaBozza[] = [];
  let nettoEsatto = 0;

  /** `prezzo` è il totale della riga; con più unità diventa prezzo cadauno. */
  const aggiungi = (v: { descrizione: string; dettagli: string | null; prezzo: number; quantita?: number; um?: string | null; tipo?: "lavorazione" | "libera"; schede?: SchedaTecnica[] }) => {
    nettoEsatto += v.prezzo;
    const quantita = v.quantita && v.quantita > 0 ? v.quantita : 1;
    righe.push({
      tipo_riga: v.tipo ?? "lavorazione", variante_id: null, codice: null, descrizione: v.descrizione, dettagli: v.dettagli, um: v.um ?? null,
      quantita, prezzo_unitario: quantita === 1 ? arrotonda2(v.prezzo) : arrotonda4(v.prezzo / quantita), sconto_pct: 0, aliquota_id: aliquotaId,
      ...(v.schede && v.schede.length > 0 ? { schede_tecniche: v.schede } : {}),
    });
  };
  const nota = (descrizione: string) => righe.push({
    tipo_riga: "nota", variante_id: null, codice: null, descrizione, dettagli: null, um: null, quantita: 0, prezzo_unitario: 0, sconto_pct: 0, aliquota_id: null,
  });

  const reparti = input.departments.filter((d) => d.totals.total > 0);
  for (const d of reparti) {
    const m = margineDi(d.key) / 100;
    // prezzo del reparto come lo calcola il Riepilogo generale: il margine non si applica ai trasporti
    const prezzoReparto = d.totals.total + Math.max(0, d.totals.total - (d.totals.transports ?? 0)) * m;
    const voci = vociReparto(d);
    if (reparti.length > 1 && voci.length > 0) nota(d.label.toUpperCase());
    let assegnato = 0;
    for (const v of voci) {
      const prezzo = v.costo * (v.conMargine ? 1 + m : 1);
      assegnato += prezzo;
      aggiungi({ descrizione: v.descrizione, dettagli: v.dettagli, prezzo, quantita: v.quantita, um: v.um, tipo: v.tipo, schede: v.schede });
    }
    // quello che il reparto conteggia e che non è una voce elencabile (o tutto il reparto, se non c'è il dettaglio)
    const resto = prezzoReparto - assegnato;
    if (Math.abs(resto) >= 0.005) aggiungi({ descrizione: voci.length === 0 ? d.label : `${d.label} — ${resto > 0 ? "altre voci" : "conguaglio"}`, dettagli: null, prezzo: resto });
  }

  for (const sp of input.subProjects ?? []) {
    for (const w of getProductWorks(sp)) {
      const ore = Number(w.hours) || 0;
      const costo = ore * (Number(w.hourlyCost) || 0);
      if (costo <= 0) continue;
      aggiungi({ descrizione: `${sp.name} — ${w.name || "Lavorazione"}`, dettagli: `${num(ore, 1)} h`, prezzo: costo * (1 + input.margin / 100) });
    }
  }

  // Gli arrotondamenti riga per riga possono spostare il totale di qualche centesimo:
  // la differenza va su una riga a quantità 1 (o, se non ce n'è, su una riga di arrotondamento),
  // così l'imponibile è quello di Progettazione.
  const netto = arrotonda2(nettoEsatto);
  const importo = (r: RigaBozza) => (r.tipo_riga === "nota" ? 0 : arrotonda2(r.quantita * r.prezzo_unitario));
  const scarto = arrotonda2(netto - righe.reduce((s, r) => s + importo(r), 0));
  if (scarto !== 0) {
    const singola = [...righe].reverse().find((r) => r.tipo_riga !== "nota" && r.quantita === 1 && r.prezzo_unitario + scarto > 0);
    if (singola) singola.prezzo_unitario = arrotonda2(singola.prezzo_unitario + scarto);
    else righe.push({ tipo_riga: "libera", variante_id: null, codice: null, descrizione: "Arrotondamento", dettagli: null, um: null, quantita: 1, prezzo_unitario: scarto, sconto_pct: 0, aliquota_id: aliquotaId });
  }

  if (input.quantity > 1 && righe.length > 0) {
    nota(`Quantità: ${input.quantity} pz — prezzo cadauno ${num(netto / input.quantity, 2)} € + IVA`);
  }

  return {
    oggetto: input.jobName.trim() || null,
    righe,
    netto,
    aliquotaMancante: input.applyVat && !aliquota ? input.vat : null,
  };
}

/* ------------------------------------------------------------------ */
/* Dalla scheda al preventivo numerato                                  */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Quello che il cliente porta sul documento, come quando lo si sceglie nell'editor del Gestionale. */
export function testataDaCliente(a: Pick<Anagrafica, "id" | "pagamento" | "esigibilita_iva" | "ordine_cliente_tipo"> & { condizione_pagamento_id?: string | null }): Partial<Testata> {
  return {
    anagrafica_id: a.id, pagamento: a.pagamento ?? null, condizione_pagamento_id: a.condizione_pagamento_id ?? null,
    esigibilita_iva: a.esigibilita_iva ?? "I", ordine_cliente_tipo: a.ordine_cliente_tipo ?? null,
  };
}

export type PreventivoScheda = Pick<Documento, "id" | "numero" | "anno" | "serie" | "data" | "stato" | "imponibile" | "anagrafica_id"> & { ragione_sociale: string | null };

/** I preventivi già nati da questa scheda (non quelli annullati), dal più recente. */
export async function preventiviDellaScheda(draftId: string | null): Promise<PreventivoScheda[]> {
  if (!draftId) return [];
  const { data, error } = await db.from("gest_documenti")
    .select("id, numero, anno, serie, data, stato, imponibile, anagrafica_id, anagrafica:gest_anagrafiche(ragione_sociale)")
    .eq("design_draft_id", draftId).eq("tipo", "preventivo").neq("stato", "annullato").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Array<Omit<PreventivoScheda, "ragione_sociale"> & { anagrafica: { ragione_sociale: string } | null }>)
    .map(({ anagrafica, ...d }) => ({ ...d, imponibile: Number(d.imponibile) || 0, ragione_sociale: anagrafica?.ragione_sociale ?? null }));
}

export type RichiestaPreventivo = {
  preventivo: PreventivoDaProgetto; draftId: string | null;
  cliente: (Pick<Anagrafica, "id" | "pagamento" | "esigibilita_iva" | "ordine_cliente_tipo"> & { condizione_pagamento_id?: string | null }) | null;
  produzione: string; validitaGiorni: number | null;
};

const testataRichiesta = (r: RichiestaPreventivo): Partial<Testata> => ({
  ...(r.cliente ? testataDaCliente(r.cliente) : {}),
  oggetto: r.preventivo.oggetto, produzione: r.produzione.trim() || null, validita_giorni: r.validitaGiorni,
});

/**
 * Crea il preventivo nel Gestionale dalla scheda. Con `conferma` gli dà subito il numero corrente
 * (serve il cliente): da lì è un preventivo ufficiale e si può inviare.
 * Se la conferma non riesce il preventivo resta in bozza e l'errore lo dice.
 */
export async function creaPreventivoDaScheda(r: RichiestaPreventivo, conferma: boolean): Promise<{ id: string; numero: number | null; anno: number | null; serie: string }> {
  if (r.preventivo.righe.length === 0) throw new Error("La scheda non ha ancora costi.");
  if (conferma && !r.cliente) throw new Error("Per dare il numero al preventivo scegli il cliente.");
  const id = await creaDocumento("preventivo", { oggetto: r.preventivo.oggetto, design_draft_id: r.draftId });
  await salvaBozza(id, testataRichiesta(r), r.preventivo.righe, []);
  if (!conferma) return { id, numero: null, anno: null, serie: "" };
  try {
    const d = await confermaDocumento(id);
    return { id, numero: d.numero, anno: d.anno, serie: d.serie };
  } catch (e) {
    throw new Error(`Il preventivo è stato creato in bozza ma non confermato: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Riporta su una bozza già creata i valori di adesso della scheda (righe e, se scelto, cliente). */
export async function aggiornaBozzaDaScheda(documentoId: string, r: RichiestaPreventivo): Promise<void> {
  if (r.preventivo.righe.length === 0) throw new Error("La scheda non ha ancora costi.");
  const { data: doc, error } = await db.from("gest_documenti").select("stato").eq("id", documentoId).single();
  if (error) throw new Error(error.message);
  if (doc.stato !== "bozza") throw new Error("Questo preventivo ha già il numero: non si riscrive. Creane uno nuovo.");
  const { data: righe, error: e2 } = await db.from("gest_documenti_righe").select("id").eq("documento_id", documentoId);
  if (e2) throw new Error(e2.message);
  await salvaBozza(documentoId, testataRichiesta(r), r.preventivo.righe, (righe as { id: string }[]).map((x) => x.id));
}

/** La scheda di Progettazione da cui è nato il documento esiste ancora ed è apribile? Restituisce il suo nome. */
export async function schedaProgettazione(draftId: string): Promise<{ nome: string } | null> {
  const { data, error } = await db.from("design_drafts").select("id, name, archived_at").eq("id", draftId).maybeSingle();
  if (error || !data || data.archived_at) return null;
  return { nome: (data.name as string | null)?.trim() || "Scheda senza nome" };
}
