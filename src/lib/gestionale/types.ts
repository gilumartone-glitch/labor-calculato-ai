export type Categoria = "tessuto" | "pannello" | "altro";
export type UnitaMisura = "m" | "m2" | "pz";

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  tessuto: "Tessuto",
  pannello: "Pannello",
  altro: "Altro",
};

export type Articolo = {
  id: string;
  codice: string;
  nome: string;
  categoria: Categoria;
  um: UnitaMisura;
  note: string | null;
  archiviato_il: string | null;
};

export type Variante = {
  id: string;
  articolo_id: string;
  codice: string;
  colore: string | null;
  ignifugo: boolean;
  classe_reazione: string | null;
  certificato_rif: string | null;
  altezza_cm: number | null;
  peso_gm2: number | null;
  spessore_mm: number | null;
  finitura: string | null;
  formato_larghezza_mm: number | null;
  formato_altezza_mm: number | null;
  costo_um: number | null;
  prezzo_um: number | null;
  inventory_item_id: string | null;
  note: string | null;
  archiviato_il: string | null;
};

export type NuovoArticolo = Pick<Articolo, "codice" | "nome" | "categoria" | "um"> & { note?: string | null };

export type NuovaVariante = Pick<Variante, "articolo_id" | "codice"> &
  Partial<Omit<Variante, "id" | "articolo_id" | "codice" | "archiviato_il">>;

/** giacenza: quanto c'è · impegnato: promesso da conferme d'ordine non ancora consegnate · disponibile: la differenza */
export type GiacenzaVariante = { variante_id: string; giacenza: number; impegnato: number; disponibile: number };

export type GiacenzaBagno = {
  variante_id: string;
  bagno_id: string | null;
  codice_bagno: string | null;
  pezze: number;
  metri: number;
  pezza_piu_lunga_m: number | null;
};

export type StatoPezza = "disponibile" | "esaurita" | "scarto";

export type PezzaGiacenza = {
  id: string;
  codice: string;
  variante_id: string;
  bagno_id: string | null;
  codice_bagno: string | null;
  posizione: string | null;
  stato: StatoPezza;
  lunghezza_iniziale_m: number;
  residuo_m: number;
  created_at: string;
};

export type TipoMovimento = "carico" | "scarico" | "taglio" | "rettifica" | "scarto" | "storno";

export type Movimento = {
  id: number;
  variante_id: string;
  pezza_id: string | null;
  sfrido_codice: string | null;
  tipo: TipoMovimento;
  quantita: number;
  riferimento_tipo: string | null;
  riferimento_id: string | null;
  storno_di: number | null;
  nota: string | null;
  utente: string | null;
  creato_il: string;
};

/** Descrizione leggibile di una variante: "nero · h 140 cm · 350 g/m² · ignifugo". */
export const descriviVariante = (v: Variante): string => {
  const parti: string[] = [];
  if (v.colore) parti.push(v.colore);
  if (v.altezza_cm != null) parti.push(`h ${v.altezza_cm} cm`);
  if (v.peso_gm2 != null) parti.push(`${v.peso_gm2} g/m²`);
  if (v.spessore_mm != null) parti.push(`${v.spessore_mm} mm`);
  if (v.finitura) parti.push(v.finitura);
  if (v.formato_larghezza_mm && v.formato_altezza_mm) parti.push(`${v.formato_larghezza_mm}×${v.formato_altezza_mm} mm`);
  if (v.ignifugo) parti.push(v.classe_reazione ? `ignifugo ${v.classe_reazione}` : "ignifugo");
  return parti.join(" · ");
};

/** Converte l'input di un campo numerico ("12,5") in numero, o null se vuoto/non valido. */
export const numeroOppureNull = (testo: string): number | null => {
  const pulito = testo.trim().replace(",", ".");
  if (pulito === "") return null;
  const n = Number(pulito);
  return Number.isFinite(n) ? n : null;
};
