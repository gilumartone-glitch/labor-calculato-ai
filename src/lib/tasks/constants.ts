import {
  Building2, ShoppingCart, HandCoins, Megaphone, Users, ListChecks,
  LucideIcon,
} from "lucide-react";

export const TASK_CATEGORIES = [
  "amministrazione",
  "acquisti",
  "vendite",
  "marketing",
  "hr",
  "generico",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_CATEGORY_META: Record<TaskCategory, { label: string; icon: LucideIcon; color: string; bg: string; permKey: string }> = {
  amministrazione: { label: "Amministrazione", icon: Building2, color: "text-blue-700",   bg: "bg-blue-100",   permKey: "tasks_amministrazione" },
  acquisti:        { label: "Acquisti",        icon: ShoppingCart, color: "text-amber-700",  bg: "bg-amber-100",  permKey: "tasks_acquisti" },
  vendite:         { label: "Vendite",         icon: HandCoins,   color: "text-emerald-700",bg: "bg-emerald-100",permKey: "tasks_vendite" },
  marketing:       { label: "Marketing",       icon: Megaphone,   color: "text-pink-700",   bg: "bg-pink-100",   permKey: "tasks_marketing" },
  hr:              { label: "HR",              icon: Users,       color: "text-purple-700", bg: "bg-purple-100", permKey: "tasks_hr" },
  generico:        { label: "Generico",        icon: ListChecks,  color: "text-slate-700",  bg: "bg-slate-100",  permKey: "tasks_generico" },
};

export const TASK_STATUSES = ["da_fare","in_corso","in_attesa","bloccato","completato","annullato"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  da_fare: "Da fare",
  in_corso: "In corso",
  in_attesa: "In attesa",
  bloccato: "Bloccato",
  completato: "Completato",
  annullato: "Annullato",
};

export const TASK_PRIORITIES = ["bassa","media","alta","urgente"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_META: Record<TaskPriority, { label: string; className: string }> = {
  bassa:   { label: "Bassa",   className: "bg-slate-100 text-slate-700 border-slate-300" },
  media:   { label: "Media",   className: "bg-blue-100 text-blue-700 border-blue-300" },
  alta:    { label: "Alta",    className: "bg-amber-100 text-amber-800 border-amber-400" },
  urgente: { label: "Urgente", className: "bg-red-100 text-red-800 border-red-400" },
};
