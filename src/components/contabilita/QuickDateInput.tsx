import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

const formatDate = (iso: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : "";
};

export const QuickDateInput = ({ value, onCommit, monthIndex, className, ariaLabel }: {
  value: string;
  onCommit: (value: string) => void;
  monthIndex: number;
  className?: string;
  ariaLabel?: string;
}) => {
  const [draft, setDraft] = useState(formatDate(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(formatDate(value));
  }, [value]);

  const commit = () => {
    const parts = draft.trim().split("/");
    let year = parts.length === 3 ? Number(parts[2]) : new Date().getFullYear();
    if (parts.length === 3 && parts[2].length === 2) year += 2000;
    const month = parts.length >= 2 ? Number(parts[1]) : monthIndex + 1;
    const day = Number(parts[0]);
    const date = new Date(year, month - 1, day);
    const valid = parts.length <= 3 && Number.isInteger(year) && year >= 1900 && year <= 2100
      && (parts.length !== 3 || [2, 4].includes(parts[2].length))
      && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    if (!valid) { setDraft(formatDate(value)); return; }
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setDraft(formatDate(iso));
    if (iso !== value) onCommit(iso);
  };

  return <Input
    aria-label={ariaLabel}
    className={className}
    type="text"
    inputMode="numeric"
    placeholder="gg/mm/aa"
    value={draft}
    onFocus={(event) => { focused.current = true; event.currentTarget.select(); }}
    onChange={(event) => {
      const raw = event.target.value.replace(/[.\-\s]/g, "/").replace(/[^\d/]/g, "");
      // Compare before removing separators: replacing a date with dots is not deletion.
      const deleting = event.target.value.length < draft.length;
      if (deleting && raw.includes("/")) { setDraft(raw.slice(0, 10)); return; }
      const digits = raw.replace(/\D/g, "").slice(0, 8);
      setDraft(digits.length <= 2 ? digits : digits.length <= 4
        ? `${digits.slice(0, 2)}/${digits.slice(2)}`
        : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`);
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      else if (event.key === "Escape") {
        event.preventDefault();
        setDraft(formatDate(value));
        focused.current = false;
        // Avoid confirming the discarded draft from this event's render.
        event.currentTarget.value = formatDate(value);
        event.currentTarget.blur();
      }
    }}
    onBlur={(event) => {
      focused.current = false;
      if (event.currentTarget.value === formatDate(value)) { setDraft(formatDate(value)); return; }
      commit();
    }}
  />;
};