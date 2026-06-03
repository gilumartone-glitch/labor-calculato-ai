export type ProdDept =
  | "grafica"
  | "stampa"
  | "taglio"
  | "tappezzeria"
  | "stampa_3d"
  | "falegnameria"
  | "assemblaggio"
  | "magazzino"
  | "acquisti"
  | "altro";

export type AppSettore =
  | "grafica" | "stampa" | "taglio" | "tappezzeria" | "stampa_3d" | "falegnameria"
  | "amministrazione" | "logistica" | "magazzino" | "acquisti" | "altro";

export const SETTORE_LABEL: Record<AppSettore, string> = {
  grafica: "Grafica",
  stampa: "Stampa",
  taglio: "Taglio",
  tappezzeria: "Tappezzeria",
  stampa_3d: "Stampa 3D",
  falegnameria: "Falegnameria",
  amministrazione: "Amministrazione",
  logistica: "Logistica",
  magazzino: "Magazzino",
  acquisti: "Acquisti",
  altro: "Altro",
};

export const ALL_SETTORI: AppSettore[] = [
  "grafica", "stampa", "taglio", "tappezzeria", "stampa_3d", "falegnameria",
  "amministrazione", "logistica", "magazzino", "acquisti", "altro",
];
export type ProdPriority = "normale" | "urgente" | "bloccante";
export type ProdDelivery = "spedizione" | "ritiro" | "mezzo_proprio" | "corriere";
export type ProdOrderStatus = "nuovo" | "in_corso" | "pronto" | "spedito" | "chiuso" | "annullato";
export type ProdSubStatus = "in_attesa" | "in_lavorazione" | "completato" | "bloccato" | "rimandato";
export type InvKind = "nuovo" | "sfrido";
export type NotifType =
  | "ordine_creato" | "subordine_assegnato" | "subordine_completato"
  | "ordine_pronto" | "ordine_chiuso" | "stock_basso" | "chat_messaggio" | "priorita_cambiata"
  | "subordine_rimandato" | "ordine_rimandato" | "magazzino_da_preparare";

export const DELIVERY_LABEL: Record<ProdDelivery, string> = {
  ritiro: "Ritiro cliente",
  mezzo_proprio: "Mezzo proprio",
  corriere: "Corriere",
  spedizione: "Spedizione",
};

/** Le consegne che passano dallo step Logistica (tutte tranne ritiro cliente). */
export const DELIVERY_NEEDS_LOGISTICA: ProdDelivery[] = ["spedizione", "mezzo_proprio", "corriere"];

export type Attachment = { name: string; type: string };

export type ProdOrder = {
  id: string;
  code: string;
  cliente: string;
  data: string;
  note: string | null;
  priorita: ProdPriority;
  delivery: ProdDelivery;
  status: ProdOrderStatus;
  attachments: Attachment[];
  nesting_included: boolean;
  ddt_number: string | null;
  ddt_date: string | null;
  ddt_causale: string | null;
  ddt_note: string | null;
  corriere: string | null;
  spedizione_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Snapshot del preventivo (pezzi, materiali, catalog). Null se l'ordine è stato creato manualmente. */
  snapshot: any | null;
  /** Nome del progetto/film del cliente (Prod.) */
  production_name?: string | null;
  /** Riferimento ordine cliente (free-text, es. PO-12345) */
  customer_order_ref?: string | null;
};

export type ProdOrderStatusForAcquisti = "da_ordinare" | "ordinato" | "in_transito" | "arrivato";

export const ORDER_STATUS_LABEL_ACQUISTI: Record<ProdOrderStatusForAcquisti, string> = {
  da_ordinare: "Da ordinare",
  ordinato: "Ordinato",
  in_transito: "In transito",
  arrivato: "Arrivato",
};

export type ProdSubOrder = {
  id: string;
  order_id: string;
  code: string;
  dept: ProdDept;
  status: ProdSubStatus;
  ordine: number;
  note: string | null;
  files: Attachment[];
  depends_on: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  rejection_reason?: string | null;
  rejected_to?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  /** Per i sub di reparto 'acquisti': nome fornitore. */
  supplier_name?: string | null;
  /** Operatore assegnato a questa lavorazione. */
  assignee_id?: string | null;
  // Campi acquisti — popolati solo quando dept === 'acquisti'
  material_qty?: number | null;
  material_unit?: string | null;
  material_code?: string | null;
  material_label?: string | null;
  due_date?: string | null;
  order_status?: ProdOrderStatusForAcquisti | null;
};

export type InvItem = {
  id: string;
  code: string;
  kind: InvKind;
  nome: string;
  descrizione: string | null;
  qty_intera: number;
  qty_sfrido: number;
  um: string;
  posizione: string | null;
  soglia_minima: number;
  note: string | null;
  reparto: string;
  material_key: string | null;
  material_name: string | null;
  material_color: string | null;
  material_height: string | null;
  material_attrs: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export type InvDept = "tappezzeria" | "stampa" | "falegnameria" | "generale";
export const INV_DEPT_LABEL: Record<InvDept, string> = {
  tappezzeria: "Tappezzeria",
  stampa: "Laboratorio",
  falegnameria: "Falegnameria",
  generale: "Generale",
};

export type ProdNotification = {
  id: string;
  user_id: string;
  type: NotifType;
  message: string;
  order_id: string | null;
  link: string | null;
  is_urgent: boolean;
  read_at: string | null;
  created_at: string;
};

export type AuditEntry = {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  detail: string | null;
  prev_state: any;
  new_state: any;
  created_at: string;
};

export type ScrapPieceStatus = "libero" | "riservato" | "usato";

export type ScrapPiece = {
  id: string;
  inventory_id: string;
  code: string;
  w_mm: number;
  h_mm: number;
  thickness_mm: number | null;
  posizione: string | null;
  note: string | null;
  status: ScrapPieceStatus;
  reserved_for_order: string | null;
  reserved_for_sub: string | null;
  created_at: string;
  updated_at: string;
};

export const SCRAP_STATUS_LABEL: Record<ScrapPieceStatus, string> = {
  libero: "Libero",
  riservato: "Riservato",
  usato: "Usato",
};

export const DEPT_LABEL: Record<ProdDept, string> = {
  grafica: "Grafica",
  stampa: "Stampa",
  taglio: "Taglio",
  tappezzeria: "Tappezzeria",
  stampa_3d: "Stampa 3D",
  falegnameria: "Falegnameria",
  assemblaggio: "Assemblaggio",
  magazzino: "Magazzino",
  acquisti: "Acquisti",
  altro: "Altro",
};

export const PRIORITY_LABEL: Record<ProdPriority, string> = {
  normale: "Normale",
  urgente: "Urgente",
  bloccante: "Bloccante",
};

export const ORDER_STATUS_LABEL: Record<ProdOrderStatus, string> = {
  nuovo: "Nuovo",
  in_corso: "In corso",
  pronto: "Pronto",
  spedito: "Spedito",
  chiuso: "Chiuso",
  annullato: "Annullato",
};

export const SUB_STATUS_LABEL: Record<ProdSubStatus, string> = {
  in_attesa: "In attesa",
  in_lavorazione: "In lavorazione",
  completato: "Completato",
  bloccato: "Bloccato",
  rimandato: "In revisione",
};

export const SUB_DEPT_SUFFIX: Record<ProdDept, string> = {
  grafica: "G",
  stampa: "S",
  taglio: "T",
  tappezzeria: "P",
  stampa_3d: "3",
  falegnameria: "F",
  assemblaggio: "A",
  magazzino: "M",
  acquisti: "Q",
  altro: "X",
};