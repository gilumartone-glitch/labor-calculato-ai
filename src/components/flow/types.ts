export type CommessaStato = "da_fare" | "preventivo" | "in_produzione" | "pronto" | "consegnato";
export type CommessaPriorita = "bassa" | "media" | "alta";
export type CommessaTipo = "commessa" | "task";
export type CommessaReparto = "tappezzeria" | "stampa" | "falegnameria" | "amministrazione" | "acquisti" | "logistica" | "generale" | "progettazione" | "lavorazione" | "vendite";

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  settori?: string[];
};

export type Commessa = {
  id: string;
  titolo: string;
  descrizione: string | null;
  cliente: string | null;
  importo: number | null;
  data_scadenza: string | null;
  reparto: CommessaReparto;
  priorita: CommessaPriorita;
  stato: CommessaStato;
  tipo: CommessaTipo;
  note: string | null;
  ordine: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Calcolato lato client unendo commessa_assegnatari */
  assegnatari?: Profile[];
};

export const STATI: { k: CommessaStato; label: string; sub: string }[] = [
  { k: "preventivo", label: "Preventivo", sub: "In quotazione" },
  { k: "da_fare", label: "Confermato", sub: "Pronto da iniziare" },
  { k: "in_produzione", label: "In produzione", sub: "Lavorazione attiva" },
  { k: "pronto", label: "Pronto", sub: "Pronto per consegna" },
  { k: "consegnato", label: "Consegnato", sub: "Chiuso" },
];

export const REPARTI: { k: CommessaReparto; label: string }[] = [
  { k: "progettazione", label: "Progettazione" },
  { k: "lavorazione", label: "Lavorazione" },
  { k: "tappezzeria", label: "→ Tappezzeria" },
  { k: "stampa", label: "→ Stampa" },
  { k: "falegnameria", label: "→ Falegnameria" },
  { k: "amministrazione", label: "Amministrazione" },
  { k: "acquisti", label: "Acquisti" },
  { k: "vendite", label: "Vendite" },
  { k: "logistica", label: "Logistica" },
  { k: "generale", label: "Generale" },
];

export const PRIORITA_LABEL: Record<CommessaPriorita, string> = {
  bassa: "Bassa",
  media: "Media",
  alta: "Alta",
};