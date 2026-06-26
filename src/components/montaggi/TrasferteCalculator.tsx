import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, MapPin, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  CASORIA,
  cityKey,
  estimateRoadKm,
  loadItalianCities,
  parseCityKey,
  searchCities,
  type ItalianCity,
} from "@/lib/italian-cities";

export type TrasferteConfig = {
  originKey?: string;
  destKey?: string;
  kmAuto?: number; // distanza stradale calcolata da partenza/arrivo (snapshot)
  kmOverride?: number;
  andataRitorno: boolean;
  costPerKm: number;
  kmh: number;
  hoursOverride?: number;
  hourlyRate: number;
  workersOverride?: number;
  days: number;
  vittoPerDay: number;
  alloggioPerDay: number;
  alloggioMinDay: number;
  /** Bonus trasferta giornaliero netto per addetto (default 20 €, da tassare). */
  bonusTrasfertaPerDay: number;
  carburanteOverride?: number;
  oreViaggioCostOverride?: number;
  vittoTotalOverride?: number;
  alloggioTotalOverride?: number;
  bonusTrasfertaTotalOverride?: number;
};

export const defaultTrasferte = (): TrasferteConfig => ({
  originKey: cityKey(CASORIA),
  andataRitorno: true,
  costPerKm: 0.5,
  kmh: 80,
  hourlyRate: 35,
  days: 1,
  vittoPerDay: 60,
  alloggioPerDay: 50,
  alloggioMinDay: 130,
  bonusTrasfertaPerDay: 20,
});

export type TrasferteTotals = {
  km: number;
  hours: number;
  workers: number;
  carburante: number;
  oreViaggio: number;
  vitto: number;
  alloggio: number;
  bonusTrasferta: number;
  total: number;
};

const eur = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 })
    : "—";

/** Variante "pure" che lavora solo sullo snapshot kmAuto del config — non richiede
 *  il dataset città. Usata dai totali del progetto. */
export const computeTrasferteTotalsFromConfig = (
  cfg: TrasferteConfig,
  workersAuto: number,
  workersHourlyTotal?: number,
): TrasferteTotals => {
  const baseKm = cfg.kmOverride != null && cfg.kmOverride > 0 ? cfg.kmOverride : cfg.kmAuto ?? 0;
  const km = baseKm * (cfg.andataRitorno ? 2 : 1);
  const workers = cfg.workersOverride != null && cfg.workersOverride > 0 ? cfg.workersOverride : workersAuto;
  const hours = cfg.hoursOverride != null && cfg.hoursOverride >= 0 ? cfg.hoursOverride : cfg.kmh > 0 ? km / cfg.kmh : 0;
  const carburante = cfg.carburanteOverride ?? km * cfg.costPerKm;
  const hourlyTotalForTravel =
    workersHourlyTotal != null && workersHourlyTotal > 0 ? workersHourlyTotal : cfg.hourlyRate * workers;
  const oreViaggio = cfg.oreViaggioCostOverride ?? hours * hourlyTotalForTravel;
  const vitto = cfg.vittoTotalOverride ?? cfg.vittoPerDay * workers * cfg.days;
  const alloggioBase = cfg.alloggioPerDay * workers * cfg.days;
  const alloggioMin = cfg.alloggioMinDay * cfg.days;
  const alloggio = cfg.alloggioTotalOverride ?? Math.max(alloggioBase, alloggioMin);
  const bonusPerDay = cfg.bonusTrasfertaPerDay ?? 20;
  const bonusTrasferta = cfg.bonusTrasfertaTotalOverride ?? bonusPerDay * workers * cfg.days;
  return { km, hours, workers, carburante, oreViaggio, vitto, alloggio, bonusTrasferta, total: carburante + oreViaggio + vitto + alloggio + bonusTrasferta };
};

