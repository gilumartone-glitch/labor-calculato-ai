import { useEffect, useRef, useState } from "react";
import { Catalog, DepartmentKey } from "@/components/calculator/types";
import { emptyCatalog, loadCatalog, loadCatalogCloud, saveCatalogCloud } from "@/lib/catalog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

type Catalogs = Record<DepartmentKey, Catalog>;

const DEPTS: DepartmentKey[] = ["tappezzeria", "stampa", "falegnameria"];

const materialKey = (m: Catalog["materials"][number]) =>
  [m.name, m.color, m.height, m.thickness ?? "", m.fireproof ?? "", m.finish ?? ""]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .join("|");

const operationKey = (o: Catalog["operations"][number]) =>
  [o.name, o.type, o.unit].map((x) => String(x ?? "").trim().toLowerCase()).join("|");

const printKey = (p: NonNullable<Catalog["printOps"]>[number]) =>
  [p.type, p.mode].map((x) => String(x ?? "").trim().toLowerCase()).join("|");

const perimeterKey = (p: Catalog["perimeterOps"][number]) =>
  [p.name, p.category ?? "", p.priceUnit ?? "", p.machine ?? ""]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .join("|");

const presetKey = (p: Catalog["perimeterPresets"][number]) =>
  String(p.name ?? "").trim().toLowerCase();

const mergeMissing = <T,>(current: T[] | undefined, local: T[] | undefined, getKey: (item: T) => string) => {
  const base = current ?? [];
  const seen = new Set(base.map(getKey));
  const missing = (local ?? []).filter((item) => !seen.has(getKey(item)));
  return { merged: [...base, ...missing], added: missing.length };
};

const mergeCatalogWithLocal = (cloud: Catalog, local: Catalog) => {
  const materials = mergeMissing(cloud.materials, local.materials, materialKey);
  const operations = mergeMissing(cloud.operations, local.operations, operationKey);
  const printOps = mergeMissing(cloud.printOps ?? [], local.printOps ?? [], printKey);
  const perimeterOps = mergeMissing(cloud.perimeterOps, local.perimeterOps, perimeterKey);
  const perimeterPresets = mergeMissing(cloud.perimeterPresets, local.perimeterPresets, presetKey);

  const merged: Catalog = {
    ...cloud,
    materials: materials.merged,
    operations: operations.merged,
    printOps: printOps.merged,
    perimeterOps: perimeterOps.merged,
    perimeterPresets: perimeterPresets.merged,
    importedAt: cloud.importedAt ?? local.importedAt,
    fileName: cloud.fileName ?? local.fileName,
  };

  return {
    merged,
    added:
      materials.added +
      operations.added +
      printOps.added +
      perimeterOps.added +
      perimeterPresets.added,
  };
};

/**
 * Sincronizza i cataloghi su Lovable Cloud.
 * - Al login carica i 3 cataloghi dal cloud.
 * - Se il cloud è vuoto e localStorage ha dati, fa migrazione automatica.
 * - Realtime: aggiorna lo stato quando un altro utente modifica un catalogo.
 */
