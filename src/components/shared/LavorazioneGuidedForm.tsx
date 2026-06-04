import { useEffect, useMemo, useState } from "react";
import { Lock, ArrowDown } from "lucide-react";
import {
  MACRO_REPARTI, MICRO_BY_MACRO, MacroReparto, UserLite,
  filterUsersByMacro, filterUsersByMicro, microLabel,
} from "@/lib/reparti";
import { fetchDipendenti, dipendenteAsUser, type Dipendente } from "@/lib/dipendenti";

export type GuidedMicro = {
  micro: string;
  assignee_id: string | null;       // responsabile del micro (operatore principale)
  operator_ids: string[];           // operatori aggiuntivi
  depends_on_micro: string | null;  // chiave micro che blocca questo (in elenco selezionato)
};

export type GuidedValue = {
  macro_reparto: MacroReparto | null;
  responsabile_id: string | null;
  micros: GuidedMicro[];
};

export const emptyGuided = (): GuidedValue => ({
  macro_reparto: null, responsabile_id: null, micros: [],
});

interface Props {
  value: GuidedValue;
  onChange: (v: GuidedValue) => void;
  users: UserLite[];
  compact?: boolean;
}

export const LavorazioneGuidedForm = ({ value, onChange, users, compact }: Props) => {
  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);
  useEffect(() => {
    fetchDipendenti(true).then(setDipendenti);
  }, []);

  const allUsers = useMemo<UserLite[]>(() => {
    // Unisce profili e dipendenti; se un dipendente è linkato a un profilo (profile_id)
    // viene escluso per evitare duplicati nel selettore.
    const linkedProfileIds = new Set(dipendenti.map((d) => d.profile_id).filter(Boolean) as string[]);
    const profileUsers = users.filter((u) => !linkedProfileIds.has(u.id));
    const dipUsers = dipendenti.map(dipendenteAsUser);
    return [...profileUsers, ...dipUsers];
  }, [users, dipendenti]);

  const macro = value.macro_reparto;
  const responsabili = useMemo(
    () => (macro ? filterUsersByMacro(allUsers, macro) : []),
    [macro, allUsers],
  );
  const microOptions = macro ? MICRO_BY_MACRO[macro] : [];

  // Reset incoerenze quando cambia macro
  useEffect(() => {
    if (!macro) return;
    const valid = new Set(microOptions.map((m) => m.k));
    const cleaned = value.micros.filter((m) => valid.has(m.micro));
    const respOk = responsabili.find((r) => r.id === value.responsabile_id);
    if (cleaned.length !== value.micros.length || (!respOk && value.responsabile_id)) {
      onChange({ ...value, responsabile_id: respOk ? value.responsabile_id : null, micros: cleaned });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macro]);

  const toggleMicro = (k: string) => {
    const exists = value.micros.find((m) => m.micro === k);
    if (exists) {
      onChange({ ...value, micros: value.micros.filter((m) => m.micro !== k) });
    } else {
      // default depends_on_micro = ultimo micro selezionato
      const last = value.micros[value.micros.length - 1]?.micro ?? null;
      onChange({
        ...value,
        micros: [...value.micros, { micro: k, assignee_id: null, operator_ids: [], depends_on_micro: last }],
      });
    }
  };

  const updateMicro = (k: string, patch: Partial<GuidedMicro>) => {
    onChange({
      ...value,
      micros: value.micros.map((m) => (m.micro === k ? { ...m, ...patch } : m)),
    });
  };

  return (
    <div className={`space-y-4 ${compact ? "text-sm" : ""}`}>
      {/* Macro */}
      <div>
        <div className="label-cap mb-1">Macroreparto *</div>
        <div className="inline-flex border-2 border-ink rounded-sm overflow-hidden flex-wrap">
          {MACRO_REPARTI.map((r) => (
            <button
              key={r.k}
              type="button"
              onClick={() => onChange({ macro_reparto: r.k, responsabile_id: null, micros: [] })}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                macro === r.k ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {macro && (
        <>
          {/* Responsabile progetto */}
          <div>
            <label className="label-cap block mb-1">Responsabile progetto *</label>
            <select
              value={value.responsabile_id ?? ""}
              onChange={(e) => onChange({ ...value, responsabile_id: e.target.value || null })}
              className="input-bare w-full bg-paper text-sm"
            >
              <option value="">— Seleziona —</option>
              {responsabili.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ?? "Utente"}</option>
              ))}
            </select>
            {responsabili.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Nessun utente con settori del macroreparto selezionato.
              </p>
            )}
          </div>

          {/* Microreparti */}
          <div>
            <div className="label-cap mb-1">Microreparti coinvolti *</div>
            <div className="flex flex-wrap gap-1.5">
              {microOptions.map((m) => {
                const active = value.micros.some((x) => x.micro === m.k);
                return (
                  <button
                    key={m.k}
                    type="button"
                    onClick={() => toggleMicro(m.k)}
                    className={`px-2 py-1 rounded-sm border text-[10px] uppercase tracking-wider font-bold ${
                      active ? "bg-ink text-paper border-ink" : "border-ink/30 text-ink/70 hover:border-ink"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configurazione per ogni micro selezionato */}
          {value.micros.length > 0 && (
            <div className="space-y-2">
              <div className="label-cap">Assegnazioni & dipendenze</div>
              {value.micros.map((row, idx) => {
                const opts = filterUsersByMicro(allUsers, row.micro);
                const blockers = value.micros.filter((m) => m.micro !== row.micro);
                return (
                  <div key={row.micro} className="border border-ink/20 rounded-sm p-2 space-y-2 bg-paper/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {idx + 1}. {microLabel(row.micro)}
                      </span>
                      {row.depends_on_micro && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
                          <Lock className="w-3 h-3" /> bloccato finché {microLabel(row.depends_on_micro)} non finisce
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Responsabile micro
                        </label>
                        <select
                          value={row.assignee_id ?? ""}
                          onChange={(e) => updateMicro(row.micro, { assignee_id: e.target.value || null })}
                          className="input-bare w-full bg-paper text-xs"
                        >
                          <option value="">— Nessuno —</option>
                          {opts.map((u) => (
                            <option key={u.id} value={u.id}>{u.display_name ?? "Utente"}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <ArrowDown className="w-3 h-3" /> Dipende da
                        </label>
                        <select
                          value={row.depends_on_micro ?? ""}
                          onChange={(e) => updateMicro(row.micro, { depends_on_micro: e.target.value || null })}
                          className="input-bare w-full bg-paper text-xs"
                        >
                          <option value="">— Indipendente —</option>
                          {blockers.map((b) => (
                            <option key={b.micro} value={b.micro}>{microLabel(b.micro)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Operatori aggiuntivi
                      </label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {opts.map((u) => {
                          const sel = row.operator_ids.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => updateMicro(row.micro, {
                                operator_ids: sel
                                  ? row.operator_ids.filter((x) => x !== u.id)
                                  : [...row.operator_ids, u.id],
                              })}
                              className={`px-1.5 py-0.5 rounded-sm border text-[10px] ${
                                sel ? "bg-ink text-paper border-ink" : "border-ink/30 text-ink/60"
                              }`}
                            >
                              {u.display_name ?? "Utente"}
                            </button>
                          );
                        })}
                        {opts.length === 0 && (
                          <span className="text-[10px] text-muted-foreground">Nessun operatore di {microLabel(row.micro)}.</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};
