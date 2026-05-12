# Distribuzione Workprice Buddy agli utenti

## Setup iniziale (una sola volta, sul TUO PC)

1. **Installa Node.js** (https://nodejs.org) e **Git** (https://git-scm.com).
2. **Crea un GitHub Personal Access Token**:
   - https://github.com/settings/tokens → "Generate new token (classic)"
   - Scope: spunta **`repo`** (intero blocco).
   - Copia il token (appare una volta sola).
3. **Imposta la variabile d'ambiente `GH_TOKEN`** in Windows:
   - Cerca "Variabili d'ambiente" → "Modifica le variabili d'ambiente per il tuo account"
   - Nuova → Nome: `GH_TOKEN` — Valore: il token incollato
   - Chiudi e riapri il prompt / il bat.

## Pubblicare un aggiornamento

1. Ogni volta che vuoi rilasciare una nuova versione, **alza il numero di versione** in `package.json` (es. `1.0.0` → `1.0.1`).
2. Fai commit/push (anche da Lovable va bene).
3. Doppio click su `aggiorna.bat`.
   - Scarica le modifiche, compila, genera l'installer `.exe` e lo carica su GitHub Releases come **draft**.
4. Vai su https://github.com/gilumartone-glitch/workprice-buddy-new/releases
   - Trovi una release in stato **Draft** con dentro `WorkpriceBuddy Setup X.Y.Z.exe` e `latest.yml`.
   - Clicca **Edit** → **Publish release**.

## Cosa ricevono gli utenti

- **Prima volta**: gli mandi il file `WorkpriceBuddy Setup 1.0.0.exe` (lo trovi in `electron-release/`). Doppio click → installa con icona sul desktop e nel menu Start. Niente Node/git richiesti.
- **Aggiornamenti successivi**: appena apri l'app, controlla GitHub Releases e mostra "Aggiornamento disponibile". Lo scarica in background e chiede conferma per riavviare. Tutto automatico.

## Note importanti

- La release su GitHub deve essere **pubblicata** (non draft), altrimenti gli utenti non la vedono.
- Se il repo è **privato**, gli utenti devono essere autenticati con GitHub per scaricare gli update → conviene tenerlo **pubblico** o passare a un server di update privato.
- La versione in `package.json` deve sempre **aumentare** (semver: 1.0.0 → 1.0.1 → 1.0.2 …).
