# Dipendenti — nuova sezione Hub

## Cosa cambia per te

- Nell'**Hub** appare una nuova card **Dipendenti** accanto a Magazzino/Marketing/ecc.
- Dentro trovi l'elenco di tutti i dipendenti dell'officina. Per ognuno:
  - **Nome** e **Funzione** (es. "Capo squadra", "Tappezziere", "Operatore CNC")
  - **Macroreparti** di appartenenza (Laboratorio / Tappezzeria / Montaggi — uno o più)
  - **Reparti / settori** specifici (Stampa, Taglio, Cucito, Montaggio tende…)
  - **Costo orario** e parametri INPS/INAIL/TFR/Ore annue (come prima nell'archivio squadre)
  - **Profilo utente collegato** (opzionale, se il dipendente ha un login nell'app)
- Il tab **Lavoratori** dentro Montaggi e Falegnameria viene **rimosso**: la gestione costi/anagrafica si fa solo dall'Hub.
- Nei preventivi (Montaggi/Falegnameria) il selettore "Squadra montaggio e ore" pesca direttamente dai dipendenti.
- Nella **Lavorazione guidata** (Flow / lancio in Produzione), quando scegli un macroreparto e un microreparto, il selettore Responsabile e Operatori mostra **solo i dipendenti che appartengono a quel reparto** (oggi filtra solo per profili utente, da ora anche per dipendenti).

## Dettagli tecnici

### Database

Nuova tabella `public.dipendenti`:

- `id`, `created_at`, `updated_at`, `created_by`
- `nome` text NOT NULL, `funzione` text
- `email` text, `telefono` text
- `macro_reparti` text[] DEFAULT '{}' (valori: `laboratorio` | `tappezzeria` | `montaggi`)
- `reparti` text[] DEFAULT '{}' (stessi valori di `profiles.settori`)
- `profile_id` uuid NULL (link opzionale a `profiles.id`)
- `hourly_rate` numeric, `ral` numeric, `inps_pct` numeric DEFAULT 30, `inail_pct` numeric DEFAULT 3, `tfr_pct` numeric DEFAULT 8.33, `extra_costs` numeric DEFAULT 0, `annual_hours` numeric DEFAULT 1720
- `attivo` boolean DEFAULT true
- `note` text

GRANT su `authenticated` + `service_role`. RLS:
- SELECT: tutti gli autenticati
- INSERT/UPDATE/DELETE: admin OR `has_permission(auth.uid(),'flow','write')`

Migrazione one-shot: seed iniziale dei dipendenti già presenti come "workers" nell'archivio condiviso non possibile da SQL (dati in localStorage). Resta come operazione manuale nell'UI; gli archivi locali esistenti restano visibili finché non vengono ricreati nell'Hub.

### Frontend

1. **`src/pages/Dipendenti.tsx`** (nuova) — tabella editabile con: nome, funzione, macroreparti (chip multi), reparti (chip multi filtrati per macro), costi, profilo collegato (select dai `profiles`). Aggiunta voce di menu `dipendenti` in `app_pages` (key=`dipendenti`, label=`Dipendenti`).
2. **`src/components/HubLink.tsx`** / Hub home — nuova card "Dipendenti".
3. **`src/App.tsx`** — route `/dipendenti` con `RouteGuard` (richiede `has_permission('dipendenti','read')`).
4. **`src/components/shared/LavorazioneGuidedForm.tsx`** — l'elenco utenti `users` viene ora costruito unendo `profiles` (settori) + `dipendenti` (reparti + macro). Il filtro per macro/reparto continua a funzionare. La selezione di un dipendente non legato a un profilo memorizza l'`id` del dipendente (prefisso `dip:` per distinguere) — il backend già accetta uuid; aggiungiamo una mappa di display name lato UI.
5. **`src/pages/Montaggi.tsx`** e **`src/pages/Falegnameria.tsx`**:
   - rimuovo il tab "Lavoratori" e la `WorkersSection`
   - rimuovo l'archivio condiviso locale dei workers (resta solo per retrocompatibilità di lettura)
   - sostituisco `project.workers` con un fetch async dei dipendenti del reparto (filtrati per `falegnameria` o `montaggi` su `macro_reparti`/`reparti`)
   - il selettore "Squadra montaggio e ore" elenca direttamente i dipendenti

### Open questions risolte
- Macroreparti: array (più di uno per dipendente).
- Sorgente: tabella nuova + link opzionale al profilo utente.
- Vecchio tab Lavoratori: rimosso da Montaggi/Falegnameria.

### Out of scope
- Migrazione automatica dei worker locali nel cloud (richiede un'azione "Importa da archivio" che possiamo aggiungere dopo se serve).
- Storico costi nel tempo (versioning su `hourly_rate`).
- Foto / documenti del dipendente.

Approva per procedere con la migration e l'implementazione.
