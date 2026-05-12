const { contextBridge, ipcRenderer } = require("electron");

function showRendererError(title, detail) {
  const render = () => {
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;background:#f4f7f8;color:#172026;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box;">
        <section style="max-width:900px;width:100%;background:white;border:2px solid #172026;padding:28px;box-sizing:border-box;">
          <h1 style="margin:0 0 12px;font-size:24px;">${title}</h1>
          <pre style="white-space:pre-wrap;background:#eef2f3;border:1px solid #cbd5d8;padding:16px;overflow:auto;max-height:60vh;">${String(detail).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre>
        </section>
      </main>`;
  };
  if (document.body) render();
  else window.addEventListener("DOMContentLoaded", render, { once: true });
}

window.addEventListener("error", (event) => {
  showRendererError("Errore JavaScript nell'app", event.error?.stack || event.message || "Errore sconosciuto");
});

window.addEventListener("unhandledrejection", (event) => {
  showRendererError("Errore asincrono nell'app", event.reason?.stack || event.reason || "Promise rejection sconosciuta");
});

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
});
