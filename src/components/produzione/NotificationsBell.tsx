import { useEffect, useMemo, useState } from "react";
import { Bell, Check, X, Smartphone } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { useProdStore } from "@/lib/produzione/store";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  pushAvailableHere, getNotificationStatus, subscribePush, unsubscribePush,
} from "@/lib/push";
import { toast } from "sonner";

export const NotificationsBell = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const notifications = useProdStore((s) => s.notifications);
  const refresh = useProdStore((s) => s.refreshNotifications);
  const [tab, setTab] = useState<"all" | "unread">("unread");
  const [open, setOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<string>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);

  const refreshPushStatus = async () => setPushStatus(await getNotificationStatus());
  useEffect(() => { refreshPushStatus(); }, [user]);

  const togglePush = async () => {
    if (!user) return;
    setPushBusy(true);
    try {
      if (pushStatus === "subscribed") {
        await unsubscribePush();
        toast.success("Notifiche push disattivate");
      } else {
        await subscribePush(user.id);
        toast.success("Notifiche push attivate");
      }
      await refreshPushStatus();
    } catch (e: any) {
      toast.error(e?.message || "Errore");
    } finally {
      setPushBusy(false);
    }
  };

  const unread = notifications.filter((n) => !n.read_at);
  const list = tab === "unread" ? unread : notifications;
  const hasUrgent = useMemo(() => unread.some((n) => n.is_urgent), [unread]);

  useEffect(() => {
    if (!user) return;
    refresh(user.id);
    const ch = supabase
      .channel(`notifications-bell-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prod_notifications", filter: `user_id=eq.${user.id}` }, () => refresh(user.id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, refresh]);

  const markRead = async (id: string) => {
    await supabase.from("prod_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (user) refresh(user.id);
  };
  const markAllRead = async () => {
    if (!user) return;
    await supabase.from("prod_notifications").update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id).is("read_at", null);
    refresh(user.id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-ink/20 bg-background hover:bg-muted transition-colors" title="Notifiche" aria-label="Notifiche">
          <Bell className={`w-4 h-4 ${hasUrgent ? "text-destructive animate-pulse" : "text-ink/70"}`} />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold grid place-items-center">
              {unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-1rem)] sm:w-96 p-0 max-h-[70vh] overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="flex gap-1">
            <button onClick={() => setTab("unread")} className={`text-[11px] uppercase tracking-wider font-bold px-2 py-1 rounded-sm ${tab === "unread" ? "bg-ink text-paper" : "text-ink/60 hover:bg-muted"}`}>
              Non lette ({unread.length})
            </button>
            <button onClick={() => setTab("all")} className={`text-[11px] uppercase tracking-wider font-bold px-2 py-1 rounded-sm ${tab === "all" ? "bg-ink text-paper" : "text-ink/60 hover:bg-muted"}`}>
              Tutte
            </button>
          </div>
          <button onClick={markAllRead} className="text-[10px] uppercase tracking-wider text-primary hover:underline">
            <Check className="w-3 h-3 inline mr-1" />
            Segna tutte
          </button>
        </div>
        {pushAvailableHere() && pushStatus !== "denied" && (
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-ink/70">
              <Smartphone className="w-3.5 h-3.5" />
              {pushStatus === "subscribed"
                ? "Push attive su questo dispositivo"
                : "Ricevi notifiche anche ad app chiusa"}
            </div>
            <button
              onClick={togglePush}
              disabled={pushBusy}
              className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-sm bg-ink text-paper hover:bg-ink/80 disabled:opacity-50"
            >
              {pushStatus === "subscribed" ? "Disattiva" : "Attiva"}
            </button>
          </div>
        )}
        {pushStatus === "denied" && (
          <div className="px-3 py-2 border-b bg-destructive/10 text-[10px] text-destructive">
            Notifiche bloccate dal browser. Sbloccale dalle impostazioni del sito.
          </div>
        )}
        <div className="overflow-y-auto flex-1">
          {list.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
              Nessuna notifica
            </div>
          ) : list.map((n) => (
            <div
              key={n.id}
              className={`px-3 py-2.5 border-b flex items-start gap-2 hover:bg-muted/40 cursor-pointer ${
                n.is_urgent && !n.read_at ? "border-l-4 border-l-destructive animate-pulse" : ""
              } ${!n.read_at ? "bg-primary/5" : ""}`}
              onClick={() => {
                if (!n.read_at) markRead(n.id);
                if (n.link) { navigate(n.link); setOpen(false); }
                else if (n.order_id) { navigate(`/produzione/board?order=${n.order_id}`); setOpen(false); }
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] leading-snug text-ink">{n.message}</div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: it })}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                className="text-ink/40 hover:text-ink shrink-0"
                title="Segna come letta"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};