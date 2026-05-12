
## Obiettivo

Far sì che **ogni operazione**, da qualsiasi PC e browser, venga salvata sul cloud e ritrovata uguale altrove. Oggi solo Contabilità, ordini di produzione, draft progettazione e cataloghi sono sul cloud. Il resto vive solo nel browser locale.

## Cosa migro sul cloud

| Sezione | Oggi | Dopo |
|---|---|---|
| Calcolatore / preventivo (`officina:state`) | localStorage | Cloud per utente, realtime |
| Montaggi — progetti | localStorage | Cloud per utente, realtime |
| Falegnameria — progetti | localStorage | Cloud per utente, realtime |
| Contabilità | Cloud (debounce ~2 s) | Cloud (debounce 500 ms + flush su `beforeunload`) |
| Cataloghi materiali/lavorazioni | Cloud | invariato |
| Ordini produzione, draft, file | Cloud | invariato |

I dati esistenti nel browser vengono migrati automaticamente al cloud al primo accesso (se il cloud per quell'utente è vuoto), così non perdi nulla.

## Modifiche tecniche

1. **Nuova tabella `user_workspaces`** (1 sola tabella per tutti gli stati per-utente):
   - `user_id uuid` + `key text` + `data jsonb` + `updated_at`
   - Chiave primaria composta `(user_id, key)`
   - Chiavi previste: `calculator_state`, `montaggi_project`, `falegnameria_project`, `ui_prefs`
   - RLS: ogni utente legge/scrive solo le proprie righe
   - Realtime abilitato

2. **Hook condiviso `useCloudWorkspace<T>(key, defaultValue)`** in `src/hooks/`:
   - Carica dal cloud al mount, fallback localStorage se cloud vuoto + migrazione
   - Salva con debounce 500 ms
   - Flush sincrono su `visibilitychange` e `beforeunload` (così chiudere la finestra non perde dati)
   - Sottoscrive realtime alla riga `(uid, key)` per propagare modifiche da altri PC

3. **Refactor Calcolatore (`src/pages/Index.tsx`)**: stato `officina:state` letto/scritto via `useCloudWorkspace("calculator_state")`. Migrazione automatica del localStorage esistente.

4. **Refactor Montaggi e Falegnameria**: stesso pattern con chiavi `montaggi_project` e `falegnameria_project`.

5. **Contabilità (`src/pages/Contabilita.tsx`)**:
   - Debounce ridotto da `REMOTE_SAVE_DEBOUNCE_MS` attuale a 500 ms
   - Aggiungo flush sincrono su `beforeunload` con `navigator.sendBeacon` (o fetch keepalive) verso una mini edge function di upsert, in modo che chiudere la pagina non perda l'ultimo modifico
   - Indicatore "Non salvato" già presente in alto a destra; resta rosso fino a successo

6. **Banner globale "Modifiche non sincronizzate"**: se un salvataggio cloud fallisce o c'è cambio offline, mostro un banner persistente in cima all'app finché non torna verde, così non si chiude la finestra per sbaglio.

## Cosa NON cambia

- Permessi utenti, RLS già esistenti su Contabilità ecc.
- Ordini di produzione, cataloghi, file, marketing: già sul cloud, restano com'è.
- I dati nei browser dei vari PC restano: alla prima apertura dopo il rilascio, vengono caricati e mandati sul cloud (con regola: se il cloud ha già qualcosa per quell'utente, vince il cloud; altrimenti vince il locale e viene migrato).

## Stima

3 step di migrazione/refactor + 1 migrazione SQL (`user_workspaces`). Nessun dato esistente viene perso.
