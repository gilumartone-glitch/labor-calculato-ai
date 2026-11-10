import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useProdStore } from "@/lib/produzione/store";
import { coalesced } from "@/lib/coalesce";
import { pushAvailableHere, subscribePush } from "@/lib/push";
import { safeNotificationPath } from "../../supabase/functions/_shared/push-rules";
import { toast } from "sonner";

// One authenticated listener for every page; push remains responsible for closed browsers.
export function NotificationDelivery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const refresh = useProdStore(s => s.refreshNotifications);
  useEffect(() => {
    if (!user) { useProdStore.setState({ notifications: [] }); return; }
    let cancelled = false;
    const seen = new Set<string>();
    const started = Date.now();
    const show = (n: { id: string; message: string; link?: string | null; order_id?: string | null; created_at: string }) => {
      if (cancelled || seen.has(n.id) || new Date(n.created_at).getTime() < started) return;
      seen.add(n.id);
      const url = safeNotificationPath(n.link || (n.order_id ? `/produzione/board?order=${n.order_id}` : "/hub"));
      toast(n.message, { id: n.id, duration: 10000, action: { label: "Apri", onClick: () => navigate(url) } });
      // Electron's file:// fallback has no web push; its open window can still show OS alerts.
      if (window.electronAPI?.isElectron && "Notification" in window && Notification.permission === "granted") {
        const note = new Notification("Tecnofra Flow", { body: n.message, tag: n.id });
        note.onclick = () => { window.focus(); navigate(url); };
      }
    };
    const reload = coalesced(async () => {
      await refresh(user.id);
      if (!cancelled) useProdStore.getState().notifications.forEach(show);
    }, 800);
    void refresh(user.id);
    // Existing consent is reused without showing a permission prompt.
    if (pushAvailableHere() && Notification.permission === "granted") {
      void subscribePush(user.id).catch(() => { /* The bell exposes retry and test controls. */ });
    }
    const channel = supabase.channel(`notification-delivery-${user.id}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "prod_notifications", filter: `user_id=eq.${user.id}` }, payload => {
        const n = payload.new as Parameters<typeof show>[0];
        show(n);
        reload();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "prod_notifications", filter: `user_id=eq.${user.id}` }, reload)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "prod_notifications", filter: `user_id=eq.${user.id}` }, reload)
      .subscribe();
    const timer = window.setInterval(() => { if (!document.hidden) reload(); }, 60000);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; reload.cancel(); clearInterval(timer); window.removeEventListener("focus", onFocus); void supabase.removeChannel(channel); };
  }, [user?.id, refresh, navigate]);
  return null;
}