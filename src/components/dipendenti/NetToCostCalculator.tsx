import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Calculator } from "lucide-react";

const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);

const round2 = (n: number) => Math.round(n * 100) / 100;

type Inputs = {
  netDaily: number;
  netToGrossRatio: number;
  workingDaysPerMonth: number;
  monthsPerYear: number;
  employerInpsRate: number;
  inailRate: number;
  tfrRate: number;
  extraCostsAnnual: number;
  effectiveWorkHoursPerYear: number;
  overtimeExtraHourly: number;
  trasfertaDailyExtra: number;
};

const DEFAULTS: Inputs = {
  netDaily: 70,
  netToGrossRatio: 0.72,
  workingDaysPerMonth: 22,
  monthsPerYear: 13,
  employerInpsRate: 0.30,
  inailRate: 0.005,
  tfrRate: 0.074,
  extraCostsAnnual: 0,
  effectiveWorkHoursPerYear: 1650,
  overtimeExtraHourly: 5,
  trasfertaDailyExtra: 20,
};

const NumField = ({
  label, value, onChange, step = "0.01", suffix, placeholder,
}: { label: string; value: number; onChange: (n: number) => void; step?: string; suffix?: string; placeholder?: string }) => (
  <div className="space-y-1.5 min-w-0">
    <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{label}</Label>
    <div className="relative">
      <Input
        type="number"
        step={step}
        min="0"
        value={Number.isFinite(value) ? value : ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className={`font-mono ${suffix ? "pr-14" : ""}`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none">{suffix}</span>
      )}
    </div>
  </div>
);

