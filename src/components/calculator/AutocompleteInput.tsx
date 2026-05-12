import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface AutocompleteInputProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  type?: "text" | "number";
  step?: string;
  className?: string;
  suffix?: string;
}

export const AutocompleteInput = ({
  value, onChange, suggestions, placeholder, type = "text", step, className = "", suffix,
}: AutocompleteInputProps) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = value
    ? suggestions.filter(
        (s) => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()
      )
    : suggestions;
  const unique = Array.from(new Set(filtered)).slice(0, 8);
  const showDropdown = open && unique.length > 0;

  useEffect(() => {
    if (!showDropdown) setHighlight(-1);
  }, [showDropdown, value]);

  useEffect(() => {
    if (highlight >= 0 && itemsRef.current[highlight]) {
      itemsRef.current[highlight]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="flex items-center gap-1">
        <input
          type={type}
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showDropdown) {
              if (e.key === "ArrowDown" && unique.length > 0) {
                e.preventDefault();
                setOpen(true);
                setHighlight(0);
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % unique.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h <= 0 ? unique.length - 1 : h - 1));
            } else if (e.key === "Enter") {
              if (highlight >= 0 && highlight < unique.length) {
                e.preventDefault();
                onChange(unique[highlight]);
                setOpen(false);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="input-bare w-full text-sm"
        />
        {suffix && (
          <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground whitespace-nowrap">
            {suffix}
          </span>
        )}
        {suggestions.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Mostra suggerimenti"
            className="w-5 h-5 grid place-items-center text-ink/50 hover:text-ink shrink-0"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>
      {showDropdown && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-paper border-2 border-ink rounded-sm shadow-lg max-h-48 overflow-y-auto">
          {unique.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                ref={(el) => (itemsRef.current[i] = el)}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  i === highlight ? "bg-ink text-paper" : "hover:bg-ink hover:text-paper"
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
