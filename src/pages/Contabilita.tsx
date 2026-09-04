import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownCircle, ArrowUpCircle, CalendarClock, Check, ChevronRight, History, Landmark, Loader2, Pencil, Plus, Redo2, Search, Trash2, Undo2, Upload, X } from "lucide-react";
import { useConfirmShortcut } from "@/hooks/useConfirmShortcut";
import { StepDateInput } from "@/components/contabilita/StepDateInput";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AdminUsersLink } from "@/components/AdminUsersLink";
import { HubLink } from "@/components/HubLink";
import { eur, uid } from "@/lib/format";
import { ACCOUNTING_SEED_FIXED_EXPENSES, ACCOUNTING_SEED_MOVEMENTS } from "@/lib/accounting-seed";
import { ChartsView } from "@/components/contabilita/ChartsView";
import { FEBRUARY_2026_MOVEMENTS } from "@/lib/february-2026-seed";
import { MARCH_2026_MOVEMENTS } from "@/lib/march-2026-seed";
import { AnagraficaView } from "@/components/contabilita/AnagraficaView";
import { Contact, suggestContacts, normalizeText, movementMatchesContact } from "@/components/contabilita/contacts";
import { SnapshotsDialog } from "@/components/contabilita/SnapshotsDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { HoursLogView, type HoursLog, type HoursRow, type DaySegment, type DayType, getSegments } from "@/components/contabilita/HoursLogView";
import { fetchDipendenti, type Dipendente } from "@/lib/dipendenti";

type MovementType = "entrata" | "uscita";
type MovementStatus = "cassa" | "previsto";
type AccountingTab = "generale" | "mensile" | "movimenti" | "fisse" | "stipendi" | "grafici" | "anagrafica";
type StipendiSubTab = "stipendi" | "ore" | "contanti";

type CashMovement = {
  id: string;
  date: string;
  description: string;
  category: string;
  paymentMethod?: string;
  type: MovementType;
  status: MovementStatus;
  amount: number;
  /** Numero fattura associato al movimento (opzionale). */
  invoiceNumber?: string;
  /**
   * Acconto già incassato/pagato per un movimento in competenza.
   * Va in cassa per la quota indicata; il residuo (amount - acconto) resta in competenza.
   * Ignorato per movimenti già in cassa.
   */
  acconto?: number;
  /**
   * Se true, la voce è "gestita per acconti": espone il campo Acconto
   * e un pulsante per registrare l'acconto come movimento di cassa separato,
   * sottraendolo dall'importo in competenza.
   */
  gestitoAcconti?: boolean;
  /**
   * Cronologia delle integrazioni aggiunte alla voce nello stesso mese.
   * Ogni elemento è { date, amount } e l'amount è già sommato in `amount`.
   */
  additions?: { date: string; amount: number }[];
};

type FixedExpense = {
  id: string;
  description: string;
  category: string;
  amount: number;
  day: number;
  active: boolean;
  month?: number; // 0-11, only used for stipendi
};

type Salary = {
  id: string;
  name: string;
  month: number; // 0-11
  totale: number;          // stipendio totale (manuale)
  bonifico: number;        // manuale
  contanti: number;        // auto = totale - bonifico, manuale solo se sc=true
  sc?: boolean;            // se true, contanti è scollegato (manuale)
  cassaBanca: number;      // manuale
  cassaContanti: number;   // manuale
};

type SalaryCalcRow = {
  id: string;
  name: string;
  month: number; // 0-11
  daysWorked: number;
  overtimeHours: number;
  holidayDays: number;
  vacationDays: number;
  tripDays: number;
};

type SalaryRate = {
  id: string;
  name: string;
  dailyCost: number;
  overtimeHourCost: number;
};

export type AccountingGoals = {
  dailyEntrate?: number;
  monthlyEntrate?: number;
  monthlyUscite?: number;
  monthlySaldo?: number;
  yearlyEntrate?: number;
  yearlyUscite?: number;
  yearlySaldo?: number;
  /** Liquidità di cassa che si vuole avere a disposizione */
  cashTarget?: number;
  /** Soglia di alert: avvisa se le spese fisse superano X% del fatturato */
  alertPctFixedOverRevenue?: number;
  /** Override mensili manuali per Entrate previste, indicizzati 0-11 */
  monthlyEntrateForecast?: Record<number, number>;
  /** Soglia di alert per BEP trimestrale: % max di costi fissi su entrate (default 35%) */
  bepThresholdPct?: number;
};

type AccountingState = {
  openingCash: number;
  movements: CashMovement[];
  fixedExpenses: FixedExpense[];
  salaries?: Salary[];
  salariesProcessed?: boolean[]; // length 12, true = "Stipendi elaborati" per quel mese
  salaryPayDates?: string[]; // length 12, data pagamento stipendi per mese
  salaryPayDays?: number[]; // legacy: giorno del mese (1-28)
  salaryCalc?: SalaryCalcRow[]; // calcolatore presenze per mese
  salaryRates?: SalaryRate[]; // costi giornalieri/straordinario per dipendente
  hoursLog?: HoursLog;
  goals?: AccountingGoals;
  contacts?: Contact[];
  // Tombstones: ID di righe eliminate. Servono perché il merge realtime
  // unisce per ID: senza tombstone una riga cancellata localmente verrebbe
  // "resuscitata" dalla copia ricevuta da un altro dispositivo.
  deletedIds?: {
    movements?: string[];
    fixedExpenses?: string[];
    salaries?: string[];
    contacts?: string[];
  };
};

const BASE_STORAGE_KEY = "officina:contabilita-cassa:v22";
/** Anno "storico": usa le chiavi originali per non perdere i dati esistenti. */
const BASE_YEAR = 2026;
const YEAR_PREF_KEY = "officina:contabilita:anno";
/** Anno attualmente aperto: le funzioni di persistenza lo usano come default. */
let ACTIVE_YEAR = BASE_YEAR;
const setActiveYear = (y: number) => { ACTIVE_YEAR = y; };
const storageKeyFor = (year: number = ACTIVE_YEAR) => year === BASE_YEAR ? BASE_STORAGE_KEY : `${BASE_STORAGE_KEY}:${year}`;
const savedAtKeyFor = (year: number = ACTIVE_YEAR) => `${storageKeyFor(year)}:saved_at`;
const remoteKeyFor = (year: number = ACTIVE_YEAR) => year === BASE_YEAR ? "main" : `main-${year}`;
const LEGACY_STORAGE_KEYS = ["officina:contabilita-cassa:v21", "officina:contabilita-cassa:v20"];
const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const OPENING_CASH_2025 = 96259.6;

// Un colore distinto per ogni mese (HSL): [dept, dept-soft]
const MONTH_COLORS: Array<{ dept: string; soft: string }> = [
  { dept: "184 85% 32%", soft: "184 42% 93%" }, // Gen - teal
  { dept: "265 60% 45%", soft: "265 50% 94%" }, // Feb - viola
  { dept: "145 55% 32%", soft: "145 40% 93%" }, // Mar - verde
  { dept: "28 86% 46%",  soft: "32 78% 93%"  }, // Apr - arancio
  { dept: "340 70% 45%", soft: "340 55% 94%" }, // Mag - magenta
  { dept: "200 80% 38%", soft: "200 55% 93%" }, // Giu - azzurro
  { dept: "48 90% 42%",  soft: "48 75% 92%"  }, // Lug - giallo/oro
  { dept: "0 70% 45%",   soft: "0 60% 94%"   }, // Ago - rosso
  { dept: "170 65% 32%", soft: "170 45% 93%" }, // Set - verde acqua
  { dept: "18 75% 42%",  soft: "18 60% 94%"  }, // Ott - terracotta
  { dept: "225 60% 42%", soft: "225 50% 94%" }, // Nov - blu
  { dept: "300 55% 38%", soft: "300 45% 94%" }, // Dic - prugna
];

const paymentCode = (method?: string) => {
  const value = (method ?? "").trim().toUpperCase();
  if (value === "CC") return "C";
  if (["B", "C", "F", "N", "R", "A"].includes(value)) return value;
  if (value === "BONIFICO") return "B";
  if (value === "CONTANTI") return "C";
  if (value === "SPESA FISSA") return "F";
  if (value === "NELLA") return "N";
  if (value === "RIBA") return "R";
  if (value === "ASSEGNO") return "A";
  return value;
};

// ====== Metodi di pagamento personalizzati ======
const DEFAULT_PAYMENT_METHODS: { code: string; label: string }[] = [
  { code: "B", label: "B - Bonifico" },
  { code: "C", label: "C - Contanti" },
  { code: "F", label: "F - Fisso" },
  { code: "N", label: "N - Note" },
  { code: "R", label: "R - Ricevuta" },
  { code: "A", label: "A - Assegno" },
];
const CUSTOM_METHODS_KEY = "officina:contabilita:custom-payment-methods";
const customMethodsListeners = new Set<() => void>();
const loadCustomMethods = (): { code: string; label: string }[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_METHODS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => (typeof x === "string" ? { code: x, label: x } : x))
      .filter((x) => x && typeof x.code === "string" && x.code.trim().length > 0)
      .map((x) => ({ code: String(x.code).trim().toUpperCase().slice(0, 6), label: String(x.label || x.code).trim().slice(0, 40) }));
  } catch { return []; }
};
const saveCustomMethods = (methods: { code: string; label: string }[]) => {
  try { localStorage.setItem(CUSTOM_METHODS_KEY, JSON.stringify(methods)); } catch { /* ignore */ }
  customMethodsListeners.forEach((fn) => fn());
};
const useCustomPaymentMethods = () => {
  const [methods, setMethods] = useState(() => loadCustomMethods());
  useEffect(() => {
    const fn = () => setMethods(loadCustomMethods());
    customMethodsListeners.add(fn);
    return () => { customMethodsListeners.delete(fn); };
  }, []);
  return methods;
};
const PaymentMethodSelect = ({ value, onChange, className, ariaLabel = "Metodo", showLongLabels = false, onKeyDown }: { value: string; onChange: (v: string) => void; className?: string; ariaLabel?: string; showLongLabels?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLSelectElement>) => void }) => {
  const custom = useCustomPaymentMethods();
  const all = [...DEFAULT_PAYMENT_METHODS, ...custom.filter((c) => !DEFAULT_PAYMENT_METHODS.some((d) => d.code === c.code))];
  const code = paymentCode(value);
  const known = all.some((m) => m.code === code);
  return (
    <select
      aria-label={ariaLabel}
      className={className}
      value={code}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__add__") {
          const codeIn = prompt("Codice metodo di pagamento (es. PP per PayPal):");
          if (!codeIn) return;
          const c = codeIn.trim().toUpperCase().slice(0, 6);
          if (!c) return;
          const labelIn = prompt(`Etichetta per "${c}" (es. "${c} - PayPal"):`, `${c} - `) || c;
          const next = loadCustomMethods();
          if (!DEFAULT_PAYMENT_METHODS.some((d) => d.code === c) && !next.some((m) => m.code === c)) {
            next.push({ code: c, label: labelIn.trim().slice(0, 40) });
            saveCustomMethods(next);
          }
          onChange(c);
          return;
        }
        onChange(v);
      }}
    >
      {!known && code && <option value={code}>{code}</option>}
      {all.map((m) => <option key={m.code} value={m.code}>{showLongLabels ? m.label : m.code}</option>)}
      <option value="__add__">+ Aggiungi metodo…</option>
    </select>
  );
};

const normalizeMovement = (movement: CashMovement): CashMovement => {
  const method = paymentCode(movement.paymentMethod);
  return {
    ...movement,
    paymentMethod: method,
    category: method === "F" ? "Spesa fissa" : movement.category,
  };
};

const seedMovements = () => [
  // Azzerati gennaio, febbraio, marzo, aprile (gli stipendi restano)
  ...ACCOUNTING_SEED_MOVEMENTS.filter((m) => {
    const mo = new Date(m.date).getMonth();
    return mo !== 0 && mo !== 1 && mo !== 2 && mo !== 3;
  }),
  ...FEBRUARY_2026_MOVEMENTS,
  ...MARCH_2026_MOVEMENTS,
].map((m) => normalizeMovement({ ...m } as CashMovement));

const replaceMonthWithSeed = (movements: CashMovement[], monthIndex: number, seed: Array<Record<string, unknown>>) => [
  ...movements.filter((m) => new Date(m.date).getMonth() !== monthIndex),
  ...seed.map((m) => normalizeMovement({ ...m } as CashMovement)),
];

const JANUARY_SALARIES_SEED: Omit<Salary, "id" | "month">[] = [
  { name: "DEL PRETE GUIDO",     totale: 1507.5, bonifico: 1200,    contanti: 307.5,   cassaBanca: 1200,    cassaContanti: 307.5   },
  { name: "MARTONE GIANLUIGI",   totale: 5000,   bonifico: 2263.89, contanti: 2736.11, cassaBanca: 2263.89, cassaContanti: 2736.11 },
  { name: "ESPOSITO SALVATORE",  totale: 700.45, bonifico: 446.45,  contanti: 254,     cassaBanca: 446.45,  cassaContanti: 254     },
  { name: "FERRILLO MARIO",      totale: 1736.25,bonifico: 1600,    contanti: 136.25,  cassaBanca: 1600,    cassaContanti: 136.25  },
  { name: "BERRINO FEDERICA",    totale: 700,    bonifico: 0,       contanti: 700,     cassaBanca: 0,       cassaContanti: 700     },
  { name: "SCARPATO GENNARO",    totale: 1305,   bonifico: 1305,    contanti: 0,       cassaBanca: 1305,    cassaContanti: 0       },
  { name: "DI CAPRIO GIULIANO",  totale: 1430,   bonifico: 1430,    contanti: 0,       cassaBanca: 1430,    cassaContanti: 0       },
  { name: "SINISCALCHI CARMELA", totale: 400,    bonifico: 0,       contanti: 400,     cassaBanca: 0,       cassaContanti: 400     },
  { name: "ESPOSITO GIUSEPPE",   totale: 1537.5, bonifico: 1375,    contanti: 162.5,   cassaBanca: 1375,    cassaContanti: 162.5   },
  { name: "STINGO VITTORIO",     totale: 880,    bonifico: 0,       contanti: 880,     cassaBanca: 0,       cassaContanti: 880     },
  { name: "RIZZO STEFANIA",      totale: 805,    bonifico: 0,       contanti: 805,     cassaBanca: 0,       cassaContanti: 805     },
  { name: "SUNDAY",              totale: 850,    bonifico: 850,     contanti: 0,       cassaBanca: 850,     cassaContanti: 0       },
  { name: "CLAUDIA",             totale: 500,    bonifico: 0,       contanti: 500,     cassaBanca: 0,       cassaContanti: 500     },
  { name: "BERRINO LUCA",        totale: 1231.25,bonifico: 1231.25, contanti: 0,       cassaBanca: 1231.25, cassaContanti: 0       },
];

const FEBRUARY_SALARIES_SEED: Omit<Salary, "id" | "month">[] = [
  { name: "DEL PRETE GUIDO",      totale: 1614,    bonifico: 1201,    contanti: 413,    cassaBanca: 1201,    cassaContanti: 413    },
  { name: "MARTONE GIANLUIGI",    totale: 5000,    bonifico: 3000,    contanti: 2000,   cassaBanca: 3000,    cassaContanti: 2000   },
  { name: "ESPOSITO SALVATORE",   totale: 50,      bonifico: 0,       contanti: 50,     cassaBanca: 0,       cassaContanti: 50     },
  { name: "FERRILLO MARIO",       totale: 1745,    bonifico: 1200,    contanti: 545,    cassaBanca: 1200,    cassaContanti: 545    },
  { name: "BERRINO FEDERICA",     totale: 700,     bonifico: 0,       contanti: 700,    cassaBanca: 0,       cassaContanti: 700    },
  { name: "SCARPATO GENNARO",     totale: 1537.5,  bonifico: 1070,    contanti: 467.5,  cassaBanca: 1070,    cassaContanti: 467.5  },
  { name: "DI CAPRIO GIULIANO",   totale: 1672.5,  bonifico: 1430,    contanti: 242.5,  cassaBanca: 1430,    cassaContanti: 242.5  },
  { name: "SINISCALCHI CARMELA",  totale: 400,     bonifico: 0,       contanti: 400,    cassaBanca: 0,       cassaContanti: 400    },
  { name: "ESPOSITO GIUSEPPE",    totale: 1532.5,  bonifico: 1375,    contanti: 157.5,  cassaBanca: 1375,    cassaContanti: 157.5  },
  { name: "STINGO VITTORIO",      totale: 856.25,  bonifico: 0,       contanti: 856.25, cassaBanca: 0,       cassaContanti: 856.25 },
  { name: "RIZZO STEFANIA",       totale: 770,     bonifico: 0,       contanti: 770,    cassaBanca: 0,       cassaContanti: 770    },
  { name: "VITIELLO GIANFRANCO",  totale: 499,     bonifico: 99,      contanti: 400,    cassaBanca: 99,      cassaContanti: 400    },
  { name: "DE MIZIO CARMINE",     totale: 599,     bonifico: 99,      contanti: 500,    cassaBanca: 99,      cassaContanti: 500    },
  { name: "APREA MASSIMILIANO",   totale: 480.05,  bonifico: 106.05,  contanti: 374,    cassaBanca: 106.05,  cassaContanti: 374    },
  { name: "BRANCATO ANTONIO",     totale: 480.05,  bonifico: 106.05,  contanti: 374,    cassaBanca: 106.05,  cassaContanti: 374    },
  { name: "SUNDAY",               totale: 950,     bonifico: 950,     contanti: 0,      cassaBanca: 950,     cassaContanti: 0      },
  { name: "CLAUDIA",              totale: 200,     bonifico: 0,       contanti: 200,    cassaBanca: 0,       cassaContanti: 200    },
  { name: "BERRINO LUCA",         totale: 1172.5,  bonifico: 1135.75, contanti: 36.75,  cassaBanca: 1135.75, cassaContanti: 36.75  },
];

const MARCH_SALARIES_SEED: Omit<Salary, "id" | "month">[] = [
  { name: "DEL PRETE GUIDO",      totale: 1503,    bonifico: 1213,    contanti: 290,    cassaBanca: 1213,    cassaContanti: 290    },
  { name: "MARTONE GIANLUIGI",    totale: 5000,    bonifico: 2999,    contanti: 2001,   cassaBanca: 2999,    cassaContanti: 2001   },
  { name: "ESPOSITO SALVATORE",   totale: 300,     bonifico: 0,       contanti: 300,    cassaBanca: 0,       cassaContanti: 300    },
  { name: "FERRILLO MARIO",       totale: 1580,    bonifico: 1200,    contanti: 380,    cassaBanca: 1200,    cassaContanti: 380    },
  { name: "BERRINO FEDERICA",     totale: 700,     bonifico: 0,       contanti: 700,    cassaBanca: 0,       cassaContanti: 700    },
  { name: "SCARPATO GENNARO",     totale: 1532,    bonifico: 1000,    contanti: 532,    cassaBanca: 1000,    cassaContanti: 532    },
  { name: "DI CAPRIO GIULIANO",   totale: 1395,    bonifico: 1000,    contanti: 395,    cassaBanca: 1000,    cassaContanti: 395    },
  { name: "SINISCALCHI CARMELA",  totale: 400,     bonifico: 0,       contanti: 400,    cassaBanca: 0,       cassaContanti: 400    },
  { name: "ESPOSITO GIUSEPPE",    totale: 1345,    bonifico: 1265,    contanti: 80,     cassaBanca: 1265,    cassaContanti: 80     },
  { name: "STINGO VITTORIO",      totale: 500,     bonifico: 0,       contanti: 500,    cassaBanca: 0,       cassaContanti: 500    },
  { name: "RIZZO STEFANIA",       totale: 700,     bonifico: 0,       contanti: 700,    cassaBanca: 0,       cassaContanti: 700    },
  { name: "VITIELLO GIANFRANCO",  totale: 240.42,  bonifico: 103.42,  contanti: 137,    cassaBanca: 103.42,  cassaContanti: 137    },
  { name: "DE MIZIO CARMINE",     totale: 360.42,  bonifico: 103.42,  contanti: 257,    cassaBanca: 103.42,  cassaContanti: 257    },
  { name: "SUNDAY",               totale: 1086,    bonifico: 1056,    contanti: 30,     cassaBanca: 1056,    cassaContanti: 30     },
  { name: "BERRINO LUCA",         totale: 1067.5,  bonifico: 1000,    contanti: 67.5,   cassaBanca: 1000,    cassaContanti: 67.5   },
];

const APRIL_SALARIES_SEED: Omit<Salary, "id" | "month">[] = [
  { name: "DEL PRETE GUIDO",      totale: 1730,    bonifico: 1202,    contanti: 528,    cassaBanca: 1202,    cassaContanti: 528    },
  { name: "MARTONE GIANLUIGI",    totale: 5008,    bonifico: 3008,    contanti: 2000,   cassaBanca: 3008,    cassaContanti: 2000   },
  { name: "ESPOSITO SALVATORE",   totale: 150,     bonifico: 0,       contanti: 150,    cassaBanca: 0,       cassaContanti: 150    },
  { name: "FERRILLO MARIO",       totale: 1835,    bonifico: 1200,    contanti: 635,    cassaBanca: 1200,    cassaContanti: 635    },
  { name: "BERRINO FEDERICA",     totale: 0,       bonifico: 0,       contanti: 0,      cassaBanca: 0,       cassaContanti: 0      },
  { name: "SCARPATO GENNARO",     totale: 1501,    bonifico: 1003,    contanti: 498,    cassaBanca: 1003,    cassaContanti: 498    },
  { name: "DI CAPRIO GIULIANO",   totale: 1510,    bonifico: 1004,    contanti: 506,    cassaBanca: 1004,    cassaContanti: 506    },
  { name: "SINISCALCHI CARMELA",  totale: 400,     bonifico: 0,       contanti: 400,    cassaBanca: 0,       cassaContanti: 400    },
  { name: "ESPOSITO GIUSEPPE",    totale: 1496,    bonifico: 1376,    contanti: 120,    cassaBanca: 1376,    cassaContanti: 120    },
  { name: "RIZZO STEFANIA",       totale: 770,     bonifico: 0,       contanti: 770,    cassaBanca: 0,       cassaContanti: 770    },
  { name: "VITIELLO GIANFRANCO",  totale: 360,     bonifico: 0,       contanti: 360,    cassaBanca: 0,       cassaContanti: 360    },
  { name: "DE MIZIO CARMINE",     totale: 1200,    bonifico: 701,     contanti: 499,    cassaBanca: 701,     cassaContanti: 499    },
  { name: "SUNDAY",               totale: 1084.75, bonifico: 1056,    contanti: 28.75,  cassaBanca: 1056,    cassaContanti: 28.75  },
  { name: "BERRINO LUCA",         totale: 1386,    bonifico: 1000,    contanti: 386,    cassaBanca: 1000,    cassaContanti: 386    },
];

