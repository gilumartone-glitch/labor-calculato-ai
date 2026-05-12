import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useSharedCloudState<T>(
  key: string,
  defaultValue: T,
  options?: { hydrate?: (raw: unknown) => T; debounceMs?: number; localStorageKeys?: string[] },
) {
  const { hydrate, debounceMs = 500, localStorageKeys = [] } = options ?? {};
  const { session, loading: authLoading } = useAuth();
  const sessionUserId = session?.user?.id ?? null;
  const [state, setState] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const stateRef = useRef<T>(defaultValue);
  const sessionRef = useRef(session);
  const uidRef = useRef<string | null>(null);
  const lastSerializedRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const hydrateValue = useCallback((raw: unknown): T => {
    if (raw == null) return defaultValue;
    try { return hydrate ? hydrate(raw) : (raw as T); }
    catch { return defaultValue; }
  }, [defaultValue, hydrate]);

  const readLocalValue = useCallback((): T | null => {
    for (const lsKey of localStorageKeys) {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) continue;
        return hydrateValue(JSON.parse(raw));
      } catch { /* ignore */ }
    }
    return null;
  }, [hydrateValue, localStorageKeys]);

  const flushSync = useCallback(() => {
    // Non sincronizzare nulla finché il valore iniziale non è stato caricato
    // dal cloud, altrimenti rischiamo di sovrascrivere i dati remoti con i
    // valori di default mentre la pagina è ancora in loading.
    if (lastSerializedRef.current === "") return;
    const activeSession = sessionRef.current;
    if (!activeSession?.access_token) return;
    const serialized = JSON.stringify(stateRef.current);
    if (serialized === lastSerializedRef.current) return;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/catalogs?on_conflict=dept`;
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      fetch(url, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey,
          Authorization: `Bearer ${activeSession.access_token}`,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([{ dept: key, data: JSON.parse(serialized), updated_by: uidRef.current ?? undefined }]),
      }).catch(() => { /* ignore */ });
      lastSerializedRef.current = serialized;
    } catch { /* ignore */ }
  }, [key]);

  useEffect(() => {
    if (authLoading) return;
    if (!sessionUserId) {
      setReady(true);
      setStatus("error");
      lastSerializedRef.current = JSON.stringify(defaultValue);
      return;
    }
    let cancelled = false;
    (async () => {
      uidRef.current = sessionUserId;
      const { data, error } = await supabase
        .from("catalogs")
        .select("data")
        .eq("dept", key)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn(`[shared:${key}] load:`, error.message);
        setStatus("error");
        lastSerializedRef.current = JSON.stringify(stateRef.current);
        setReady(true);
        return;
      }
      const cloudValue = hydrateValue(data?.data ?? null);
      const localValue = readLocalValue();
      const defaultSerialized = JSON.stringify(defaultValue);
      const cloudSerialized = JSON.stringify(cloudValue);
      const localSerialized = localValue == null ? "" : JSON.stringify(localValue);
      const useLocal = localValue != null && cloudSerialized === defaultSerialized && localSerialized !== defaultSerialized;
      const value = useLocal ? localValue : cloudValue;
      // Se stiamo recuperando un backup locale perché il cloud è vuoto, non
      // marchiarlo come già salvato: il prossimo effetto lo rimanda al cloud.
      lastSerializedRef.current = useLocal ? "" : JSON.stringify(value);
      setState(value);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [authLoading, sessionUserId, key, hydrateValue, readLocalValue, defaultValue]);

  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(state);
    if (serialized === lastSerializedRef.current) return;
    for (const lsKey of localStorageKeys) {
      try { localStorage.setItem(lsKey, serialized); } catch { /* ignore */ }
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setStatus("saving");
    const seq = ++seqRef.current;
    saveTimerRef.current = setTimeout(async () => {
      const updated_by = sessionRef.current?.user?.id ?? null;
      if (!updated_by) {
        if (seq === seqRef.current) setStatus("error");
        return;
      }
      const { error } = await supabase
        .from("catalogs")
        .upsert([{ dept: key, data: JSON.parse(serialized) as unknown as never, updated_by: updated_by ?? undefined }], {
          onConflict: "dept",
        });
      if (seq !== seqRef.current) return;
      if (error) {
        console.warn(`[shared:${key}] save:`, error.message);
        setStatus("error");
      } else {
        lastSerializedRef.current = serialized;
        setStatus("idle");
      }
    }, debounceMs);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state, ready, key, debounceMs, localStorageKeys]);

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

  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel(`shared-${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "catalogs", filter: `dept=eq.${key}` },
        (payload) => {
          const row = payload.new as { data?: unknown } | null;
          if (!row) return;
          const value = hydrateValue(row.data);
          const serialized = JSON.stringify(value);
          if (serialized === lastSerializedRef.current) return;
          lastSerializedRef.current = serialized;
          for (const lsKey of localStorageKeys) {
            try { localStorage.setItem(lsKey, serialized); } catch { /* ignore */ }
          }
          setState(value);
          setStatus("idle");
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ready, key, hydrateValue, localStorageKeys]);

  return { state, setState, ready, status };
}
