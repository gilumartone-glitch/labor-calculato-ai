import { useEffect } from "react";

/**
 * Scorciatoia da tastiera "conferma e chiudi" (F10).
 * Si registra solo quando enabled=true e usa la callback più aggiornata.
 */
export function useConfirmShortcut(onConfirm: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled, onConfirm]);
}
