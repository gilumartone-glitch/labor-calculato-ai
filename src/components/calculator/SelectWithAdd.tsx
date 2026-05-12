import { useState } from "react";
import { Plus, Check, X } from "lucide-react";

interface SelectWithAddProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export const SelectWithAdd = ({
  value,
  onChange,
  options,
  placeholder = "Seleziona…",
  allowEmpty = true,
  emptyLabel = "—",
}: SelectWithAddProps) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const unique = Array.from(new Set(options.filter((o) => o.trim() !== ""))).sort();

  const confirmAdd = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    onChange(v);
    setDraft("");
    setAdding(false);
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmAdd();
            } else if (e.key === "Escape") {
              setAdding(false);
              setDraft("");
            }
          }}
          placeholder="Nuovo valore…"
          className="input-bare flex-1 w-full text-sm"
        />
        <button
          type="button"
          onClick={confirmAdd}
          aria-label="Conferma"
          className="w-6 h-6 grid place-items-center rounded-sm bg-primary text-primary-foreground hover:bg-ink shrink-0"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setDraft("");
          }}
          aria-label="Annulla"
          className="w-6 h-6 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:text-ink shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-bare w-full text-sm bg-paper py-1 flex-1 min-w-0"
      >
        <option value="">{allowEmpty ? emptyLabel : placeholder}</option>
        {value && !unique.includes(value) && (
          <option value={value}>{value}</option>
        )}
        {unique.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="Aggiungi nuovo valore"
        title="Aggiungi nuovo valore"
        className="w-6 h-6 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-primary hover:text-primary-foreground hover:border-primary shrink-0"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};