const seedAllSalaries = (): Salary[] => [
  ...JANUARY_SALARIES_SEED.map((s, i) => ({ ...s, id: `sal-1-${i}`, month: 0 })),
  ...FEBRUARY_SALARIES_SEED.map((s, i) => ({ ...s, id: `sal-2-${i}`, month: 1 })),
  ...MARCH_SALARIES_SEED.map((s, i) => ({ ...s, id: `sal-3-${i}`, month: 2 })),
  ...APRIL_SALARIES_SEED.map((s, i) => ({ ...s, id: `sal-4-${i}`, month: 3 })),
];

const initialState = (): AccountingState => ({
  openingCash: OPENING_CASH_2025,
  movements: seedMovements(),
  fixedExpenses: ACCOUNTING_SEED_FIXED_EXPENSES.map((e) => ({ ...e } as FixedExpense)),
  salaries: seedAllSalaries(),
  salariesProcessed: [true, true, true, true, false, false, false, false, false, false, false, false],
  salaryPayDates: defaultSalaryPayDates(),
  });


const defaultProcessedFlags = () => [true, true, true, true, false, false, false, false, false, false, false, false];
const isCompleteDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const salaryPayDateFor = (monthIndex: number, day = 28, year = new Date().getFullYear()) =>
  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(sanitizePayDay(day)).padStart(2, "0")}`;
const defaultSalaryPayDates = () => Array.from({ length: 12 }, (_, i) => salaryPayDateFor(i));
const sanitizePayDay = (n: unknown): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 28;
  return Math.max(1, Math.min(28, v));
};
const sanitizeSalaryPayDate = (value: unknown, monthIndex: number, fallbackDay = 28): string => {
  const raw = String(value ?? "").slice(0, 10);
  return isCompleteDate(raw) ? raw : salaryPayDateFor(monthIndex, fallbackDay);
};

const normalizeImportText = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const salaryNameMatches = (description: string, salaries: Salary[]) => {
  const text = normalizeImportText(description);
  return salaries.some((salary) => {
    const name = normalizeImportText(salary.name);
    return name.length >= 3 && text === name;
  });
};

const shouldSkipImportedMovement = (description: string, salaries: Salary[] = []) => {
  const text = normalizeImportText(description);
  if (!text) return true;
  if (salaryNameMatches(description, salaries)) return true;
  if (/\bstipendi?\b|\bbust[ae]\s+paga\b|\bpag[ah]?e?\s+(dipendenti|operai)\b/.test(text)) return true;
  if (/^(totale|totali|tot\.?|subtotale|sub totale|riepilogo|saldo|utile|differenza)(\b|\s|:|-)/.test(text)) return true;
  if (/\b(totale\s+(entrate|uscite|cassa|competenza)|totali\s+(entrate|uscite|cassa|competenza))\b/.test(text)) return true;
  return false;
};

const cleanImportedMovements = (movements: CashMovement[], salaries: Salary[]) => movements
  .map(normalizeMovement);

const normalizeState = (saved: Partial<AccountingState>): AccountingState => {
  const salaries = Array.isArray(saved.salaries) ? saved.salaries : seedAllSalaries();
  const savedGoals = (saved.goals && typeof saved.goals === "object") ? saved.goals : {};
  const goals: AccountingGoals = {
    // Valori dell'obiettivo dal foglio Excel (precaricati se mancanti)
    dailyEntrate: 7258.06,
    monthlyEntrate: 150000,
    yearlyEntrate: 1800000,
    cashTarget: 587903.23,
    bepThresholdPct: 35,
    alertPctFixedOverRevenue: 35,
    ...savedGoals,
  };
  return {
    openingCash: typeof saved.openingCash === "number" ? saved.openingCash : OPENING_CASH_2025,
    movements: Array.isArray(saved.movements) ? cleanImportedMovements(saved.movements, salaries) : [],
    fixedExpenses: Array.isArray(saved.fixedExpenses) ? saved.fixedExpenses : [],
    salaries,
    salariesProcessed: Array.isArray(saved.salariesProcessed) ? saved.salariesProcessed : defaultProcessedFlags(),
    salaryPayDates: Array.isArray((saved as AccountingState).salaryPayDates)
      ? Array.from({ length: 12 }, (_, i) => sanitizeSalaryPayDate((saved as AccountingState).salaryPayDates?.[i], i, (saved as AccountingState).salaryPayDays?.[i] ?? 28))
      : Array.isArray((saved as AccountingState).salaryPayDays)
        ? Array.from({ length: 12 }, (_, i) => salaryPayDateFor(i, (saved as AccountingState).salaryPayDays?.[i] ?? 28))
        : defaultSalaryPayDates(),
    salaryCalc: Array.isArray((saved as AccountingState).salaryCalc) ? (saved as AccountingState).salaryCalc : [],
    salaryRates: Array.isArray((saved as AccountingState).salaryRates) ? (saved as AccountingState).salaryRates : [],
    hoursLog: (saved as AccountingState).hoursLog && typeof (saved as AccountingState).hoursLog === "object" ? (saved as AccountingState).hoursLog : {},
    goals,
    contacts: Array.isArray(saved.contacts) ? saved.contacts as Contact[] : [],
    deletedIds: {
      movements: Array.isArray(saved.deletedIds?.movements) ? Array.from(new Set(saved.deletedIds!.movements as string[])) : [],
      fixedExpenses: Array.isArray(saved.deletedIds?.fixedExpenses) ? Array.from(new Set(saved.deletedIds!.fixedExpenses as string[])) : [],
      salaries: Array.isArray(saved.deletedIds?.salaries) ? Array.from(new Set(saved.deletedIds!.salaries as string[])) : [],
      contacts: Array.isArray(saved.deletedIds?.contacts) ? Array.from(new Set(saved.deletedIds!.contacts as string[])) : [],
    },
  };
};

/** Stato di partenza per un anno nuovo: nessun seed, solo riporti dall'anno precedente. */
const carryOverStateFromPreviousYear = (year: number): AccountingState => {
  const empty: AccountingState = normalizeState({
    openingCash: 0,
    movements: [],
    fixedExpenses: [],
    salaries: [],
    salariesProcessed: Array.from({ length: 12 }, () => false),
    salaryPayDates: Array.from({ length: 12 }, (_, i) => salaryPayDateFor(i, 28, year)),
    hoursLog: {},
  });
  let prev: AccountingState | null = null;
  try {
    const raw = localStorage.getItem(storageKeyFor(year - 1));
    if (raw) prev = normalizeState(JSON.parse(raw) as Partial<AccountingState>);
  } catch { /* nessun anno precedente leggibile */ }
  if (!prev) return empty;

  const acconto = (m: CashMovement) => Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
  // Cassa finale dell'anno precedente = apertura + incassato - pagato (compresi stipendi in cassa).
  let cash = prev.openingCash;
  for (const m of prev.movements) {
    const paid = m.status === "cassa" ? m.amount : acconto(m);
    cash += m.type === "entrata" ? paid : -paid;
  }
  const processed = prev.salariesProcessed ?? [];
  for (const s of prev.salaries ?? []) {
    if (processed[s.month]) cash -= (s.cassaBanca || 0) + (s.cassaContanti || 0);
  }

  // Residui: tutto ciò che era ancora in competenza viene riportato a gennaio del nuovo anno.
  const residui: CashMovement[] = prev.movements
    .filter((m) => m.status === "previsto" && !m.id.startsWith("__"))
    .map((m, i) => {
      const day = (m.date || "").slice(8, 10) || "15";
      const monthIdx = Number((m.date || "").slice(5, 7)) - 1;
      const label = MONTHS[monthIdx] ? ` (residuo ${MONTHS[monthIdx]} ${year - 1})` : ` (residuo ${year - 1})`;
      return normalizeMovement({
        ...m,
        id: `carry-${year}-${i}-${m.id}`,
        date: `${year}-01-${day}`,
        description: `${m.description}${label}`,
        amount: Math.max(0, m.amount - acconto(m)),
        acconto: 0,
      });
    })
    .filter((m) => m.amount > 0);

  return normalizeState({
    ...empty,
    openingCash: Math.round(cash * 100) / 100,
    movements: residui,
    fixedExpenses: (prev.fixedExpenses ?? []).map((e) => ({ ...e })),
    salaryRates: prev.salaryRates ?? [],
    contacts: prev.contacts ?? [],
    goals: prev.goals,
  });
};

const loadStoredState = (year: number = ACTIVE_YEAR): AccountingState => {
  try {
    const raw = localStorage.getItem(storageKeyFor(year));
    if (raw) return normalizeState(JSON.parse(raw) as Partial<AccountingState>);
  } catch {
    // continua sui dati legacy o seed sotto
  }
  if (year !== BASE_YEAR) return carryOverStateFromPreviousYear(year);
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const migrated = normalizeState(JSON.parse(raw) as Partial<AccountingState>);
      const next = {
        ...migrated,
        movements: replaceMonthWithSeed(migrated.movements, 1, FEBRUARY_2026_MOVEMENTS),
      };
      persistState(next);
      return next;
    } catch {
      // ignora vecchi salvataggi non leggibili
    }
  }
  return initialState();
};

const writeLocalState = (next: AccountingState, savedAt = Date.now()) => {
  const serialized = JSON.stringify(next);
  localStorage.setItem(storageKeyFor(), serialized);
  localStorage.setItem(savedAtKeyFor(), String(savedAt));
  return serialized;
};

const readLocalSavedAt = () => {
  try {
    const n = Number(localStorage.getItem(savedAtKeyFor()) || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

const persistState = (next: AccountingState, notify = false) => {
  try {
    writeLocalState(next);
  } catch {
    try {
      localStorage.removeItem(storageKeyFor());
      writeLocalState(next);
    } catch {
      if (notify) toast.error("Salvataggio non riuscito");
      return false;
    }
  }
  if (notify) toast.success("Contabilità salvata");
  return true;
};

const sortForStableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortForStableJson((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
};

const serializeAccountingState = (value: AccountingState) => JSON.stringify(sortForStableJson(normalizeState(value)));

export default function Contabilita() {
  const { isAdmin, isAmministrazione } = usePermissions();
  const canEditHours = isAdmin || isAmministrazione;
  const [state, setState] = useState<AccountingState>(() => loadStoredState());
  const [tab, setTab] = useState<AccountingTab>(() => {
    try {
      const saved = localStorage.getItem("officina:contabilita:tab");
      const valid: AccountingTab[] = ["generale", "mensile", "movimenti", "fisse", "stipendi", "grafici", "anagrafica"];
      if (saved === "ore") return "stipendi";
      if (saved && (valid as string[]).includes(saved)) return saved as AccountingTab;
    } catch { /* ignore */ }
    return "generale";
  });
  const [stipendiSub, setStipendiSub] = useState<StipendiSubTab>(() => {
    try {
      const saved = localStorage.getItem("officina:contabilita:stipendiSub");
      if (saved === "ore" || saved === "stipendi" || saved === "contanti") return saved;
    } catch { /* ignore */ }
    return "stipendi";
  });
  useEffect(() => { try { localStorage.setItem("officina:contabilita:stipendiSub", stipendiSub); } catch { /* ignore */ } }, [stipendiSub]);
  useEffect(() => { if (!isAdmin && !canEditHours && tab === "stipendi") setTab("generale"); }, [isAdmin, canEditHours, tab]);
  useEffect(() => {
    if (!isAdmin && canEditHours) {
      // amministrazione (non-admin): solo "contanti" (read-only) o "ore"
      if (stipendiSub === "stipendi") setStipendiSub("contanti");
    } else if (isAdmin) {
      if (stipendiSub === "contanti") setStipendiSub("stipendi");
    }
  }, [isAdmin, canEditHours, stipendiSub]);

  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("officina:contabilita:month");
      const n = saved ? Number(saved) : NaN;
      if (Number.isInteger(n) && n >= 0 && n <= 11) return n;
    } catch { /* ignore */ }
    return 0;
  });
  useEffect(() => { try { localStorage.setItem("officina:contabilita:tab", tab); } catch { /* ignore */ } }, [tab]);
  useEffect(() => { try { localStorage.setItem("officina:contabilita:month", String(selectedMonth)); } catch { /* ignore */ } }, [selectedMonth]);
  const [history, setHistory] = useState<AccountingState[]>([]);
  const [future, setFuture] = useState<AccountingState[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  // ===== Sync realtime con Supabase (chiave 'main') =====
  const REMOTE_KEY = "main";
  const REMOTE_SAVE_DEBOUNCE_MS = 500;
  const lastRemoteRef = useRef<string>("");
  const remoteLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeqRef = useRef(0);
  const localEditUntilRef = useRef(0);
  const stateRef = useRef<AccountingState | null>(null);
  const ownSaveUntilRef = useRef(0);
  /**
   * ID modificati di recente localmente: per questi, il merge realtime
   * NON sovrascrive con la versione remota (eviterebbe il classico bug
   * "spunto pagato → torna in competenze" perché un evento realtime arriva
   * tra la modifica locale e il salvataggio cloud).
   */
  const recentlyModifiedRef = useRef<Map<string, number>>(new Map());
  const RECENT_MODIFIED_TTL_MS = 15000;
  const markRecentlyModified = useCallback((ids: string[]) => {
    const expiry = Date.now() + RECENT_MODIFIED_TTL_MS;
    for (const id of ids) recentlyModifiedRef.current.set(id, expiry);
  }, []);
  const getRecentIds = useCallback(() => {
    const now = Date.now();
    const out = new Set<string>();
    for (const [id, exp] of recentlyModifiedRef.current) {
      if (exp > now) out.add(id);
      else recentlyModifiedRef.current.delete(id);
    }
    return out;
  }, []);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

  const restoreSnapshot = useCallback(async (raw: unknown) => {
    const restored = normalizeState(raw as Partial<AccountingState>);
    // Forza un upsert pulito: azzera il riferimento così il save effect lo rimanda al cloud
    lastRemoteRef.current = "";
    ownSaveUntilRef.current = Date.now() + 3000;
    setState(restored);
    try { writeLocalState(restored, Date.now()); } catch { /* ignore */ }
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id ?? null;
    const { error } = await supabase
      .from("contabilita_state")
      .upsert(
        [{ key: REMOTE_KEY, data: restored as unknown as never, updated_by: uid as unknown as never }],
        { onConflict: "key" },
      );
    if (error) throw error;
    lastRemoteRef.current = serializeAccountingState(restored);
    setSaveStatus("idle");
  }, []);

  // Merge granulare anti-cancellazione: fonde lo stato remoto con quello locale
  // per ID, in modo che modifiche concorrenti di utenti diversi non si distruggano.
  const mergeById = <T extends { id: string }>(local: T[], remote: T[], tombstones: Set<string> = new Set(), keepLocalIds: Set<string> = new Set()): T[] => {
    const map = new Map<string, T>();
    for (const item of local) if (!tombstones.has(item.id)) map.set(item.id, item);
    // Il remoto vince sui record con stesso id (last-write-wins per riga),
    // EXCEPT per gli ID modificati di recente localmente: in quel caso il
    // locale resta finché non scade la finestra (così la spunta non torna indietro).
    for (const item of remote) {
      if (tombstones.has(item.id)) continue;
      if (keepLocalIds.has(item.id) && map.has(item.id)) continue;
      map.set(item.id, item);
    }
    return Array.from(map.values());
  };

  const hasSameItemsById = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
    if (a.length !== b.length) return false;
    const ids = new Set(a.map((item) => item.id));
    return b.every((item) => ids.has(item.id));
  };

  // Merge hoursLog senza perdere giorni già salvati altrove.
  // - Union delle chiavi mese (mai droppare un mese presente su un lato).
  // - Per ogni mese, merge righe per dipendenteId (fallback id).
  // - Per ogni riga, union dei giorni: locale vince solo se localActive; un giorno mai svuotato.
  const mergeHoursLog = (
    local: Record<string, { rows: any[] }> | undefined,
    remote: Record<string, { rows: any[] }> | undefined,
    localActive: boolean,
  ): Record<string, { rows: any[] }> => {
    const l = local ?? {};
    const r = remote ?? {};
    const keys = new Set<string>([...Object.keys(l), ...Object.keys(r)]);
    const out: Record<string, { rows: any[] }> = {};
    for (const k of keys) {
      const lm = l[k];
      const rm = r[k];
      if (!lm) { out[k] = rm; continue; }
      if (!rm) { out[k] = lm; continue; }
      const rowKey = (row: any) => row?.dipendenteId ?? row?.id;
      const byKey = new Map<string, any>();
      for (const row of rm.rows ?? []) byKey.set(rowKey(row), row);
      for (const row of lm.rows ?? []) {
        const key = rowKey(row);
        const other = byKey.get(key);
        if (!other) { byKey.set(key, row); continue; }
        const localDays = row?.days ?? {};
        const remoteDays = other?.days ?? {};
        const dayKeys = new Set<string>([...Object.keys(localDays), ...Object.keys(remoteDays)]);
        const mergedDays: Record<string, any> = {};
        for (const dk of dayKeys) {
          const lv = localDays[dk];
          const rv = remoteDays[dk];
          if (lv == null || lv === "") { mergedDays[dk] = rv ?? lv; continue; }
          if (rv == null || rv === "") { mergedDays[dk] = lv; continue; }
          mergedDays[dk] = localActive ? lv : rv;
        }
        byKey.set(key, { ...other, ...row, days: mergedDays });
      }
      out[k] = { rows: Array.from(byKey.values()) };
    }
    return out;
  };

  const mergeRemoteState = (local: AccountingState, remote: AccountingState, localActive: boolean, preferLocalRecords = false): AccountingState => {
    const unionIds = (a?: string[], b?: string[]) => Array.from(new Set([...(a ?? []), ...(b ?? [])]));
    const deletedIds = {
      movements: unionIds(local.deletedIds?.movements, remote.deletedIds?.movements),
      fixedExpenses: unionIds(local.deletedIds?.fixedExpenses, remote.deletedIds?.fixedExpenses),
      salaries: unionIds(local.deletedIds?.salaries, remote.deletedIds?.salaries),
      contacts: unionIds(local.deletedIds?.contacts, remote.deletedIds?.contacts),
    };
    const tMov = new Set(deletedIds.movements);
    const tFix = new Set(deletedIds.fixedExpenses);
    const tSal = new Set(deletedIds.salaries);
    const tCon = new Set(deletedIds.contacts);
    const recent = preferLocalRecords ? new Set(local.movements.map((m) => m.id)) : getRecentIds();
    return {
    // Campi scalari: durante una modifica locale attiva preferisci il locale
    // per evitare che le date stipendi e altri scalari "si auto-cambino".
    openingCash: localActive ? local.openingCash : remote.openingCash,
    goals: localActive ? (local.goals ?? remote.goals) : (remote.goals ?? local.goals),
    salariesProcessed: localActive ? (local.salariesProcessed ?? remote.salariesProcessed) : (remote.salariesProcessed ?? local.salariesProcessed),
    salaryPayDates: localActive ? (local.salaryPayDates ?? remote.salaryPayDates) : (remote.salaryPayDates ?? local.salaryPayDates),
    salaryPayDays: localActive ? (local.salaryPayDays ?? remote.salaryPayDays) : (remote.salaryPayDays ?? local.salaryPayDays),
    salaryCalc: localActive ? (local.salaryCalc ?? remote.salaryCalc) : (remote.salaryCalc ?? local.salaryCalc),
    salaryRates: localActive ? (local.salaryRates ?? remote.salaryRates) : (remote.salaryRates ?? local.salaryRates),
    hoursLog: mergeHoursLog(local.hoursLog as any, remote.hoursLog as any, localActive) as any,
    // Liste con id: merge per id (nessuna cancellazione di righe modificate altrove)
      movements: mergeById(local.movements, remote.movements ?? [], tMov, recent),
      fixedExpenses: mergeById(local.fixedExpenses, remote.fixedExpenses ?? [], tFix, recent),
      salaries: mergeById(local.salaries ?? [], remote.salaries ?? [], tSal, recent),
      contacts: mergeById(local.contacts ?? [], remote.contacts ?? [], tCon, recent),
      deletedIds,
    };
  };

  useEffect(() => { stateRef.current = state; }, [state]);

  // 1) Caricamento iniziale dal cloud (sovrascrive lo state locale se esiste)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("contabilita_state")
        .select("data,updated_at")
        .eq("key", REMOTE_KEY)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[contabilita] load remote:", error.message);
        remoteLoadedRef.current = true;
        return;
      }
      if (data?.data) {
        const remote = normalizeState(data.data as Partial<AccountingState>);
        const remoteSerialized = serializeAccountingState(remote);
        const remoteSavedAt = data.updated_at ? new Date(data.updated_at as string).getTime() : 0;
        const local = stateRef.current ?? remote;
        const localSavedAt = readLocalSavedAt();
        const preferLocalAtStart = localSavedAt > remoteSavedAt + 1000;
        const merged = mergeRemoteState(local, remote, preferLocalAtStart, preferLocalAtStart);
        const mergedSerialized = serializeAccountingState(merged);
        // Il cloud è la fonte comune: all'avvio non scartare più il remoto solo
        // perché questo browser ha un timestamp locale più recente. Unisci invece
        // le righe per ID, così le aggiunte fatte su due postazioni convergono.
        lastRemoteRef.current = remoteSerialized;
        setState(merged);
        try { writeLocalState(merged, remoteSavedAt || Date.now()); } catch { /* ignore */ }
        if (
          mergedSerialized !== remoteSerialized
          && (
            !hasSameItemsById(local.movements, remote.movements)
            || !hasSameItemsById(local.fixedExpenses, remote.fixedExpenses)
            || !hasSameItemsById(local.salaries ?? [], remote.salaries ?? [])
            || !hasSameItemsById(local.contacts ?? [], remote.contacts ?? [])
          )
        ) {
          toast.info("Contabilità unificata con le modifiche trovate su questo dispositivo.", { duration: 5000 });
        }
        if (preferLocalAtStart && mergedSerialized !== remoteSerialized) {
          lastRemoteRef.current = remoteSerialized;
          ownSaveUntilRef.current = Date.now() + 2500;
          const { data: authData } = await supabase.auth.getUser();
          const uid = authData?.user?.id ?? null;
          const { error: restoreError } = await supabase
            .from("contabilita_state")
            .upsert(
              [{ key: REMOTE_KEY, data: merged as unknown as never, updated_by: uid as unknown as never }],
              { onConflict: "key" },
            );
          if (restoreError) {
            setSaveStatus("error");
            toast.error("Non riesco a riportare sul cloud le modifiche locali: resta su questa pagina finché non risulta Salvato.", { duration: 10000, id: "contab-save-error" });
          } else {
            lastRemoteRef.current = mergedSerialized;
            setSaveStatus("idle");
          }
        }
      }
      remoteLoadedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // 2) Salvataggio remoto debounced ad ogni cambio di state
  useEffect(() => {
    if (!remoteLoadedRef.current) return;
    const serialized = serializeAccountingState(state);
    if (serialized === lastRemoteRef.current) return; // viene da realtime, non rimandare
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    const seq = ++saveSeqRef.current;
    saveTimerRef.current = setTimeout(async () => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id ?? null;
      const { data: written, error } = await supabase
        .from("contabilita_state")
        .upsert(
          [{ key: REMOTE_KEY, data: state as unknown as never, updated_by: uid as unknown as never }],
          { onConflict: "key" },
        )
        .select("key,updated_at");
      if (seq !== saveSeqRef.current) return;
      if (error) {
        console.warn("[contabilita] save remote:", error.message, "uid=", uid);
        // Tentativo di refresh sessione + retry una volta
        let recovered = false;
        try {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed?.session) {
            const retry = await supabase
              .from("contabilita_state")
              .upsert(
                [{ key: REMOTE_KEY, data: state as unknown as never, updated_by: refreshed.session.user.id as unknown as never }],
                { onConflict: "key" },
              )
              .select("key,updated_at");
            if (!retry.error && retry.data && retry.data.length > 0) {
              lastRemoteRef.current = serialized;
              ownSaveUntilRef.current = Date.now() + 2500;
              setSaveStatus("idle");
              recovered = true;
            }
          }
        } catch { /* ignore */ }
        if (!recovered) {
          setSaveStatus("error");
          toast.error(
            uid
              ? `Salvataggio cloud non riuscito: ${error.message}. Dati salvati su questo browser, riproverò automaticamente.`
              : "Sessione scaduta: rifai login per salvare la contabilità sul cloud. I dati restano su questo browser.",
            { duration: 8000, id: "contab-save-error" },
          );
        }
      } else if (!written || written.length === 0) {
        // RLS ha filtrato silenziosamente la scrittura: 200 ma 0 righe scritte.
        console.warn("[contabilita] save remote: 0 righe scritte (RLS), uid=", uid);
        setSaveStatus("error");
        toast.error(
          "Salvataggio cloud bloccato: l'utente non ha permesso di scrittura sulla Contabilità (oppure la sessione è scaduta). I dati restano solo su questo browser. Esci e rientra, oppure chiedi a un amministratore.",
          { duration: 10000 },
        );
      } else {
        lastRemoteRef.current = serialized;
        ownSaveUntilRef.current = Date.now() + 2500;
        setSaveStatus("idle");
      }
    }, REMOTE_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state]);

  // 2b) Auto-retry: finché il salvataggio è in errore, riprova ogni 15s
  useEffect(() => {
    if (saveStatus !== "error") return;
    const id = setInterval(async () => {
      const current = stateRef.current;
      if (!current) return;
      const serialized = serializeAccountingState(current);
      if (serialized === lastRemoteRef.current) { setSaveStatus("idle"); return; }
      try {
        await supabase.auth.refreshSession();
      } catch { /* ignore */ }
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id ?? null;
      if (!uid) return; // serve login utente
      const { data: written, error } = await supabase
        .from("contabilita_state")
        .upsert(
          [{ key: REMOTE_KEY, data: current as unknown as never, updated_by: uid as unknown as never }],
          { onConflict: "key" },
        )
        .select("key,updated_at");
      if (!error && written && written.length > 0) {
        lastRemoteRef.current = serialized;
        ownSaveUntilRef.current = Date.now() + 2500;
        setSaveStatus("idle");
        toast.success("Contabilità ri-sincronizzata sul cloud", { id: "contab-save-error" });
      }
    }, 15000);
    return () => clearInterval(id);
  }, [saveStatus]);

  // 3) Realtime: ricevi modifiche da altri utenti.
  // NOTA: il payload Realtime di Supabase ha un limite di ~256 KB. Il record
  // della contabilità supera questa soglia (≈280 KB), quindi `payload.new`
  // arriva troncato/vuoto. Per garantire la sincronizzazione facciamo SEMPRE
  // un re-fetch della riga quando arriva un evento, ignorando il payload.
  useEffect(() => {
    let refetching = false;
    const applyRemote = async () => {
      if (refetching) return;
      refetching = true;
      try {
        const { data, error } = await supabase
          .from("contabilita_state")
          .select("data")
          .eq("key", REMOTE_KEY)
          .maybeSingle();
        if (error || !data?.data) return;
        const remote = normalizeState(data.data as Partial<AccountingState>);
        const remoteSerialized = serializeAccountingState(remote);
        if (remoteSerialized === lastRemoteRef.current) return;
        if (Date.now() < ownSaveUntilRef.current) {
          lastRemoteRef.current = remoteSerialized;
          return;
        }
        const local = stateRef.current ?? remote;
        const localActive = Date.now() < localEditUntilRef.current;
        const merged = mergeRemoteState(local, remote, localActive);
        const mergedSerialized = serializeAccountingState(merged);
        if (mergedSerialized === serializeAccountingState(local)) {
          lastRemoteRef.current = remoteSerialized;
          return;
        }
        lastRemoteRef.current = remoteSerialized;
        setState(merged);
        try { writeLocalState(merged); } catch { /* ignore */ }
        if (localActive) {
          toast.info("Modifiche ricevute da un altro dispositivo: unite per riga.", {
            duration: 6000,
          });
        }
      } finally {
        refetching = false;
      }
    };

    const channel = supabase
      .channel("contabilita-state-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contabilita_state", filter: `key=eq.${REMOTE_KEY}` },
        () => { void applyRemote(); },
      )
      .subscribe();

    // Safety net: ogni 30s riallinea con il cloud, nel caso un evento Realtime
    // fosse stato perso (es. connessione instabile).
    const poll = setInterval(() => { void applyRemote(); }, 30000);
    // Riallinea quando la finestra torna in primo piano.
    const onVis = () => { if (document.visibilityState === "visible") void applyRemote(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Flush sincrono su chiusura finestra / cambio visibilità: evita di perdere l'ultimo
  // edit fatto poco prima di chiudere il browser. Usa fetch keepalive.
  useEffect(() => {
    const flush = () => {
      const current = stateRef.current;
      if (!current) return;
      const serialized = serializeAccountingState(current);
      if (serialized === lastRemoteRef.current) return;
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/contabilita_state?on_conflict=key`;
        const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
        const tokenRaw = localStorage.getItem(`sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`);
        let accessToken = apikey;
        if (tokenRaw) {
          try { accessToken = JSON.parse(tokenRaw)?.access_token ?? apikey; } catch { /* ignore */ }
        }
        fetch(url, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            apikey,
            Authorization: `Bearer ${accessToken}`,
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify([{ key: REMOTE_KEY, data: JSON.parse(serialized) }]),
        }).catch(() => { /* ignore */ });
        lastRemoteRef.current = serialized;
      } catch { /* ignore */ }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const pushHistory = (snapshot: AccountingState) => {
    setHistory((h) => [...h.slice(-49), snapshot]);
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) { toast.info("Niente da annullare"); return h; }
      const prev = h[h.length - 1];
      setFuture((f) => [...f.slice(-49), state]);
      setState(prev);
      persistState(prev);
      toast.success("Azione annullata");
      return h.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((f) => {
      if (f.length === 0) { toast.info("Niente da rifare"); return f; }
      const nextState = f[f.length - 1];
      setHistory((h) => [...h.slice(-49), state]);
      setState(nextState);
      persistState(nextState);
      toast.success("Azione ripristinata");
      return f.slice(0, -1);
    });
  };

  // Salvataggio in tempo reale: nessun pulsante, nessun intervallo manuale.
  // Lo state locale viene scritto su localStorage e su cloud automaticamente.

  const reloadFromSeed = () => {
    pushHistory(state);
    const next = initialState();
    setState(next);
    persistState(next);
    toast.success("Dati iniziali ricaricati");
  };

  const update = (
    patch: Partial<AccountingState> | ((prev: AccountingState) => Partial<AccountingState>),
  ) => setState((prev) => {
    // Finestra ampia di "sto modificando localmente": il merge realtime
    // non sovrascrive scalari (es. date stipendi) appena modificati.
    localEditUntilRef.current = Date.now() + 8000;
    pushHistory(prev);
    setFuture([]);
    const resolved = typeof patch === "function" ? patch(prev) : patch;
    const next = { ...prev, ...resolved };
    // Rileva cancellazioni e registrale come tombstone così non risorgono dal cloud.
    const diffRemoved = <T extends { id: string }>(before: T[] = [], after: T[] = []) => {
      const afterIds = new Set(after.map((x) => x.id));
      const removed: string[] = [];
      for (const item of before) if (!afterIds.has(item.id)) removed.push(item.id);
      return removed;
    };
    const diffTouched = <T extends { id: string }>(before: T[] = [], after: T[] = []) => {
      const beforeMap = new Map(before.map((x) => [x.id, JSON.stringify(sortForStableJson(x))]));
      const touched = new Set<string>(diffRemoved(before, after));
      for (const item of after) {
        if (beforeMap.get(item.id) !== JSON.stringify(sortForStableJson(item))) touched.add(item.id);
      }
      return Array.from(touched);
    };
    const prevDel = prev.deletedIds ?? {};
    const nextDeleted = {
      movements: prevDel.movements ?? [],
      fixedExpenses: prevDel.fixedExpenses ?? [],
      salaries: prevDel.salaries ?? [],
      contacts: prevDel.contacts ?? [],
    };
    if (resolved.movements) nextDeleted.movements = Array.from(new Set([...nextDeleted.movements, ...diffRemoved(prev.movements, resolved.movements)]));
    if (resolved.fixedExpenses) nextDeleted.fixedExpenses = Array.from(new Set([...nextDeleted.fixedExpenses, ...diffRemoved(prev.fixedExpenses, resolved.fixedExpenses)]));
    if (resolved.salaries) nextDeleted.salaries = Array.from(new Set([...nextDeleted.salaries, ...diffRemoved(prev.salaries ?? [], resolved.salaries)]));
    if (resolved.contacts) nextDeleted.contacts = Array.from(new Set([...nextDeleted.contacts, ...diffRemoved(prev.contacts ?? [], resolved.contacts)]));
    markRecentlyModified([
      ...(resolved.movements ? diffTouched(prev.movements, resolved.movements) : []),
      ...(resolved.fixedExpenses ? diffTouched(prev.fixedExpenses, resolved.fixedExpenses) : []),
      ...(resolved.salaries ? diffTouched(prev.salaries ?? [], resolved.salaries) : []),
      ...(resolved.contacts ? diffTouched(prev.contacts ?? [], resolved.contacts) : []),
    ]);
    next.deletedIds = nextDeleted;
    persistState(next);
    return next;
  });
  const addMovement = () => setWizardOpen(true);
  const createMovement = (m: Omit<CashMovement, "id">) => {
    update({ movements: [...state.movements, normalizeMovement({ ...m, id: uid() })] });
    toast.success("Movimento aggiunto");
  };
  const addFixed = (category = "Fissi", month?: number) => update({ fixedExpenses: [...state.fixedExpenses, { id: uid(), description: category === "Stipendi" ? "Nuovo stipendio" : "Nuova spesa fissa", category, amount: 0, day: 1, active: true, ...(month !== undefined ? { month } : {}) }] });

  const totals = useMemo(() => {
    const accontoOf = (m: CashMovement) => Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
    const cashIn = state.movements.reduce((s, m) => {
      if (m.type !== "entrata") return s;
      if (m.status === "cassa") return s + m.amount;
      return s + accontoOf(m);
    }, 0);
    const cashOut = state.movements.reduce((s, m) => {
      if (m.type !== "uscita") return s;
      if (m.status === "cassa") return s + m.amount;
      return s + accontoOf(m);
    }, 0);
    const expectedIn = state.movements.reduce((s, m) => {
      if (m.status !== "previsto" || m.type !== "entrata") return s;
      return s + (m.amount - accontoOf(m));
    }, 0);
    const expectedOut = state.movements.reduce((s, m) => {
      if (m.status !== "previsto" || m.type !== "uscita") return s;
      return s + (m.amount - accontoOf(m));
    }, 0);
    const utile = cashIn - cashOut;
    const cash = state.openingCash + utile;
    const expected = expectedIn - expectedOut;
    const forecast = cash - expectedOut;
    const fixedMonthly = state.fixedExpenses.filter((e) => e.active).reduce((s, e) => s + e.amount, 0);
    const today = new Date().toISOString().slice(0, 10);
    let cashToday = state.openingCash;
    for (const m of state.movements) {
      const d = (m.date || "").slice(0, 10);
      if (d > today) continue;
      if (m.type === "entrata") {
        if (m.status === "cassa") cashToday += m.amount;
        else cashToday += accontoOf(m);
      } else {
        if (m.status === "cassa") cashToday -= m.amount;
        else cashToday -= accontoOf(m);
      }
    }
    return { cash, cashToday, expected, forecast, fixedMonthly, cashIn, cashOut, expectedIn, expectedOut, utile };
  }, [state]);

  // helpers per stipendi
  const salaries = state.salaries ?? [];
  const processedFlags = state.salariesProcessed ?? [];
  const payDates = state.salaryPayDates ?? defaultSalaryPayDates();
  // Devono rispecchiare esattamente le colonne mostrate in "Stipendi per mese".
  // Anche con i contanti sbloccati (sc), bonifico e valori di cassa restano quelli inseriti.
  const contantiOfSalary = (s: Salary) => (s.sc ? s.contanti : s.totale - s.bonifico);
  const bonificoOfSalary = (s: Salary) => s.bonifico;
  const cassaBancaOfSalary = (s: Salary) => s.cassaBanca;
  // Totale coerente con la tabella: con split manuale (sc) il totale è bonifico + contanti.
  const totaleOfSalary = (s: Salary) => (s.sc ? s.bonifico + s.contanti : s.totale);
  const competenzaOfSalary = (s: Salary) =>
    (bonificoOfSalary(s) - cassaBancaOfSalary(s)) + (contantiOfSalary(s) - s.cassaContanti);
  const salaryMonthTotals = (month: number) => {
    const rows = salaries.filter((s) => s.month === month);
    const cassa = rows.reduce((sum, s) => sum + cassaBancaOfSalary(s) + s.cassaContanti, 0);
    // Competenza = sola quota ancora di competenza, escluso quanto già registrato in cassa.
    const competenza = rows.reduce((sum, s) => sum + competenzaOfSalary(s), 0);
    return { cassa, competenza, totale: rows.reduce((sum, s) => sum + totaleOfSalary(s), 0) };
  };
  const avgProcessedTotale = useMemo(() => {
    const processedMonths: number[] = [];
    for (let i = 0; i < 12; i++) if (processedFlags[i]) processedMonths.push(salaryMonthTotals(i).totale);
    if (processedMonths.length === 0) return 0;
    return processedMonths.reduce((a, b) => a + b, 0) / processedMonths.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salaries, processedFlags]);

  // Movimenti virtuali generati dagli stipendi per ogni mese
  const salaryVirtualMovements = useMemo(() => {
    const out: CashMovement[] = [];
    const cents = (n: number) => Math.round(n * 100) / 100;
    for (let i = 0; i < 12; i++) {
      const dateStr = sanitizeSalaryPayDate(payDates[i], i);
      if (processedFlags[i]) {
        const monthSalaries = salaries.filter((s) => s.month === i);
        let cassaTot = 0;
        let competenzaTot = 0;
        monthSalaries.forEach((s) => {
          cassaTot += cassaBancaOfSalary(s) + s.cassaContanti;
          // Somma soltanto banca e contanti rimasti nella colonna Competenza.
          competenzaTot += competenzaOfSalary(s);
        });
        cassaTot = cents(cassaTot);
        competenzaTot = cents(competenzaTot);
        // Mese "elaborato": la quota cassa diventa un'uscita di cassa reale,
        // la competenza resta come previsto.
        if (cassaTot !== 0) out.push({ id: `__sal-cassa-${i}`, date: dateStr, description: `Stipendi ${MONTHS[i]}`, category: "Stipendi", paymentMethod: "F", type: "uscita", status: "cassa", amount: cassaTot });
        if (competenzaTot !== 0) out.push({ id: `__sal-prev-${i}`, date: dateStr, description: `Stipendi ${MONTHS[i]} (competenza)`, category: "Stipendi", paymentMethod: "F", type: "uscita", status: "previsto", amount: competenzaTot });
      } else {
        if (avgProcessedTotale > 0) out.push({ id: `__sal-avg-${i}`, date: dateStr, description: `Stipendi ${MONTHS[i]} (media stimata)`, category: "Stipendi", paymentMethod: "F", type: "uscita", status: "previsto", amount: avgProcessedTotale });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salaries, processedFlags, avgProcessedTotale, payDates]);

  const allMovementsForForecast = useMemo(() => [...state.movements, ...salaryVirtualMovements], [state.movements, salaryVirtualMovements]);

  const forecast = useMemo(() => {
    let runningCash = state.openingCash;
    let runningForecast = state.openingCash;
    return MONTHS.map((month, index) => {
      const monthMovements = allMovementsForForecast.filter((m) => new Date(m.date).getMonth() === index);
      const accontoOf = (m: CashMovement) => Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
      const cashIn = monthMovements.reduce((s, m) => {
        if (m.type !== "entrata") return s;
        if (m.status === "cassa") return s + m.amount;
        return s + accontoOf(m);
      }, 0);
      const cashOut = monthMovements.reduce((s, m) => {
        if (m.type !== "uscita") return s;
        if (m.status === "cassa") return s + m.amount;
        return s + accontoOf(m);
      }, 0);
      const expectedIn = monthMovements.reduce((s, m) => {
        if (m.status !== "previsto" || m.type !== "entrata") return s;
        return s + (m.amount - accontoOf(m));
      }, 0);
      const expectedOut = monthMovements.reduce((s, m) => {
        if (m.status !== "previsto" || m.type !== "uscita") return s;
        return s + (m.amount - accontoOf(m));
      }, 0);
      const fixed = monthMovements.filter((m) => paymentCode(m.paymentMethod) === "F" && m.type === "uscita").reduce((s, m) => s + m.amount, 0);
      const cashSaldo = cashIn - cashOut;
      const expectedSaldo = expectedIn - expectedOut;
      runningCash += cashSaldo;
      runningForecast += cashSaldo - expectedOut;
      return { month, movements: monthMovements, cashIn, cashOut, expectedIn, expectedOut, fixed, cashSaldo, expectedSaldo, runningCash, runningForecast };
    });
  }, [state, allMovementsForForecast]);

  const currentCash = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const accontoOf = (m: CashMovement) => Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
    return allMovementsForForecast.reduce((saldo, m) => {
      const d = (m.date || "").slice(0, 10);
      if (d > today) return saldo;
      const paidAmount = m.status === "cassa" ? m.amount : accontoOf(m);
      return m.type === "entrata" ? saldo + paidAmount : saldo - paidAmount;
    }, state.openingCash);
  }, [state.openingCash, allMovementsForForecast]);

  return (
    <div data-dept="generale" className="min-h-screen bg-dept-soft/35">
      <header className="sticky top-0 z-20 border-b-2 border-dept bg-paper">
        <div className="w-full px-3 md:px-6 flex flex-wrap items-center justify-between gap-3 py-3 md:py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-dept text-dept-foreground"><Landmark className="h-5 w-5" /></div>
            <div className="min-w-0"><h1 className="font-display text-lg md:text-2xl font-semibold leading-tight truncate">Contabilità</h1><p className="hidden md:block text-xs uppercase tracking-[0.2em] text-muted-foreground">Entrate, uscite, scadenze, fissi e previsionale</p></div>
          </div>
          <div className="flex flex-wrap gap-2 items-center"><AdminUsersLink variant="outline" /><Button variant="outline" size="sm" onClick={undo} disabled={history.length === 0} title={history.length === 0 ? "Niente da annullare" : `Annulla (${history.length})`}><Undo2 className="h-4 w-4" /><span className="hidden sm:inline">Annulla{history.length > 0 ? ` (${history.length})` : ""}</span></Button><Button variant="outline" size="sm" onClick={redo} disabled={future.length === 0} title={future.length === 0 ? "Niente da rifare" : `Avanti (${future.length})`}><Redo2 className="h-4 w-4" /><span className="hidden sm:inline">Avanti{future.length > 0 ? ` (${future.length})` : ""}</span></Button><Button variant="outline" size="sm" onClick={() => setSnapshotsOpen(true)} title="Versioni precedenti (ripristino)"><History className="h-4 w-4" /><span className="hidden sm:inline">Versioni</span></Button><div className={`flex items-center gap-1.5 text-xs ${saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`} title="Salvataggio automatico in tempo reale">{saveStatus === "saving" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="hidden sm:inline">Salvataggio…</span></>) : saveStatus === "error" ? (<><X className="h-3.5 w-3.5" /><span className="hidden sm:inline">Non salvato</span></>) : (<><Check className="h-3.5 w-3.5 text-green-600" /><span className="hidden sm:inline">Salvato</span></>)}</div></div>
        </div>
      </header>
      <SnapshotsDialog open={snapshotsOpen} onOpenChange={setSnapshotsOpen} remoteKey={REMOTE_KEY} onRestore={restoreSnapshot} />

      <main className="w-full px-3 md:px-6 space-y-6 py-4 md:py-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Utile" value={totals.utile} icon={ArrowUpCircle} />
          <SummaryCard title="Saldo previsionale" value={totals.expected} icon={CalendarClock} />
          <SummaryCard title="Spese fisse mensili" value={totals.fixedMonthly} icon={ArrowDownCircle} />
          <SummaryCard title="Cassa previsionale" value={totals.forecast} icon={ArrowUpCircle} strong />
        </section>

        <Card className="border-2 border-dept shadow-soft">
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Gestione contabile</CardTitle>
            <div className="flex flex-wrap gap-2">
              {([{ key: "generale", label: "Generale" }, { key: "mensile", label: "Mese per mese" }, { key: "movimenti", label: "Movimenti" }, { key: "fisse", label: "Spese fisse" }, ...((isAdmin || canEditHours) ? [{ key: "stipendi" as const, label: "Stipendi" }] : []), { key: "grafici", label: "Grafici" }, { key: "anagrafica", label: "Anagrafica" }] as const).map((item) => (
                <Button key={item.key} size="sm" variant={tab === item.key ? "default" : "outline"} onClick={() => setTab(item.key)}>{item.label}</Button>
              ))}
            </div>
          </CardHeader>
          {tab === "mensile" && <CardContent className="flex flex-wrap gap-2 pt-0">{MONTHS.map((month, index) => <Button key={month} size="sm" variant={selectedMonth === index ? "default" : "outline"} onClick={() => setSelectedMonth(index)}>{month}</Button>)}</CardContent>}
        </Card>

        {tab === "generale" && <GeneralReport totals={totals} movements={allMovementsForForecast} currentCash={currentCash} />}
        {tab === "mensile" && <ForecastTable rows={[forecast[selectedMonth]]} movements={state.movements} salaries={salaries} setMovements={(m) => update((prev) => ({ movements: typeof m === "function" ? (m as (p: CashMovement[]) => CashMovement[])(prev.movements) : m }))} salaryPayDates={payDates} setSalaryPayDates={(salaryPayDates) => update({ salaryPayDates })} contacts={state.contacts ?? []} onAddContact={(c) => update({ contacts: [...(state.contacts ?? []), c] })} currentCash={currentCash} />}
        {tab === "movimenti" && <MovementsTable movements={state.movements} setMovements={(m) => update((prev) => ({ movements: typeof m === "function" ? (m as (p: CashMovement[]) => CashMovement[])(prev.movements) : m }))} addMovement={addMovement} openingCash={state.openingCash} setOpeningCash={(openingCash) => update({ openingCash })} />}
        {tab === "fisse" && <FixedTable title="Spese fisse mensili" category="Fissi" expenses={state.fixedExpenses} setExpenses={(fixedExpenses) => update({ fixedExpenses })} addFixed={() => addFixed("Fissi")} />}
        {tab === "stipendi" && (isAdmin || canEditHours) && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {isAdmin && <Button size="sm" variant={stipendiSub === "stipendi" ? "default" : "outline"} onClick={() => setStipendiSub("stipendi")}>Stipendi</Button>}
              {!isAdmin && canEditHours && <Button size="sm" variant={stipendiSub === "contanti" ? "default" : "outline"} onClick={() => setStipendiSub("contanti")}>Contanti da consegnare</Button>}
              {canEditHours && <Button size="sm" variant={stipendiSub === "ore" ? "default" : "outline"} onClick={() => setStipendiSub("ore")}>Calcolo ore</Button>}
            </div>
            {stipendiSub === "stipendi" && isAdmin && <SalariesTable salaries={state.salaries ?? []} setSalaries={(salaries) => update({ salaries })} processed={state.salariesProcessed ?? []} setProcessed={(salariesProcessed) => update({ salariesProcessed })} payDates={payDates} setPayDates={(salaryPayDates) => update({ salaryPayDates })} hoursLog={state.hoursLog ?? {}} isAdmin={isAdmin} />}
            {stipendiSub === "contanti" && !isAdmin && canEditHours && <CashOnlySalariesView salaries={state.salaries ?? []} processed={state.salariesProcessed ?? []} payDates={payDates} hoursLog={state.hoursLog ?? {}} />}
            {stipendiSub === "ore" && canEditHours && <HoursLogView hoursLog={state.hoursLog ?? {}} setHoursLog={(hoursLog) => update({ hoursLog })} canEdit={canEditHours} />}
          </div>
        )}
        {tab === "grafici" && (
          <ChartsView
            movements={allMovementsForForecast}
            goals={state.goals ?? {}}
            setGoals={(goals) => update({ goals })}
            fixedExpenses={state.fixedExpenses}
            setFixedExpenses={(fixedExpenses) => update({ fixedExpenses })}
            currentCash={currentCash}
            openingCash={state.openingCash}
            cashIn={totals.cashIn}
            cashOut={totals.cashOut}
            expectedIn={totals.expectedIn}
            expectedOut={totals.expectedOut}
          />
        )}
        {tab === "anagrafica" && (
          <AnagraficaView
            contacts={state.contacts ?? []}
            setContacts={(contacts) => update({ contacts })}
            movements={state.movements}
          />
        )}
      </main>
      <MovementWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreate={createMovement}
        contacts={state.contacts ?? []}
        onAddContact={(c) => update({ contacts: [...(state.contacts ?? []), c] })}
      />
    </div>
  );
}

