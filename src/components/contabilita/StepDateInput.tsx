import { useEffect, useRef, useState } from "react";

/**
 * Input data a step: gg → mm → aaaa.
 * - 3 caselle separate: digitando 2 cifre passa automaticamente alla successiva.
 * - Conferma SOLO con tasto OK / Invio / F10 (gestito dal contenitore).
 * - Se la data è incompleta o non valida, OK ripristina il valore precedente.
 *
 * Uso:
 *   <StepDateInput value={iso} onCommit={(iso) => ...} />
 */
export type StepDateInputProps = {
  value: string; // yyyy-mm-dd
  onCommit: (iso: string) => void;
  className?: string;
  ariaLabel?: string;
  /** Mostra il pulsante OK accanto ai campi. Default true. */
  showOk?: boolean;
  /** Chiamato quando l'utente preme Invio o OK con valore valido. */
  onConfirm?: () => void;
  autoFocus?: boolean;
};

const isValidDate = (y: number, m: number, d: number) => {
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

const parseIso = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return { d: "", mo: "", y: "" };
  return { d: m[3], mo: m[2], y: m[1] };
};

export const StepDateInput = ({
  value,
  onCommit,
  className,
  ariaLabel,
  showOk = true,
  onConfirm,
  autoFocus,
}: StepDateInputProps) => {
  const initial = parseIso(value);
  const [d, setD] = useState(initial.d);
  const [mo, setMo] = useState(initial.mo);
  const [y, setY] = useState(initial.y);
  const dRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const yRef = useRef<HTMLInputElement>(null);

  // Resync se il valore esterno cambia (es. import). Non sovrascrive mentre si edita.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current) return;
    const next = parseIso(value);
    setD(next.d);
    setMo(next.mo);
    setY(next.y);
  }, [value]);

  useEffect(() => {
    if (autoFocus) dRef.current?.focus();
  }, [autoFocus]);

  const tryCommit = (): boolean => {
    const dn = Number(d);
    const mn = Number(mo);
    const yn = Number(y.length === 2 ? "20" + y : y);
    if (!isValidDate(yn, mn, dn)) return false;
    const iso = `${String(yn).padStart(4, "0")}-${String(mn).padStart(2, "0")}-${String(dn).padStart(2, "0")}`;
    if (iso !== value) onCommit(iso);
    return true;
  };

  const confirm = () => {
    if (tryCommit()) {
      onConfirm?.();
    } else {
      // ripristina il valore valido precedente
      const prev = parseIso(value);
      setD(prev.d); setMo(prev.mo); setY(prev.y);
    }
  };

  const onlyDigits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);

  const cellBase = "h-9 w-full rounded-md border border-input bg-background px-1.5 text-center font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`} aria-label={ariaLabel}>
      <input
        ref={dRef}
        inputMode="numeric"
        maxLength={2}
        placeholder="gg"
        aria-label="Giorno"
        className={`${cellBase} w-10`}
        value={d}
        onFocus={(e) => { focusedRef.current = true; e.currentTarget.select(); }}
        onBlur={() => { focusedRef.current = false; }}
        onChange={(e) => {
          const v = onlyDigits(e.target.value, 2);
          setD(v);
          if (v.length === 2) mRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          else if (e.key === "ArrowRight" && (e.currentTarget.selectionStart ?? 0) >= d.length) mRef.current?.focus();
          else if (e.key === "/" || e.key === "-" || e.key === ".") { e.preventDefault(); mRef.current?.focus(); }
        }}
      />
      <span className="text-muted-foreground select-none">/</span>
      <input
        ref={mRef}
        inputMode="numeric"
        maxLength={2}
        placeholder="mm"
        aria-label="Mese"
        className={`${cellBase} w-10`}
        value={mo}
        onFocus={(e) => { focusedRef.current = true; e.currentTarget.select(); }}
        onBlur={() => { focusedRef.current = false; }}
        onChange={(e) => {
          const v = onlyDigits(e.target.value, 2);
          setMo(v);
          if (v.length === 2) yRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          else if (e.key === "Backspace" && mo.length === 0) dRef.current?.focus();
          else if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) === 0) dRef.current?.focus();
          else if (e.key === "ArrowRight" && (e.currentTarget.selectionStart ?? 0) >= mo.length) yRef.current?.focus();
          else if (e.key === "/" || e.key === "-" || e.key === ".") { e.preventDefault(); yRef.current?.focus(); }
        }}
      />
      <span className="text-muted-foreground select-none">/</span>
      <input
        ref={yRef}
        inputMode="numeric"
        maxLength={4}
        placeholder="aaaa"
        aria-label="Anno"
        className={`${cellBase} w-16`}
        value={y}
        onFocus={(e) => { focusedRef.current = true; e.currentTarget.select(); }}
        onBlur={() => { focusedRef.current = false; }}
        onChange={(e) => {
          const v = onlyDigits(e.target.value, 4);
          setY(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          else if (e.key === "Backspace" && y.length === 0) mRef.current?.focus();
          else if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) === 0) mRef.current?.focus();
        }}
      />
      {showOk && (
        <button
          type="button"
          onClick={confirm}
          aria-label="Conferma data"
          className="ml-1 grid h-9 w-10 place-items-center rounded-md border border-input bg-background text-xs font-semibold uppercase tracking-wider hover:bg-dept-soft/30"
        >
          OK
        </button>
      )}
    </div>
  );
};