export const NetToCostCalculator = () => {
  const [v, setV] = useState<Inputs>(DEFAULTS);
  const set = (patch: Partial<Inputs>) => setV((p) => ({ ...p, ...patch }));

  const r = useMemo(() => {
    const grossDaily = v.netDaily / Math.max(0.0001, v.netToGrossRatio);
    const grossMonthly = grossDaily * v.workingDaysPerMonth;
    const grossAnnual = grossMonthly * v.monthsPerYear;
    const companyCostAnnual = grossAnnual * (1 + v.employerInpsRate + v.inailRate + v.tfrRate) + v.extraCostsAnnual;
    const hourlyCost = companyCostAnnual / Math.max(1, v.effectiveWorkHoursPerYear);
    const dailyCompanyCost = companyCostAnnual / Math.max(1, v.workingDaysPerMonth * v.monthsPerYear);
    const netAnnual = v.netDaily * v.workingDaysPerMonth * v.monthsPerYear;
    const netToCostMultiplier = netAnnual > 0 ? companyCostAnnual / netAnnual : 0;
    // Overtime extra (>8h): netto +5€/h → lordo /ratio → costo azienda con stessi oneri
    const overtimeNet = v.overtimeExtraHourly;
    const overtimeCostHourly = (overtimeNet / Math.max(0.0001, v.netToGrossRatio)) * (1 + v.employerInpsRate + v.inailRate + v.tfrRate);
    const trasfertaNet = v.trasfertaDailyExtra;
    const trasfertaCostDaily = (trasfertaNet / Math.max(0.0001, v.netToGrossRatio)) * (1 + v.employerInpsRate + v.inailRate + v.tfrRate);
    return { grossDaily, grossMonthly, grossAnnual, companyCostAnnual, hourlyCost, dailyCompanyCost, netToCostMultiplier, overtimeCostHourly, trasfertaCostDaily };
  }, [v]);

  const warnings: string[] = [];
  if (v.netToGrossRatio < 0.5 || v.netToGrossRatio > 0.95) warnings.push("Rapporto netto/lordo fuori range tipico (0.5–0.95).");
  for (const [k, val] of [["INPS datore", v.employerInpsRate], ["INAIL", v.inailRate], ["TFR", v.tfrRate]] as const) {
    if (val < 0 || val > 1) warnings.push(`Aliquota ${k} fuori intervallo 0–1.`);
  }

  return (
    <Card className="border-2 border-ink/20 bg-paper">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <Calculator className="w-5 h-5" /> Calcolatore da Netto a Costo Aziendale
          <span className="ml-2 text-[10px] font-normal text-muted-foreground uppercase tracking-wider">metalmeccanico</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Step 1 */}
        <div className="rounded-sm border border-border bg-background p-3 space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Step 1 · Netto → Lordo (RAL)</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumField label="Netto giornaliero" value={v.netDaily} onChange={(n) => set({ netDaily: n })} suffix="€" />
            <NumField label="Rapporto netto/lordo" value={v.netToGrossRatio} onChange={(n) => set({ netToGrossRatio: n })} step="0.01" placeholder="0.72" />
            <NumField label="Giorni lavorativi / mese" value={v.workingDaysPerMonth} onChange={(n) => set({ workingDaysPerMonth: n })} step="1" suffix="gg" />
            <NumField label="Mensilità / anno" value={v.monthsPerYear} onChange={(n) => set({ monthsPerYear: n })} step="1" suffix="m" />
          </div>
        </div>

        {/* Step 2 */}
        <div className="rounded-sm border border-border bg-background p-3 space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Step 2 · RAL → Costo aziendale</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumField label="INPS datore" value={v.employerInpsRate} onChange={(n) => set({ employerInpsRate: n })} step="0.001" placeholder="0.30" />
            <NumField label="INAIL (tasso 20SM)" value={v.inailRate} onChange={(n) => set({ inailRate: n })} step="0.0001" placeholder="0.005" />
            <NumField label="TFR" value={v.tfrRate} onChange={(n) => set({ tfrRate: n })} step="0.001" placeholder="0.074" />
            <NumField label="Costi extra / anno" value={v.extraCostsAnnual} onChange={(n) => set({ extraCostsAnnual: n })} suffix="€" />
          </div>
        </div>

        {/* Step 3 */}
        <div className="rounded-sm border border-border bg-background p-3 space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Step 3 · Costo orario & extra</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <NumField label="Ore effettive / anno" value={v.effectiveWorkHoursPerYear} onChange={(n) => set({ effectiveWorkHoursPerYear: n })} step="10" suffix="h" />
            <NumField label="Straordinario oltre 8h (netto)" value={v.overtimeExtraHourly} onChange={(n) => set({ overtimeExtraHourly: n })} suffix="€/h" />
            <NumField label="Bonus trasferta (netto)" value={v.trasfertaDailyExtra} onChange={(n) => set({ trasfertaDailyExtra: n })} suffix="€/g" />
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="flex items-start gap-2 rounded-sm border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <ul className="space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {/* Output */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-sm border border-border bg-muted/50 p-3 space-y-1.5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Lordo</div>
            <Row label="Lordo / giorno" value={eur(round2(r.grossDaily))} />
            <Row label="Lordo / mese" value={eur(round2(r.grossMonthly))} />
            <Row label="RAL annua" value={eur(round2(r.grossAnnual))} />
          </div>
          <div className="rounded-sm border-2 border-dept bg-dept-soft/30 p-3 space-y-1.5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-dept">Costo aziendale</div>
            <Row label="Annuo" value={eur(round2(r.companyCostAnnual))} />
            <Row label="Giornaliero" value={eur(round2(r.dailyCompanyCost))} />
            <div className="border-t border-dept/40 pt-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Costo / ora</span>
                <span className="font-mono text-xl font-bold text-dept">{eur(round2(r.hourlyCost))}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">valore chiave per i preventivi</div>
            </div>
          </div>
          <div className="rounded-sm border border-border bg-background p-3 space-y-1.5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Riferimento & extra</div>
            <Row label="Moltiplicatore netto→costo" value={`${(r.netToCostMultiplier || 0).toFixed(2)}×`} />
            <Row label="Costo straordinario / h" value={eur(round2(r.overtimeCostHourly))} />
            <Row label="Costo trasferta / g" value={eur(round2(r.trasfertaCostDaily))} />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground italic leading-snug">
          Stima indicativa per il settore metalmeccanico. Contributi e INAIL variano per CCNL e classe di rischio, e si aggiornano ogni anno. Il tasso INAIL reale è quello comunicato dall'INAIL con il modello 20SM. Ricalibrare su una busta paga reale.
        </p>
      </CardContent>
    </Card>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="font-mono text-sm font-semibold">{value}</span>
  </div>
);

export default NetToCostCalculator;