const SummaryCard = ({ title, value, icon: Icon, strong }: { title: string; value: number; icon: typeof Landmark; strong?: boolean }) => (
  <Card className="border-2 border-dept bg-paper shadow-soft">
    <CardContent className="flex items-center justify-between gap-4 p-5">
      <div><div className="label-cap mb-2">{title}</div><div className={`font-mono text-2xl font-bold ${strong ? "text-dept" : ""}`}>{eur(value)}</div></div>
      <Icon className="h-6 w-6 text-dept" />
    </CardContent>
  </Card>
);

type AccountingTotals = { cash: number; cashToday: number; expected: number; forecast: number; fixedMonthly: number; cashIn: number; cashOut: number; expectedIn: number; expectedOut: number; utile: number };

const GeneralReport = ({ totals, movements, currentCash }: { totals: AccountingTotals; movements: CashMovement[]; currentCash: number }) => {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = search.trim().toLowerCase();
  const inRange = (iso: string) => {
    if (!from && !to) return true;
    const d = iso.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  const filtered = movements.filter((m) => {
    if (q && !(m.description.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))) return false;
    return inRange(m.date);
  });
  const rangeActive = !!(from || to);
  const rangeTotals = useMemo(() => computeMovementTotals(filtered), [filtered]);
  const rangeCoverage = currentCash - rangeTotals.expectedOut;
  const view = rangeActive
    ? { ...rangeTotals, utile: rangeTotals.cashIn - rangeTotals.cashOut, cash: rangeTotals.cashIn - rangeTotals.cashOut, expected: rangeTotals.expectedIn - rangeTotals.expectedOut }
    : totals;
  const top = (type: MovementType, status: MovementStatus) => filtered
    .filter((m) => m.type === type && m.status === status)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="xl:col-span-2 space-y-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Cerca per voce o categoria in tutti i movimenti…" />
        <DateRangeFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>
      <Card className="border-2 border-dept shadow-soft"><CardHeader><CardTitle>Riepilogo {rangeActive ? "intervallo" : "generale"}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><SummaryLine label="Entrate in cassa" value={view.cashIn} /><SummaryLine label="Uscite in cassa" value={view.cashOut} /><SummaryLine label="Utile" value={view.utile} strong /><SummaryLine label="Entrate previste" value={view.expectedIn} /><SummaryLine label="Uscite previste" value={view.expectedOut} />{rangeActive ? (<><SummaryLine label="Cassa attuale" value={currentCash} strong /><SummaryLine label="Copertura vs scadenze (cassa attuale − uscite previste)" value={rangeCoverage} strong /></>) : (<><SummaryLine label="Saldo cassa" value={view.cash} strong /><SummaryLine label="Saldo cassa + previsto" value={view.cash + view.expected} strong /></>)}</CardContent></Card>
      <Card className="border-2 border-dept shadow-soft"><CardHeader><CardTitle>Causali principali</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><MiniList title="Clienti incassati" rows={top("entrata", "cassa")} /><MiniList title="Fornitori pagati" rows={top("uscita", "cassa")} /><MiniList title="Clienti da incassare" rows={top("entrata", "previsto")} /><MiniList title="Fornitori da pagare" rows={top("uscita", "previsto")} /></CardContent></Card>
    </div>
  );
};

