## Cosa cambia

### 1. Nuova pagina "Montaggi" nell'Hub
- Aggiungo un nuovo tile **Montaggi** nella `Hub.tsx` (riquadro colorato dedicato), che porta a `/montaggi-pianificazione`.
- Creo la pagina `src/pages/MontaggiPianificazione.tsx`: header coerente con le altre pagine + `PianificazioneSection` in modalità **panoramica globale** (tutti gli operai × tutti i cantieri).
- Aggiungo la rotta in `App.tsx`, protetta da `RouteGuard page="montaggi"`.

### 2. Operai di default dall'Archivio squadre
- Quando l'anagrafica operai globale è vuota al primo caricamento, viene **seedata automaticamente** leggendo tutti gli "Archivi squadre e montatori" presenti nei progetti Montaggi salvati in locale (`officina:montaggi-module:v2:*`) — vengono presi i nomi unici, mantenendo l'eventuale ruolo.
- Aggiungo un pulsante **"Importa da Archivio squadre"** sempre visibile, che esegue lo stesso merge al volo (utile quando aggiungi un nuovo montatore in un progetto e lo vuoi ribaltare nella panoramica).
- Resta la possibilità di aggiungere/rimuovere/rinominare operai liberamente, anche un solo nominativo per un singolo progetto.

### 3. Cleanup del modulo Montaggi
- Dentro Montaggi (`/preventivi?tab=montaggi`) la sezione "Pianificazione" mostra solo la vista **del singolo progetto** (con avviso conflitti su altri cantieri). La toggle "Panoramica" lì viene rimossa: per la vista globale si va dal nuovo tile Hub.

### Dettagli tecnici

- `PianificazioneSection` riceve un nuovo prop `mode: "project" | "global"`:
  - `project` (default attuale embed Montaggi): solo calendario settimanale del cantiere corrente con highlight conflitti, niente toggle.
  - `global` (nuova pagina): mostra tutti i cantieri allo stesso peso, niente highlight "altro cantiere", consente di filtrare/cercare cantiere.
- Seed operai: hook esegue una scansione di `localStorage` la prima volta che `ops.state.length === 0` dopo `ready`. Lo stato è condiviso via `useSharedCloudState` su `catalogs.dept = "montaggi:operai:v1"`, quindi tutti gli utenti vedono lo stesso elenco.
- Nessuna migrazione DB: la tabella `montaggi_planning` esiste già.
