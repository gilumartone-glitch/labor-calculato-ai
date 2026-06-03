import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Calculator, LogOut, Plus, ArrowLeft, Loader2, Filter } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CommessaCard, type OrderColor, type ProdSubInfo } from "@/components/flow/CommessaCard";
import { CommessaDialog } from "@/components/flow/CommessaDialog";
import { AdminUsersLink } from "@/components/AdminUsersLink";
import { HubLink } from "@/components/HubLink";
import { CommessaDetailDialog } from "@/components/flow/CommessaDetailDialog";
import { Commessa, CommessaStato, Profile, REPARTI, STATI } from "@/components/flow/types";
import { usePermissions } from "@/hooks/usePermissions";

const Column = ({
  stato,
  label,
  sub,
  items,
  children,
}: {
  stato: CommessaStato;
  label: string;
  sub: string;
  items: Commessa[];
  children: React.ReactNode;
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stato}`, data: { stato } });
  const totale = items.reduce((s, c) => s + (c.importo ?? 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] w-[280px] bg-muted/30 border-2 rounded-sm transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-ink/15"
      }`}
    >
      <div className="px-3 py-2.5 border-b-2 border-ink/15">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <h3 className="font-display font-semibold text-sm leading-none">{label}</h3>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          {sub}
        </div>
        {totale > 0 && (
          <div className="font-mono text-[10px] text-ink/60 tabular-nums mt-1">
            ∑ {totale.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">{children}</div>
    </div>
  );
};

const Flow = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { isAdmin, roles } = usePermissions();
  const isCoordinator = isAdmin || roles.includes("coordinatore");
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  /** Sub‑ordini di produzione raggruppati per commessa_id (via production_orders.source_commessa_id) */
  const [prodByCommessa, setProdByCommessa] = useState<Map<string, ProdSubInfo[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Commessa | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCommessa, setDetailCommessa] = useState<Commessa | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterReparto, setFilterReparto] = useState<string>("all");
  const [mobileStato, setMobileStato] = useState<CommessaStato>("da_fare");
  // "mine" = solo i miei compiti (default per tutti, anche coordinatori).
  // "all"  = panoramica completa (selezionabile solo da coordinatori/admin).
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [user, authLoading, navigate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [
        { data: cs, error: cErr },
        { data: ps, error: pErr },
        { data: ass, error: aErr },
        { data: pos, error: poErr },
        { data: subs, error: sErr },
      ] = await Promise.all([
        supabase.from("commesse").select("*").order("ordine", { ascending: true }),
        supabase.from("profiles").select("id, display_name, avatar_url"),
        supabase.from("commessa_assegnatari").select("commessa_id, user_id"),
        supabase.from("production_orders").select("id, source_commessa_id, status").not("source_commessa_id", "is", null),
        supabase.from("production_sub_orders").select("id, order_id, dept, status, assignee_id, code"),
      ]);
      if (cErr) throw cErr;
      if (pErr) throw pErr;
      if (aErr) throw aErr;
      if (poErr) throw poErr;
      if (sErr) throw sErr;

      const profilesById = new Map((ps ?? []).map((p) => [p.id, p as Profile]));
      const byCommessa = new Map<string, Profile[]>();
      for (const a of ass ?? []) {
        const list = byCommessa.get(a.commessa_id) ?? [];
        const prof = profilesById.get(a.user_id);
        if (prof) list.push(prof);
        byCommessa.set(a.commessa_id, list);
      }
      // Mappa commessa_id -> info sub-ordini di produzione
      const orderToCommessa = new Map<string, string>();
      for (const po of pos ?? []) {
        if (po.source_commessa_id) orderToCommessa.set(po.id, po.source_commessa_id);
      }
      const prodMap = new Map<string, ProdSubInfo[]>();
      for (const s of subs ?? []) {
        const commessaId = orderToCommessa.get(s.order_id);
        if (!commessaId) continue;
        // Nascondi sub completati per snellire la card
        if (s.status === "completato") continue;
        const list = prodMap.get(commessaId) ?? [];
        const assignee = s.assignee_id ? profilesById.get(s.assignee_id) ?? null : null;
        list.push({
          id: s.id,
          dept: s.dept as string,
          status: s.status as string,
          assigneeId: s.assignee_id ?? null,
          assigneeName: assignee?.display_name ?? null,
          code: s.code,
        });
        prodMap.set(commessaId, list);
      }

      const enriched = (cs ?? []).map((c) => {
        const flowAssignees = byCommessa.get(c.id) ?? [];
        const productionAssignees = (prodMap.get(c.id) ?? [])
          .map((s) => (s.assigneeId ? profilesById.get(s.assigneeId) ?? null : null))
          .filter((p): p is Profile => !!p);
        const uniqueAssignees = new Map<string, Profile>();
        for (const p of [...flowAssignees, ...productionAssignees]) uniqueAssignees.set(p.id, p);
        return {
          ...(c as Commessa),
          importo: c.importo === null ? null : Number(c.importo),
          assegnatari: Array.from(uniqueAssignees.values()),
        };
      });

      setCommesse(enriched);
      setProfiles((ps ?? []) as Profile[]);
      setProdByCommessa(prodMap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore di caricamento");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Realtime: aggiorna quando un altro utente modifica
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("commesse-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "commesse" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "commessa_assegnatari" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "production_sub_orders" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "production_orders" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = useMemo(
    () =>
      commesse.filter((c) => {
        if (filterReparto !== "all" && c.reparto !== filterReparto) return false;
        // Coordinatori/admin: vedono tutto solo se scope === "all".
        if (isCoordinator && scope === "all") return true;
        if (!user) return false;
        if (c.created_by === user.id) return true;
        return (c.assegnatari ?? []).some((a) => a.id === user.id);
      }),
    [commesse, filterReparto, isCoordinator, scope, user],
  );

  const byStato = useMemo(() => {
    const m: Record<CommessaStato, Commessa[]> = {
      da_fare: [], preventivo: [], in_produzione: [], pronto: [], consegnato: [],
    };
    for (const c of filtered) m[c.stato].push(c);
    for (const k of Object.keys(m) as CommessaStato[]) {
      m[k].sort((a, b) => a.ordine - b.ordine);
    }
    return m;
  }, [filtered]);

  /** Palette riciclabile per identificare ogni commessa attiva con un colore.
   *  Le commesse "consegnate" non consumano colore, così torna disponibile per le nuove. */
  const ORDER_PALETTE: OrderColor[] = useMemo(() => ([
    { bg: "bg-rose-50",     border: "border-l-rose-500",     chip: "bg-rose-500" },
    { bg: "bg-amber-50",    border: "border-l-amber-500",    chip: "bg-amber-500" },
    { bg: "bg-emerald-50",  border: "border-l-emerald-500",  chip: "bg-emerald-500" },
    { bg: "bg-sky-50",      border: "border-l-sky-500",      chip: "bg-sky-500" },
    { bg: "bg-violet-50",   border: "border-l-violet-500",   chip: "bg-violet-500" },
    { bg: "bg-fuchsia-50",  border: "border-l-fuchsia-500",  chip: "bg-fuchsia-500" },
    { bg: "bg-orange-50",   border: "border-l-orange-500",   chip: "bg-orange-500" },
    { bg: "bg-teal-50",     border: "border-l-teal-500",     chip: "bg-teal-500" },
    { bg: "bg-indigo-50",   border: "border-l-indigo-500",   chip: "bg-indigo-500" },
    { bg: "bg-lime-50",     border: "border-l-lime-600",     chip: "bg-lime-600" },
    { bg: "bg-cyan-50",     border: "border-l-cyan-500",     chip: "bg-cyan-500" },
    { bg: "bg-pink-50",     border: "border-l-pink-500",     chip: "bg-pink-500" },
  ]), []);

  const colorByCommessa = useMemo(() => {
    const m = new Map<string, OrderColor>();
    const active = filtered
      .filter((c) => c.stato !== "consegnato")
      .slice()
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    active.forEach((c, i) => m.set(c.id, ORDER_PALETTE[i % ORDER_PALETTE.length]));
    return m;
  }, [filtered, ORDER_PALETTE]);

  const handleSave = async (
    data: Omit<Commessa, "id" | "created_by" | "created_at" | "updated_at" | "ordine" | "assegnatari">,
    assegnatariIds: string[],
    id?: string,
  ) => {
    if (!user) return;
    if (id) {
      const { error } = await supabase.from("commesse").update(data).eq("id", id);
      if (error) throw error;
      // Sync assegnatari
      await supabase.from("commessa_assegnatari").delete().eq("commessa_id", id);
      if (assegnatariIds.length > 0) {
        await supabase.from("commessa_assegnatari").insert(
          assegnatariIds.map((uid) => ({ commessa_id: id, user_id: uid })),
        );
      }
      toast.success("Commessa aggiornata");
    } else {
      // Calcola ordine: in fondo alla colonna dello stato
      const maxOrdine = Math.max(0, ...byStato[data.stato].map((c) => c.ordine));
      const { data: created, error } = await supabase
        .from("commesse")
        .insert({ ...data, ordine: maxOrdine + 1, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      if (created && assegnatariIds.length > 0) {
        await supabase.from("commessa_assegnatari").insert(
          assegnatariIds.map((uid) => ({ commessa_id: created.id, user_id: uid })),
        );
      }
      toast.success("Creata!");
    }
    await loadAll();
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) {
      toast.error("Solo gli amministratori possono eliminare le lavorazioni");
      return;
    }
    if (!window.confirm("Eliminare definitivamente questa card?")) return;
    const { error } = await supabase.from("commesse").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCommesse((prev) => prev.filter((c) => c.id !== id));
    toast.success("Eliminata");
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeC = commesse.find((c) => c.id === active.id);
    if (!activeC) return;

    // Determine target stato + position
    let targetStato: CommessaStato = activeC.stato;
    let overIndex = -1;
    const overId = String(over.id);

    if (overId.startsWith("col:")) {
      targetStato = overId.slice(4) as CommessaStato;
    } else {
      const overC = commesse.find((c) => c.id === over.id);
      if (overC) {
        targetStato = overC.stato;
        overIndex = byStato[targetStato].findIndex((c) => c.id === overC.id);
      }
    }

    const sameColumn = targetStato === activeC.stato;
    const sourceList = byStato[activeC.stato];
    const targetList = byStato[targetStato];

    // Build new ordering for the target column
    let newTargetList: Commessa[];
    if (sameColumn) {
      const fromIdx = sourceList.findIndex((c) => c.id === activeC.id);
      const toIdx = overIndex >= 0 ? overIndex : sourceList.length - 1;
      newTargetList = arrayMove(sourceList, fromIdx, toIdx);
    } else {
      const insertAt = overIndex >= 0 ? overIndex : targetList.length;
      const updated = { ...activeC, stato: targetStato };
      newTargetList = [...targetList.slice(0, insertAt), updated, ...targetList.slice(insertAt)];
    }

    // Optimistic update
    setCommesse((prev) => {
      const others = prev.filter(
        (c) => c.stato !== targetStato && !(c.id === activeC.id && !sameColumn),
      );
      const restoredSource = sameColumn
        ? others
        : others.map((c) => c); // sourceList rimane invariato (la card è stata rimossa)
      const renumbered = newTargetList.map((c, i) => ({ ...c, ordine: i, stato: targetStato }));
      return [...restoredSource, ...renumbered];
    });

    // Persist: aggiorno stato (se cambia) e ordine
    try {
      if (!sameColumn) {
        await supabase.from("commesse").update({ stato: targetStato }).eq("id", activeC.id);
      }
      // Aggiorno ordine di tutte le card della colonna target
      const updates = newTargetList.map((c, i) =>
        supabase.from("commesse").update({ ordine: i }).eq("id", c.id),
      );
      await Promise.all(updates);
    } catch (err) {
      toast.error("Errore di salvataggio, ricarico…");
      await loadAll();
    }
  };

  if (authLoading || (loading && commesse.length === 0)) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-ink/50" />
      </div>
    );
  }

  const draggedCommessa = commesse.find((c) => c.id === activeId) ?? null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b-2 border-ink bg-paper sticky top-0 z-20">
        <div className="container py-3 md:py-4 flex items-center justify-between gap-2 md:gap-4 flex-wrap">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="min-w-0">
              <div className="font-display text-base md:text-lg font-semibold leading-none truncate">
                Flow <span className="text-primary">·</span> Panoramica progetti
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 hidden md:block">
                Stato, scadenze, importi. Qui decidi cosa lanciare in Produzione.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            {/* Toggle ambito: i miei compiti vs tutti (solo coordinatori/admin) */}
            {isCoordinator ? (
              <div className="inline-flex items-stretch border-2 border-ink/30 rounded-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setScope("mine")}
                  className={`px-2.5 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors ${
                    scope === "mine" ? "bg-ink text-paper" : "bg-paper text-ink/60 hover:text-ink"
                  }`}
                  title="Mostra solo le commesse che ho creato o che mi sono assegnate"
                >
                  I miei
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`px-2.5 py-1.5 text-[11px] uppercase tracking-wider font-bold transition-colors border-l border-ink/20 ${
                    scope === "all" ? "bg-ink text-paper" : "bg-paper text-ink/60 hover:text-ink"
                  }`}
                  title="Mostra tutte le commesse di tutti gli utenti (coordinatori)"
                >
                  Tutti
                </button>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border-2 border-ink/15 rounded-sm text-[11px] uppercase tracking-wider font-bold text-ink/60 bg-paper" title="Vedi solo i compiti a te assegnati">
                I miei compiti
              </div>
            )}


            {/* Filtro reparto */}
            <div className="inline-flex items-center gap-1.5 border-2 border-ink/30 rounded-sm overflow-hidden">
              <span className="px-2 text-ink/50">
                <Filter className="w-3 h-3" />
              </span>
              <select
                value={filterReparto}
                onChange={(e) => setFilterReparto(e.target.value)}
                className="bg-transparent text-[11px] uppercase tracking-wider font-bold py-1.5 pr-2 focus:outline-none"
              >
                <option value="all">Tutti i reparti</option>
                {REPARTI.map((r) => (
                  <option key={r.k} value={r.k}>{r.label}</option>
                ))}
              </select>
            </div>

            <div className="hidden md:block">
              <AdminUsersLink variant="ink" />
            </div>

            <button
              type="button"
              onClick={() => { setEditing(null); setDialogOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-sm text-[11px] uppercase tracking-wider font-bold hover:bg-ink transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nuova
            </button>

            <div className="flex items-center gap-2 text-[11px] font-mono text-ink/60">
              <span className="hidden lg:inline">{user?.email}</span>
              <button
                type="button"
                onClick={() => signOut()}
                className="inline-flex items-center gap-1 px-2 py-1.5 border border-ink/30 rounded-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors uppercase tracking-wider font-bold"
                title="Esci"
              >
                <LogOut className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Selettore stato compatto: mobile sempre, desktop solo per operatori */}
        <div className={`${isCoordinator ? "md:hidden" : ""} border-t border-ink/10 overflow-x-auto`}>
          <div className="flex min-w-max">
            {STATI.map((s) => {
              const count = byStato[s.k].length;
              const active = mobileStato === s.k;
              return (
                <button
                  key={s.k}
                  type="button"
                  onClick={() => setMobileStato(s.k)}
                  className={`flex-1 px-3 py-2 text-[11px] uppercase tracking-wider font-bold border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? "border-primary text-ink bg-primary/5"
                      : "border-transparent text-ink/50 hover:text-ink"
                  }`}
                >
                  {s.label}
                  <span className="ml-1.5 font-mono text-[10px] text-ink/40">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Kanban orizzontale: solo coordinatori su desktop */}
      {isCoordinator && (
      <main className="flex-1 overflow-x-auto overflow-y-hidden hidden md:block">
        <div className="px-6 py-6 h-full">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <div className="flex gap-3 h-[calc(100vh-160px)] min-h-[400px]">
              {STATI.map((s, idx) => (
                <div key={s.k} className="flex items-stretch gap-3">
                  <Column stato={s.k} label={s.label} sub={s.sub} items={byStato[s.k]}>
                    <SortableContext
                      items={byStato[s.k].map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {byStato[s.k].length === 0 ? (
                        <div className="text-center text-[11px] text-muted-foreground py-6 font-mono uppercase tracking-wider">
                          Vuoto
                        </div>
                      ) : (
                        byStato[s.k].map((c) => (
                          <CommessaCard
                            key={c.id}
                            commessa={c}
                            color={colorByCommessa.get(c.id)}
                            prodSubs={prodByCommessa.get(c.id)}
                            onOpen={() => { setDetailCommessa(c); setDetailOpen(true); }}
                            onDelete={() => handleDelete(c.id)}
                            canDelete={isAdmin}
                          />
                        ))
                      )}
                    </SortableContext>
                  </Column>
                  {idx < STATI.length - 1 && (
                    <div className="flex items-center text-ink/20 text-2xl select-none" aria-hidden>
                      →
                    </div>
                  )}
                </div>
              ))}
            </div>

            <DragOverlay>
              {draggedCommessa && (
                <div className="rotate-2 opacity-90">
                  <CommessaCard commessa={draggedCommessa} color={colorByCommessa.get(draggedCommessa.id)} onOpen={() => {}} onDelete={() => {}} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </main>
      )}

      {/* Vista compatta: mobile per tutti, desktop per operatori */}
      <main className={`flex-1 overflow-y-auto ${isCoordinator ? "md:hidden" : ""} bg-muted/20`}>
        <div className="px-3 md:px-6 py-3 md:py-6 max-w-3xl mx-auto w-full">
          {(() => {
            const list = byStato[mobileStato];
            const totale = list.reduce((s, c) => s + (c.importo ?? 0), 0);
            const meta = STATI.find((s) => s.k === mobileStato);
            return (
              <>
                <div className="mb-3 px-1">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {meta?.sub} · {list.length} card
                  </div>
                  {totale > 0 && (
                    <div className="font-mono text-xs text-ink/70 tabular-nums mt-0.5">
                      Totale {totale.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
                    </div>
                  )}
                </div>
                {list.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-12 font-mono uppercase tracking-wider">
                    Nessuna commessa in {meta?.label}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {list.map((c) => (
                      <CommessaCard
                        key={c.id}
                        commessa={c}
                        color={colorByCommessa.get(c.id)}
                        prodSubs={prodByCommessa.get(c.id)}
                        onOpen={() => { setDetailCommessa(c); setDetailOpen(true); }}
                        onDelete={() => handleDelete(c.id)}
                        canDelete={isAdmin}
                      />
                    ))}
                  </div>
                )}
                <p className="mt-6 text-center text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                  Tocca una card per modificarne lo stato
                </p>
              </>
            );
          })()}
        </div>
      </main>

      <CommessaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        profiles={profiles}
        onSave={handleSave}
      />

      <CommessaDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        commessa={
          detailCommessa
            ? commesse.find((c) => c.id === detailCommessa.id) ?? detailCommessa
            : null
        }
        onChanged={() => loadAll()}
        onEdit={() => {
          if (detailCommessa) {
            setEditing(detailCommessa);
            setDetailOpen(false);
            setDialogOpen(true);
          }
        }}
      />
    </div>
  );
};

export default Flow;