const computeMovementTotals = (movs: CashMovement[]) => {
  const accontoOf = (m: CashMovement) => Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
  let cashIn = 0, cashOut = 0, expectedIn = 0, expectedOut = 0;
  for (const m of movs) {
    if (m.type === "entrata") {
      if (m.status === "cassa") cashIn += m.amount;
      else { cashIn += accontoOf(m); expectedIn += m.amount - accontoOf(m); }
    } else {
      if (m.status === "cassa") cashOut += m.amount;
      else { cashOut += accontoOf(m); expectedOut += m.amount - accontoOf(m); }
    }
  }
  return { cashIn, cashOut, expectedIn, expectedOut };
};

const DateRangeFilter = ({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) => {
  const active = !!(from || to);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-sm border border-border bg-background p-2">
      <div className="flex flex-col gap-1">
        <span className="label-cap">Dal</span>
        <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="h-8 w-[140px] text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="label-cap">Al</span>
        <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="h-8 w-[140px] text-xs" />
      </div>
      {active && (
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onChange("", "")}>
          <X className="h-3.5 w-3.5" />Azzera
        </Button>
      )}
      {active && (
        <span className="text-xs text-muted-foreground">Filtro intervallo attivo</span>
      )}
    </div>
  );
};

const SearchBar = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Cerca…"}
      className="h-9 pl-8 pr-8 text-sm"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange("")}
        aria-label="Cancella ricerca"
        className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

const SummaryLine = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
  <div className="flex items-center justify-between gap-4 rounded-sm border border-border bg-background p-3">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className={`font-mono tabular-nums ${strong ? "text-lg font-bold text-dept" : "font-semibold"}`}>{eur(value)}</span>
  </div>
);

const MiniList = ({ title, rows }: { title: string; rows: CashMovement[] }) => (
  <div className="space-y-2">
    <div className="label-cap">{title}</div>
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna voce</p> : rows.map((m) => (
      <div key={m.id} className="flex items-center justify-between gap-3 border-b border-border pb-1 text-sm">
        <span className="truncate">{m.description}</span>
        <span className="shrink-0 font-mono font-semibold">{eur(m.amount)}</span>
      </div>
    ))}
  </div>
);

const formatDateShort = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });
};

const AdditionsControl = ({ movement, onChange, compact = false }: { movement: CashMovement; onChange: (patch: Partial<CashMovement>) => void; compact?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const additions = movement.additions ?? [];
  const apply = () => {
    const v = Number(String(draft).replace(",", "."));
    if (!isFinite(v) || v === 0) { setDraft(""); return; }
    const today = new Date().toISOString().slice(0, 10);
    onChange({
      amount: Math.max(0, (movement.amount || 0) + v),
      additions: [...additions, { date: today, amount: v }],
    });
    setDraft("");
    setOpen(false);
    toast.success(`+${eur(v)} aggiunto a "${movement.description}"`);
  };
  const removeAt = (idx: number) => {
    const rem = additions[idx];
    if (!rem) return;
    onChange({
      amount: Math.max(0, (movement.amount || 0) - rem.amount),
      additions: additions.filter((_, i) => i !== idx),
    });
  };
  const btnSize = compact ? "h-7 px-2 text-xs" : "h-9 px-2 text-xs";
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" className={btnSize} title="Aggiungi importo a questa voce">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-2">
            <div className="label-cap">Aggiungi importo</div>
            <div className="flex gap-2">
              <Input
                autoFocus
                type="number"
                step="0.01"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
                placeholder="es. 35,40"
                className="h-9 text-sm"
              />
              <Button type="button" size="sm" className="h-9" onClick={apply}>OK</Button>
            </div>
            <p className="text-xs text-muted-foreground">Verrà sommato all'importo della voce.</p>
          </div>
        </PopoverContent>
      </Popover>
      {additions.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className={`${btnSize} text-muted-foreground hover:text-foreground`} title="Cronologia integrazioni">
              <History className="h-3.5 w-3.5" />
              <span className="ml-1">{additions.length}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-2">
              <div className="label-cap">Cronologia integrazioni</div>
              <div className="space-y-1 max-h-64 overflow-auto">
                {additions.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-sm">
                    <span className="text-muted-foreground">{formatDateShort(a.date)}</span>
                    <span className="font-mono font-semibold">+{eur(a.amount)}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeAt(i)} title="Rimuovi">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

const MovementsTable = ({ movements, setMovements, addMovement, openingCash, setOpeningCash }: { movements: CashMovement[]; setMovements: (m: CashMovement[] | ((prev: CashMovement[]) => CashMovement[])) => void; addMovement: () => void; openingCash: number; setOpeningCash: (n: number) => void }) => (
  <Card className="border-2 border-dept shadow-soft">
    <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Entrate e uscite</CardTitle><Button size="sm" onClick={addMovement}><Plus className="h-4 w-4" />Movimento</Button></CardHeader>
    <CardContent className="space-y-3">
      <Field label="Cassa iniziale"><NumberInput value={openingCash} onChange={setOpeningCash} /></Field>
      {movements.map((m) => <div key={m.id} className="space-y-2 rounded-sm border border-border bg-background p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[120px_minmax(220px,1fr)_150px_130px_110px_120px_130px_40px] xl:items-end">
          <Field label="Data"><DateInput value={m.date} onCommit={(v) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, date: v } : x))} /></Field>
          <Field label="Causale"><TextInput value={m.description} onCommit={(description) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, description } : x))} /></Field>
          <Field label="Categoria"><TextInput value={m.category} onCommit={(category) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, category } : x))} /></Field>
          <Field label="Metodo"><PaymentMethodSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={m.paymentMethod ?? ""} onChange={(v) => setMovements((prev) => prev.map((x) => x.id === m.id ? normalizeMovement({ ...x, paymentMethod: v }) : x))} /></Field>
          <Field label="Tipo"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={m.type} onChange={(e) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, type: e.target.value as MovementType } : x))}><option value="entrata">Entrata</option><option value="uscita">Uscita</option></select></Field>
          <Field label="Stato"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={m.status} onChange={(e) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, status: e.target.value as MovementStatus } : x))}><option value="cassa">Cassa</option><option value="previsto">Competenza</option></select></Field>
          <Field label={m.gestitoAcconti && (m.acconto ?? 0) > 0 ? "Importo (residuo)" : "Importo"}>
            <div className="flex items-center gap-1">
              <NumberInput
                value={m.gestitoAcconti ? Math.max(0, m.amount - (m.acconto ?? 0)) : m.amount}
                onChange={(v) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, amount: x.gestitoAcconti ? v + (x.acconto ?? 0) : v } : x))}
              />
              <AdditionsControl movement={m} onChange={(patch) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, ...patch } : x))} />
            </div>
          </Field>
          <Button type="button" size="icon" variant="ghost" onClick={() => setMovements((prev) => prev.filter((x) => x.id !== m.id))}><Trash2 className="h-4 w-4" /></Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[260px_200px_260px_1fr] xl:items-end">
          <Field label="N° Fattura"><TextInput className="font-mono" placeholder="es. 2026/123" value={m.invoiceNumber ?? ""} onCommit={(invoiceNumber) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, invoiceNumber } : x))} /></Field>
          <Field label="Gestito per Acconti">
            <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <input type="checkbox" checked={!!m.gestitoAcconti} onChange={(e) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, gestitoAcconti: e.target.checked, acconto: e.target.checked ? x.acconto : undefined } : x))} />
              Sì
            </label>
          </Field>
          {m.status === "previsto" && m.gestitoAcconti && (
            <Field label={`Acconto (in cassa)${(m.acconto ?? 0) > 0 && m.amount > 0 ? ` · residuo ${eur(Math.max(0, m.amount - (m.acconto ?? 0)))}` : ""}`}>
              <div className="flex gap-2">
                <NumberInput value={m.acconto ?? 0} onChange={(acconto) => setMovements((prev) => prev.map((x) => x.id === m.id ? { ...x, acconto: Math.max(0, Math.min(acconto, x.amount)) } : x))} />
                <Button type="button" size="sm" variant="outline" disabled={!((m.acconto ?? 0) > 0)} onClick={() => {
                  const q = Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
                  if (q <= 0) return;
                  const today = new Date().toISOString().slice(0, 10);
                  const cassaMov: CashMovement = normalizeMovement({
                    id: uid(),
                    date: today,
                    description: `Acconto — ${m.description}`,
                    category: m.category,
                    paymentMethod: m.paymentMethod,
                    type: m.type,
                    status: "cassa",
                    amount: q,
                    invoiceNumber: m.invoiceNumber,
                  });
                  setMovements((prev) => [
                    ...prev.map((x) => x.id === m.id ? { ...x, amount: Math.max(0, x.amount - q), acconto: undefined } : x),
                    cassaMov,
                  ]);
                  toast.success(`Acconto di ${eur(q)} registrato in cassa`);
                }}>Applica</Button>
              </div>
            </Field>
          )}
        </div>
      </div>)}
    </CardContent>
  </Card>
);