export const computeTrasferteTotals = (
  cfg: TrasferteConfig,
  origin: ItalianCity | undefined,
  dest: ItalianCity | undefined,
  workersAuto: number,
  workersHourlyTotal?: number,
): TrasferteTotals => {
  const kmAuto = origin && dest ? estimateRoadKm(origin, dest) : cfg.kmAuto ?? 0;
  return computeTrasferteTotalsFromConfig({ ...cfg, kmAuto }, workersAuto, workersHourlyTotal);
};

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="space-y-1.5 min-w-0">
    <Label className="label-cap block leading-tight">{label}</Label>
    {children}
    {hint && <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>}
  </div>
);

const NumberField = ({
  value,
  onChange,
  suffix,
  step = "0.01",
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  suffix?: string;
  step?: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value != null && Number.isFinite(value) ? String(value) : "");
  return (
    <div className="relative">
      <Input
        type="number"
        step={step}
        min="0"
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value === "") onChange(undefined);
          else onChange(Number(e.target.value));
        }}
        onBlur={() => setDraft(null)}
        className={cn("font-mono", suffix && "pr-12")}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
};

const CityPicker = ({
  value,
  cities,
  onChange,
  placeholder,
}: {
  value: ItalianCity | undefined;
  cities: ItalianCity[];
  onChange: (c: ItalianCity) => void;
  placeholder: string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchCities(cities, query, 40), [cities, query]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2 truncate">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            {value ? (
              <span className="truncate">
                <span className="font-semibold">{value.name}</span>
                <span className="text-muted-foreground"> · {value.cap} ({value.province})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Cerca città, CAP o sigla provincia…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Nessun risultato.</CommandEmpty>
            <CommandGroup>
              {results.map((c) => {
                const key = cityKey(c);
                const isSel = value && cityKey(value) === key;
                return (
                  <CommandItem
                    key={key}
                    value={key}
                    onSelect={() => {
                      onChange(c);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", isSel ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {c.name} <span className="text-xs text-muted-foreground">({c.province})</span>
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">CAP {c.cap}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const TrasferteCalculator = ({
  cfg,
  onChange,
  workersAuto,
  workersHourlyTotal,
}: {
  cfg: TrasferteConfig;
  onChange: (next: TrasferteConfig) => void;
  workersAuto: number;
  /** Somma dei costi orari (€/h, costo azienda) degli addetti assegnati alla
   *  squadra. Quando >0 viene usato al posto di `hourlyRate × workers` per il
   *  calcolo delle ore di viaggio. */
  workersHourlyTotal?: number;
}) => {
  const [cities, setCities] = useState<ItalianCity[]>([]);
  useEffect(() => {
    let alive = true;
    loadItalianCities().then((c) => alive && setCities(c));
    return () => {
      alive = false;
    };
  }, []);

  const origin = cfg.originKey ? parseCityKey(cfg.originKey, cities) : undefined;
  const dest = cfg.destKey ? parseCityKey(cfg.destKey, cities) : undefined;
  const kmAuto = origin && dest ? estimateRoadKm(origin, dest) : 0;

  // Snapshot kmAuto nel config così i totali possono essere calcolati anche
  // senza il dataset città caricato (es. nella card di riepilogo del progetto).
  useEffect(() => {
    if (kmAuto && cfg.kmAuto !== kmAuto) onChange({ ...cfg, kmAuto });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmAuto]);

  const totals = useMemo(
    () => computeTrasferteTotals(cfg, origin, dest, workersAuto, workersHourlyTotal),
    [cfg, origin, dest, workersAuto, workersHourlyTotal],
  );

  const set = (patch: Partial<TrasferteConfig>) => onChange({ ...cfg, ...patch });

  const workers = cfg.workersOverride != null && cfg.workersOverride > 0 ? cfg.workersOverride : workersAuto;
  const useRealCosts = workersHourlyTotal != null && workersHourlyTotal > 0;
  const avgHourly = useRealCosts ? workersHourlyTotal / Math.max(workers, 1) : cfg.hourlyRate;

  return (
    <div className="space-y-4">
      {/* Tratta */}
      <div className="rounded-sm border border-border bg-background p-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Città di partenza">
            <CityPicker
              cities={cities}
              value={origin}
              onChange={(c) => set({ originKey: cityKey(c) })}
              placeholder={cities.length === 0 ? "Caricamento…" : "Seleziona città"}
            />
          </Field>
          <Field label="Città di arrivo">
            <CityPicker
              cities={cities}
              value={dest}
              onChange={(c) => set({ destKey: cityKey(c) })}
              placeholder={cities.length === 0 ? "Caricamento…" : "Seleziona città"}
            />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Km (auto)" hint={kmAuto > 0 ? `Stima stradale (linea d'aria × 1.3)` : "Imposta partenza/arrivo"}>
            <NumberField
              value={cfg.kmOverride ?? (kmAuto || undefined)}
              onChange={(n) => set({ kmOverride: n })}
              suffix="km"
              step="1"
            />
          </Field>
          <Field label="Andata/Ritorno">
            <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={cfg.andataRitorno}
                onChange={(e) => set({ andataRitorno: e.target.checked })}
              />
              <RotateCw className="h-3.5 w-3.5" />
              <span>{cfg.andataRitorno ? "A/R (× 2)" : "Solo andata"}</span>
            </label>
          </Field>
          <Field label="Costo per km">
            <NumberField value={cfg.costPerKm} onChange={(n) => set({ costPerKm: n ?? 0 })} suffix="€/km" />
          </Field>
          <Field label="Km totali tratta" hint={cfg.andataRitorno ? "A/R" : "solo andata"}>
            <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm font-semibold">
              {totals.km.toFixed(0)} km
            </div>
          </Field>
        </div>
      </div>

      {/* Squadra & ore viaggio */}
      <div className="rounded-sm border border-border bg-background p-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="N° addetti" hint={`Auto: ${workersAuto} dalla squadra`}>
            <NumberField
              value={cfg.workersOverride ?? workersAuto}
              onChange={(n) => set({ workersOverride: n })}
              suffix="pers."
              step="1"
            />
          </Field>
          <Field label="Velocità media">
            <NumberField value={cfg.kmh} onChange={(n) => set({ kmh: n ?? 0 })} suffix="km/h" step="1" />
          </Field>
          <Field
            label="Ore viaggio (auto)"
            hint={useRealCosts ? `km totali / velocità · costo medio squadra ${eur(avgHourly)}/h` : "km totali / velocità"}
          >
            <NumberField
              value={cfg.hoursOverride ?? Number(totals.hours.toFixed(2))}
              onChange={(n) => set({ hoursOverride: n })}
              suffix="ore"
            />
          </Field>
        </div>
      </div>

      {/* Giorni / Vitto / Alloggio */}
      <div className="rounded-sm border border-border bg-background p-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Giorni trasferta" hint="comprende i giorni di viaggio">
            <NumberField value={cfg.days} onChange={(n) => set({ days: n ?? 0 })} suffix="gg" step="1" />
          </Field>
          <Field label="Vitto / giorno per addetto">
            <NumberField value={cfg.vittoPerDay} onChange={(n) => set({ vittoPerDay: n ?? 0 })} suffix="€/g" />
          </Field>
          <Field label="Alloggio / giorno per addetto">
            <NumberField value={cfg.alloggioPerDay} onChange={(n) => set({ alloggioPerDay: n ?? 0 })} suffix="€/g" />
          </Field>
          <Field label="Alloggio minimo / giorno" hint="totale, indipendente dagli addetti">
            <NumberField value={cfg.alloggioMinDay} onChange={(n) => set({ alloggioMinDay: n ?? 0 })} suffix="€/g" />
          </Field>
          <Field label="Bonus trasferta / giorno per addetto" hint="extra netto da tassare">
            <NumberField value={cfg.bonusTrasfertaPerDay ?? 20} onChange={(n) => set({ bonusTrasfertaPerDay: n ?? 0 })} suffix="€/g" />
          </Field>
        </div>
      </div>

      {/* Riepilogo voci modificabili */}
      <div className="rounded-sm border-2 border-dept bg-dept-soft/30 p-3 space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-dept">Voci trasferta (modificabili)</div>
        <VoiceRow
          label="Carburante / km"
          auto={totals.km * cfg.costPerKm}
          override={cfg.carburanteOverride}
          onChange={(n) => set({ carburanteOverride: n })}
          hint={`${totals.km.toFixed(0)} km × ${eur(cfg.costPerKm)}/km`}
        />
        <VoiceRow
          label="Ore di viaggio squadra"
          auto={(cfg.hoursOverride ?? totals.hours) * (useRealCosts ? (workersHourlyTotal as number) : cfg.hourlyRate * workers)}
          override={cfg.oreViaggioCostOverride}
          onChange={(n) => set({ oreViaggioCostOverride: n })}
          hint={
            useRealCosts
              ? `${(cfg.hoursOverride ?? totals.hours).toFixed(2)} h × somma costi squadra (${eur(workersHourlyTotal as number)}/h totali · ${workers} ${workers === 1 ? "addetto" : "addetti"})`
              : `${(cfg.hoursOverride ?? totals.hours).toFixed(2)} h × ${eur(cfg.hourlyRate)}/h × ${workers} ${workers === 1 ? "addetto" : "addetti"}`
          }
        />
        <VoiceRow
          label="Vitto"
          auto={cfg.vittoPerDay * workers * cfg.days}
          override={cfg.vittoTotalOverride}
          onChange={(n) => set({ vittoTotalOverride: n })}
          hint={`${eur(cfg.vittoPerDay)} × ${workers} × ${cfg.days} ${cfg.days === 1 ? "giorno" : "giorni"}`}
        />
        <VoiceRow
          label="Alloggio"
          auto={Math.max(cfg.alloggioPerDay * workers * cfg.days, cfg.alloggioMinDay * cfg.days)}
          override={cfg.alloggioTotalOverride}
          onChange={(n) => set({ alloggioTotalOverride: n })}
          hint={`max(${eur(cfg.alloggioPerDay)} × ${workers} × ${cfg.days}, ${eur(cfg.alloggioMinDay)} × ${cfg.days}) — minimo ${eur(cfg.alloggioMinDay * cfg.days)}`}
        />
        <VoiceRow
          label="Bonus trasferta (netto)"
          auto={(cfg.bonusTrasfertaPerDay ?? 20) * workers * cfg.days}
          override={cfg.bonusTrasfertaTotalOverride}
          onChange={(n) => set({ bonusTrasfertaTotalOverride: n })}
          hint={`${eur(cfg.bonusTrasfertaPerDay ?? 20)} × ${workers} × ${cfg.days} ${cfg.days === 1 ? "giorno" : "giorni"} — da tassare`}
        />
        <div className="flex items-center justify-between border-t border-dept/40 pt-2">
          <span className="font-semibold">Totale trasferta</span>
          <span className="font-mono text-xl font-bold text-dept">{eur(totals.total)}</span>
        </div>
      </div>
    </div>
  );
};

const VoiceRow = ({
  label,
  auto,
  override,
  onChange,
  hint,
}: {
  label: string;
  auto: number;
  override: number | undefined;
  onChange: (n: number | undefined) => void;
  hint: string;
}) => {
  const value = override ?? auto;
  return (
    <div className="grid grid-cols-[1fr_140px_auto] items-center gap-3 rounded-sm border border-border bg-background p-2.5">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground font-mono truncate">{hint}</div>
      </div>
      <NumberField value={value} onChange={onChange} suffix="€" />
      {override != null ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground hover:text-ink underline"
          title="Ripristina valore automatico"
        >
          auto
        </button>
      ) : (
        <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">auto</span>
      )}
    </div>
  );
};
