
# Piano fix Contabilità

Tutti i lavori restano in `src/pages/Contabilita.tsx` (e suoi sotto-componenti). Nessuna modifica al backend.

## 1. "Pagato" che torna in Competenze + salvataggi persi

Causa: il loop di salvataggio re-invia tutto lo state via `JSON.stringify(state)` con debounce 500 ms; nel frattempo arriva un evento realtime che ri-merge lo stato prima che il salvataggio sia confermato, e la spunta torna indietro. C'è anche una finestra dove `localActive` è scaduto e il merge fa vincere il remoto.

Fix:
- Quando l'utente fa una modifica, "blocco" finestra di edit più lunga (5 s anziché istantanea) e durante questa finestra **ignoro** del tutto i payload realtime che hanno `updated_at < ultimo save tentato localmente`.
- Il toggle "pagato" (icona spunta nella riga) ora applica la modifica con `setState` funzionale (`setState(s => ...)`) invece di leggere `movements` dalla closure, così non si sovrascrive mai uno state più nuovo.
- Flush sincrono su `beforeunload`/`visibilitychange` con `keepalive` fetch verso `contabilita_state` upsert (oggi manca → chiudere la finestra perde l'ultima modifica).
- Indicatore "Salvataggio…" già esistente in alto: aggiungo conteggio retry e banner rosso persistente se 2 tentativi falliscono di fila.

## 2. Box che si freezano

Causa principale: ogni keystroke su un input dentro `MonthSection` rifà il `JSON.stringify` di tutto lo state (anche 500 KB) nell'effetto di save, e re-renderizza tutto l'albero perché `setMovements` ricrea l'array. Su Electron desktop questo cumula.

Fix:
- Sostituisco gli handler di tipo `setMovements(movements.map(...))` con `setMovements(prev => prev.map(...))` su tutti i punti caldi (riga, ricerca, gruppi).
- Memoizzo `MonthSection` con `React.memo` + `useCallback` per `setMovements`, così digitare nel mese A non re-renderizza il mese B.
- Sposto la serializzazione del save in `requestIdleCallback` (fallback `setTimeout 0`) così non blocca il main thread durante la digitazione.

## 3. Ricerca "mese per mese" che non lascia scrivere

Stessa causa del #2: il `<SearchBar>` è ricreato ad ogni render del `MonthSection`. Inoltre l'autoFocus che potrebbe avere lo perde. Fix con la memoizzazione del punto 2 + verifico che l'input usi state locale del componente (già lo fa) e che non abbia `key` che cambia.

## 4. Ordinamento per Data / Nome / Importo nei mesi

Aggiungo nella `CardHeader` di `MonthSection` un piccolo selettore (`<select>` minimal) con: Data ↓ (default), Data ↑, Nome A→Z, Nome Z→A, Importo ↓, Importo ↑. La preferenza si salva in `localStorage` `officina:contabilita:sortBy`. L'ordinamento si applica all'interno di ognuna delle 4 colonne (Cassa entrate/uscite, Competenza entrate/uscite).

## 5. Rinominare un gruppo unito

Oggi nel dialog di un gruppo (più voci con stesso nome) il titolo è solo testo. Aggiungo:
- Icona "matita" accanto al titolo del dialog del gruppo.
- Cliccandola: input → su Salva, applico il nuovo `description` a **tutte** le voci del gruppo (`setMovements(prev => prev.map(m => groupIds.has(m.id) ? { ...m, description: newName } : m))`).

## 6. Date a step (giorno → mese → anno → OK)

Sostituisco l'input data dentro le schede movimento con un componente `<StepDateInput>`:
- 3 campi `<input>` separati gg / mm / aaaa, ognuno auto-avanza al successivo quando completo (gg ≥ 4 o 2 cifre, idem mm).
- Conferma solo con tasto OK / Invio / F10 (vedi #7) — non emette `onChange` parziali per evitare salvataggi su date incomplete.
- Validazione minima (gg 1-31, mm 1-12, anno ≥ 2000).
- Riutilizzato in: wizard nuovo movimento, dialog modifica movimento, date stipendi.

## 7. F10 nelle schede = conferma + chiudi

Il wizard nuovo movimento ha già F10 (riga 1418). Estendo la stessa scorciatoia a:
- Dialog "Modifica movimento" (riga ~1230): F10 → salva e chiude.
- Dialog "Gruppo unito" (#5): F10 → OK chiude.
- Dialog stipendi mensili: F10 → chiude.

Implemento un piccolo hook `useConfirmShortcut(onConfirm, enabled)` da riusare.

## File toccati

- `src/pages/Contabilita.tsx` (le 7 modifiche)
- nuovo `src/components/contabilita/StepDateInput.tsx`
- nuovo `src/hooks/useConfirmShortcut.ts`

## Ordine di esecuzione

1. Fix #1 e #2 (blocchi più gravi)
2. Fix #3 (cade da #2)
3. Hook F10 + StepDateInput (componenti riusabili)
4. Fix #4 ordinamento
5. Fix #5 rinomina gruppo
6. Fix #6 date a step + #7 F10 nelle altre schede

## Verifica

- Dopo ogni fix controllo build pulita.
- Test manuale del flusso "spunta pagato → ricarico → resta pagato" tramite query SQL diretta sulla tabella `contabilita_state` per confermare la persistenza.
