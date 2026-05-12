# App Desktop (Electron)

Il progetto è configurato per essere pacchettizzato come app desktop nativa per **Windows, macOS e Linux** tramite Electron.

## 1. Esporta su GitHub e clona in locale

1. In Lovable, clicca **GitHub → Export to GitHub**.
2. Clona il repository sul tuo computer:
   ```bash
   git clone <url-del-tuo-repo>
   cd <nome-progetto>
   ```

## 2. Installa le dipendenze

```bash
npm install
npm install --save-dev electron @electron/packager
```

## 3. Provala in locale (modalità sviluppo)

In due terminali separati:

```bash
# Terminale 1 — avvia Vite
npm run dev

# Terminale 2 — avvia Electron puntando al dev server
npm run electron:dev
```

Si aprirà una finestra desktop con l'app dentro.

## 4. Crea l'eseguibile distribuibile

### Windows (.exe)
Da un PC Windows (o Linux con wine):
```bash
npm run build
npx electron-packager . "WorkpriceBuddy" --platform=win32 --arch=x64 --out=electron-release --overwrite --ignore="^/src" --ignore="^/public" --ignore="^/electron-release" --ignore="^/supabase"
```
Output: `electron-release/WorkpriceBuddy-win32-x64/WorkpriceBuddy.exe`

### macOS (.app)
Da un Mac:
```bash
npm run build
npx electron-packager . "WorkpriceBuddy" --platform=darwin --arch=universal --out=electron-release --overwrite --ignore="^/src" --ignore="^/public" --ignore="^/electron-release" --ignore="^/supabase"
```
Output: `electron-release/WorkpriceBuddy-darwin-universal/WorkpriceBuddy.app`

### Linux
```bash
npm run electron:build
```
Output: `electron-release/WorkpriceBuddy-linux-x64/WorkpriceBuddy`

## 5. Distribuzione agli operatori

- **Windows**: zippa la cartella `WorkpriceBuddy-win32-x64` e mandala. Si avvia con doppio click su `WorkpriceBuddy.exe`, nessuna installazione necessaria.
- **macOS**: zippa il file `WorkpriceBuddy.app` e mandalo. Doppio click per avviare.
- **Linux**: idem con il binario.

## Note

- L'app desktop carica gli **stessi dati live** dal cloud (autosave + multi-utente continuano a funzionare identici al browser).
- Ad ogni aggiornamento importante dell'app va rifatto il build e ridistribuito il pacchetto.
- I link esterni si aprono nel browser di sistema, non dentro la finestra Electron.