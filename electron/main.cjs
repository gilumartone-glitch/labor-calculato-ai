const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// Su alcuni PC Windows Chromium/Electron apre una finestra bianca per problemi GPU.
// Disattiviamo l'accelerazione prima che Electron sia pronto: non cambia le funzioni dell'app.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

const APP_VERSION = app.getVersion();

const isDev = !!process.env.ELECTRON_START_URL;

function showStartupError(win, title, message) {
  const html = `<!doctype html>
  <html lang="it">
    <head>
      <meta charset="UTF-8" />
      <style>
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #f4f7f8; color: #172026; }
        main { max-width: 760px; padding: 32px; border: 2px solid #172026; background: white; }
        h1 { margin: 0 0 12px; font-size: 24px; }
        pre { white-space: pre-wrap; background: #eef2f3; padding: 16px; border: 1px solid #cbd5d8; }
      </style>
    </head>
    <body><main><h1>${title}</h1><pre>${message}</pre></main></body>
  </html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Tecnofra Lab",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#f4f7f8",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Avvia massimizzata a schermo intero
  win.maximize();
  win.once("ready-to-show", () => win.show());

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    if (!fs.existsSync(indexPath)) {
      showStartupError(
        win,
        "Applicativo non trovato",
        `Manca il file compilato:\n${indexPath}\n\nRilancia aggiorna.bat e verifica che npm run build finisca senza errori prima di installare l'exe.`
      );
    } else {
      win.loadFile(indexPath, { hash: "/hub" }).catch((err) => {
        showStartupError(win, "Errore apertura applicativo", String(err));
      });
    }
  }

  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      try {
        const state = await win.webContents.executeJavaScript(`({
          title: document.title,
          url: location.href,
          bodyText: document.body?.innerText?.trim() || "",
          rootHtmlLength: document.getElementById("root")?.innerHTML?.length || 0
        })`);
        if (!state.bodyText && state.rootHtmlLength === 0) {
          showStartupError(
            win,
            "Applicazione caricata ma schermata vuota",
            `URL: ${state.url}\nTitolo: ${state.title}\n\nIl file index.html esiste, ma React non ha disegnato contenuti. Rilancia aggiorna.bat: questa versione include routing desktop e GPU fix.`
          );
        }
      } catch (err) {
        console.error("blank check failed:", err);
      }
    }, 5000);
  });

  // DevTools disponibili solo in sviluppo o con env DEBUG_DEVTOOLS=1.
  if (isDev || process.env.DEBUG_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
    dialog.showErrorBox(
      "Errore caricamento app",
      `Codice: ${code}\nDescrizione: ${desc}\nURL: ${url}`
    );
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("render-process-gone", details);
    dialog.showErrorBox("Render crash", JSON.stringify(details));
  });

  // Apri link esterni nel browser di sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Controllo aggiornamenti automatico dopo 3s
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (!isDev && app.isPackaged) {
        autoUpdater.checkForUpdates().catch((e) => console.error("auto check failed:", e));
      }
    }, 3000);
  });

  return win;
}

// === electron-updater eventi ===
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

let manualCheck = false;

function getMainWindow() {
  return BrowserWindow.getAllWindows()[0];
}

autoUpdater.on("update-available", (info) => {
  const win = getMainWindow();
  if (win) {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Aggiornamento disponibile",
      message: `Nuova versione ${info.version} disponibile`,
      detail: "Sto scaricando l'aggiornamento in background. Ti avviser\u00f2 quando sar\u00e0 pronto da installare.",
    });
  }
});

autoUpdater.on("update-not-available", () => {
  if (manualCheck) {
    const win = getMainWindow();
    if (win) {
      dialog.showMessageBox(win, {
        type: "info",
        title: "Aggiornamenti",
        message: "L'app \u00e8 aggiornata.",
        detail: `Versione installata: ${APP_VERSION}`,
      });
    }
    manualCheck = false;
  }
});

autoUpdater.on("error", async (err) => {
  console.error("autoUpdater error:", err);
  if (manualCheck) {
    const win = getMainWindow();
    if (win) {
      const choice = await dialog.showMessageBox(win, {
        type: "error",
        title: "Errore aggiornamento",
        message: "Impossibile controllare/scaricare gli aggiornamenti",
        detail:
          String(err) +
          "\n\nPuoi scaricare manualmente l'ultima versione dalla pagina GitHub Releases.",
        buttons: ["Apri pagina download", "Chiudi"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) {
        shell.openExternal(
          "https://github.com/gilumartone-glitch/workprice-buddy-new/releases/latest"
        );
      }
    }
    manualCheck = false;
  }
});

autoUpdater.on("download-progress", (p) => {
  const win = getMainWindow();
  if (win) win.setProgressBar(p.percent / 100);
});

autoUpdater.on("update-downloaded", async (info) => {
  const win = getMainWindow();
  if (win) win.setProgressBar(-1);
  const choice = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Riavvia e installa", "Pi\u00f9 tardi"],
    defaultId: 0,
    cancelId: 1,
    title: "Aggiornamento pronto",
    message: `La versione ${info.version} \u00e8 pronta da installare`,
    detail: "L'app si chiuder\u00e0, installer\u00e0 l'aggiornamento e si riavvier\u00e0 automaticamente.",
  });
  if (choice.response === 0) {
    setImmediate(() => autoUpdater.quitAndInstall());
  }
});

// IPC: chiamato dal renderer (pulsante "Controlla aggiornamenti")
ipcMain.handle("check-for-updates", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!app.isPackaged) {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Aggiornamenti",
      message: "Auto-update disponibile solo nella versione installata.",
      detail: `Versione corrente: ${APP_VERSION}`,
    });
    return;
  }
  manualCheck = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error("manual check failed:", err);
  }
});

ipcMain.handle("get-app-version", () => APP_VERSION);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});