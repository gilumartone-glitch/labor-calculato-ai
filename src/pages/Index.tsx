import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, Scissors, Printer, Hammer, Wrench, Sigma, Users, User, RotateCcw, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { DepartmentView } from "@/components/calculator/DepartmentView";
import { GeneralSummary } from "@/components/calculator/GeneralSummary";
import { Catalog, DepartmentKey, DepartmentState, PieceLine } from "@/components/calculator/types";
import { loadCatalog, saveCatalog, emptyCatalog } from "@/lib/catalog";
import { useCloudCatalogs } from "@/hooks/useCloudCatalogs";
import { buildPerimeterOpsForDept, perimeterCost } from "@/lib/perimeter";
import { pieceTotal, aggregateScrapDeduction } from "@/lib/piece";
import { buildGhostMaterialsForLab } from "@/lib/ghost-materials";
import { materialAwareCatalog, withoutInitialScrap } from "@/lib/piece-catalog";
import { syncMaterialFromLabDimensions } from "@/lib/lab-sync";
import { uid } from "@/lib/format";
import { workerHourlyCost } from "@/lib/workshop-shared";
import { CustomerType, priceMultiplier } from "@/lib/pricing";
import Falegnameria from "./Falegnameria";
import Montaggi from "./Montaggi";
import MagazzinoCalc from "./MagazzinoCalc";
import { HubLink } from "@/components/HubLink";
import { DraftTabsBar } from "@/components/design/DraftTabsBar";
import { NotificationsBell } from "@/components/produzione/NotificationsBell";

type TabKey = DepartmentKey | "magazzino" | "montaggi" | "riepilogo";

const TABS: {
  key: TabKey;
  label: string;
  icon: typeof Scissors;
  description: string;
  template: { url: string; name: string };
}[] = [
  {
    key: "stampa",
    label: "Laboratorio",
    icon: Printer,
    description: "Stampa, taglio e lavorazioni di laboratorio.",
    template: { url: "/templates/listino-stampa.xlsx", name: "listino-laboratorio.xlsx" },
  },
  {
    key: "tappezzeria",
    label: "Tappezzeria",
    icon: Scissors,
    description: "Tessuti, lavorazioni di cucito, imbottiture, montaggi.",
    template: { url: "/templates/listino-tappezzeria.xlsx", name: "listino-tappezzeria.xlsx" },
  },
  {
    key: "falegnameria",
    label: "Falegnameria",
    icon: Hammer,
    description: "Pannelli, essenze, ferramenta e finiture.",
    template: { url: "/templates/listino-falegnameria.xlsx", name: "listino-falegnameria.xlsx" },
  },
  {
    key: "magazzino",
    label: "Vendite",
    icon: Warehouse,
    description: "Database prodotti per la vendita (tappeto danza, vernici ignifughe, prodotti stampa, tessuti) e calcolatori di fabbisogno.",
    template: { url: "", name: "" },
  },
  {
    key: "montaggi",
    label: "Montaggi",
    icon: Wrench,
    description: "Squadre, trasferte, mezzi, accessori e materiali di posa.",
    template: { url: "", name: "" },
  },
  {
    key: "riepilogo",
    label: "Riepilogo",
    icon: Sigma,
    description: "Somma di tutti i reparti con margine e IVA.",
    template: { url: "", name: "" },
  },
];

const STATE_KEY = "officina:state";
const STATE_VERSION = 9;
const WORKSHOP_KEYS = {
  falegnameria: "officina:falegnameria-module:v2",
  montaggi: "officina:montaggi-module:v2",
} as const;

