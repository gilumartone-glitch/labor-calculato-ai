import { createRoot } from "react-dom/client";
import "./index.css";

const rootEl = document.getElementById("root");

// Service worker per push notifications + auto-navigate al click
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const isPreview =
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com");
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }
  if (isPreview || inIframe) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  } else {
    navigator.serviceWorker.addEventListener("message", (e) => {
      const url = (e.data && e.data.url) as string | undefined;
      if (e.data?.type === "navigate" && url) {
        try { history.pushState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate")); }
        catch { window.location.href = url; }
      }
    });
  }
}

const escapeHtml = (value: unknown) =>
  String(value).replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] ?? char));

const showStartupError = (title: string, detail: unknown) => {
  if (!rootEl) return;
  rootEl.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#f4f7f8;color:#172026;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box;">
      <section style="max-width:900px;width:100%;background:white;border:2px solid #172026;padding:28px;box-sizing:border-box;">
        <h1 style="margin:0 0 12px;font-size:24px;">${escapeHtml(title)}</h1>
        <pre style="white-space:pre-wrap;background:#eef2f3;border:1px solid #cbd5d8;padding:16px;overflow:auto;max-height:60vh;">${escapeHtml(detail)}</pre>
      </section>
    </main>`;
};

if (!rootEl) {
  throw new Error("Elemento #root non trovato");
}

const env = import.meta.env as Record<string, string | undefined>;
const missingEnv = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PROJECT_ID"].filter(
  (key) => !env[key],
);

if (missingEnv.length > 0) {
  showStartupError(
    "Configurazione desktop mancante",
    `Mancano queste variabili di build:\n${missingEnv.join("\n")}\n\nRilancia aggiorna.bat aggiornato: ora crea automaticamente la configurazione locale prima della compilazione.`,
  );
} else {
  import("./App.tsx")
    .then(({ default: App }) => {
      createRoot(rootEl).render(<App />);
    })
    .catch((error) => {
      showStartupError("Errore avvio applicazione", error?.stack || error?.message || error);
    });
}