const FixedTable = ({ title, category, expenses, setExpenses, addFixed }: { title: string; category: string; expenses: FixedExpense[]; setExpenses: (e: FixedExpense[]) => void; addFixed: () => void }) => (
  <Card className="border-2 border-dept shadow-soft">
    <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>{title}</CardTitle><Button size="sm" onClick={addFixed}><Plus className="h-4 w-4" />{category === "Stipendi" ? "Stipendio" : "Spesa fissa"}</Button></CardHeader>
    <CardContent className="space-y-3">
      {expenses.filter((e) => category === "Stipendi" ? e.category === "Stipendi" : e.category !== "Stipendi").map((e) => <div key={e.id} className="grid gap-3 rounded-sm border border-border bg-background p-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_110px_120px_110px_40px] xl:items-end">
        <Field label="Descrizione"><TextInput value={e.description} onCommit={(description) => setExpenses(expenses.map((x) => x.id === e.id ? { ...x, description } : x))} /></Field>
        <Field label="Categoria"><TextInput value={e.category} onCommit={(category) => setExpenses(expenses.map((x) => x.id === e.id ? { ...x, category } : x))} /></Field>
        <Field label="Giorno"><NumberInput value={e.day} onChange={(day) => setExpenses(expenses.map((x) => x.id === e.id ? { ...x, day } : x))} /></Field>
        <Field label="Importo"><NumberInput value={e.amount} onChange={(amount) => setExpenses(expenses.map((x) => x.id === e.id ? { ...x, amount } : x))} /></Field>
        <Field label="Attiva"><label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><input type="checkbox" checked={e.active} onChange={(ev) => setExpenses(expenses.map((x) => x.id === e.id ? { ...x, active: ev.target.checked } : x))} />Sì</label></Field>
        <Button type="button" size="icon" variant="ghost" onClick={() => setExpenses(expenses.filter((x) => x.id !== e.id))}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
    </CardContent>
  </Card>
);

const WIZARD_STEPS = ["Data", "Causale", "Tipo & Stato", "Categoria & Metodo", "Importo"] as const;

const MovementWizard = ({ open, onOpenChange, onCreate, contacts, onAddContact }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (m: Omit<CashMovement, "id">) => void; contacts: Contact[]; onAddContact: (c: Contact) => void }) => {
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [type, setType] = useState<MovementType>("uscita");
  const [status, setStatus] = useState<MovementStatus>("previsto");
  const [category, setCategory] = useState("Generale");
  const [paymentMethod, setPaymentMethod] = useState("B");
  const [amount, setAmount] = useState(0);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [acconto, setAcconto] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [highlight, setHighlight] = useState(-1);

  useEffect(() => {
    if (open) {
      setStep(0);
      setDate(new Date().toISOString().slice(0, 10));
      setDescription("");
      setType("uscita");
      setStatus("previsto");
      setCategory("Generale");
      setPaymentMethod("B");
      setAmount(0);
      setInvoiceNumber("");
      setAcconto(0);
      setError(null);
      setShowSuggestions(true);
      setHighlight(-1);
    }
  }, [open]);

  // Suggerimenti dopo 3 lettere, filtrati per tipo movimento
  const suggestions = useMemo(
    () => suggestContacts(description, contacts, type),
    [description, contacts, type],
  );
  const exactMatch = useMemo(() => {
    const q = normalizeText(description);
    return q.length >= 3 ? contacts.find((c) => normalizeText(c.name) === q) : null;
  }, [description, contacts]);
  const canQuickAdd = description.trim().length >= 3 && !exactMatch;
  const quickAdd = () => {
    const newContact: Contact = {
      id: uid(),
      type: type === "entrata" ? "cliente" : "fornitore",
      name: description.trim(),
      createdAt: new Date().toISOString(),
    };
    onAddContact(newContact);
    toast.success(`${type === "entrata" ? "Cliente" : "Fornitore"} "${newContact.name}" aggiunto all'anagrafica`);
  };

  const validateStep = (): string | null => {
    if (step === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Data non valida";
    if (step === 1 && description.trim().length === 0) return "Inserisci una causale";
    if (step === 1 && description.trim().length > 200) return "Causale troppo lunga (max 200)";
    if (step === 3 && category.trim().length === 0) return "Inserisci una categoria";
    if (step === 4 && (!Number.isFinite(amount) || amount <= 0)) return "Importo deve essere maggiore di zero";
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    if (step < WIZARD_STEPS.length - 1) setStep(step + 1);
    else {
      const safeAcconto = status === "previsto" ? Math.max(0, Math.min(acconto, amount)) : 0;
      onCreate({
        date,
        description: description.trim(),
        category: category.trim(),
        paymentMethod,
        type,
        status,
        amount,
        invoiceNumber: invoiceNumber.trim() || undefined,
        acconto: safeAcconto > 0 ? safeAcconto : undefined,
      });
      onOpenChange(false);
    }
  };

  const back = () => { setError(null); if (step > 0) setStep(step - 1); };

  // F10 = scorciatoia per il pulsante principale (Avanti / Salva)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, date, description, type, status, category, paymentMethod, amount, invoiceNumber, acconto]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuovo movimento — Step {step + 1}/{WIZARD_STEPS.length}: {WIZARD_STEPS[step]}</DialogTitle>
          <DialogDescription>Compila i campi richiesti per registrare un nuovo movimento di cassa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {step === 0 && <Field label="Data"><DateInput value={date} onCommit={setDate} /></Field>}
          {step === 1 && (
            <div className="space-y-2">
              <Field label="Causale">
                <div className="flex gap-2">
                  <Input
                    value={description}
                    maxLength={200}
                    placeholder="Es. Fornitore Rossi - fattura 123"
                    onChange={(e) => { setDescription(e.target.value); setShowSuggestions(true); }}
                    onKeyDown={(e) => {
                      if (!showSuggestions || suggestions.length === 0) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHighlight((h) => (h + 1) % suggestions.length);
                      } else if (e.key === "Tab" && !e.shiftKey) {
                        // Tab → scendi nella lista suggerimenti (se nessuno evidenziato → primo)
                        e.preventDefault();
                        setHighlight((h) => (h < 0 ? 0 : (h + 1) % suggestions.length));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
                      } else if (e.key === "Enter" && highlight >= 0) {
                        e.preventDefault();
                        setDescription(suggestions[highlight].name);
                        setShowSuggestions(false);
                        setHighlight(-1);
                      } else if (e.key === "Enter" && highlight < 0 && suggestions.length === 1) {
                        // Invio con un unico suggerimento → conferma
                        e.preventDefault();
                        setDescription(suggestions[0].name);
                        setShowSuggestions(false);
                      } else if (e.key === "Escape") {
                        setShowSuggestions(false);
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant={canQuickAdd ? "default" : "outline"}
                    size="icon"
                    title={canQuickAdd
                      ? `Aggiungi "${description.trim()}" come ${type === "entrata" ? "cliente" : "fornitore"}`
                      : exactMatch ? "Già presente in anagrafica" : "Scrivi almeno 3 lettere"}
                    disabled={!canQuickAdd}
                    onClick={quickAdd}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </Field>
              {showSuggestions && suggestions.length > 0 && (
                <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground px-1 flex items-center justify-between">
                    <span>Suggerimenti dall'anagrafica · {type === "entrata" ? "clienti" : "fornitori"}</span>
                    <button type="button" className="hover:text-foreground" onClick={() => setShowSuggestions(false)}><X className="h-3 w-3" /></button>
                  </div>
                  {suggestions.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => { setDescription(c.name); setShowSuggestions(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between ${i === highlight ? "bg-background" : "hover:bg-background"}`}
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.vat && <span className="text-xs text-muted-foreground font-mono">{c.vat}</span>}
                    </button>
                  ))}
                </div>
              )}
              {exactMatch && (
                <p className="text-[11px] text-muted-foreground">✓ "{exactMatch.name}" è già in anagrafica come {exactMatch.type}.</p>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={type} onChange={(e) => setType(e.target.value as MovementType)}><option value="entrata">Entrata</option><option value="uscita">Uscita</option></select></Field>
              <Field label="Stato"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as MovementStatus)}><option value="cassa">Cassa</option><option value="previsto">Competenza</option></select></Field>
            </div>
          )}
          {step === 3 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Categoria"><Input value={category} maxLength={80} onChange={(e) => setCategory(e.target.value)} /></Field>
              <Field label="Metodo"><PaymentMethodSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={paymentMethod} onChange={setPaymentMethod} showLongLabels /></Field>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <Field label="Importo (€)"><NumberInput value={amount} onChange={setAmount} /></Field>
              <Field label="N° Fattura (opzionale)">
                <Input
                  value={invoiceNumber}
                  maxLength={60}
                  placeholder="es. 2026/123"
                  className="font-mono"
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                />
              </Field>
              {status === "previsto" && (
                <Field label={`Acconto già in cassa (€)${acconto > 0 && amount > 0 ? ` · residuo ${eur(Math.max(0, amount - acconto))}` : ""}`}>
                  <NumberInput value={acconto} onChange={(v) => setAcconto(Math.max(0, Math.min(v, amount)))} />
                </Field>
              )}
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="label-cap mb-2">Riepilogo</div>
                <div className="grid grid-cols-2 gap-1">
                  <span className="text-muted-foreground">Data</span><span className="font-mono">{date}</span>
                  <span className="text-muted-foreground">Causale</span><span className="truncate">{description}</span>
                  <span className="text-muted-foreground">Tipo / Stato</span><span>{type} / {status}</span>
                  <span className="text-muted-foreground">Categoria / Metodo</span><span>{category} / {paymentMethod}</span>
                  <span className="text-muted-foreground">Importo</span><span className="font-mono font-semibold">{eur(amount)}</span>
                  {invoiceNumber.trim() && (<><span className="text-muted-foreground">N° Fattura</span><span className="font-mono">{invoiceNumber.trim()}</span></>)}
                  {status === "previsto" && acconto > 0 && (<><span className="text-muted-foreground">Acconto in cassa</span><span className="font-mono">{eur(acconto)} <span className="text-muted-foreground">· residuo {eur(Math.max(0, amount - acconto))}</span></span></>)}
                </div>
              </div>
            </div>
          )}
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={back} disabled={step === 0}>Indietro</Button>
          <Button onClick={next} title="Scorciatoia: F10">{step < WIZARD_STEPS.length - 1 ? "Avanti (F10)" : "Salva movimento (F10)"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ForecastTable = ({ rows, movements, salaries, setMovements, salaryPayDates, setSalaryPayDates, contacts, onAddContact, currentCash }: { rows: { month: string; movements: CashMovement[]; cashIn: number; cashOut: number; expectedIn: number; expectedOut: number; fixed: number; cashSaldo: number; expectedSaldo: number; runningCash: number; runningForecast: number }[]; movements: CashMovement[]; salaries: Salary[]; setMovements: (m: CashMovement[] | ((prev: CashMovement[]) => CashMovement[])) => void; salaryPayDates: string[]; setSalaryPayDates: (d: string[]) => void; contacts: Contact[]; onAddContact: (c: Contact) => void; currentCash: number }) => (
  <div className="space-y-5">{rows.map((r) => <MonthSection key={r.month} row={r} movements={movements} salaries={salaries} setMovements={setMovements} salaryPayDates={salaryPayDates} setSalaryPayDates={setSalaryPayDates} contacts={contacts} onAddContact={onAddContact} currentCash={currentCash} />)}</div>
);

/**
 * Input data che committa SOLO su Invio o blur.
 * Mentre l'utente digita o naviga col calendario il valore visibile cambia,
 * ma onCommit viene chiamato solo quando l'utente preme Invio o esce dal campo.
 */
const DateInput = ({
  value,
  onCommit,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  ariaLabel?: string;
}) => {
  const [draft, setDraft] = useState(value);
  const lastCommittedRef = useRef(value);
  // Sincronizza quando il valore esterno cambia (es. import, switch mese)
  useEffect(() => { setDraft(value); lastCommittedRef.current = value; }, [value]);
  const commitValue = (next: string) => {
    if (next === value || next === lastCommittedRef.current) return;
    if (isCompleteDate(next)) {
      lastCommittedRef.current = next;
      onCommit(next);
    } else {
      // input incompleto: ripristina il valore precedente
      setDraft(value);
    }
  };
  const commit = () => commitValue(draft);
  return (
    <Input
      aria-label={ariaLabel}
      className={className}
      type="date"
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (isCompleteDate(next)) commitValue(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      onBlur={commit}
    />
  );
};

// Input data leggero, da tastiera. Accetta "g", "gg", "gg/mm", "gg/mm/aaaa".
// Completa automaticamente con il mese/anno della scheda corrente.
const QuickDateInput = ({
  value,
  onCommit,
  monthIndex,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  monthIndex: number;
  className?: string;
  ariaLabel?: string;
}) => {
  const fmt = (iso: string) => {
    if (!isCompleteDate(iso)) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  };
  const [draft, setDraft] = useState(fmt(value));
  useEffect(() => { setDraft(fmt(value)); }, [value]);
  const parse = (raw: string): string | null => {
    const s = raw.trim().replace(/[.\-\s]/g, "/");
    if (!s) return null;
    const parts = s.split("/").filter(Boolean);
    const today = new Date();
    const baseYear = today.getFullYear();
    let d = NaN, m = monthIndex + 1, y = baseYear;
    if (parts.length === 1) { d = Number(parts[0]); }
    else if (parts.length === 2) { d = Number(parts[0]); m = Number(parts[1]); }
    else if (parts.length >= 3) {
      d = Number(parts[0]); m = Number(parts[1]);
      let yy = Number(parts[2]);
      if (yy < 100) yy += 2000;
      y = yy;
    }
    if (!Number.isFinite(d) || d < 1 || d > 31) return null;
    if (!Number.isFinite(m) || m < 1 || m > 12) return null;
    if (!Number.isFinite(y)) return null;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return isCompleteDate(iso) ? iso : null;
  };
  const commit = () => {
    const iso = parse(draft);
    if (iso && iso !== value) { onCommit(iso); return; }
    if (!iso) setDraft(fmt(value));
  };
  return (
    <Input
      aria-label={ariaLabel}
      className={className}
      type="text"
      inputMode="numeric"
      placeholder="gg/mm/aa"
      value={draft}
      onFocus={(e) => { e.currentTarget.select(); }}
      onChange={(e) => {
        let raw = e.target.value.replace(/[^\d/]/g, "");
        const isDeleting = raw.length < draft.length;
        // Estrai solo cifre per auto-formattazione
        const digitsOnly = raw.replace(/\D/g, "");
        // Se l'utente sta inserendo cifre (anche pasting o sostituendo tutto),
        // riformatta come gg/mm/aa man mano che digita.
        if (!isDeleting) {
          const d = digitsOnly.slice(0, 8);
          if (d.length === 0) raw = "";
          else if (d.length <= 2) raw = d;
          else if (d.length <= 4) raw = d.slice(0, 2) + "/" + d.slice(2);
          else raw = d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
        }
        if (raw.length > 10) raw = raw.slice(0, 10);
        setDraft(raw);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(fmt(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      onBlur={commit}
    />
  );
};

type ImportColumnBlock = { descriptionCol: number; dateCol: number; methodCol: number; amountCol: number; type: MovementType; status: MovementStatus };

const IMPORT_TARGETS: Pick<ImportColumnBlock, "type" | "status">[] = [
  { type: "entrata", status: "cassa" },
  { type: "uscita", status: "cassa" },
  { type: "entrata", status: "previsto" },
  { type: "uscita", status: "previsto" },
];

const parseImportAmount = (raw: string): number => {
  let s = String(raw || "").trim().replace(/[€\s]/g, "");
  if (!s) return 0;
  s = s.replace(/[()]/g, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,(?=\d{3}(\D|$))/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : 0;
};

const looksLikeExcelSerialDate = (raw: string) => {
  const n = Number(String(raw || "").trim());
  return Number.isFinite(n) && n >= 20000 && n <= 60000;
};

const parseImportDate = (raw: string, monthIndex: number): string => {
  const year = new Date().getFullYear();
  const fallbackDate = `${year}-${String(monthIndex + 1).padStart(2, "0")}-15`;
  const s = String(raw || "").trim();
  const mm = String(monthIndex + 1).padStart(2, "0");
  if (!s) return fallbackDate;
  if (looksLikeExcelSerialDate(s)) {
    const parsed = XLSX.SSF.parse_date_code(Number(s));
    if (parsed) return `${parsed.y}-${mm}-${String(parsed.d).padStart(2, "0")}`;
  }
  if (isCompleteDate(s)) return `${s.split("-")[0]}-${mm}-${s.split("-")[2]}`;
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return `${y}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[-/\s]([a-zA-Zàèéìòù]{3,})\.?(?:[-/\s](\d{2,4}))?$/);
  if (m) {
    let y = m[3] || String(year); if (y.length === 2) y = "20" + y;
    return `${y}-${mm}-${m[1].padStart(2, "0")}`;
  }
  return fallbackDate;
};

const parseImportMethod = (raw: string) => {
  const method = paymentCode(raw).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  if (method === "CC") return "C";
  return ["B", "C", "F", "N", "R", "A"].includes(method) ? method : "B";
};

const excelCellToText = (cell?: XLSX.CellObject) => {
  const value = cell?.v as unknown;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(10).replace(/\.?0+$/, "");
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
};

const worksheetToImportRows = (ws: XLSX.WorkSheet) => {
  if (!ws["!ref"]) return [] as string[][];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = excelCellToText(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined);
      row.push(text);
      if (text) hasValue = true;
    }
    if (hasValue) rows.push(row);
  }
  return rows;
};

const isImportHeader = (cols: string[]) => {
  const joined = normalizeImportText(cols.join(" "));
  const hasRealAmount = cols.some((col) => parseImportAmount(col) > 0 && !looksLikeExcelSerialDate(col));
  return !hasRealAmount && /cassa|competenza|entrate|uscite|colonna|voce|metodo|importo|data/.test(joined);
};

const columnNonEmptyScore = (rows: string[][], col: number, amountCol: number) => {
  let checked = 0, filled = 0;
  for (const row of rows) {
    if (isImportHeader(row) || parseImportAmount(row[amountCol]) === 0) continue;
    checked++;
    if ((row[col] || "").trim()) filled++;
  }
  return checked === 0 ? 0 : filled / checked;
};

const methodColumnScore = (rows: string[][], methodCol: number, amountCol: number) => {
  let checked = 0, ok = 0;
  for (const row of rows) {
    if (isImportHeader(row) || parseImportAmount(row[amountCol]) === 0) continue;
    checked++;
    const raw = normalizeImportText(row[methodCol] || "").toUpperCase();
    if (!raw || ["B", "C", "CC", "F", "N", "R", "A", "BONIFICO", "CONTANTI", "RIBA"].includes(raw)) ok++;
  }
  return checked === 0 ? 0 : ok / checked;
};

const detectImportBlocks = (rows: string[][]): ImportColumnBlock[] => {
  // 1) Riconoscimento template ufficiale: cerca una riga di header che contenga
  //    VOCE / DATA / MET. / IMPORTO ripetuti per 4 quadranti.
  //    Le colonne possono variare (es. presenza di PAG.) quindi rileviamo
  //    dinamicamente le posizioni di ciascuna intestazione.
  for (const row of rows) {
    const norm = row.map((c) => normalizeImportText(c || "").toUpperCase());
    const voceCols: number[] = [];
    const dateCols: number[] = [];
    const methodCols: number[] = [];
    const importoCols: number[] = [];
    norm.forEach((cell, i) => {
      if (!cell) return;
      if (cell.startsWith("VOCE")) voceCols.push(i);
      else if (cell.startsWith("DATA")) dateCols.push(i);
      else if (cell.startsWith("MET")) methodCols.push(i);
      else if (cell.startsWith("IMPORTO")) importoCols.push(i);
    });
    if (
      voceCols.length >= 4 &&
      dateCols.length >= 4 &&
      methodCols.length >= 4 &&
      importoCols.length >= 4
    ) {
      // Per ogni quadrante (4) costruisci il blocco usando le colonne
      // corrispondenti (ordinate da sinistra a destra).
      return [0, 1, 2, 3].map((idx) => ({
        descriptionCol: voceCols[idx],
        dateCol: dateCols[idx],
        methodCol: methodCols[idx],
        amountCol: importoCols[idx],
        ...IMPORT_TARGETS[idx],
      }));
    }
  }
  // 2) Auto-detect euristico (compatibilità con file legacy)
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const amountCols: { amountCol: number; methodCol: number }[] = [];
  for (let col = 0; col < maxCols; col++) {
    let amounts = 0, dateLikes = 0;
    for (const row of rows) {
      if (isImportHeader(row)) continue;
      const amount = parseImportAmount(row[col]);
      if (amount === 0) continue;
      amounts++;
      if (looksLikeExcelSerialDate(row[col])) dateLikes++;
    }
    if (amounts === 0 || dateLikes / amounts > 0.6) continue;
    let methodCol = Math.max(0, col - 1), bestScore = -1;
    for (let candidate = col - 1; candidate >= Math.max(0, col - 3); candidate--) {
      const score = methodColumnScore(rows, candidate, col);
      if (score > bestScore) { bestScore = score; methodCol = candidate; }
    }
    if (bestScore >= 0.45 || col <= 3) amountCols.push({ amountCol: col, methodCol });
  }
  const blocks = amountCols.slice(0, 4).map(({ amountCol, methodCol }, index) => {
    const before = methodCol - 1;
    const twoBefore = methodCol - 2;
    const twoBeforeIsDescription = twoBefore >= 0 && columnNonEmptyScore(rows, twoBefore, amountCol) >= columnNonEmptyScore(rows, before, amountCol);
    const descriptionCol = twoBeforeIsDescription ? twoBefore : before;
    const dateCol = twoBeforeIsDescription ? before : -1;
    return { descriptionCol, dateCol, methodCol, amountCol, ...IMPORT_TARGETS[index] };
  });
  return blocks.length > 0 ? blocks : [0, 4, 8, 12].map((offset, index) => ({ descriptionCol: offset, dateCol: offset + 1, methodCol: offset + 2, amountCol: offset + 3, ...IMPORT_TARGETS[index] }));
};

const MonthSection = ({ row: r, movements, salaries, setMovements, salaryPayDates, setSalaryPayDates, contacts, onAddContact, currentCash }: { row: { month: string; movements: CashMovement[]; cashIn: number; cashOut: number; expectedIn: number; expectedOut: number; fixed: number; cashSaldo: number; expectedSaldo: number; runningCash: number; runningForecast: number }; movements: CashMovement[]; salaries: Salary[]; setMovements: (m: CashMovement[] | ((prev: CashMovement[]) => CashMovement[])) => void; salaryPayDates: string[]; setSalaryPayDates: (d: string[]) => void; contacts: Contact[]; onAddContact: (c: Contact) => void; currentCash: number }) => {
  const monthIndex = MONTHS.indexOf(r.month);
  const updateMovement = (id: string, patch: Partial<CashMovement>) => {
    if (id.startsWith("__sal-") && patch.date && isCompleteDate(patch.date)) {
      const next = Array.from({ length: 12 }, (_, i) => sanitizeSalaryPayDate(salaryPayDates[i], i));
      next[monthIndex] = patch.date;
      setSalaryPayDates(next);
      toast.success(`Data stipendi ${r.month} salvata`);
      return;
    }
    setMovements((prev) => prev.map((m) => m.id === id ? normalizeMovement({ ...m, ...patch }) : m));
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = search.trim().toLowerCase();
  const inRange = (iso: string) => {
    if (!from && !to) return true;
    const d = iso.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  const SORT_KEY = "officina:contabilita:sortBy";
  const [sortBy, setSortBy] = useState<"date" | "name" | "amount">(() => {
    if (typeof window === "undefined") return "date";
    const v = window.localStorage.getItem(SORT_KEY);
    return v === "name" || v === "amount" ? v : "date";
  });
  useEffect(() => {
    try { window.localStorage.setItem(SORT_KEY, sortBy); } catch { /* noop */ }
  }, [sortBy]);
  const filteredMovements = useMemo(() => {
    const base = r.movements.filter((m) => {
      if (q && !(m.description.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))) return false;
      return inRange(m.date);
    });
    const sorted = [...base];
    if (sortBy === "date") sorted.sort((a, b) => a.date.localeCompare(b.date));
    else if (sortBy === "name") sorted.sort((a, b) => a.description.localeCompare(b.description, "it", { sensitivity: "base" }));
    else if (sortBy === "amount") sorted.sort((a, b) => b.amount - a.amount);
    return sorted;
  }, [r.movements, q, from, to, sortBy]);
  const rangeActive = !!(from || to);
  const rangeTotals = computeMovementTotals(filteredMovements);
  const rangeCashSaldo = rangeTotals.cashIn - rangeTotals.cashOut;
  const rangeExpectedSaldo = rangeTotals.expectedIn - rangeTotals.expectedOut;
  // Cassa attuale del mese = saldo cassa a fine mese (quello mostrato come "Cassa" nella riga)
  const rangeCoverage = r.runningCash - rangeTotals.expectedOut;
  // Cassa prevista del mese = saldo previsionale a fine mese
  const rangeForecastCoverage = r.runningForecast - rangeTotals.expectedOut;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const toggleSelected = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const monthRealIds = new Set(r.movements.filter((m) => !m.id.startsWith("__")).map((m) => m.id));
  const selectedInMonth = Array.from(selectedIds).filter((id) => monthRealIds.has(id));
  const selectedMovements = r.movements.filter((m) => selectedIds.has(m.id));
  const selectedInCompetenza = selectedMovements.filter((m) => m.status === "previsto").length;
  const selectedInCassa = selectedMovements.filter((m) => m.status === "cassa").length;
  const bulkDelete = () => {
    if (selectedInMonth.length === 0) return;
    if (!confirm(`Cancellare ${selectedInMonth.length} voci da ${r.month}?`)) return;
    const toDelete = new Set(selectedInMonth);
    setMovements((prev) => prev.filter((m) => !toDelete.has(m.id)));
    setSelectedIds(new Set());
    toast.success(`${toDelete.size} voci cancellate`);
  };
  const bulkMarkPaid = () => {
    const today = new Date().toISOString().slice(0, 10);
    const toUpdate = new Set(selectedMovements.filter((m) => m.status === "previsto").map((m) => m.id));
    if (toUpdate.size === 0) return;
    setMovements((prev) => prev.map((m) => toUpdate.has(m.id) ? normalizeMovement({ ...m, status: "cassa", date: today }) : m));
    setSelectedIds(new Set());
    toast.success(`${toUpdate.size} voci messe in cassa`);
  };
  const bulkMarkUnpaid = () => {
    const toUpdate = new Set(selectedMovements.filter((m) => m.status === "cassa").map((m) => m.id));
    if (toUpdate.size === 0) return;
    setMovements((prev) => prev.map((m) => toUpdate.has(m.id) ? normalizeMovement({ ...m, status: "previsto" }) : m));
    setSelectedIds(new Set());
    toast.success(`${toUpdate.size} voci messe in competenza`);
  };
  const exitSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };
  const selectAllInMonth = () => setSelectedIds(new Set(monthRealIds));
  const [openGroup, setOpenGroup] = useState<{ label: string; ids: string[]; type: MovementType; status: MovementStatus } | null>(null);
  const [groupRenameDraft, setGroupRenameDraft] = useState("");
  useEffect(() => { setGroupRenameDraft(openGroup?.label ?? ""); }, [openGroup]);
  const groupKey = (description: string) => normalizeText(description).trim();
  const openGroupItems = useMemo(
    () => openGroup ? openGroup.ids.map((id) => movements.find((m) => m.id === id)).filter(Boolean) as CashMovement[] : [],
    [openGroup, movements],
  );
  const renameGroup = () => {
    if (!openGroup) return;
    const newName = groupRenameDraft.trim();
    if (!newName || newName === openGroup.label) return;
    const ids = new Set(openGroup.ids);
    setMovements((prev) => prev.map((m) => ids.has(m.id) ? { ...m, description: newName } : m));
    setOpenGroup({ ...openGroup, label: newName });
    toast.success(`Voci rinominate in "${newName}"`);
  };
  // F10: conferma e chiudi la scheda di modifica o il dialog di gruppo
  useConfirmShortcut(() => {
    if (openGroup) { renameGroup(); setOpenGroup(null); return; }
    if (editingId) { setEditingId(null); return; }
  }, !!editingId || !!openGroup);
  const deleteMovementById = (id: string) => {
    if (id.startsWith("__")) return;
    setMovements((prev) => prev.filter((x) => x.id !== id));
    if (editingId === id) setEditingId(null);
  };
  const deleteWholeGroup = () => {
    if (!openGroup) return;
    const ids = new Set(openGroup.ids.filter((i) => !i.startsWith("__")));
    if (ids.size === 0) return;
    if (!confirm(`Cancellare tutte le ${ids.size} voci di "${openGroup.label}"?`)) return;
    setMovements((prev) => prev.filter((m) => !ids.has(m.id)));
    setOpenGroup(null);
    toast.success(`${ids.size} voci cancellate`);
  };
  const addInlineMovement = (type: MovementType, status: MovementStatus) => {
    const today = new Date();
    const day = String(Math.min(today.getDate(), 28)).padStart(2, "0");
    const date = `${today.getFullYear()}-${String(monthIndex + 1).padStart(2, "0")}-${day}`;
    const newMov = normalizeMovement({
      id: uid(),
      date,
      description: "",
      category: "Generale",
      paymentMethod: "B",
      type,
      status,
      amount: 0,
    });
    setMovements((prev) => [...prev, newMov]);
    setEditingId(newMov.id);
  };
  const importFile = async (file: File) => {
    try {
      const newOnes: CashMovement[] = [];
      let rows: string[][] = [];
      let blocks: ImportColumnBlock[] | null = null;
      const name = file.name.toLowerCase();
      const isExcel = name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls");
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        // Seleziona il foglio del mese corrente (case-insensitive); fallback al primo
        // foglio non "Legenda", poi al primo foglio disponibile.
        const monthName = r.month.toLowerCase();
        const sheetName =
          wb.SheetNames.find((n) => n.toLowerCase() === monthName) ??
          wb.SheetNames.find((n) => !/legend/i.test(n)) ??
          wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        rows = worksheetToImportRows(ws);
        blocks = detectImportBlocks(rows);
      } else {
        const text = await file.text();
        rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;,\t]/).map((c) => c.trim()));
      }
      const detectedBlocks = blocks ?? [0, 4, 8, 12].map((offset, index) => ({ descriptionCol: offset, dateCol: offset + 1, methodCol: offset + 2, amountCol: offset + 3, ...IMPORT_TARGETS[index] }));
      // Se abbiamo riconosciuto il template ufficiale (header VOCE/DATA/MET./IMPORTO),
      // saltiamo solo le righe fino all'header (incluso) e poi importiamo tutto il resto
      // senza ulteriori filtri "header-like" (che potrebbero scartare righe valide).
      let startIdx = 0;
      const officialHeaderIdx = rows.findIndex((row) => {
        const norm = row.map((c) => normalizeImportText(c || "").toUpperCase());
        let v = 0, d = 0, m = 0, im = 0;
        for (const cell of norm) {
          if (!cell) continue;
          if (cell.startsWith("VOCE")) v++;
          else if (cell.startsWith("DATA")) d++;
          else if (cell.startsWith("MET")) m++;
          else if (cell.startsWith("IMPORTO")) im++;
        }
        return v >= 4 && d >= 4 && m >= 4 && im >= 4;
      });
      const isOfficialTemplate = officialHeaderIdx >= 0;
      if (isOfficialTemplate) startIdx = officialHeaderIdx + 1;
      // Importa TUTTI i 4 quadranti (cassa entrate/uscite + competenza entrate/uscite).
      const activeBlocks = detectedBlocks;
      let scannedRows = 0;
      let skippedHeader = 0;
      let skippedZero = 0;
      let skippedSalary = 0;
      // Traccia quali quadranti (type+status) hanno almeno una riga compilata nel template.
      // I quadranti VUOTI nel template NON devono toccare i movimenti esistenti.
      const touchedQuadrants = new Set<string>();
      const quadrantKey = (type: MovementType, status: MovementStatus) => `${type}|${status}`;
      for (let i = startIdx; i < rows.length; i++) {
        const cols = rows[i];
        if (!cols || cols.length === 0) continue;
        if (!isOfficialTemplate && isImportHeader(cols)) { skippedHeader++; continue; }
        scannedRows++;
        let rowProducedSomething = false;
        for (const b of activeBlocks) {
          const descriptionRaw = (cols[b.descriptionCol] || "").trim();
          const dateRaw = b.dateCol >= 0 ? (cols[b.dateCol] || "").trim() : "";
          const methodRaw = (cols[b.methodCol] || "").trim();
          if (shouldSkipImportedMovement(descriptionRaw, salaries)) { skippedSalary++; continue; }
          const amt = parseImportAmount(cols[b.amountCol]);
          if (amt === 0) { skippedZero++; continue; }
          const description = descriptionRaw;
          const method = parseImportMethod(methodRaw);
          newOnes.push(normalizeMovement({
            id: uid(),
            date: parseImportDate(dateRaw, monthIndex),
            description,
            category: "Generale",
            paymentMethod: method,
            type: b.type,
            status: b.status,
            amount: amt,
          }));
          rowProducedSomething = true;
          touchedQuadrants.add(quadrantKey(b.type, b.status));
        }
        void rowProducedSomething;
      }
      if (newOnes.length === 0) {
        const detail = isOfficialTemplate
          ? `Template riconosciuto ma vuoto. Inserisci dati sotto la riga "VOCE/DATA/MET./IMPORTO" del foglio "${r.month}".`
          : `Nessuna riga valida (scansionate ${scannedRows}, importi nulli ${skippedZero}, header ${skippedHeader}, stipendi esclusi ${skippedSalary}). Verifica colonne IMPORTO e foglio.`;
        toast.error(detail);
        return;
      }
      // Sostituisci SOLO i movimenti del mese che appartengono ai quadranti compilati nel template.
      // I quadranti vuoti nel template restano intatti (non vengono cancellati).
      const idsToReplace = new Set(
        r.movements
          .filter((m) => !m.id.startsWith("__") && touchedQuadrants.has(quadrantKey(m.type, m.status)))
          .map((m) => m.id),
      );
      setMovements((prev) => [...prev.filter((m) => !idsToReplace.has(m.id)), ...newOnes]);
      const labels: Record<string, string> = {
        "entrata|cassa": "Cassa Entrate",
        "uscita|cassa": "Cassa Uscite",
        "entrata|previsto": "Competenza Entrate",
        "uscita|previsto": "Competenza Uscite",
      };
      const updated = Array.from(touchedQuadrants).map((k) => labels[k] || k).join(", ");
      toast.success(`${newOnes.length} movimenti caricati in ${r.month} (${updated}). Cassa non modificata.`);
    } catch { toast.error("Errore lettura file"); }
  };
  const renderRow = (m: CashMovement, opts?: { indent?: boolean; inlinePaid?: boolean }) => {
    const isEditing = editingId === m.id;
    const isVirtual = m.id.startsWith("__");
    const togglePaid = (checked: boolean) => {
      if (isVirtual) return;
      if (checked && m.status !== "cassa") {
        const today = new Date().toISOString().slice(0, 10);
        updateMovement(m.id, { status: "cassa", date: today });
      } else {
        updateMovement(m.id, { status: checked ? "cassa" : "previsto" });
      }
    };
    return (
      <div key={m.id} className={`border-b border-border pb-0.5 text-sm last:border-b-0 ${opts?.indent ? "pl-4 bg-muted/20" : ""}`}>
        <div className={`grid gap-0 md:grid-cols-2 ${selectionMode ? "lg:grid-cols-[24px_92px_minmax(180px,1fr)_88px]" : opts?.inlinePaid ? "lg:grid-cols-[110px_92px_minmax(180px,1fr)_88px]" : "lg:grid-cols-[92px_minmax(180px,1fr)_88px]"} lg:items-center ${isVirtual ? "bg-dept-soft/20" : ""}`}>
          {selectionMode && <input type="checkbox" aria-label="Seleziona" disabled={isVirtual} className="h-3.5 w-3.5 cursor-pointer accent-dept disabled:opacity-30" checked={selectedIds.has(m.id)} onChange={() => toggleSelected(m.id)} />}
          {opts?.inlinePaid && !selectionMode && (
            <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-1.5 text-[11px] font-medium ${m.status === "cassa" ? "text-dept" : "text-muted-foreground"}`} title="Pagato (sposta in cassa con data odierna)">
              <input type="checkbox" disabled={isVirtual} className="h-3.5 w-3.5 cursor-pointer accent-dept" checked={m.status === "cassa"} onChange={(e) => togglePaid(e.target.checked)} />
              {m.status === "cassa" ? "Pagato" : "Pagare"}
            </label>
          )}
          <QuickDateInput ariaLabel="Data" className="h-8 w-full px-1 text-sm text-center tracking-tight" monthIndex={monthIndex} value={m.date} onCommit={(v) => updateMovement(m.id, { date: v })} />
          <div className="relative flex h-8 w-full items-stretch min-w-0">
            <button type="button" disabled={isVirtual} className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-input bg-background px-1.5 text-left text-sm font-medium hover:bg-dept-soft/30 disabled:cursor-default disabled:opacity-90" onClick={() => setEditingId(isEditing ? null : m.id)} title={isVirtual ? "Voce automatica da Stipendi" : undefined}>{isVirtual ? "🔒 " : ""}{m.description}</button>
            {!isVirtual && m.description.trim().length >= 3 && !contacts.some((c) => movementMatchesContact(m.description, c.name)) && (
              <button
                type="button"
                aria-label={`Aggiungi "${m.description}" all'anagrafica`}
                title={`Aggiungi "${m.description}" all'anagrafica come ${m.type === "entrata" ? "cliente" : "fornitore"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const newContact: Contact = { id: uid(), type: m.type === "entrata" ? "cliente" : "fornitore", name: m.description.trim(), createdAt: new Date().toISOString() };
                  onAddContact(newContact);
                  toast.success(`${m.type === "entrata" ? "Cliente" : "Fornitore"} "${newContact.name}" aggiunto all'anagrafica`);
                }}
                className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-dept bg-background text-dept hover:bg-dept hover:text-dept-foreground transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex h-8 items-center justify-end rounded-md border border-input bg-muted px-1 font-mono text-sm font-semibold whitespace-nowrap" title={m.gestitoAcconti && (m.acconto ?? 0) > 0 ? `Totale ${eur(m.amount)} − acconto ${eur(m.acconto ?? 0)}` : undefined}>{eur(m.gestitoAcconti ? Math.max(0, m.amount - (m.acconto ?? 0)) : m.amount)}</div>
        </div>
        {((isEditing) || (selectionMode && selectedIds.has(m.id))) && !isVirtual && (
          <form className="mt-2 grid gap-2 rounded-sm border border-dept bg-dept-soft/20 p-2 grid-cols-2" onSubmit={(e) => { e.preventDefault(); setEditingId(null); }}>
            <Field label="Causale">
              <ContactAutocompleteInput value={m.description} onChange={(v) => updateMovement(m.id, { description: v })} contacts={contacts} movementType={m.type} onAddContact={onAddContact} autoFocus={!m.description} />
            </Field>
            <Field label={m.gestitoAcconti && (m.acconto ?? 0) > 0 ? "Importo (residuo)" : "Importo"}>
              <div className="flex items-center gap-1">
                <NumberInput
                  value={m.gestitoAcconti ? Math.max(0, m.amount - (m.acconto ?? 0)) : m.amount}
                  onChange={(v) => updateMovement(m.id, { amount: m.gestitoAcconti ? v + (m.acconto ?? 0) : v })}
                />
                <AdditionsControl movement={m} onChange={(patch) => updateMovement(m.id, patch)} compact />
              </div>
            </Field>
            <Field label="Metodo"><PaymentMethodSelect className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={m.paymentMethod ?? ""} onChange={(v) => updateMovement(m.id, { paymentMethod: v })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditingId(null); } }} /></Field>
            <Field label="Data"><StepDateInput value={m.date} onCommit={(v) => updateMovement(m.id, { date: v })} onConfirm={() => setEditingId(null)} /></Field>
            <Field label="N° Fattura"><TextInput className="h-9 text-xs font-mono" value={m.invoiceNumber ?? ""} placeholder="es. 2026/123" onCommit={(invoiceNumber) => updateMovement(m.id, { invoiceNumber })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditingId(null); } }} /></Field>
            <Field label="Pagato">
              <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-2 text-xs">
                <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-dept" checked={m.status === "cassa"} onChange={(e) => {
                  if (e.target.checked && m.status !== "cassa") {
                    const today = new Date().toISOString().slice(0, 10);
                    updateMovement(m.id, { status: "cassa", date: today });
                  } else {
                    updateMovement(m.id, { status: e.target.checked ? "cassa" : "previsto" });
                  }
                }} />
                {m.status === "cassa" ? "Sì (in cassa)" : "No (previsto)"}
              </label>
            </Field>
            <Field label="Gestito per Acconti">
              <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 text-xs">
                <input type="checkbox" checked={!!m.gestitoAcconti} onChange={(e) => updateMovement(m.id, { gestitoAcconti: e.target.checked, acconto: e.target.checked ? m.acconto : undefined })} />
                Sì
              </label>
            </Field>
            {m.status === "previsto" && m.gestitoAcconti && (
              <Field label={`Acconto (in cassa)${m.amount > 0 && (m.acconto ?? 0) > 0 ? ` · residuo ${eur(Math.max(0, m.amount - (m.acconto ?? 0)))}` : ""}`}>
                <div className="flex gap-2">
                  <NumberInput value={m.acconto ?? 0} onChange={(acconto) => updateMovement(m.id, { acconto: Math.max(0, Math.min(acconto, m.amount)) })} />
                  <Button type="button" size="sm" variant="outline" className="h-9 text-xs" disabled={!((m.acconto ?? 0) > 0)} onClick={() => {
                    const q = Math.max(0, Math.min(Number(m.acconto || 0), m.amount));
                    if (q <= 0) return;
                    const today = new Date().toISOString().slice(0, 10);
                    const cassaMov: CashMovement = normalizeMovement({ id: uid(), date: today, description: `Acconto — ${m.description}`, category: m.category, paymentMethod: m.paymentMethod, type: m.type, status: "cassa", amount: q, invoiceNumber: m.invoiceNumber });
                    setMovements((prev) => [...prev.map((x) => x.id === m.id ? normalizeMovement({ ...x, amount: Math.max(0, x.amount - q), acconto: undefined }) : x), cassaMov]);
                    toast.success(`Acconto di ${eur(q)} registrato in cassa`);
                  }}>Applica</Button>
                </div>
              </Field>
            )}
            <div className="col-span-2 flex items-center justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => { setMovements((prev) => prev.filter((x) => x.id !== m.id)); setEditingId(null); }}><Trash2 className="h-3.5 w-3.5" />Elimina</Button>
              <Button type="submit" size="sm" className="h-7 text-xs">OK</Button>
            </div>
          </form>
        )}
      </div>
    );
  };
  const section = (title: string, rows: CashMovement[], type: MovementType, status: MovementStatus) => (
    <div className="min-w-0 border-2 border-dept/60 bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-dept-soft/40 px-2 py-1.5">
        <span className="flex-1 text-center font-display text-base font-semibold uppercase tracking-wide text-foreground">{title}</span>
        <button
          type="button"
          onClick={() => addInlineMovement(type, status)}
          aria-label={`Aggiungi ${title.toLowerCase()}`}
          title={`Aggiungi ${title.toLowerCase()}`}
          className="grid h-8 w-8 place-items-center rounded-md border border-dept bg-background text-dept hover:bg-dept hover:text-dept-foreground transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className={`hidden ${selectionMode ? "grid-cols-[24px_92px_minmax(180px,1fr)_88px]" : "grid-cols-[92px_minmax(180px,1fr)_88px]"} gap-0 border-b border-border bg-muted/40 px-1 py-1 label-cap text-[10px] lg:grid`}>
        {selectionMode && <span></span>}
        <span className="px-1">Data</span>
        <span className="px-1">Voce</span>
        <span className="px-1 text-right">Importo</span>
      </div>
      <div className="max-h-[78vh] min-h-[60vh] space-y-0.5 overflow-auto p-1">
        {rows.length === 0 ? <p className="p-2 text-xs text-muted-foreground">Nessun movimento</p> : (() => {
          // Raggruppa per descrizione normalizzata, mantenendo l'ordine di prima apparizione.
          const order: string[] = [];
          const groups = new Map<string, CashMovement[]>();
          for (const m of rows) {
            const k = groupKey(m.description);
            if (!groups.has(k)) { groups.set(k, []); order.push(k); }
            groups.get(k)!.push(m);
          }
          return order.map((k) => {
            const items = groups.get(k)!;
            if (items.length === 1) return renderRow(items[0]);
            const total = items.reduce((s, m) => s + m.amount, 0);
            const groupId = `${type}-${status}-${k}`;
            const label = items[0].description || "(senza voce)";
            const openDetail = () => setOpenGroup({ label, ids: items.map((m) => m.id), type, status });
            return (
              <div key={groupId} className="border-b border-border pb-0.5 text-sm last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={openDetail}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); } }}
                  title={`${items.length} voci raggruppate · clicca per aprire la scheda`}
                  className={`grid gap-0 md:grid-cols-2 ${selectionMode ? "lg:grid-cols-[24px_92px_minmax(180px,1fr)_88px]" : "lg:grid-cols-[92px_minmax(180px,1fr)_88px]"} lg:items-center cursor-pointer hover:bg-dept-soft/30`}
                >
                  {selectionMode && <span />}
                  <div className="flex h-8 items-center justify-center text-muted-foreground">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                  <div className="relative flex h-8 w-full items-stretch min-w-0">
                    <div className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-input bg-dept-soft/40 px-1.5 text-sm font-semibold">
                      <span className="truncate">{label}</span>
                      <span className="ml-1 shrink-0 font-mono text-[10px] text-muted-foreground">×{items.length}</span>
                    </div>
                  </div>
                  <div className="flex h-8 items-center justify-end rounded-md border border-input bg-muted px-1 font-mono text-sm font-bold whitespace-nowrap">{eur(total)}</div>
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
  return <><Card className="border-2 border-dept shadow-soft" style={{ ["--dept" as string]: MONTH_COLORS[monthIndex]?.dept ?? "184 85% 32%", ["--dept-soft" as string]: MONTH_COLORS[monthIndex]?.soft ?? "184 42% 93%" } as React.CSSProperties}><CardHeader className="flex-row items-center justify-between gap-2 space-y-0 flex-wrap bg-dept text-dept-foreground rounded-t-md"><CardTitle className="text-dept-foreground">{r.month}</CardTitle><div className="flex items-center gap-2 flex-wrap">{selectionMode ? (<>{selectedInCompetenza > 0 && (<Button size="sm" variant="outline" onClick={bulkMarkPaid} className="h-8 text-xs">Metti pagato ({selectedInCompetenza})</Button>)}{selectedInCassa > 0 && (<Button size="sm" variant="outline" onClick={bulkMarkUnpaid} className="h-8 text-xs">Metti non pagato ({selectedInCassa})</Button>)}{selectedInMonth.length > 0 && (<Button size="sm" variant="destructive" onClick={bulkDelete} className="h-8"><Trash2 className="h-3.5 w-3.5" />Cancella ({selectedInMonth.length})</Button>)}<Button size="sm" variant="outline" onClick={() => { if (selectedInMonth.length === monthRealIds.size && monthRealIds.size > 0) setSelectedIds(new Set()); else selectAllInMonth(); }} className="h-8 text-xs">{selectedInMonth.length === monthRealIds.size && monthRealIds.size > 0 ? "Deseleziona" : "Tutti"}</Button><Button size="sm" variant="ghost" onClick={exitSelection} className="h-8 text-xs">Annulla</Button></>) : (<Button size="sm" variant="outline" onClick={() => setSelectionMode(true)} className="h-8 text-xs">Seleziona</Button>)}<label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground hover:bg-dept-soft/30" title="CSV: data,descrizione,metodo,tipo,stato,importo"><Upload className="h-3.5 w-3.5" />Importa CSV/XLSX<input type="file" accept=".csv,text/csv,.xlsx,.xlsm,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.currentTarget.value = ""; }} /></label></div></CardHeader><CardContent className="space-y-5 pt-5"><div className="flex items-center justify-between gap-2 flex-wrap"><SearchBar value={search} onChange={setSearch} placeholder={`Cerca in ${r.month}…`} /><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>Ordina:</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date" | "name" | "amount")} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="date">Data</option><option value="name">Nome</option><option value="amount">Importo</option></select></label></div><DateRangeFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /><div className="space-y-4">{rangeActive && (<div className="rounded-md border-2 border-dept bg-dept-soft/40 p-3 shadow-sm"><div className="flex items-center justify-between mb-3 pb-2 border-b border-dept/40"><div className="font-display text-sm font-semibold uppercase tracking-wide text-dept">Intervallo {from || "…"} → {to || "…"}</div><span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Filtro attivo</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><SummaryLine label={`Cassa attuale (${r.month})`} value={r.runningCash} strong /><SummaryLine label="Uscite competenza nel range" value={rangeTotals.expectedOut} /><SummaryLine label="Copertura cassa attuale − uscite previste" value={rangeCoverage} strong /><SummaryLine label={`Cassa prevista (fine ${r.month})`} value={r.runningForecast} strong /><SummaryLine label="Entrate competenza nel range" value={rangeTotals.expectedIn} /><SummaryLine label="Copertura cassa prevista − uscite previste" value={rangeForecastCoverage} strong /></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 mt-3 pt-3 border-t border-dept/30"><SummaryLine label="Entrate cassa" value={rangeTotals.cashIn} /><SummaryLine label="Uscite cassa" value={rangeTotals.cashOut} /><SummaryLine label="Utile cassa" value={rangeCashSaldo} strong /><SummaryLine label="Utile previsto" value={rangeExpectedSaldo} strong /></div></div>)}<div className="rounded-md border border-dept/40 bg-paper p-3"><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Cassa effettiva — {r.month}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><SummaryLine label="Entrate cassa" value={r.cashIn} /><SummaryLine label="Uscite cassa" value={r.cashOut} /><SummaryLine label="Utile cassa" value={r.cashSaldo} strong /><SummaryLine label="Cassa" value={r.runningCash} strong /></div></div><div className="rounded-md border border-dept/40 bg-paper p-3"><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Competenza — {r.month}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><SummaryLine label="Entrate competenza" value={r.expectedIn} /><SummaryLine label="Uscite competenza" value={r.expectedOut} /><SummaryLine label="Utile previsto" value={r.expectedSaldo} strong /><SummaryLine label="Cassa prevista" value={r.runningForecast} strong /></div></div></div><div className="grid gap-3 lg:grid-cols-2"><div className="min-w-0 border-2 border-dept bg-paper rounded-md overflow-hidden shadow-sm"><div className="border-b-2 border-dept bg-dept text-dept-foreground py-2 text-center font-display text-2xl font-semibold uppercase tracking-wide">Cassa</div><div className="grid gap-0 grid-cols-2">{section("Entrate", filteredMovements.filter((m) => m.status === "cassa" && m.type === "entrata"), "entrata", "cassa")}{section("Uscite", filteredMovements.filter((m) => m.status === "cassa" && m.type === "uscita"), "uscita", "cassa")}</div></div><div className="min-w-0 border-2 border-dept/70 bg-paper rounded-md overflow-hidden shadow-sm"><div className="border-b-2 border-dept/70 bg-dept-soft text-dept py-2 text-center font-display text-2xl font-semibold uppercase tracking-wide">Competenza</div><div className="grid gap-0 grid-cols-2">{section("Entrate", filteredMovements.filter((m) => m.status === "previsto" && m.type === "entrata"), "entrata", "previsto")}{section("Uscite", filteredMovements.filter((m) => m.status === "previsto" && m.type === "uscita"), "uscita", "previsto")}</div></div></div></CardContent></Card>{openGroup && (<Dialog open onOpenChange={(o)=>{if(!o)setOpenGroup(null);}}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle><div className="flex items-center gap-2"><Pencil className="h-4 w-4 text-muted-foreground" /><input type="text" value={groupRenameDraft} onChange={(e) => setGroupRenameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameGroup(); } }} className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-base font-semibold" aria-label="Rinomina gruppo" /><Button type="button" size="sm" variant="outline" onClick={renameGroup} disabled={!groupRenameDraft.trim() || groupRenameDraft.trim() === openGroup.label}>Rinomina</Button></div></DialogTitle><DialogDescription>{openGroupItems.length} voci · Totale {eur(openGroupItems.reduce((s,m)=>s+m.amount,0))}</DialogDescription></DialogHeader><div className="max-h-[70vh] overflow-auto space-y-0.5">{openGroupItems.map((m)=>renderRow(m, { inlinePaid: true }))}</div><DialogFooter className="sm:justify-between gap-2 flex-wrap"><Button type="button" size="sm" variant="destructive" onClick={deleteWholeGroup} disabled={openGroupItems.length === 0}><Trash2 className="h-3.5 w-3.5" />Cancella tutto il gruppo ({openGroupItems.length})</Button><div className="flex gap-2 flex-wrap">{openGroupItems.some((m) => m.status === "previsto" && !m.id.startsWith("__")) && (<Button type="button" size="sm" variant="outline" onClick={() => { const today = new Date().toISOString().slice(0, 10); const ids = new Set(openGroupItems.filter((m) => m.status === "previsto" && !m.id.startsWith("__")).map((m) => m.id)); if (ids.size === 0) return; setMovements((prev) => prev.map((m) => ids.has(m.id) ? normalizeMovement({ ...m, status: "cassa", date: today }) : m)); toast.success(`${ids.size} voci messe in cassa`); }}>Metti tutte pagate</Button>)}{openGroupItems.some((m) => m.status === "cassa" && !m.id.startsWith("__")) && (<Button type="button" size="sm" variant="outline" onClick={() => { const ids = new Set(openGroupItems.filter((m) => m.status === "cassa" && !m.id.startsWith("__")).map((m) => m.id)); if (ids.size === 0) return; setMovements((prev) => prev.map((m) => ids.has(m.id) ? normalizeMovement({ ...m, status: "previsto" }) : m)); toast.success(`${ids.size} voci messe in competenza`); }}>Metti tutte non pagate</Button>)}<Button type="button" size="sm" onClick={() => setOpenGroup(null)}>OK</Button></div></DialogFooter></DialogContent></Dialog>)}</>;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="min-w-0 space-y-1.5"><Label className="label-cap block leading-tight">{label}</Label>{children}</div>;

const TextInput = ({ value, onCommit, className, ...props }: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & { value?: string; onCommit: (v: string) => void }) => {
  const [draft, setDraft] = useState(value ?? "");
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value ?? "");
  }, [value]);

  const commit = (next = draft) => {
    if ((value ?? "") !== next) onCommit(next);
  };

  return (
    <Input
      {...props}
      className={className}
      value={draft}
      onFocus={(e) => {
        focusedRef.current = true;
        props.onFocus?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        commit(next);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        commit(e.target.value);
        props.onBlur?.(e);
      }}
    />
  );
};

