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

  const reg = (await ensureServiceWorker())!;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  return true;
}

export async function unsubscribePush() {
  if (!pushAvailableHere()) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}