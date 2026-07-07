import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { Wrench } from "lucide-react";
import { eur, num } from "@/lib/format";
import { Catalog, DepartmentState, DepartmentTotals, SubProject } from "./types";
import { CustomerType } from "@/lib/pricing";
import { CreateCommessaButton } from "./CreateCommessaButton";

interface GeneralSummaryProps {
  jobName: string;
  setJobName: (s: string) => void;
  quantity: number;
  setQuantity: (n: number) => void;
  margin: number;
  setMargin: (n: number) => void;
  vat: number;
  setVat: (n: number) => void;
  applyVat: boolean;
  setApplyVat: (b: boolean) => void;
  departments: {
    key: string;
    label: string;
    totals: DepartmentTotals;
    state?: DepartmentState;
    catalog?: Catalog;
    customerType?: CustomerType;
    details?: {
      materials?: string[];
      accessories?: string[];
      workerCount?: number;
      laborHours?: number;
      transports?: string[];
    };
  }[];
  /** Sub-progetti del preventivo (per calcolare "Assemblaggio in laboratorio"). */
  subProjects?: SubProject[];
}

export const GeneralSummary = ({
  jobName, setJobName, quantity, setQuantity,
  margin, setMargin, vat, setVat, applyVat, setApplyVat,
  departments, subProjects = [],
}: GeneralSummaryProps) => {
  const allMaterials = departments.reduce((s, d) => s + d.totals.materials, 0);
  const allWorks = departments.reduce(
    (s, d) => s + d.totals.operations + (d.totals.perimeters ?? 0) + (d.totals.pieces ?? 0),
    0,
  );
  const allTransports = departments.reduce((s, d) => s + (d.totals.transports ?? 0), 0);
  // Assemblaggio in laboratorio: costo aggregato dai sub-progetti con toggle attivo.
  const assemblyLabRows = subProjects
    .filter((s) => s.assemblyLab?.enabled && (Number(s.assemblyLab.hours) || 0) > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      hours: Number(s.assemblyLab!.hours) || 0,
      rate: Number(s.assemblyLab!.hourlyCost) || 0,
      cost: (Number(s.assemblyLab!.hours) || 0) * (Number(s.assemblyLab!.hourlyCost) || 0),
    }));
  const assemblyLabTotal = assemblyLabRows.reduce((s, r) => s + r.cost, 0);
  const cost = departments.reduce((s, d) => s + d.totals.total, 0) + assemblyLabTotal;

  // Margine per reparto: ogni reparto può avere la sua % oppure usa il margine globale.
  // Persistito in localStorage per non perdere le scelte tra refresh.
  const STORAGE = "officina:summary:deptMargins";
  const [deptMargins, setDeptMargins] = useState<Record<string, number>>(() => {
    try {
      if (typeof window === "undefined") return {};
      const raw = localStorage.getItem(STORAGE);
      return raw ? (JSON.parse(raw) ?? {}) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(deptMargins)); } catch { /* ignore */ }
  }, [deptMargins]);
  const marginFor = (k: string) => (deptMargins[k] ?? margin);
  const setMarginFor = (k: string, v: number) => setDeptMargins((prev) => ({ ...prev, [k]: v }));
  const resetMarginFor = (k: string) => setDeptMargins((prev) => { const next = { ...prev }; delete next[k]; return next; });
  // Base margine = costo senza trasferte e trasporti (che passano a costo)
  const marginBaseFor = (d: GeneralSummaryProps["departments"][number]) =>
    Math.max(0, d.totals.total - (d.totals.transports ?? 0));
  const deptTotalWithMargin = (d: GeneralSummaryProps["departments"][number]) =>
    d.totals.total + marginBaseFor(d) * (marginFor(d.key) / 100);

  const marginAmount =
    departments.reduce((s, d) => s + marginBaseFor(d) * (marginFor(d.key) / 100), 0)
    + assemblyLabTotal * (margin / 100);
  const net = cost + marginAmount;
  const vatAmount = applyVat ? net * (vat / 100) : 0;
  const total = net + vatAmount;

  // Titolo schedina (draft attivo) come default per il dialog "Crea commessa nel Flow"
  const schedinaTitle = (() => {
    try {
      if (typeof window === "undefined") return "";
      return localStorage.getItem("officina:active-draft-name") || "";
    } catch { return ""; }
  })();
  const perPiece = quantity > 0 ? total / quantity : total;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8">
      {/* Breakdown reparti */}
      <div className="space-y-6">
        <div className="pb-4 border-b-2 border-ink">
          <h2 className="font-display text-3xl md:text-4xl font-semibold leading-none">
            Riepilogo generale
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Somma di tutti i reparti.
          </p>
        </div>

        <section className="panel p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-xs text-primary font-bold tracking-widest">§ REPARTI</span>
            <span className="label-cap">Costi diretti</span>
          </div>
          <div className="rule-line mb-4" />

          {departments.map((d) => (
            <div key={d.key} className="py-3 border-b border-dashed border-ink/20 last:border-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-xl font-semibold">{d.label}</h3>
                <span className="font-mono text-lg font-semibold tabular-nums">
                  {eur(d.totals.total)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono text-muted-foreground">
                <div className="flex justify-between">
                  <span>Materiali</span>
                  <span className="tabular-nums">{eur(d.totals.materials)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Lavorazioni</span>
                  <span className="tabular-nums">{eur(d.totals.operations + (d.totals.perimeters ?? 0) + (d.totals.pieces ?? 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Trasporti</span>
                  <span className="tabular-nums">{eur(d.totals.transports ?? 0)}</span>
                </div>
              </div>
              {d.details && (
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <DetailList title="Materiali" items={d.details.materials} />
                  <DetailList title="Accessori" items={d.details.accessories} />
                  <div className="font-mono">Lavoratori: {d.details.workerCount ?? 0} · Ore: {num(d.details.laborHours ?? 0, 1)}</div>
                  <DetailList title="Trasporti" items={d.details.transports} />
                </div>
              )}
            </div>
          ))}

          {assemblyLabRows.length > 0 && (
            <div className="py-3 border-b border-dashed border-ink/20 last:border-0 bg-amber-50/40 -mx-6 px-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-xl font-semibold inline-flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-700" />
                  Assemblaggio in laboratorio
                </h3>
                <span className="font-mono text-lg font-semibold tabular-nums">{eur(assemblyLabTotal)}</span>
              </div>
              <div className="space-y-1 text-xs font-mono text-muted-foreground">
                {assemblyLabRows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between">
                    <span>· {r.name} — {num(r.hours, 1)}h × {eur(r.rate)}/h</span>
                    <span className="tabular-nums">{eur(r.cost)}</span>
                  </div>
                ))}
                <div className="text-[10px] italic mt-1">
                  Eseguito da Falegnameria · bloccante = tutte le altre lavorazioni del sub-progetto
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t-2 border-ink flex items-center justify-between">
            <span className="font-display text-xl font-semibold">Totale costi diretti</span>
            <span className="font-mono text-2xl font-semibold tabular-nums">{eur(cost)}</span>
          </div>
        </section>

        <section className="panel p-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="label-cap block mb-2">Materiali totali</label>
              <div className="font-mono text-xl font-semibold tabular-nums">{eur(allMaterials)}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">
                {cost > 0 ? `${num((allMaterials / cost) * 100, 1)}%` : "-"} sul costo
              </div>
            </div>
            <div>
              <label className="label-cap block mb-2">Lavorazioni totali</label>
              <div className="font-mono text-xl font-semibold tabular-nums">{eur(allWorks)}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">
                {cost > 0 ? `${num((allWorks / cost) * 100, 1)}%` : "-"} sul costo
              </div>
            </div>
            <div>
              <label className="label-cap block mb-2">Trasporti totali</label>
              <div className="font-mono text-xl font-semibold tabular-nums">{eur(allTransports)}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">
                {cost > 0 ? `${num((allTransports / cost) * 100, 1)}%` : "-"} sul costo
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Pannello finale prezzo */}
      <aside className="panel p-6 md:p-8 sticky top-6 bg-ink text-paper border-ink h-fit">
        <div className="flex items-center justify-between mb-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper/60">
            Prezzo finale · Live
          </span>
          <span className="font-mono text-[10px] text-primary">●</span>
        </div>

        <input
          type="text"
          value={jobName || schedinaTitle}
          onChange={(e) => setJobName(e.target.value)}
          placeholder={schedinaTitle || "Nome lavorazione"}
          className="w-full bg-transparent border-0 border-b border-paper/30 text-paper font-display text-2xl pb-2 mb-6 focus:outline-none focus:border-primary placeholder:text-paper/30"
        />

        <dl className="space-y-3 font-mono text-sm">
          {departments.map((d) => {
            const m = marginFor(d.key);
            const hasOverride = deptMargins[d.key] !== undefined;
            return (
              <div key={d.key} className="text-paper/80">
                <div className="flex justify-between items-center">
                  <dt className="text-xs uppercase tracking-wider">{d.label}</dt>
                  <dd className="tabular-nums">{eur(d.totals.total)}</dd>
                </div>
                <div className="flex justify-between items-center mt-1 text-[10px] text-paper/50">
                  <div className="flex items-center gap-1">
                    <span className="uppercase tracking-wider">Margine</span>
                    <input
                      type="number"
                      step={0.5}
                      value={m}
                      onChange={(e) => setMarginFor(d.key, parseFloat(e.target.value) || 0)}
                      className="w-12 bg-transparent border-b border-paper/30 text-center font-mono focus:outline-none focus:border-primary text-paper"
                      title={hasOverride ? "Margine personalizzato per questo reparto" : "Usa il margine globale (clic per modificare)"}
                    />
                    <span>%</span>
                    {hasOverride && (
                      <button
                        type="button"
                        onClick={() => resetMarginFor(d.key)}
                        className="ml-1 text-paper/40 hover:text-primary"
                        title="Torna al margine globale"
                      >↺</button>
                    )}
                  </div>
                  <span className="tabular-nums text-paper/70">→ {eur(deptTotalWithMargin(d))}</span>
                </div>
              </div>
            );
          })}
          <div className="h-px bg-paper/20 my-3" />
          <div className="flex justify-between items-center">
            <dt className="text-xs uppercase tracking-wider text-paper/60">Margine globale (default)</dt>
            <dd className="flex items-center gap-1">
              <input
                type="number"
                step={0.5}
                value={margin}
                onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                className="w-14 bg-transparent border-b border-paper/30 text-center font-mono focus:outline-none focus:border-primary text-paper"
              />
              <span className="text-paper/60">%</span>
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-xs uppercase tracking-wider text-paper/60">Subtotale costi</dt>
            <dd className="tabular-nums text-paper/70">{eur(cost)}</dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-xs uppercase tracking-wider text-paper/60">Margine</dt>
            <dd className="tabular-nums text-paper/70">{eur(marginAmount)}</dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-xs uppercase tracking-wider text-paper/60">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyVat}
                  onChange={(e) => setApplyVat(e.target.checked)}
                  className="accent-primary"
                />
                IVA
              </label>
              <input
                type="number"
                step={0.5}
                value={vat}
                onChange={(e) => setVat(parseFloat(e.target.value) || 0)}
                disabled={!applyVat}
                className="w-12 ml-2 bg-transparent border-b border-paper/30 text-center font-mono focus:outline-none focus:border-primary text-paper disabled:opacity-40"
              />
              <span className="ml-1">%</span>
            </dt>
            <dd className="tabular-nums text-paper/70">{eur(vatAmount)}</dd>
          </div>
        </dl>

        <div className="rule-line my-6 opacity-40" />

        <motion.div
          key={total}
          initial={{ scale: 0.98, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <div className="text-paper/60 text-[10px] uppercase tracking-[0.2em] mb-2">
            Totale
          </div>
          <div className="font-display text-5xl md:text-6xl font-semibold text-primary tabular-nums leading-none break-all">
            {eur(total)}
          </div>
        </motion.div>

        <div className="mt-6 flex items-center justify-between gap-3 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-paper/60 text-xs uppercase tracking-wider">Pezzi</span>
            <input
              type="number"
              min={1}
              value={quantity === 0 ? "" : quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              className="w-14 bg-transparent border-b border-paper/40 text-center font-mono focus:outline-none focus:border-primary"
            />
          </div>
          <div className="text-right">
            <div className="text-paper/60 text-[10px] uppercase tracking-[0.2em]">Cad.</div>
            <div className="font-mono font-semibold">{eur(perPiece)}</div>
          </div>
        </div>

        {/* Crea commessa nel Flow */}
        <div className="mt-6 pt-6 border-t border-paper/20">
          <CreateCommessaButton
            label="Trasforma in commessa nel Flow"
            defaultTitle={schedinaTitle || jobName || ""}
            defaultAmount={total}
            defaultReparto="generale"
            snapshot={{
              source: "summary",
              jobName,
              quantity,
              margin,
              vat,
              applyVat,
              cost,
              marginAmount,
              net,
              vatAmount,
              total,
              departments,
              subProjects,
              assemblyLabTotal,
            }}
            variant="primary"
            disabled={total === 0}
          />
        </div>
      </aside>
    </div>
  );
};

const DetailList = ({ title, items }: { title: string; items?: string[] }) => {
  if (!items?.length) return <div className="font-mono">{title}: -</div>;
  return (
    <div>
      <div className="font-mono font-semibold text-ink">{title}</div>
      <ul className="mt-1 space-y-0.5">
        {items.slice(0, 4).map((item, index) => <li key={`${item}-${index}`} className="truncate">{item}</li>)}
        {items.length > 4 && <li>+{items.length - 4} altre voci</li>}
      </ul>
    </div>
  );
};