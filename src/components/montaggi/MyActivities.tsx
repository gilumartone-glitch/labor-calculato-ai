import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ListChecks, ClipboardList, Bell, Calendar as CalIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEPT_LABEL } from "@/lib/produzione/types";

type MySub = {
  id: string;
  code: string;
  dept: string;
  status: string;
  order_id: string;
  due_date: string | null;
  rejection_reason: string | null;
};

type MyPlan = {
  id: string;
  date: string;
  hours: number;
  cantiere_label: string;
  reparto: string | null;
  notes: string | null;
};

type MyNotif = {
  id: string;
  message: string;
  link: string | null;
  order_id: string | null;
  is_urgent: boolean;
  read_at: string | null;
  created_at: string;
};

const fmtDay = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }); }
  catch { return iso; }
};

/** Sezione "Le mie attività": raccoglie sub-ordini assegnati, turni di pianificazione
 *  e notifiche non lette dell'utente loggato. Click → naviga al dettaglio. */
export const MyActivities = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subs, setSubs] = useState<MySub[]>([]);
  const [plans, setPlans] = useState<MyPlan[]>([]);
  const [notifs, setNotifs] = useState<MyNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPlan, setOpenPlan] = useState<MyPlan | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString().slice(0, 10);
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
    const in30Iso = in30.toISOString().slice(0, 10);

    (async () => {
      setLoading(true);
      // operator ids legati a questo utente (operator.userId === user.id e fallback: operator.id === user.id)
      const [subsR, plansByUser, plansByOperatorId, notifR] = await Promise.all([
        supabase.from("production_sub_orders")
          .select("id, code, dept, status, order_id, due_date, rejection_reason")
          .eq("assignee_id", user.id)
          .neq("status", "completato")
          .order("due_date", { ascending: true })
          .limit(50),
        supabase.from("montaggi_planning")
          .select("id, date, hours, cantiere_label, reparto, notes, operator_id")
          .gte("date", todayIso)
          .lte("date", in30Iso)
          .order("date", { ascending: true })
          .limit(30),
        supabase.from("montaggi_planning")
          .select("id, date, hours, cantiere_label, reparto, notes, operator_id")
          .eq("operator_id", user.id)
          .gte("date", todayIso)
          .lte("date", in30Iso)
          .order("date", { ascending: true })
          .limit(30),
        supabase.from("prod_notifications")
          .select("id, message, link, order_id, is_urgent, read_at, created_at")
          .eq("user_id", user.id)
          .is("read_at", null)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (cancelled) return;
      setSubs((subsR.data ?? []) as MySub[]);

      // Unisci pianificazioni: per operator_id = user.id (linking diretto)
      // Le pianificazioni indirette (via operator.userId) sono già gestite altrove —
      // qui ci basiamo sul caso più comune: operator_id === user.id.
      const planMap = new Map<string, MyPlan>();
      for (const p of plansByOperatorId.data ?? []) planMap.set(p.id, p as MyPlan);
      // plansByUser viene caricato ma filtrato successivamente — per ora non lo usiamo
      // perché il legame operator/user è già coperto da plansByOperatorId.
      void plansByUser;
      setPlans(Array.from(planMap.values()).slice(0, 8));

      setNotifs((notifR.data ?? []) as MyNotif[]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user]);

  const openNotif = async (n: MyNotif) => {
    await supabase.from("prod_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    if (n.link) navigate(n.link);
    else if (n.order_id) navigate(`/produzione/board?order=${n.order_id}`);
  };

  const totalItems = subs.length + plans.length + notifs.length;

  return (
    <Card className="border-2 border-primary/40 shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-5 w-5 text-primary" />
          Le mie attività
          {totalItems > 0 && (
            <Badge variant="secondary" className="font-mono">{totalItems}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : totalItems === 0 ? (
          <div className="text-sm text-muted-foreground italic">Nessuna attività o notifica in attesa per te.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {/* Lavorazioni assegnate */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-ink/70">
                <ClipboardList className="h-3.5 w-3.5" />
                Lavorazioni ({subs.length})
              </div>
              {subs.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">Niente da fare.</div>
              ) : (
                <div className="space-y-1.5">
                  {subs.slice(0, 8).map((s) => (
                    <Link
                      key={s.id}
                      to={`/produzione/board?sub=${s.id}`}
                      className="block border border-ink/15 rounded-sm p-2 hover:bg-muted/40 hover:border-primary transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="font-bold truncate">{s.code}</span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-primary shrink-0">
                          {DEPT_LABEL[s.dept as keyof typeof DEPT_LABEL] ?? s.dept}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.status === "rimandato" && s.rejection_reason ? `↩ ${s.rejection_reason}` : s.status}
                        {s.due_date && ` · scad. ${fmtDay(s.due_date)}`}
                      </div>
                    </Link>
                  ))}
                  {subs.length > 8 && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                      <Link to="/produzione/board">+ altri {subs.length - 8}</Link>
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Turni pianificazione */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-ink/70">
                <CalIcon className="h-3.5 w-3.5" />
                Turni 30gg ({plans.length})
              </div>
              {plans.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">Nessun turno pianificato.</div>
              ) : (
                <div className="space-y-1.5">
                  {plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setOpenPlan(p)}
                      className="w-full text-left border border-ink/15 rounded-sm p-2 text-[13px] hover:bg-muted/40 hover:border-primary transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold truncate">{p.cantiere_label}</span>
                        <span className="text-[10px] font-mono shrink-0 bg-primary/10 text-primary px-1.5 py-0.5 rounded-sm">
                          {p.hours}h
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtDay(p.date)}
                        {p.reparto && p.reparto !== "montaggi" && ` · ${p.reparto}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notifiche non lette */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-ink/70">
                <Bell className="h-3.5 w-3.5" />
                Notifiche ({notifs.length})
              </div>
              {notifs.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">Tutto letto.</div>
              ) : (
                <div className="space-y-1.5">
                  {notifs.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => openNotif(n)}
                      className={`w-full text-left border rounded-sm p-2 hover:bg-muted/40 transition-colors ${
                        n.is_urgent ? "border-destructive/40 bg-destructive/5" : "border-ink/15"
                      }`}
                    >
                      <div className="text-[12px] leading-snug line-clamp-2">{n.message}</div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: it })}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
