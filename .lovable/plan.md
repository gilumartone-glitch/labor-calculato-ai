## Obiettivo
Trasformare la sezione Montaggi in uno strumento di pianificazione risorse:
- **Calendario globale** con vista a griglia (operai × giorni e cantieri × giorni, con toggle) per vedere a colpo d'occhio sovraccarichi e tempi morti.
- **Dentro a ogni progetto**: due tab — "Progetto" (preventivo/stima attuale) e "Assegnazione" (pianificazione reale del lavoro).
- **Catalogo cloud** di attrezzi e materiali, riutilizzabile.
- Pulsante **Riprendi da progetto** in Assegnazione che precompila lavoratori, date e attrezzi/materiali.

## 1. Database (Lovable Cloud)

Nuove tabelle:
- `montaggi_attrezzi` — `id, nome, categoria, descrizione, unita, note, created_by, created_at, updated_at`
- `montaggi_materiali` — `id, nome, categoria, unita, descrizione, note, created_by, created_at, updated_at`
- `montaggi_assignment_items` — riga per ogni attrezzo/materiale assegnato a un progetto/cantiere: `id, commessa_id, kind ('attrezzo'|'materiale'), ref_id, qty, note, created_by, ts`

RLS: lettura per utenti autenticati con permesso `flow:read` o `produzione:read`; scrittura con `write`. Admin pieno controllo. GRANT espliciti a `authenticated` e `service_role` (come da regola di progetto).

`montaggi_planning` resta invariato — è già la fonte dati del calendario.

## 2. Calendario globale (`/montaggi/pianificazione`)

Riscrittura di `PianificazioneSection` in modalità `mode="global"`:
- Header con range 2 settimane (pulsanti ‹ Oggi ›) e toggle **Per operaio / Per cantiere**.
- **Per operaio**: righe = operai, colonne = 14 giorni. In ogni cella i chip dei cantieri con ore. Footer riga con totale ore/settimana e indicatore colore (sotto/in linea/sovraccarico vs 40h).
- **Per cantiere**: righe = cantieri (commesse attive), colonne = 14 giorni. Celle con avatar operai assegnati. Riga footer con totale operai-giorno.
- Click su cella → dialog rapido per aggiungere/modificare assegnazione (operaio, ore, cantiere, ruolo, note).
- Filtri: cantiere, ruolo, mostra solo conflitti.

## 3. Dentro al progetto: tab Progetto / Assegnazione

In `Montaggi.tsx` (vista singolo progetto) introdurre due tab:
- **Progetto**: contenuto attuale (preventivo, stima operai, attrezzi/materiali pianificati come parte del calcolo).
- **Assegnazione**: nuova vista
  - Header con pulsante **Riprendi da progetto** (copia lavoratori previsti, date stimate, attrezzi e materiali dalla scheda Progetto nelle entry reali).
  - **Selettore lavoratore con vista 2 settimane**: quando assegno, vedo per ciascun candidato la sua agenda nei prossimi 14 giorni (chip cantieri + giorni liberi). Così capisco subito se è disponibile.
  - Tabella assegnazioni del cantiere (giorno × operaio).
  - Sezione **Attrezzi**: lista con autocomplete sul catalogo + pulsante "Nuovo attrezzo" che salva nel database condiviso. Quantità modificabile per riga.
  - Sezione **Materiali**: stessa UX.

## 4. Catalogo attrezzi e materiali

Nuovo componente `CatalogoMontaggiDialog` raggiungibile da:
- pulsante "Gestisci catalogo" nella sezione Assegnazione,
- e nuova voce nell'hub admin (opzionale).

CRUD completo, ricerca, categorie. Riutilizzato dal selettore autocomplete in Assegnazione.

## 5. File toccati

```text
NEW   supabase/migrations/<ts>_montaggi_catalog.sql
NEW   src/components/montaggi/CalendarGlobalView.tsx
NEW   src/components/montaggi/AssegnazioneSection.tsx
NEW   src/components/montaggi/WorkerAvailabilityPicker.tsx
NEW   src/components/montaggi/CatalogoMontaggiDialog.tsx
NEW   src/components/montaggi/AttrezziMaterialiPicker.tsx
NEW   src/lib/montaggi/catalog.ts        (hook + types)
NEW   src/lib/montaggi/planning.ts       (queries riusabili)
EDIT  src/components/montaggi/PianificazioneSection.tsx  (mode globale → usa CalendarGlobalView)
EDIT  src/pages/Montaggi.tsx             (tab Progetto / Assegnazione)
EDIT  src/pages/MontaggiPianificazione.tsx (passa a nuovo calendario)
```

## 6. Dettagli tecnici

- **Disponibilità operaio**: query `montaggi_planning` filtrata per `operator_id` e range date, raggruppata per data, somma `hours`. Operatore "libero" se totale < 8h. Soglia configurabile in costante.
- **Vista per operaio**: 1 SELECT su `montaggi_planning` joinata con `profiles` (per nome/avatar) e `commesse` (per cantiere label/colore).
- **Vista per cantiere**: stessa SELECT, pivot lato client. Le commesse senza assegnazioni nei 14gg vengono comunque elencate se attive.
- **Dialog cella rapido**: usa upsert su `montaggi_planning` (chiave naturale: operator_id+date+commessa_id).
- **Riprendi da progetto**: legge `commesse.snapshot.montaggi` (struttura attuale del preventivo) e fa bulk insert in `montaggi_planning` + `montaggi_assignment_items`.
- **Catalogo**: hook `useMontaggiCatalog()` con cache `zustand` o `react-query`; autocomplete client-side.
- Tutti i pulsanti, dialog e tabelle usano i token semantici esistenti (`dept`, `paper`, ecc.) — niente colori hard-coded.

## 7. Ordine di esecuzione

1. Migrazione DB (3 tabelle + RLS + GRANT).
2. Catalogo + dialog gestione (base riutilizzabile).
3. Tab Progetto/Assegnazione + AssegnazioneSection con picker disponibilità + attrezzi/materiali + "Riprendi da progetto".
4. Calendario globale dual-view.
5. QA: scenari operaio sovraccarico, cantiere senza operai, riprendi su progetto vuoto.

## Note

- Lavoro ampio: lo splitto in due step di consegna se preferisci (prima Assegnazione + catalogo, poi Calendario globale). Dimmi se va bene in un'unica passata.
- Non tocco logica preventivo/contabilità — solo presentazione + nuove tabelle.