const NumberInput = ({ value, onChange, onCommit, className }: { value: number; onChange: (n: number) => void; onCommit?: (n: number) => void; className?: string }) => {
  // Stato locale per non riformattare il testo durante la digitazione:
  // così caratteri come ".", ",", o gli zeri intermedi non vengono cancellati.
  const [draft, setDraft] = useState<string>(Number.isFinite(value) && value !== 0 ? String(value) : "");
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current) return; // non sovrascrivere mentre l'utente sta scrivendo
    setDraft(Number.isFinite(value) && value !== 0 ? String(value) : "");
  }, [value]);
  return (
    <Input
      className={`font-mono ${className ?? ""}`}
      type="number"
      step="0.01"
      inputMode="decimal"
      value={draft}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        const n = draft === "" ? 0 : Number(draft.replace(",", ".")) || 0;
        setDraft(n !== 0 ? String(n) : "");
        if (n !== value) onChange(n);
        onCommit?.(n);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Propaga solo se è un numero "completo" (non finisce con . o ,)
        if (raw === "") { onChange(0); return; }
        if (/[.,]$/.test(raw)) return;
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n) && n !== value) onChange(n);
      }}
    />
  );
};

/** Input causale con suggerimenti dall'Anagrafica + quick-add. */
const ContactAutocompleteInput = ({ value, onChange, contacts, movementType, onAddContact, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  contacts: Contact[];
  movementType: "entrata" | "uscita";
  onAddContact: (c: Contact) => void;
  autoFocus?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const suggestions = useMemo(
    () => suggestContacts(value, contacts, movementType),
    [value, contacts, movementType],
  );
  const exactMatch = useMemo(() => {
    const q = normalizeText(value);
    return q.length >= 3 ? contacts.find((c) => normalizeText(c.name) === q) : null;
  }, [value, contacts]);
  const alreadyLinked = useMemo(
    () => value.trim().length >= 3 && contacts.some((c) => movementMatchesContact(value, c.name)),
    [value, contacts],
  );
  const showAdd = !exactMatch && !alreadyLinked && value.trim().length >= 3;

  useEffect(() => { setHighlight(-1); }, [value, open]);

  return (
    <div className="relative">
      <div className="flex items-stretch gap-1">
        <Input
          className="h-9 text-xs"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (suggestions.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
            } else if (e.key === "Enter" && open && highlight >= 0) {
              e.preventDefault();
              onChange(suggestions[highlight].name);
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          autoFocus={autoFocus}
          placeholder="Causale o nome contatto…"
        />
        {showAdd && (
          <button
            type="button"
            title={`Aggiungi "${value.trim()}" all'anagrafica come ${movementType === "entrata" ? "cliente" : "fornitore"}`}
            onMouseDown={(e) => {
              e.preventDefault();
              const newContact: Contact = {
                id: uid(),
                type: movementType === "entrata" ? "cliente" : "fornitore",
                name: value.trim(),
                createdAt: new Date().toISOString(),
              };
              onAddContact(newContact);
              toast.success(`${movementType === "entrata" ? "Cliente" : "Fornitore"} "${newContact.name}" aggiunto all'anagrafica`);
              setOpen(false);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-dept bg-background text-dept hover:bg-dept hover:text-dept-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border-2 border-dept bg-popover shadow-md">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            Suggerimenti dall'anagrafica
          </div>
          <ul className="max-h-56 overflow-auto py-1">
            {suggestions.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setOpen(false); }}
                  className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs ${i === highlight ? "bg-dept-soft/60" : "hover:bg-dept-soft/40"}`}
                >
                  <span className="font-medium truncate">{c.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {c.type === "entrambi" ? "cl+forn" : c.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ============== Stipendi per mese ==============
// Le ore di riferimento per il mese visualizzato provengono dal mese PRECEDENTE
// del Calcolo ore (es. Stipendi Giugno → Calcolo ore di Maggio).

type DayDetail = {
  day: number;
  dow: number;
  segs: DaySegment[];
  workH: number;
  normalH: number;
  overtimeH: number;
  paidH: number;
  hourlyRate: number;
  baseAmount: number;
  trasfertaBonus: number;
  isHoliday: boolean;
  amount: number;
};

type ComputedSalary = {
  name: string;
  dipendenteId?: string;
  source?: "auto" | "saved";
  hourlyRate: number;
  contractH: number;
  totale: number;
  breakdown: DayDetail[];
  totals: {
    normalH: number;
    overtimeH: number;
    paidH: number;
    holidayDays: number;
    trasfertaDays: number;
    ferieDays: number;
    malattiaDays: number;
    permessoH: number;
  };
};

const computeSalaryForRow = (
  row: HoursRow,
  dip: Dipendente | undefined,
  year: number,
  month: number,
): ComputedSalary => {
  const hourlyRate = Number(dip?.hourly_rate) || 0;
  const contractH = Math.max(0, Number(dip?.contract_hours_per_day) || 8);
  const OVERTIME_RATE = 5;
  const TRASFERTA_BONUS = 20;
  const breakdown: DayDetail[] = [];
  let totale = 0;
  let tNormalH = 0, tOvertimeH = 0, tPaidH = 0;
  let holidayDays = 0, trasfertaDays = 0, ferieDays = 0, malattiaDays = 0, permessoH = 0;
  Object.entries(row.days || {}).forEach(([dayStr, cell]) => {
    const day = Number(dayStr);
    const segs = getSegments(cell);
    if (segs.length === 0) return;
    const date = new Date(year, month, day);
    const dow = date.getDay();
    let workH = 0;
    let paidH = 0;
    let hasFestivoSeg = false;
    let hadTrasferta = false;
    let hadFerie = false;
    let hadMalattia = false;
    let hadDoppia = false;
    segs.forEach((s) => {
      const h = Math.max(0, Number(s.h) || 0);
      if (s.t === "lavoro") workH += h;
      else if (s.t === "doppia") {
        // Doppia = secondo turno da 8h aggiunto alle ore inserite (default: 8+8=16)
        const eff = h > 0 ? h + contractH : contractH * 2;
        workH += eff;
        hadDoppia = true;
      }
      else if (s.t === "trasferta") { workH += h; hadTrasferta = true; }
      else if (s.t === "permesso") { paidH += h; permessoH += h; }
      else if (s.t === "ferie") { paidH += (h > 0 ? h : contractH); hadFerie = true; }
      else if (s.t === "malattia") { paidH += (h > 0 ? h : contractH); hadMalattia = true; }
      else if (s.t === "festivo") { workH += (h > 0 ? h : contractH); hasFestivoSeg = true; }
    });
    // Per la doppia, tutte le ore sono pagate a tariffa oraria piena (no straordinario)
    const overtimeH = hadDoppia ? 0 : Math.max(workH - contractH, 0);
    const normalH = workH - overtimeH;
    const isHoliday = (dow === 0 || hasFestivoSeg) && (workH > 0);
    const baseAmount = (normalH + paidH) * hourlyRate + overtimeH * OVERTIME_RATE;
    // Bonus trasferta: +20 € per ogni giornata con almeno un segmento di trasferta
    const trasfertaBonus = hadTrasferta ? TRASFERTA_BONUS : 0;
    // Le ore festive/domenica sono già conteggiate al pari delle ordinarie: nessun raddoppio automatico.
    const amount = baseAmount + trasfertaBonus;
    breakdown.push({ day, dow, segs, workH, normalH, overtimeH, paidH, hourlyRate, baseAmount, trasfertaBonus, isHoliday, amount });
    totale += amount;
    tNormalH += normalH;
    tOvertimeH += overtimeH;
    tPaidH += paidH;
    if (isHoliday) holidayDays += 1;
    if (hadTrasferta) trasfertaDays += 1;
    if (hadFerie) ferieDays += 1;
    if (hadMalattia) malattiaDays += 1;
  });
  // Override fisso: Siniscalchi Carmela ha sempre 400 € da ricevere (tutto in contanti)
  if (normalizeImportText(row.name).includes("siniscalchi carmela")) {
    totale = 400;
  }
  return {
    name: row.name,
    dipendenteId: row.dipendenteId,
    source: "auto",
    hourlyRate,
    contractH,
    totale,
    breakdown,
    totals: { normalH: tNormalH, overtimeH: tOvertimeH, paidH: tPaidH, holidayDays, trasfertaDays, ferieDays, malattiaDays, permessoH },
  };
};

const prevMonthYear = (year: number, month: number) =>
  month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };

const sameEmployeeName = (a: string, b: string) => normalizeImportText(a) === normalizeImportText(b);

const findDipendente = (dipendenti: Dipendente[], name: string, dipendenteId?: string) => {
  if (dipendenteId) {
    const byId = dipendenti.find((d) => d.id === dipendenteId);
    if (byId) return byId;
  }
  return dipendenti.find((d) => sameEmployeeName(d.nome, name));
};

const computedFromSavedSalary = (salary: Salary, dip?: Dipendente): ComputedSalary => ({
  name: salary.name,
  dipendenteId: dip?.id,
  source: "saved",
  hourlyRate: Number(dip?.hourly_rate) || 0,
  contractH: Math.max(0, Number(dip?.contract_hours_per_day) || 8),
  totale: Number(salary.totale) || 0,
  breakdown: [],
  totals: { normalH: 0, overtimeH: 0, paidH: 0, holidayDays: 0, trasfertaDays: 0, ferieDays: 0, malattiaDays: 0, permessoH: 0 },
});

// Vista read-only per Amministrazione: solo contanti da consegnare ai dipendenti.
// Non mostra totali, bonifici, cassa. Non permette modifiche.
const CashOnlySalariesView = ({ salaries, processed, payDates, hoursLog }: { salaries: Salary[]; processed: boolean[]; payDates: string[]; hoursLog: HoursLog }) => {
  const now = new Date();
  const [openMonth, setOpenMonth] = useState<number>(now.getMonth());
  const [year, setYear] = useState<number>(now.getFullYear());
  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);

  useEffect(() => {
    let mounted = true;
    fetchDipendenti(false).then((r) => { if (mounted) setDipendenti(r); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // openMonth = mese di COMPETENZA (mese lavorato). Lo stipendio corrispondente
  // è salvato sotto il mese successivo (stipendio "di luglio" = competenza giugno).
  const nextM = openMonth === 11 ? 0 : openMonth + 1;
  const nextY = openMonth === 11 ? year + 1 : year;
  const isProcessed = !!processed[nextM];
  const savedRows = useMemo(
    () => salaries
      .filter((s) => s.month === nextM)
      .filter((s) => (s.totale || 0) > 0 || (s.bonifico || 0) !== 0 || (s.contanti || 0) !== 0 || s.sc)
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" })),
    [salaries, nextM],
  );

  // Ore del mese di competenza selezionato
  const computedRows = useMemo(() => {
    const hm = hoursLog[`${year}-${openMonth}`] ?? { rows: [] };
    return hm.rows.map((r) => {
      const dip = findDipendente(dipendenti, r.name, r.dipendenteId);
      return computeSalaryForRow(r, dip, year, openMonth);
    });
  }, [hoursLog, year, openMonth, dipendenti]);

  type Row = { name: string; contanti: number; stato: "confermato" | "stimato" };
  const rows: Row[] = useMemo(() => {
    const computedByKey = new Map(computedRows.map((c) => [c.name.trim().toLowerCase(), c] as const));
    if (isProcessed && savedRows.length > 0) {
      return savedRows.map((s) => {
        const fresh = computedByKey.get(s.name.trim().toLowerCase());
        const totale = (!s.sc && fresh) ? fresh.totale : (Number(s.totale) || 0);
        const contanti = s.sc
          ? (Number(s.contanti) || 0)
          : Math.max(0, totale - (Number(s.bonifico) || 0));
        return { name: s.name, contanti, stato: "confermato" as const };
      });
    }
    return computedRows
      .filter((c) => c.totale > 0)
      .map((c) => ({ name: c.name, contanti: c.totale, stato: "stimato" as const }))
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
  }, [isProcessed, savedRows, computedRows]);


  const totContanti = rows.reduce((a, r) => a + r.contanti, 0);
  const payDate = sanitizeSalaryPayDate(payDates[nextM], nextM);

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Contanti da consegnare ai dipendenti</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Vista di sola lettura. Amministrazione vede solo i contanti; i totali e i bonifici non sono visibili.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Anno</label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} className="h-8 w-24" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MONTHS.map((m, i) => (
            <Button key={m} size="sm" variant={openMonth === i ? "default" : "outline"} onClick={() => setOpenMonth(i)}>
              {m}{processed[i] ? <span className="ml-1 text-[10px]">✓</span> : null}
            </Button>
          ))}
        </div>
        <div className="rounded-md border-2 border-dept bg-dept-soft/30 px-3 py-2 text-sm">
          Competenza <strong>{MONTHS[openMonth]} {year}</strong> · stipendio {MONTHS[nextM]} {nextY}
          {isProcessed
            ? <> · <strong>elaborato</strong> · pagamento previsto <strong>{payDate || "—"}</strong></>
            : <> · <strong>stimato</strong> dalle ore di {MONTHS[openMonth]} {year}</>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-dept bg-dept-soft/40">
                <th className="border border-border px-3 py-2 text-left label-cap">Dipendente</th>
                <th className="border border-border px-3 py-2 text-right label-cap">Contanti da consegnare</th>
                <th className="border border-border px-3 py-2 text-center label-cap">Stato</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={3} className="border border-border p-4 text-center text-muted-foreground">Nessun dato disponibile per {MONTHS[openMonth]} {year}.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.name} className="border-b border-border hover:bg-dept-soft/20">
                  <td className="border border-border px-3 py-2 font-medium">{r.name}</td>
                  <td className="border border-border px-3 py-2 text-right font-mono font-semibold">{eur(r.contanti)}</td>
                  <td className="border border-border px-3 py-2 text-center">
                    {r.stato === "confermato"
                      ? <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">confermato</span>
                      : <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">stimato</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-dept bg-dept-soft/30 font-semibold">
                  <td className="border border-border px-3 py-2 text-right label-cap">Totale contanti</td>
                  <td className="border border-border px-3 py-2 text-right font-mono text-dept">{eur(totContanti)}</td>
                  <td className="border border-border" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
};



const SalariesTable = ({ salaries, setSalaries, processed, setProcessed, payDates, setPayDates, hoursLog, isAdmin }: { salaries: Salary[]; setSalaries: (s: Salary[]) => void; processed: boolean[]; setProcessed: (p: boolean[]) => void; payDates: string[]; setPayDates: (p: string[]) => void; hoursLog: HoursLog; isAdmin: boolean }) => {
  const now = new Date();
  const [openMonth, setOpenMonth] = useState<number>(now.getMonth());
  const [year, setYear] = useState<number>(now.getFullYear());
  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);
  const [breakdownFor, setBreakdownFor] = useState<ComputedSalary | null>(null);
  const [historyFor, setHistoryFor] = useState<{ name: string; dipendenteId?: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadDipendenti = () => {
      fetchDipendenti(false).then((rows) => {
        if (mounted) setDipendenti(rows);
      }).catch(() => {
        if (mounted) setDipendenti([]);
      });
    };
    loadDipendenti();
    const onFocus = () => loadDipendenti();
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel("contabilita-dipendenti-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "dipendenti" }, () => loadDipendenti())
      .subscribe();
    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  const { year: prevY, month: prevM } = prevMonthYear(year, openMonth);
  const prevKey = `${prevY}-${prevM}`;
  const prevHoursMonth = hoursLog[prevKey] ?? { rows: [] };
  const isProcessed = !!processed[openMonth];
  const savedRowsForMonth = useMemo(
    () => salaries
      .filter((s) => s.month === openMonth)
      .filter((s) => (s.totale || 0) > 0 || (s.bonifico || 0) !== 0 || (s.contanti || 0) !== 0 || (s.cassaBanca || 0) !== 0 || (s.cassaContanti || 0) !== 0 || s.sc)
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" })),
    [salaries, openMonth],
  );
  const useSavedRows = isProcessed && savedRowsForMonth.length > 0;

  const computedRows: ComputedSalary[] = useMemo(() => {
    const rows = prevHoursMonth.rows.map((r) => {
      const dip = findDipendente(dipendenti, r.name, r.dipendenteId);
      return computeSalaryForRow(r, dip, prevY, prevM);
    });
    return rows;
  }, [prevHoursMonth, dipendenti, prevY, prevM]);

  // Match each computed row with an existing Salary record for the openMonth (by name).
  const ensureSalary = (c: ComputedSalary): Salary => {
    const found = salaries.find((s) => s.month === openMonth && s.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (found) return found;
    return { id: `__virtual-${c.name}`, name: c.name, month: openMonth, totale: c.totale, bonifico: 0, contanti: c.totale, sc: false, cassaBanca: 0, cassaContanti: 0 };
  };

  const displayRows = useMemo(() => {
    if (useSavedRows) {
      const computedByKey = new Map(computedRows.map((c) => [c.name.trim().toLowerCase(), c] as const));
      return savedRowsForMonth.map((salary) => {
        const dip = findDipendente(dipendenti, salary.name);
        // Se l'utente non ha impostato uno split manuale (sc=false), riflettiamo
        // il totale ricalcolato dalle ore in tempo reale (così le correzioni sui
        // conteggi ore — festivo, doppia, ferie — aggiornano subito gli importi).
        const fresh = computedByKey.get(salary.name.trim().toLowerCase());
        const computed = fresh && !salary.sc ? fresh : computedFromSavedSalary(salary, dip);
        return { key: salary.id, computed, salary, saved: true };
      });
    }
    return computedRows.map((computed) => ({ key: computed.name, computed, salary: ensureSalary(computed), saved: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSavedRows, savedRowsForMonth, computedRows, dipendenti, salaries, openMonth]);

  // Allinea i totali salvati a quelli ricalcolati dalle ore: senza questo i
  // movimenti virtuali (cassa/competenza) usavano importi obsoleti e non
  // corrispondevano ai totali mostrati in tabella.
  useEffect(() => {
    if (!useSavedRows) return;
    const patches = new Map<string, number>();
    displayRows.forEach(({ computed, salary }) => {
      if (salary.sc) return;
      const fresh = Math.round((Number(computed.totale) || 0) * 100) / 100;
      const stored = Math.round((Number(salary.totale) || 0) * 100) / 100;
      if (fresh !== stored) patches.set(salary.id, fresh);
    });
    if (patches.size === 0) return;
    setSalaries(salaries.map((s) => patches.has(s.id) ? { ...s, totale: patches.get(s.id)! } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows, useSavedRows]);


  const persistRow = (c: ComputedSalary, patch: Partial<Salary>) => {
    const existing = salaries.find((s) => s.month === openMonth && s.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (existing) {
      setSalaries(salaries.map((s) => s.id === existing.id ? { ...s, ...patch } : s));
    } else {
      const fresh: Salary = { id: uid(), name: c.name, month: openMonth, totale: c.totale, bonifico: 0, contanti: c.totale, sc: false, cassaBanca: 0, cassaContanti: 0, ...patch };
      setSalaries([...salaries, fresh]);
    }
  };

  // Display rules:
  // Totale = c.totale (auto). Bonifico manual; Contanti = totale - bonifico.
  const bonificoOf = (s: Salary) => s.bonifico;
  const contantiOf = (c: ComputedSalary, s: Salary) => s.sc ? s.contanti : c.totale - s.bonifico;
  const totaleOf = (c: ComputedSalary, s: Salary) => s.sc ? (s.bonifico + s.contanti) : c.totale;
  const cassaBancaOf = (s: Salary) => s.cassaBanca;
  const compBancaOf = (s: Salary) => bonificoOf(s) - cassaBancaOf(s);
  const compContantiOf = (c: ComputedSalary, s: Salary) => contantiOf(c, s) - s.cassaContanti;

  const recomputeSavedFromHours = () => {
    const byKey = new Map(computedRows.map((c) => [c.name.trim().toLowerCase(), c] as const));
    const computedKeys = new Set(byKey.keys());
    // Rimuove le righe salvate per il mese che non hanno più ore corrispondenti
    // (a meno che non siano state modificate manualmente: bonifico/contanti/sc/cassa != 0)
    const updated = salaries.flatMap<Salary>((s) => {
      if (s.month !== openMonth) return [s];
      const key = s.name.trim().toLowerCase();
      const c = byKey.get(key);
      if (c) {
        byKey.delete(key);
        return [{ ...s, totale: c.totale }];
      }
      const manuallyEdited = s.bonifico !== 0 || s.sc || s.cassaBanca !== 0 || s.cassaContanti !== 0;
      if (!computedKeys.has(key) && !manuallyEdited) return [];
      return [s];
    });
    const toAdd: Salary[] = Array.from(byKey.values()).map((c) => ({
      id: uid(),
      name: c.name,
      month: openMonth,
      totale: c.totale,
      bonifico: 0,
      contanti: c.totale,
      sc: false,
      cassaBanca: 0,
      cassaContanti: 0,
    }));
    setSalaries([...updated, ...toAdd]);
  };

  const toggleProcessed = (v: boolean) => {
    const next = Array.from({ length: 12 }, (_, i) => !!processed[i]);
    next[openMonth] = v;
    if (v) recomputeSavedFromHours();
    setProcessed(next);
  };
  const currentPayDate = sanitizeSalaryPayDate(payDates[openMonth], openMonth);
  const updatePayDate = (v: string) => {
    if (!isCompleteDate(v)) return;
    const next = Array.from({ length: 12 }, (_, i) => sanitizeSalaryPayDate(payDates[i], i));
    next[openMonth] = v;
    setPayDates(next);
  };

  const monthTotals = displayRows.reduce((acc, row) => {
    const c = row.computed;
    const s = row.salary;
    return {
      totale: acc.totale + totaleOf(c, s),
      bonifico: acc.bonifico + bonificoOf(s),
      contanti: acc.contanti + contantiOf(c, s),
      cassaBanca: acc.cassaBanca + cassaBancaOf(s),
      cassaContanti: acc.cassaContanti + s.cassaContanti,
      compBanca: acc.compBanca + compBancaOf(s),
      compContanti: acc.compContanti + compContantiOf(c, s),
    };
  }, { totale: 0, bonifico: 0, contanti: 0, cassaBanca: 0, cassaContanti: 0, compBanca: 0, compContanti: 0 });

  const cell = "h-9 w-full rounded-md border border-input bg-background px-2 text-right font-mono text-xs";
  const cellRO = "flex h-9 w-full items-center justify-end rounded-md border border-input bg-muted px-2 font-mono text-xs";

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Stipendi per mese</CardTitle>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Anno</label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} className="h-8 w-24" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MONTHS.map((m, i) => {
            const { year: pY, month: pM } = prevMonthYear(year, i);
            const savedForMonth = salaries.filter((s) => s.month === i);
            const hm = hoursLog[`${pY}-${pM}`] ?? { rows: [] };
            const tot = processed[i] && savedForMonth.length > 0
              ? savedForMonth.reduce((sum, s) => sum + (s.sc ? (Number(s.bonifico) || 0) + (Number(s.contanti) || 0) : (Number(s.totale) || 0)), 0)
              : hm.rows.reduce((sum, r) => {
                const dip = findDipendente(dipendenti, r.name, r.dipendenteId);
                return sum + computeSalaryForRow(r, dip, pY, pM).totale;
              }, 0);
            return (
              <Button key={m} size="sm" variant={openMonth === i ? "default" : "outline"} onClick={() => setOpenMonth(i)}>
                {m}{tot > 0 ? <span className="ml-1 font-mono text-[10px] opacity-80">{eur(tot)}</span> : null}
                {processed[i] ? <span className="ml-1 text-[10px]">✓</span> : null}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-md border-2 border-dept bg-dept-soft/30 px-3 py-2 text-sm font-medium cursor-pointer w-fit">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-dept" checked={isProcessed} onChange={(e) => toggleProcessed(e.target.checked)} />
            Stipendi elaborati per {MONTHS[openMonth]}
          </label>
          <label className="flex items-center gap-2 rounded-md border-2 border-dept bg-dept-soft/30 px-3 py-2 text-sm font-medium w-fit">
            <span>Data pagamento {MONTHS[openMonth]}</span>
            <DateInput className="h-8 w-36 rounded-md border border-input bg-background px-2 font-mono text-xs" value={currentPayDate} onCommit={updatePayDate} />
          </label>
          {isProcessed && (
            <Button size="sm" variant="outline" onClick={recomputeSavedFromHours} title={`Ricalcola i totali dalle ore di ${MONTHS[prevM]} ${prevY}`}>
              ↻ Ricalcola dalle ore
            </Button>
          )}
          <div className="text-xs text-muted-foreground">
            {useSavedRows ? (
              <>Valori storici salvati per <strong>{MONTHS[openMonth]} {year}</strong> · {savedRowsForMonth.length} dipendenti</>
            ) : (
              <>Calcolato dalle ore di <strong>{MONTHS[prevM]} {prevY}</strong> · {prevHoursMonth.rows.length} dipendenti</>
            )}
          </div>
        </div>
        {(() => {
          const saldati = monthTotals.cassaBanca + monthTotals.cassaContanti;
          const daSaldare = monthTotals.compBanca + monthTotals.compContanti;
          const diff = Math.round((monthTotals.totale - saldati - daSaldare) * 100) / 100;
          return (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border-2 border-dept bg-dept-soft/30 px-3 py-2">
                <div className="label-cap text-foreground">Totale stipendi {MONTHS[openMonth]}</div>
                <div className="font-mono text-lg font-bold">{eur(monthTotals.totale)}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="label-cap text-foreground">Saldati (cassa banca + contanti)</div>
                <div className="font-mono text-lg font-bold">{eur(saldati)}</div>
                <div className="text-[11px] text-muted-foreground">{eur(monthTotals.cassaBanca)} banca · {eur(monthTotals.cassaContanti)} contanti</div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="label-cap text-foreground">Da saldare (competenza)</div>
                <div className="font-mono text-lg font-bold">{eur(daSaldare)}</div>
                <div className="text-[11px] text-muted-foreground">{eur(monthTotals.compBanca)} banca · {eur(monthTotals.compContanti)} contanti</div>
              </div>
              {diff !== 0 && (
                <div className="sm:col-span-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  Attenzione: saldati + da saldare non corrispondono al totale (differenza {eur(diff)}).
                </div>
              )}
            </div>
          );
        })()}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-dept bg-dept-soft/40">
                <th rowSpan={2} className="border border-border px-2 py-1.5 text-left label-cap">Dipendente</th>
                <th rowSpan={2} className="border border-border px-2 py-1.5 text-right label-cap">Totale</th>
                <th colSpan={2} className="border border-border bg-muted/40 px-2 py-1.5 text-center label-cap text-foreground">Divisione pagamento</th>
                <th colSpan={2} className="border border-border bg-dept-soft/60 px-2 py-1.5 text-center label-cap text-foreground">Cassa</th>
                <th colSpan={2} className="border border-border bg-muted/50 px-2 py-1.5 text-center label-cap text-foreground">Competenza</th>
              </tr>
              <tr className="border-b border-border bg-muted/30">
                <th className="border border-border px-2 py-1 text-right label-cap">Bonifico</th>
                <th className="border border-border px-2 py-1 text-right label-cap">Contanti</th>
                <th className="border border-border px-2 py-1 text-right label-cap">Banca</th>
                <th className="border border-border px-2 py-1 text-right label-cap">Contanti</th>
                <th className="border border-border px-2 py-1 text-right label-cap">Banca</th>
                <th className="border border-border px-2 py-1 text-right label-cap">Contanti</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr><td colSpan={8} className="border border-border p-3 text-center text-muted-foreground">Nessuna ora registrata in {MONTHS[prevM]} {prevY}. Compila il Calcolo ore del mese precedente.</td></tr>
              ) : displayRows.map((row) => {
                const c = row.computed;
                const s = row.salary;
                return (
                  <tr key={row.key} className="border-b border-border hover:bg-dept-soft/20">
                    <td className="border border-border p-1">
                      <button type="button" onClick={() => setHistoryFor({ name: c.name, dipendenteId: c.dipendenteId })} className="h-9 w-full rounded-md px-2 text-left text-xs font-medium hover:bg-dept-soft/40 underline-offset-2 hover:underline">
                        {c.name}{row.saved ? <span className="ml-2 rounded-sm bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground no-underline">salvato</span> : null}
                      </button>
                    </td>
                    <td className="border border-border p-1">
                      <button type="button" onClick={() => setBreakdownFor(c)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-right font-mono text-xs font-semibold hover:bg-dept-soft/40 underline-offset-2 hover:underline" title="Vedi calcolo analitico">
                        {eur(totaleOf(c, s))}
                      </button>
                    </td>
                    <td className="border border-border p-1">
                      <NumberInput className={cell} value={s.bonifico} onChange={(bonifico) => persistRow(c, { bonifico })} />
                    </td>
                    <td className="border border-border p-1">
                      <div className="flex items-center gap-1">
                        <label className="flex items-center" title="Sblocca per modificare i contanti manualmente">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 cursor-pointer accent-dept"
                            checked={!!s.sc}
                            onChange={(e) => {
                              const sc = e.target.checked;
                              persistRow(c, sc ? { sc: true, contanti: contantiOf(c, s) } : { sc: false, contanti: c.totale - s.bonifico });
                            }}
                          />
                        </label>
                        {s.sc ? (
                          <NumberInput className={cell} value={s.contanti} onChange={(contanti) => persistRow(c, { contanti })} />
                        ) : (
                          <div className={cellRO} title="Calcolato: Totale − Bonifico">{eur(contantiOf(c, s))}</div>
                        )}
                      </div>
                    </td>
                    <td className="border border-border p-1">
                      <NumberInput className={cell} value={s.cassaBanca} onChange={(cassaBanca) => persistRow(c, { cassaBanca })} />
                    </td>
                    <td className="border border-border p-1">
                      <NumberInput className={cell} value={s.cassaContanti} onChange={(cassaContanti) => persistRow(c, { cassaContanti })} />
                    </td>
                    <td className="border border-border p-1"><div className={cellRO}>{eur(compBancaOf(s))}</div></td>
                    <td className="border border-border p-1"><div className={cellRO}>{eur(compContantiOf(c, s))}</div></td>
                  </tr>
                );
              })}
            </tbody>
            {displayRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-dept bg-dept-soft/30 font-semibold">
                  <td className="border border-border px-2 py-1.5 text-right label-cap">Totali</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono text-dept">{eur(monthTotals.totale)}</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono">{eur(monthTotals.bonifico)}</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono">{eur(monthTotals.contanti)}</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono">{eur(monthTotals.cassaBanca)}</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono">{eur(monthTotals.cassaContanti)}</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono">{eur(monthTotals.compBanca)}</td>
                  <td className="border border-border px-2 py-1.5 text-right font-mono">{eur(monthTotals.compContanti)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>

      <BreakdownDialog
        data={breakdownFor}
        year={prevY}
        month={prevM}
        onClose={() => setBreakdownFor(null)}
      />
      <HistoryDialog
        target={historyFor}
        hoursLog={hoursLog}
        salaries={salaries}
        dipendenti={dipendenti}
        salaryYear={year}
        onClose={() => setHistoryFor(null)}
      />
    </Card>
  );
};

const DAY_NAMES_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

const BreakdownDialog = ({ data, year, month, onClose }: { data: ComputedSalary | null; year: number; month: number; onClose: () => void }) => {
  if (!data) return null;
  return (
    <Dialog open={!!data} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calcolo stipendio · {data.name}</DialogTitle>
          <DialogDescription>
            Periodo {MONTHS[month]} {year} · €/ora <strong>{data.hourlyRate.toFixed(2)}</strong> · contratto {data.contractH}h/giorno · straordinario €5/h
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryBox label="Ore normali" value={`${data.totals.normalH.toFixed(1)}h`} />
            <SummaryBox label="Straordinario" value={`${data.totals.overtimeH.toFixed(1)}h`} />
            <SummaryBox label="Ferie/Malattia/Permessi" value={`${data.totals.paidH.toFixed(1)}h`} />
            <SummaryBox label="Giorni festivi lavorati" value={String(data.totals.holidayDays)} />
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-1 text-left">Giorno</th>
                  <th className="px-2 py-1 text-left">Dettaglio</th>
                  <th className="px-2 py-1 text-right">Ore normali</th>
                  <th className="px-2 py-1 text-right">Straord.</th>
                  <th className="px-2 py-1 text-right">Ferie/Mal/Perm</th>
                  <th className="px-2 py-1 text-right">Importo</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.map((d) => (
                  <tr key={d.day} className={`border-t ${d.isHoliday ? "bg-amber-50" : ""}`}>
                    <td className="px-2 py-1 font-medium">
                      {d.day} <span className="text-muted-foreground">{DAY_NAMES_SHORT[d.dow]}</span>
                      {d.isHoliday && <span className="ml-1 text-[10px] text-amber-700">×2</span>}
                    </td>
                    <td className="px-2 py-1 text-[11px] text-muted-foreground">
                      {d.segs.map((s, i) => <span key={i} className="mr-2">{s.t} {s.h}h</span>)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{d.normalH.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{d.overtimeH.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{d.paidH.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right font-mono font-semibold">
                      {eur(d.amount)}
                      {d.trasfertaBonus > 0 && <div className="text-[9px] text-blue-700">+{eur(d.trasfertaBonus)} trasferta</div>}
                      {d.isHoliday && d.baseAmount !== d.amount && <div className="text-[9px] text-muted-foreground">(base {eur(d.baseAmount)})</div>}
                    </td>
                  </tr>
                ))}
                {data.breakdown.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">Nessun giorno registrato</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-dept-soft/30 font-semibold">
                  <td colSpan={2} className="px-2 py-1.5 text-right">Totale stipendio</td>
                  <td className="px-2 py-1.5 text-right font-mono">{data.totals.normalH.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{data.totals.overtimeH.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{data.totals.paidH.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-dept">{eur(data.totale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="rounded-md border bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
            <div><strong>Formula:</strong> (ore normali + ferie/mal/permessi) × €/ora + straordinario × €5</div>
            <div>Le ore di domenica o segnate come "festivo" sono conteggiate come ore ordinarie.</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SummaryBox = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border bg-muted/20 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="text-base font-bold font-mono">{value}</div>
  </div>
);

const HistoryDialog = ({ target, hoursLog, salaries, dipendenti, salaryYear, onClose }: { target: { name: string; dipendenteId?: string } | null; hoursLog: HoursLog; salaries: Salary[]; dipendenti: Dipendente[]; salaryYear: number; onClose: () => void }) => {
  if (!target) return null;
  const dip = findDipendente(dipendenti, target.name, target.dipendenteId);
  const targetMatches = (name: string) => sameEmployeeName(name, target.name) || (!!dip && sameEmployeeName(name, dip.nome));
  const entriesBySalaryMonth = new Map<string, { key: string; periodYear: number; periodMonth: number; salaryYear: number; salaryMonth: number; totale: number; bonifico?: number; contanti?: number; source: "salvato" | "calcolato" }>();

  salaries.forEach((salary) => {
    if (!targetMatches(salary.name)) return;
    const { year: periodYear, month: periodMonth } = prevMonthYear(salaryYear, salary.month);
    const key = `${salaryYear}-${salary.month}`;
    const savedTotale = Number(salary.totale) || 0;
    const savedBonifico = Number(salary.bonifico) || 0;
    const rawContanti = Number(salary.contanti);
    const savedContanti = Number.isFinite(rawContanti) ? rawContanti : Math.max(0, savedTotale - savedBonifico);
    entriesBySalaryMonth.set(key, {
      key,
      periodYear,
      periodMonth,
      salaryYear,
      salaryMonth: salary.month,
      totale: savedTotale,
      bonifico: savedBonifico,
      contanti: savedContanti,
      source: "salvato",
    });
  });

  Object.entries(hoursLog).forEach(([key, hm]) => {
    const [yStr, mStr] = key.split("-");
    const y = Number(yStr); const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    const row = hm.rows.find((r) => (target.dipendenteId && r.dipendenteId === target.dipendenteId) || targetMatches(r.name));
    if (!row) return;
    const c = computeSalaryForRow(row, dip, y, m);
    const salaryMonth = m === 11 ? 0 : m + 1;
    const nextSalaryYear = m === 11 ? y + 1 : y;
    const mapKey = `${nextSalaryYear}-${salaryMonth}`;
    const manualSalary = salaries.find((s) => s.month === salaryMonth && targetMatches(s.name));
    const manualTotale = manualSalary ? Number(manualSalary.totale) || c.totale : c.totale;
    const manualBonifico = manualSalary ? Number(manualSalary.bonifico) || 0 : undefined;
    const rawManualContanti = manualSalary ? Number(manualSalary.contanti) : NaN;
    const manualContanti = manualSalary ? (Number.isFinite(rawManualContanti) ? rawManualContanti : Math.max(0, manualTotale - (manualBonifico || 0))) : undefined;
    const existing = entriesBySalaryMonth.get(mapKey);
    entriesBySalaryMonth.set(mapKey, {
      key: mapKey,
      periodYear: y,
      periodMonth: m,
      salaryYear: nextSalaryYear,
      salaryMonth,
      totale: existing?.source === "salvato" ? existing.totale : c.totale,
      bonifico: typeof manualBonifico === "number" ? manualBonifico : existing?.bonifico,
      contanti: typeof manualContanti === "number" ? manualContanti : existing?.contanti,
      source: existing?.source === "salvato" ? "salvato" : "calcolato",
    });
  });
  const entries = Array.from(entriesBySalaryMonth.values()).sort((a, b) => a.salaryYear === b.salaryYear ? a.salaryMonth - b.salaryMonth : a.salaryYear - b.salaryYear);
  const grandTotal = entries.reduce((s, e) => s + e.totale, 0);
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Storico stipendi · {target.name}</DialogTitle>
          <DialogDescription>
            €/ora {(Number(dip?.hourly_rate) || 0).toFixed(2)} · contratto {(Number(dip?.contract_hours_per_day) || 8)}h/giorno
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-2 py-1 text-left">Periodo ore</th>
                <th className="px-2 py-1 text-left">Stipendio pagato in</th>
                <th className="px-2 py-1 text-right">Calcolato</th>
                <th className="px-2 py-1 text-right">Bonifico</th>
                <th className="px-2 py-1 text-right">Contanti</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">Nessuno storico stipendio presente</td></tr>
              ) : entries.map((e) => {
                return (
                  <tr key={e.key} className="border-t">
                    <td className="px-2 py-1 font-medium">{MONTHS[e.periodMonth]} {e.periodYear}</td>
                    <td className="px-2 py-1 text-muted-foreground">{MONTHS[e.salaryMonth]} {e.salaryYear} <span className="ml-1 text-[10px]">{e.source}</span></td>
                    <td className="px-2 py-1 text-right font-mono font-semibold">{eur(e.totale)}</td>
                    <td className="px-2 py-1 text-right font-mono">{typeof e.bonifico === "number" ? eur(e.bonifico) : "—"}</td>
                    <td className="px-2 py-1 text-right font-mono">{typeof e.contanti === "number" ? eur(e.contanti) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 bg-dept-soft/30 font-semibold">
                  <td colSpan={2} className="px-2 py-1.5 text-right">Totale</td>
                  <td className="px-2 py-1.5 text-right font-mono text-dept">{eur(grandTotal)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
