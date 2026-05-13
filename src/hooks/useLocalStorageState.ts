import { useEffect, useRef, useState } from "react";

/** Persistente in localStorage. Read-once all'init, scrive al cambio. */
export function useLocalStorageState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      if (raw == null) return initial;
      return { ...(initial as any), ...(JSON.parse(raw) as any) } as T;
    } catch {
      return initial;
    }
  });

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
  }, [key, value]);

  const clear = () => {
    try { window.localStorage.removeItem(key); } catch { /* noop */ }
  };

  return [value, setValue, clear];
}
