import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { Loader2, Package, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { InventoryDeptView } from "@/components/produzione/InventoryDeptView";
import { InvDept, INV_DEPT_LABEL } from "@/lib/produzione/types";
import { loadCatalogCloud } from "@/lib/catalog";
import { Catalog, DepartmentKey } from "@/components/calculator/types";

/**
 * Magazzino virtuale unico — mostra TUTTO il listino per reparto con:
 * - carico/scarico rapido (±N)
 * - creazione varianti a misura personalizzata / sfridi
 * - dettaglio pezzi di sfrido per ogni variante
 * - le varianti sono distinte per prodotto → spessore → colore → misura lastra
 * Condivide dati e componenti con la sezione /produzione/magazzino.
 */

const TABS: InvDept[] = ["stampa", "tappezzeria", "falegnameria"];

const MagazzinoView = () => {
  const { user, loading: authLoading } = useAuth();
  const { loading: permLoading, isAdmin, approved } = usePermissions();
  const [tab, setTab] = useState<InvDept>("stampa");
  const [catalogs, setCatalogs] = useState<Partial<Record<InvDept, Catalog | null>>>({});
  const [loadingCat, setLoadingCat] = useState(false);

  useEffect(() => {
    if (catalogs[tab] !== undefined) return;
    let cancelled = false;
    (async () => {
      setLoadingCat(true);
      const c = await loadCatalogCloud(tab as DepartmentKey).catch(() => null);
      if (!cancelled) {
        setCatalogs((p) => ({ ...p, [tab]: c }));
        setLoadingCat(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, catalogs]);

  if (authLoading || permLoading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin && !approved) return <Navigate to="/hub" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-ink bg-paper">
        <div className="w-full px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Postazione</div>
            <h1 className="font-display text-3xl font-semibold leading-none flex items-center gap-2">
              <Package className="w-7 h-7" /> Magazzino virtuale
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Tutto il listino, carico/scarico immediato, sfridi e misure personalizzate.
              Condiviso con <Link to="/produzione/magazzino" className="text-primary hover:underline inline-flex items-center gap-1">Produzione → Magazzino <ExternalLink className="w-3 h-3" /></Link>
            </p>
          </div>
        </div>
      </header>

      <main className="w-full px-8 py-6 space-y-5">
        <div className="flex gap-1 border-b-2 border-ink/15">
          {TABS.map((d) => {
            const active = d === tab;
            return (
              <button
                key={d}
                onClick={() => setTab(d)}
                className={`px-6 py-3 text-sm uppercase tracking-wider font-bold border-b-2 -mb-[2px] transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-ink/50 hover:text-ink"
                }`}
              >
                {INV_DEPT_LABEL[d]}
              </button>
            );
          })}
        </div>

        {loadingCat && catalogs[tab] === undefined ? (
          <div className="p-10 grid place-items-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <InventoryDeptView key={tab} dept={tab} catalog={catalogs[tab] ?? null} />
        )}
      </main>
    </div>
  );
};

export default MagazzinoView;
