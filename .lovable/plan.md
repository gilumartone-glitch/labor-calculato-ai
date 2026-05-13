## 4 interventi su Flow / Produzione

### 1. Operatore per ogni lavorazione
**DB**: aggiungo colonna `assignee_id uuid` su `production_sub_orders` (+ index).

**LaunchOrderDialog** (`src/components/produzione/LaunchOrderDialog.tsx`):
- Per ogni reparto della sequenza, accanto alla nota, un Select operatore (filtrato su utenti che hanno il `settore` corrispondente al reparto, dal `useProdStore.profiles`).
- Salvo `assignee_id` sul sub_order corrispondente.
- Notifica push diretta all'operatore scelto (oltre alle notifiche generiche).

**SubOrderDetailDialog** / `CompleteSubDialog` (`src/components/produzione/CompleteSubDialog.tsx`):
- Quando completo un sub e c'è un successore, chiedo / mostro un Select operatore per il prossimo reparto (default = `assignee_id` già salvato se presente).
- Aggiorno `assignee_id` del successore e mando notifica push mirata.

### 2. "Solo materiale" per riga in CreateCommessaButton
**`src/components/calculator/CreateCommessaButton.tsx`**:
- Nel dialog mostro l'elenco dei reparti inferiti dallo snapshot (`inferProdDeptsFromSnapshot`) prima di lanciare; per ognuno c'è una checkbox "solo materiale".
- I reparti marcati "solo materiale" NON generano un `production_sub_order` di lavorazione, ma vengono comunque considerati per il magazzino (stesso effetto della spunta globale, solo per quel reparto).
- La spunta globale "Senza lavorazione" resta come scorciatoia (= tutte le righe spuntate).

### 3. Persistenza form in entrambi i dialog
- `CreateCommessaButton`: hook `useLocalStorageState("calc:create-commessa", {…})` per `cliente, prodName, importo, reparto, priorita, scadenza, note, warehouseOnly, perDeptOnlyMaterial`. Cancello al submit riuscito.
- `LaunchOrderDialog`: stesso pattern con chiave `"prod:launch-order"` per `cliente, data, note, depts, deptNotes, deptAssignees, nesting, priorita, delivery, warehouseOnly, magazzinoNote, perDeptOnlyMaterial`. Allegati restano in stato (sono già in storage).
- Creo helper `src/hooks/useLocalStorageState.ts`.

### 4. Nesting in produzione = nesting del preventivo
- Aggiungo nello snapshot del calcolatore il campo `nestingState` con `{ overridesByGroup, mixedBinsByGroup }` (già stato locale di `NestingPanel`).
- Lifting: `MagazzinoCalc` (e altri pages che usano NestingPanel) tengono `nestingState` come state e lo passano a `NestingPanel` (controlled) e lo includono nello snapshot quando creano la commessa.
- `SubOrderDetailDialog`: il `mergedNesting` usa `nestingState` salvato per ricostruire i gruppi via `recomputeGroupWithOverride` / `recomputeGroupWithMixedBins` invece di `computeNesting` puro.
- Se `nestingState` non c'è (vecchi ordini), fallback al calcolo attuale.

## Note tecniche
- Migration richiesta solo per (1).
- Le RLS non cambiano: `production_sub_orders` policy `psub_cud_assigned_or_coordinator` continua a valere.
- I form salvati in localStorage usano `JSON.stringify` con namespace per utente non necessario (sono dispositivo-locali).