const initialDept = (): DepartmentState => ({
  materials: [],
  operations: [],
  perimeters: [],
  pieces: [],
  transports: [],
});

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab") as TabKey | null;
    const valid: TabKey[] = ["tappezzeria", "stampa", "falegnameria", "magazzino", "montaggi", "riepilogo"];
    return t && valid.includes(t) ? t : "stampa";
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  useEffect(() => {
    const t = searchParams.get("tab") as TabKey | null;
    const valid: TabKey[] = ["tappezzeria", "stampa", "falegnameria", "magazzino", "montaggi", "riepilogo"];
    if (t && valid.includes(t) && t !== activeTab) setActiveTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const changeTab = (k: TabKey) => {
    setActiveTab(k);
    const next = new URLSearchParams(searchParams);
    if (k === "stampa") next.delete("tab"); else next.set("tab", k);
    setSearchParams(next, { replace: true });
  };

  /** Carica lo stato iniziale da localStorage STATE_KEY.
   *  La persistenza per-scheda (e la sync cloud) è gestita da DraftTabsBar,
   *  che scrive lo snapshot della scheda attiva in localStorage prima del mount
   *  e ricarica la pagina ad ogni switch. NON usiamo useCloudWorkspace qui
   *  perché farebbe condividere lo stesso stato fra tutte le schede. */
  type StoredSnap = {
    version: number;
    departments: Record<DepartmentKey, DepartmentState>;
    jobName: string;
    quantity: number;
    margin: number;
    vat: number;
    applyVat: boolean;
    customerType: CustomerType;
  };
  /** Normalizza qualsiasi snapshot (calcolatrice o produzione/revisione) nel formato
   *  StoredSnap. In particolare:
   *  - se è uno snapshot "produzione" (con `designState`), preferisce quello
   *  - se mancano `version`/campi, completa con default invece di scartare tutto
   *    (così le bozze tornate in revisione non spariscono solo per un version bump). */
  const normalizeSnap = (raw: any): Partial<StoredSnap> | null => {
    if (!raw || typeof raw !== "object") return null;
    // Snapshot produzione: preferisci designState che è in formato calcolatrice
    if (raw.designState && typeof raw.designState === "object") {
      const merged: any = { ...raw.designState };
      for (const k of ["jobName", "quantity", "margin", "vat", "applyVat", "customerType"] as const) {
        if (merged[k] == null && raw[k] != null) merged[k] = raw[k];
      }
      return normalizeSnap(merged);
    }
    // Snapshot "revisione" o produzione estratto: i reparti sono al top-level
    // invece che sotto `departments` (la SQL `return_order_to_revision`
    // copia direttamente designState come snapshot della bozza).
    if (!raw.departments && (raw.tappezzeria || raw.stampa || raw.falegnameria)) {
      const { tappezzeria, stampa, falegnameria, ...rest } = raw;
      return { ...rest, departments: { tappezzeria, stampa, falegnameria } } as Partial<StoredSnap>;
    }
    return raw;
  };
  const readInitialSnap = (): Partial<StoredSnap> | null => {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return null;
      return normalizeSnap(JSON.parse(raw));
    } catch { return null; }
  };
  const initialSnap = readInitialSnap();
  const buildDepts = (raw: any): Record<DepartmentKey, DepartmentState> => {
    let depRaw: Partial<Record<DepartmentKey, Partial<DepartmentState>>> = {};
    if (Array.isArray(raw)) {
      // Formato produzione: array di { key, state, ... }
      for (const entry of raw) {
        const k = entry?.key as DepartmentKey | undefined;
        if (k && (k === "tappezzeria" || k === "stampa" || k === "falegnameria") && entry?.state) {
          depRaw[k] = entry.state;
        }
      }
    } else if (raw && typeof raw === "object") {
      depRaw = raw;
    }
    const dep: Record<DepartmentKey, DepartmentState> = {
      tappezzeria: { ...initialDept(), ...(depRaw.tappezzeria ?? {}) },
      stampa: { ...initialDept(), ...(depRaw.stampa ?? {}) },
      falegnameria: { ...initialDept(), ...(depRaw.falegnameria ?? {}) },
    };
    (Object.keys(dep) as DepartmentKey[]).forEach((k) => {
      if (!Array.isArray(dep[k].pieces)) dep[k].pieces = [];
    });
    dep.stampa.pieces = dep.stampa.pieces.map((p) => (p.noMargins === true ? p : { ...p, noMargins: true }));
    return syncMaterialFromLabDimensions(dep);
  };

  const [departments, setDepartments] = useState<Record<DepartmentKey, DepartmentState>>(() =>
    buildDepts(initialSnap?.departments),
  );
  const [jobName, setJobName] = useState(initialSnap?.jobName ?? "");
  const [quantity, setQuantity] = useState(typeof initialSnap?.quantity === "number" ? initialSnap.quantity : 1);
  const [margin, setMargin] = useState(typeof initialSnap?.margin === "number" ? initialSnap.margin : 30);
  const [vat, setVat] = useState(typeof initialSnap?.vat === "number" ? initialSnap.vat : 22);
  const [applyVat, setApplyVat] = useState(typeof initialSnap?.applyVat === "boolean" ? initialSnap.applyVat : false);
  const [customerType, setCustomerType] = useState<CustomerType>(initialSnap?.customerType === "dealer" ? "dealer" : "final");
  const [workshopTick, setWorkshopTick] = useState(0);
  const [draftReloadNonce, setDraftReloadNonce] = useState(0);
  /** Incrementato ad ogni Reset totale: usato come `key` del contenuto per forzare
   *  un rimontaggio completo dei componenti (input, autocomplete, ...) ed evitare
   *  che stati locali "rimasti appesi" blocchino la scrittura nei campi. */
  const [resetNonce, setResetNonce] = useState(0);

  // Funzione di post-processing applicata ai cataloghi caricati (default + migrazioni)
  const ensurePresets = (c: Catalog, dept: DepartmentKey): Catalog => {
      const ops = c.perimeterOps ?? [];
      let next = ops;
      if (next.length === 0) next = buildPerimeterOpsForDept(dept);

      // Solo Tappezzeria ha bisogno delle lavorazioni speciali "Cucitura" e "Tiro a Pacchetto"
      if (dept === "tappezzeria") {
        const ensureOp = (
          list: typeof next,
          name: string,
          color: string,
        ): typeof next => {
          const exists = list.some((o) => o.name.trim().toLowerCase() === name.toLowerCase());
          if (exists) return list;
          return [...list, { id: uid(), name, pricePerMeter: 0, color }];
        };
        next = ensureOp(next, "Cucitura", "hsl(0 0% 20%)");
        next = ensureOp(next, "Tiro a Pacchetto", "hsl(200 80% 45%)");
      }

      const result: Catalog = next === ops ? { ...c } : { ...c, perimeterOps: next };
      // Voci stampa precompilate (solo se mancanti); l'utente può modificarle dal listino
      if (dept === "stampa" && (!result.printOps || result.printOps.length === 0)) {
        result.printOps = [
          { id: uid(), type: "uv", mode: "standard", pricePerSqm: 0 },
          { id: uid(), type: "uv", mode: "fronte_retro", pricePerSqm: 0 },
          { id: uid(), type: "uv", mode: "bianco", pricePerSqm: 0 },
          { id: uid(), type: "solvente", mode: "standard", pricePerSqm: 0 },
          { id: uid(), type: "solvente", mode: "fronte_retro", pricePerSqm: 0 },
        ];
      }
      if (typeof result.markupPct !== "number") result.markupPct = 0;
      return result;
    };

  // Cataloghi sincronizzati con Lovable Cloud (con realtime + migrazione localStorage)
  const { catalogs, setCatalog: setCatalogCloud } = useCloudCatalogs(
    {
      tappezzeria: emptyCatalog(),
      stampa: emptyCatalog(),
      falegnameria: emptyCatalog(),
    },
    ensurePresets,
  );

  // Persistenza dello stato del preventivo in localStorage STATE_KEY.
  // La scheda attiva (DraftTabsBar) legge questo valore e lo salva su `design_drafts`
  // (cloud) tramite debounce + interval. Ogni scheda ha così il proprio stato isolato.
  const lastAppliedRef = useRef<string>("");
  useEffect(() => {
    const snap: StoredSnap = { version: STATE_VERSION, departments, jobName, quantity, margin, vat, applyVat, customerType };
    const serialized = JSON.stringify(snap);
    if (serialized === lastAppliedRef.current) return;
    lastAppliedRef.current = serialized;
    try {
      localStorage.setItem(STATE_KEY, serialized);
      window.dispatchEvent(new Event("officina:draft-state-changed"));
    } catch { /* ignore */ }
  }, [departments, jobName, quantity, margin, vat, applyVat, customerType]);

  useEffect(() => {
    const refresh = () => setWorkshopTick((v) => v + 1);
    window.addEventListener("workshop-summary-updated", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("officina:draft-state-changed", refresh);
    return () => {
      window.removeEventListener("workshop-summary-updated", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("officina:draft-state-changed", refresh);
    };
  }, []);

  const setCatalog = (key: DepartmentKey) => (c: Catalog) => {
    setCatalogCloud(key)(c);
    // Mantieni anche un backup locale per offline/legacy
    saveCatalog(key, c);
  };

  const setDept = (key: DepartmentKey) => (s: DepartmentState) => {
    // Le righe materiale "ghost" (auto-generate da pezzi di altri reparti) non
    // devono essere persistite nello state del reparto: vengono ricalcolate ad ogni
    // render. Le filtro qui prima di salvare.
    const cleaned: DepartmentState = {
      ...s,
      materials: s.materials.filter((m) => !m.ghostFromPieceId),
    };
    setDepartments((prev) => syncMaterialFromLabDimensions({ ...prev, [key]: cleaned }));
  };

  useEffect(() => {
    const applyLoadedDraft = (event: Event) => {
      const rawSnap = (event as CustomEvent<any>).detail ?? {};
      const nextSnap = (normalizeSnap(rawSnap) ?? {}) as Partial<StoredSnap>;
      const nextDepartments = buildDepts(nextSnap.departments);
      setDepartments(nextDepartments);
      setJobName(nextSnap.jobName ?? "");
      setQuantity(typeof nextSnap.quantity === "number" ? nextSnap.quantity : 1);
      setMargin(typeof nextSnap.margin === "number" ? nextSnap.margin : 30);
      setVat(typeof nextSnap.vat === "number" ? nextSnap.vat : 22);
      setApplyVat(typeof nextSnap.applyVat === "boolean" ? nextSnap.applyVat : false);
      setCustomerType(nextSnap.customerType === "dealer" ? "dealer" : "final");
      lastAppliedRef.current = JSON.stringify({
        version: STATE_VERSION,
        departments: nextDepartments,
        jobName: nextSnap.jobName ?? "",
        quantity: typeof nextSnap.quantity === "number" ? nextSnap.quantity : 1,
        margin: typeof nextSnap.margin === "number" ? nextSnap.margin : 30,
        vat: typeof nextSnap.vat === "number" ? nextSnap.vat : 22,
        applyVat: typeof nextSnap.applyVat === "boolean" ? nextSnap.applyVat : false,
        customerType: nextSnap.customerType === "dealer" ? "dealer" : "final",
      });
      setDraftReloadNonce((n) => n + 1);
    };
    window.addEventListener("officina:draft-state-loaded", applyLoadedDraft);
    return () => window.removeEventListener("officina:draft-state-loaded", applyLoadedDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reset totale del preventivo: azzera tutti i reparti, riporta i parametri ai default
   *  e cancella lo stato persistito su localStorage. NON tocca i listini. */
  const resetAllJob = async () => {
    const totalPieces =
      departments.tappezzeria.pieces.length +
      departments.stampa.pieces.length +
      departments.falegnameria.pieces.length;
    const totalMaterials =
      departments.tappezzeria.materials.length +
      departments.stampa.materials.length +
      departments.falegnameria.materials.length;
    if (totalPieces === 0 && totalMaterials === 0) {
      toast.info("Il preventivo è già vuoto");
      return;
    }
    if (
      !window.confirm(
        `Azzerare TUTTO il preventivo?\nVerranno cancellati ${totalPieces} pezzi e ${totalMaterials} materiali da tutti i reparti.\n(I listini rimangono intatti)`,
      )
    )
      return;
    // Pulisci stato locale e snapshot della scheda attiva sul cloud, poi ricarica.
    // Il reload garantisce il rimontaggio completo di TUTTI i componenti figli
    // (input, autocomplete, righe materiale/pezzo) evitando freeze dovuti a stati
    // locali residui dopo il reset.
    try {
      localStorage.removeItem(STATE_KEY);
      const activeDraftId = localStorage.getItem("officina:active-draft");
      if (activeDraftId) {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase
          .from("design_drafts")
          .update({ snapshot: {} as never })
          .eq("id", activeDraftId);
      }
    } catch {
      /* ignore */
    }
    toast.success("Preventivo azzerato");
    window.location.reload();
  };

  const computeTotals = (s: DepartmentState) => {
    // Le righe materiale sciolte hanno il moltiplicatore già applicato all'unitCost
    // (vedi MaterialRow). Qui sommiamo soltanto.
    const materials = s.materials.reduce((acc, m) => acc + m.quantity * m.unitCost, 0);
    const operations = s.operations.reduce((acc, o) => acc + o.quantity * o.rate, 0);
    const perimeters = (s.perimeters ?? []).reduce((acc, p) => acc + perimeterCost(p), 0);
    const transports = (s.transports ?? []).reduce((acc, t) => acc + t.quantity * t.unitCost, 0);
    return { materials, operations, perimeters, transports, pieces: 0, total: 0 };
  };

  /** Il selettore Riv/Fin vale solo per il reparto Laboratorio (stampa).
   *  Per Tappezzeria e Falegnameria usiamo sempre prezzo "dealer" (unico). */
  const customerForDept = (key: DepartmentKey): CustomerType =>
    key === "stampa" ? customerType : "dealer";

  /** Righe materiale "ghost" derivate dai pezzi degli altri reparti con il flag
   *  `materialFromLab`. Vengono iniettate solo nel reparto Laboratorio. */
  const ghostLabMaterials = buildGhostMaterialsForLab(
    departments,
    catalogs.stampa,
    customerForDept("stampa"),
  );

  /** State del reparto, con eventuali ghost rows iniettate. */
  const stateForDept = (key: DepartmentKey): DepartmentState => {
    const s = departments[key];
    if (key !== "stampa" || ghostLabMaterials.length === 0) return s;
    return { ...s, materials: [...s.materials, ...ghostLabMaterials] };
  };

  const computeTotalsFor = (key: DepartmentKey) => {
    const s = stateForDept(key);
    const base = computeTotals(s);
    const piecesArr = s.pieces ?? [];
    const matCat = (p: PieceLine) => {
      const c = materialAwareCatalog(p, catalogs[key], catalogs.stampa);
      return key === "tappezzeria" ? withoutInitialScrap(c) : c;
    };
    const piecesT =
      piecesArr.reduce(
        (acc, p) => acc + pieceTotal(p, matCat(p), customerForDept(key)),
        0,
      ) -
      // Sfrido (1,5 m) una sola volta per stesso materiale nel reparto
      aggregateScrapDeduction(
        piecesArr,
        (p) => matCat(p),
        () => customerForDept(key),
      );
    // Nel reparto Laboratorio (stampa) il "Totale lavorazioni" è già il prezzo
    // cliente: nel riepilogo non devo riportare anche materiali/trasporti, altrimenti
    // il totale finale li somma due volte.
    if (key === "stampa") {
      return {
        materials: 0,
        operations: 0,
        perimeters: 0,
        transports: 0,
        pieces: piecesT,
        total: piecesT,
      };
    }

    const total = base.materials + base.operations + base.perimeters + base.transports + piecesT;
    return {
      ...base,
      pieces: piecesT,
      total,
    };
  };

  const workshopSummaryData = ([
    { key: "falegnameria", label: "Falegnameria" },
    { key: "montaggi", label: "Montaggi" },
  ] as const).map(({ key, label }) => {
    void workshopTick;
    try {
      // Le chiavi sono scoped per-draft: ogni progetto Flow ha il proprio modulo.
      const activeDraftId = localStorage.getItem("officina:active-draft") || "default";
      const draftKey = `${WORKSHOP_KEYS[key]}:${activeDraftId}`;
      const raw = localStorage.getItem(draftKey);
      if (!raw) return null;
      const project = JSON.parse(raw);
      const materialById = new Map((project.materialCatalog ?? []).map((m: any) => [m.id, m]));
      const materialsByCategory = (project.materials ?? []).reduce((acc: Record<string, number>, line: any) => {
        const item: any = materialById.get(line.materialId);
        const category = item?.category ?? "legno";
        acc[category] = (acc[category] ?? 0) + (Number(line.quantity) || 0) * (Number(line.unitCost ?? item?.unitCost) || 0);
        return acc;
      }, {});
      const labor = (project.labor ?? []).reduce((sum: number, line: any) => {
        const worker = (project.workers ?? []).find((w: any) => w.id === line.workerId);
        return sum + (worker ? workerHourlyCost(worker) * (Number(line.hours) || 0) : 0);
      }, 0);
      const laborHours = (project.labor ?? []).reduce((sum: number, line: any) => sum + (Number(line.hours) || 0), 0);
      const transports = (project.transports ?? []).reduce((sum: number, line: any) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);
      const production = Number(materialsByCategory.legno ?? 0) + Number(materialsByCategory.plastica ?? 0) + Number(materialsByCategory.accessori ?? 0) + labor + transports;
      const total = production + production * ((Number(project.marginPct) || 0) / 100);
      return {
        key,
        label,
        totals: { materials: Number(materialsByCategory.legno ?? 0) + Number(materialsByCategory.plastica ?? 0), operations: labor, perimeters: 0, pieces: Number(materialsByCategory.accessori ?? 0), transports, total },
        details: {
          materials: (project.materials ?? []).map((line: any) => {
            const item: any = materialById.get(line.materialId);
            return item && item.category !== "accessori" ? `${item.name} · ${line.quantity} ${item.unit}` : null;
          }).filter(Boolean),
          accessories: (project.materials ?? []).map((line: any) => {
            const item: any = materialById.get(line.materialId);
            return item && item.category === "accessori" ? `${item.name} · ${line.quantity} ${item.unit}` : null;
          }).filter(Boolean),
          workerCount: new Set((project.labor ?? []).map((line: any) => line.workerId).filter(Boolean)).size,
          laborHours,
          transports: (project.transports ?? []).map((line: any) => `${line.description} · ${line.quantity} × ${line.unitCost}`),
        },
      };
    } catch {
      return null;
    }
  }).filter((entry: any) => {
    if (!entry) return false;
    const t = entry.totals ?? {};
    const sum = (Number(t.materials) || 0) + (Number(t.operations) || 0) + (Number(t.perimeters) || 0) + (Number(t.pieces) || 0) + (Number(t.transports) || 0) + (Number(t.total) || 0);
    if (sum > 0) return true;
    const d = entry.details ?? {};
    const hasItems = (d.materials?.length ?? 0) + (d.accessories?.length ?? 0) + (d.transports?.length ?? 0) + (d.workerCount ?? 0) + (d.laborHours ?? 0) > 0;
    return hasItems;
  });

  const summaryData = (["tappezzeria", "stampa"] as DepartmentKey[]).map((k) => ({
    key: k,
    label: TABS.find((t) => t.key === k)!.label,
    totals: computeTotalsFor(k),
    state: stateForDept(k),
    catalog: catalogs[k],
    customerType: customerForDept(k),
  })).concat(workshopSummaryData as any);

  return (
    <div data-dept={activeTab} className="min-h-screen bg-dept-soft/35 transition-colors">
      {/* Header */}
      <header className="app-header border-b-2 border-dept bg-paper sticky top-0 z-20">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 py-2 md:py-5 flex flex-wrap items-center justify-between gap-2 md:gap-6">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1 md:flex-none">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-dept text-dept-foreground grid place-items-center font-display font-bold text-xl rounded-sm shrink-0">
              ƒ
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm md:text-xl font-semibold leading-none truncate">
                Officina <span className="text-dept">·</span> Progettazione
              </div>
              <div className="hidden md:block text-[10px] uppercase tracking-[0.25em] text-muted-foreground mt-1">
                Schede progetto · invia al Flow quando pronto
              </div>
            </div>
          </div>

          {/* Dept tabs spostate sotto la barra schede progetto */}

          {/* Selettore tipo cliente: SOLO per il reparto Laboratorio (stampa).
              Negli altri reparti il prezzo è unico, quindi nascondiamo il toggle
              e forziamo "dealer" come default. */}
          <div
            className={`hidden md:flex items-center gap-1 bg-background border-2 border-ink rounded-sm p-1 transition-opacity ${
              activeTab === "stampa" ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            aria-hidden={activeTab !== "stampa"}
            title="Tipo cliente: applica i prezzi Riv/Fin (solo Laboratorio)"
          >
            {([
              { v: "dealer" as const, Icon: Users, label: "Riv.", piece: priceMultiplier("dealer", "piece"), cut: priceMultiplier("dealer", "cut") },
              { v: "final" as const, Icon: User, label: "Finale", piece: priceMultiplier("final", "piece"), cut: priceMultiplier("final", "cut") },
            ]).map(({ v, Icon, label, piece, cut }) => {
              const isActive = customerType === v;
              return (
                <button
                  key={v}
                  onClick={() => setCustomerType(v)}
                  title={`${label} · intero ×${piece} · taglio ×${cut}`}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-sm text-[11px] uppercase tracking-wider font-semibold transition-colors ${
                    isActive ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{label}</span>
                  <span className="hidden lg:inline font-mono text-[9px] opacity-70">
                    ×{piece}/×{cut}
                  </span>
                </button>
              );
            })}
          </div>


          <NotificationsBell />

          {/* Reset totale: azzera tutti i reparti del preventivo (i listini restano) */}
          <button
            type="button"
            onClick={resetAllJob}
            title="Reset totale: azzera tutti i reparti del preventivo"
            className="inline-flex items-center gap-1.5 px-2 md:px-2.5 py-2 border-2 border-ink rounded-sm text-[11px] uppercase tracking-wider font-semibold text-ink/70 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Barra schede progetto + (riga sotto) tab reparti + Storico + Invia al Flow */}
      <DraftTabsBar
        secondaryRow={
          <nav className="flex items-center gap-1 bg-background border-2 border-dept rounded-sm p-1 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => changeTab(t.key)}
                  className={`relative shrink-0 inline-flex items-center gap-2 px-2.5 md:px-4 py-2 rounded-sm text-[11px] md:text-xs uppercase tracking-wider font-semibold transition-colors ${
                    isActive ? "bg-dept text-dept-foreground" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{t.label}</span>
                </button>
              );
            })}
          </nav>
        }
      />

      {/* Body */}
      <main className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 py-4 md:py-8 pb-20">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}:${resetNonce}:${draftReloadNonce}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "riepilogo" ? (
              <GeneralSummary
                jobName={jobName}
                setJobName={setJobName}
                quantity={quantity}
                setQuantity={setQuantity}
                margin={margin}
                setMargin={setMargin}
                vat={vat}
                setVat={setVat}
                applyVat={applyVat}
                setApplyVat={setApplyVat}
                departments={summaryData}
              />
            ) : activeTab === "falegnameria" ? (
              <Falegnameria embedded />
            ) : activeTab === "magazzino" ? (
              <MagazzinoCalc />
            ) : activeTab === "montaggi" ? (
              <Montaggi embedded />
            ) : (
              (() => {
                const tab = TABS.find((t) => t.key === activeTab)!;
                const key = activeTab as DepartmentKey;
                return (
                  <DepartmentView
                    deptKey={key}
                    deptLabel={tab.label}
                    description={tab.description}
                    catalog={catalogs[key]}
                    setCatalog={setCatalog(key)}
                    state={stateForDept(key)}
                    setState={setDept(key)}
                    templateUrl={tab.template.url}
                    templateName={tab.template.name}
                    customerType={customerForDept(key)}
                    labCatalog={catalogs.stampa}
                    labPieces={departments.stampa.pieces}
                  />
                );
              })()
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t-2 border-ink bg-paper">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 py-5 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calculator className="w-3 h-3" />
            <span>© Officina · Preventivi</span>
          </div>
          <span>Listini e preventivi salvati nel browser</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
