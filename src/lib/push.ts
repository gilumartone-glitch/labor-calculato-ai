import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY =
  "BIjyeNqduxsxgwWlwMzPeYXFGKPXt0t3dmsibRxXHPKQ8CpclyboSps_HyXiADirP-FGaeIJ19--9mqmxzofLnw";

const isPreviewHost = () =>
  typeof window !== "undefined" &&
  (window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com"));

const inIframe = () => {
  try { return window.self !== window.top; } catch { return true; }
};

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const pushAvailableHere = () =>
  pushSupported() && !isPreviewHost() && !inIframe();

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushAvailableHere()) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn("[push] sw register failed", e);
    return null;
  }
}

export async function getNotificationStatus(): Promise<
  "unsupported" | "denied" | "default" | "subscribed" | "granted-not-subscribed"
> {
  if (!pushAvailableHere()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "granted-not-subscribed";
}

export async function subscribePush(userId: string) {
  if (!pushAvailableHere()) throw new Error("Push non supportate qui");
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permesso negato");

  const reg = await ensureServiceWorker();
  if (!reg) throw new Error("Impossibile attivare le notifiche su questo dispositivo");
  const { data: configuration, error: configurationError } = await supabase.functions.invoke("send-push", { body: { action: "public-key" } });
  if (configurationError || !configuration?.publicKey) throw new Error("Configurazione notifiche non disponibile");
  const publicKey = urlBase64ToUint8Array(configuration.publicKey);
  let sub = await reg.pushManager.getSubscription();
  const existingKey = sub?.options.applicationServerKey;
  if (sub && existingKey && (new Uint8Array(existingKey).length !== publicKey.length || new Uint8Array(existingKey).some((v, i) => v !== publicKey[i]))) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
  }
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys.auth) throw new Error("Registrazione dispositivo incompleta");
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error("Il dispositivo non è stato registrato: riprova ad attivare le notifiche");
  return true;
}

export async function unsubscribePush() {
  if (!pushAvailableHere()) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    if (error) throw new Error("Impossibile disattivare le notifiche: riprova");
    await sub.unsubscribe();
  }
}