export const useCloudCatalogs = (
  initial: Catalogs,
  postProcess: (c: Catalog, dept: DepartmentKey) => Catalog = (c) => c,
) => {
  const { user } = useAuth();
  const [catalogs, setCatalogs] = useState<Catalogs>(initial);
  const [loaded, setLoaded] = useState(false);
  // Hash dell'ultimo payload salvato/ricevuto per dept: se l'evento realtime
  // contiene esattamente lo stesso payload, è inutile riprocessarlo.
  const lastSeenHash = useRef<Record<string, string>>({});

  const hashCatalog = (c: Catalog) => {
    try { return JSON.stringify(c); } catch { return ""; }
  };

  // Caricamento iniziale + migrazione localStorage → Cloud
  // Strategia:
  // - Se nel cloud manca il record o ha materials VUOTI ma localStorage ha materiali,
  //   migriamo i materiali (e operations/printOps) da localStorage senza perdere
  //   le perimeterOps/preset eventualmente già personalizzati nel cloud.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const next: Partial<Catalogs> = {};
      for (const dept of DEPTS) {
        const cloud = await loadCatalogCloud(dept);
        const local = loadCatalog(dept);
        const localHasAnyData =
          local.materials.length > 0 ||
          local.operations.length > 0 ||
          (local.printOps?.length ?? 0) > 0 ||
          local.perimeterOps.length > 0 ||
          local.perimeterPresets.length > 0;

        let merged: Catalog;
        let needsSave = false;

        if (!cloud) {
          merged = postProcess(localHasAnyData ? local : emptyCatalog(), dept);
          needsSave = localHasAnyData;
        } else {
          const mergedResult = mergeCatalogWithLocal(cloud, local);
          merged = postProcess(mergedResult.merged, dept);
          needsSave = mergedResult.added > 0;
        }

        next[dept] = merged;
        if (needsSave) {
          try {
            lastSeenHash.current[dept] = hashCatalog(merged);
            await saveCatalogCloud(dept, merged);
          } catch {
            // ignore
          }
        } else {
          lastSeenHash.current[dept] = hashCatalog(merged);
        }
      }
      if (cancelled) return;
      setCatalogs(next as Catalogs);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /** Forza la migrazione degli elementi mancanti da localStorage al cloud. */
  const migrateFromLocalStorage = async (dept: DepartmentKey): Promise<number> => {
    const local = loadCatalog(dept);
    const current = catalogs[dept];
    const mergedResult = mergeCatalogWithLocal(current, local);
    if (mergedResult.added === 0) return 0;
    const merged = postProcess(mergedResult.merged, dept);
    setCatalogs((prev) => ({ ...prev, [dept]: merged }));
    lastSeenHash.current[dept] = hashCatalog(merged);
    await saveCatalogCloud(dept, merged);
    return mergedResult.added;
  };

  // Realtime: ascolta modifiche dagli altri utenti
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`catalogs-changes-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "catalogs" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { dept?: string; data?: Catalog } | null;
          if (!row?.dept) return;
          const dept = row.dept as DepartmentKey;
          if (!DEPTS.includes(dept)) return;
          if (payload.eventType === "DELETE") {
            lastSeenHash.current[dept] = "";
            setCatalogs((prev) => ({ ...prev, [dept]: emptyCatalog() }));
            return;
          }
          const incoming = (row.data ?? {}) as Partial<Catalog>;
          // Il cloud è l'unica fonte di verità: applichiamo il payload remoto
          // così che cancellazioni e modifiche fatte da altri utenti vengano
          // sempre propagate (niente merge, niente "resurrezione" di voci).
          const remoteCat: Catalog = postProcess({
            materials: incoming.materials ?? [],
            operations: incoming.operations ?? [],
            perimeterOps: incoming.perimeterOps ?? [],
            perimeterPresets: incoming.perimeterPresets ?? [],
            importedAt: incoming.importedAt ?? null,
            fileName: incoming.fileName ?? null,
            markupPct: incoming.markupPct ?? 0,
            printOps: incoming.printOps ?? [],
          }, dept);
          const incomingHash = hashCatalog(remoteCat);
          if (lastSeenHash.current[dept] === incomingHash) return;
          lastSeenHash.current[dept] = incomingHash;
          setCatalogs((prev) => ({ ...prev, [dept]: remoteCat }));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  /** Aggiorna localmente e salva su cloud (debounce per evitare flood). */
  const setCatalog = (dept: DepartmentKey) => (c: Catalog) => {
    setCatalogs((prev) => ({ ...prev, [dept]: c }));
    lastSeenHash.current[dept] = hashCatalog(c);
    saveCatalogCloud(dept, c).catch((err) => {
      console.error("Errore salvataggio listino cloud:", err);
    });
  };

  return { catalogs, setCatalog, loaded, migrateFromLocalStorage };
};