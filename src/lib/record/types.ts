export type RecordType =
  | "pagamento_ricevuto"
  | "da_incassare"
  | "pagamento_fatto"
  | "da_pagare"
  | "promemoria"
  | "nota";

export type ContactKind = "cliente" | "fornitore" | "entrambi" | "altro";
export type RecordStatus = "aperto" | "chiuso";
export type RecordVisibility = "private" | "shared" | "all";

export type PersonalRecord = {
  id: string;
  owner_id: string;
  contact_name: string;
  contact_kind: ContactKind;
  record_type: RecordType;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string;
  due_date: string | null;
  event_at: string | null;
  status: RecordStatus;
  tags: string[];
  visibility: RecordVisibility;
  created_at: string;
  updated_at: string;
};

export type RecordShare = {
  record_id: string;
  shared_with: string;
  shared_by: string;
  created_at: string;
  read_at: string | null;
};

export const RECORD_TYPE_META: Record<RecordType, { label: string; sign: 1 | -1 | 0; monetary: boolean; tone: string }> = {
  pagamento_ricevuto: { label: "Pagamento ricevuto", sign: 1, monetary: true, tone: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  da_incassare:       { label: "Da incassare",        sign: 1, monetary: true, tone: "bg-amber-100 text-amber-900 border-amber-300" },
  pagamento_fatto:    { label: "Pagamento fatto",     sign: -1, monetary: true, tone: "bg-sky-100 text-sky-900 border-sky-300" },
  da_pagare:          { label: "Da pagare",           sign: -1, monetary: true, tone: "bg-rose-100 text-rose-900 border-rose-300" },
  promemoria:         { label: "Promemoria",          sign: 0, monetary: false, tone: "bg-violet-100 text-violet-900 border-violet-300" },
  nota:               { label: "Nota",                sign: 0, monetary: false, tone: "bg-zinc-100 text-zinc-900 border-zinc-300" },
};
