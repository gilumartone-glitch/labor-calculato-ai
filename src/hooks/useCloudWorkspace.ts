import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Hook generico per persistere uno stato per-utente sul cloud (tabella `user_workspaces`).
 *
 * - Carica al mount; se cloud è vuoto e c'è un valore in localStorage, lo migra sul cloud.
 * - Salva con debounce (500ms) ad ogni cambio di stato.
 * - Flush sincrono su `visibilitychange` e `beforeunload` (fetch keepalive) così chiudere la
 *   finestra non perde le ultime modifiche.
 * - Realtime: applica le modifiche provenienti da altri PC dello stesso utente.
 *
 * @param key       chiave logica (es. "calculator_state", "montaggi_project")
 * @param defaultValue valore iniziale se cloud + localStorage sono vuoti
 * @param options   { localStorageKey?: string | string[], hydrate?: (raw) => T, debounceMs?: number }
 */
export function useCloudWorkspace<T>(
  key: string,
  defaultValue: T,
  options?: {
    localStorageKeys?: string[];
    hydrate?: (raw: unknown) => T;
    debounceMs?: number;
  },
) {
  const { localStorageKeys = [], hydrate, debounceMs = 500 } = options ?? {};
  const [state, setState] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "offline">("idle");

  const stateRef = useRef<T>(defaultValue);
  const uidRef = useRef<string | null>(null);
  const lastSerializedRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const conflictToastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const hydrateValue = useCallback(
    (raw: unknown): T => {
      if (raw == null) return defaultValue;
      try {
        return hydrate ? hydrate(raw) : (raw as T);
      } catch {
        return defaultValue;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const flushSync = useCallback(() => {
    const uid = uidRef.current;
    if (!uid) return;
    const serialized = JSON.stringify(stateRef.current);
    if (serialized === lastSerializedRef.current) return;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_workspaces?on_conflict=user_id,key`;
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      // Token JWT corrente (sync access via local storage Supabase)
      const tokenRaw = localStorage.getItem(`sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`);
      let accessToken = apikey;
      if (tokenRaw) {
        try {
          const parsed = JSON.parse(tokenRaw);
          accessToken = parsed?.access_token ?? apikey;
        } catch { /* ignore */ }
      }
      const body = JSON.stringify([{ user_id: uid, key, data: JSON.parse(serialized) }]);
      fetch(url, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body,
      }).catch(() => { /* ignore */ });
      lastSerializedRef.current = serialized;
    } catch { /* ignore */ }
  }, [key]);

  // Caricamento iniziale + migrazione localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id ?? null;
      uidRef.current = uid;
      if (!uid) {
        setReady(true);
        return;
      }
      const { data, error } = await supabase
        .from("user_workspaces")
        .select("data")
        .eq("user_id", uid)
        .eq("key", key)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn(`[useCloudWorkspace:${key}] load:`, error.message);
      }
      if (data?.data) {
        const value = hydrateValue(data.data);
        lastSerializedRef.current = JSON.stringify(value);
        setState(value);
      } else {
        // Cloud vuoto: prova migrazione da localStorage
        let migrated: T | null = null;
        for (const lsKey of localStorageKeys) {
          try {
            const raw = localStorage.getItem(lsKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              migrated = hydrateValue(parsed);
              break;
            }
          } catch { /* ignore */ }
        }
        if (migrated != null) {
          const serialized = JSON.stringify(migrated);
          lastSerializedRef.current = ""; // forza upsert
          setState(migrated);
          await supabase
            .from("user_workspaces")
            .upsert([{ user_id: uid, key, data: JSON.parse(serialized) as unknown as never }], {
              onConflict: "user_id,key",
            });
          lastSerializedRef.current = serialized;
        }
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Salvataggio debounced
  useEffect(() => {
    if (!ready) return;
    const uid = uidRef.current;
    if (!uid) return;
    const serialized = JSON.stringify(state);
    if (serialized === lastSerializedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setStatus("saving");
    const seq = ++seqRef.current;
    saveTimerRef.current = setTimeout(async () => {
      const { error } = await supabase
        .from("user_workspaces")
        .upsert([{ user_id: uid, key, data: JSON.parse(serialized) as unknown as never }], {
          onConflict: "user_id,key",
        });
      if (seq !== seqRef.current) return;
      if (error) {
        console.warn(`[useCloudWorkspace:${key}] save:`, error.message);
        setStatus("error");
      } else {
        lastSerializedRef.current = serialized;
        setStatus("idle");
      }
    }, debounceMs);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, ready, key, debounceMs]);

  // Realtime: applica modifiche da altri PC
  useEffect(() => {
    if (!ready) return;
    const uid = uidRef.current;
    if (!uid) return;
    const channel = supabase
      .channel(`uw-${key}-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_workspaces", filter: `user_id=eq.${uid}` },
        (payload) => {
          const row = (payload.new as { key?: string; data?: unknown } | null) ?? null;
          if (!row || row.key !== key) return;
          const value = hydrateValue(row.data);
          const serialized = JSON.stringify(value);
          if (serialized === lastSerializedRef.current) return;
          // Conflict detection: se lo stato locale ha modifiche non ancora salvate
          // (current ≠ lastSerialized) e arriva un update remoto diverso → conflitto.
          const currentLocal = JSON.stringify(stateRef.current);
          const localDirty = currentLocal !== lastSerializedRef.current;
          if (!localDirty) {
            lastSerializedRef.current = serialized;
            setState(value);
            return;
          }
          // Mostra una sola toast di conflitto alla volta
          if (conflictToastIdRef.current != null) {
            toast.dismiss(conflictToastIdRef.current);
          }
          conflictToastIdRef.current = toast.warning(
            `Modifiche da un altro dispositivo (${key}). Quale versione tieni?`,
            {
              duration: 30000,
              action: {
                label: "Usa remoto",
                onClick: () => {
                  lastSerializedRef.current = serialized;
                  setState(value);
                  conflictToastIdRef.current = null;
                },
              },
              cancel: {
                label: "Mantieni mie",
                onClick: () => {
                  // Forza un re-save del locale invalidando lastSerializedRef
                  lastSerializedRef.current = serialized + "::override";
                  setState((prev) => ({ ...(prev as object) } as T));
                  conflictToastIdRef.current = null;
                },
              },
            },
          );
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ready, key, hydrateValue]);

  // Flush su unload / cambio visibilità
  useEffect(() => {
    const onUnload = () => flushSync();
    const onVis = () => { if (document.visibilityState === "hidden") flushSync(); };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [flushSync]);

  return { state, setState, ready, status, flush: flushSync };
}