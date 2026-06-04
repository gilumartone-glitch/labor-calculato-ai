# Nuova sezione "Record" personale

Una scheda personale nell'Hub dove ogni utente registra promemoria su clienti e fornitori (anche non ancora in anagrafica). Ogni record è privato per default, ma può essere condiviso con altri utenti o con tutti.

## Cosa l'utente vede

**Tile in Hub** "Record" (icona BookMarked) — visibile a tutti gli utenti approvati, non serve un permesso specifico.

**Pagina /record** con:
- Barra in alto: ricerca per nome contatto/testo, filtri per **tipo** (Pagamento ricevuto · Da pagare · Da incassare · Promemoria · Nota) e **stato** (aperto / chiuso), toggle "Solo miei" / "Condivisi con me".
- Lista raggruppata per **contatto** (cliente/fornitore). Su ogni gruppo: badge con totale aperto € a debito/credito.
- Pulsante "+ Nuovo record" che apre un dialog guidato:
  1. **Contatto**: autocomplete sui contatti già usati dall'utente; se non esiste, lo crea al volo (nome + tipo cliente/fornitore/entrambi opzionale).
  2. **Tipo record** (radio guidato, ognuno con icona):
     - Pagamento ricevuto (entrata, importo, data)
     - Da incassare (importo, scadenza)
     - Pagamento fatto (uscita, importo, data)
     - Da pagare (importo, scadenza)
     - Promemoria (data/ora opzionale)
     - Nota libera
  3. **Dettagli**: importo (se monetario), data, titolo breve, descrizione libera, tag opzionali.
  4. **Condivisione**: privato (default) · utenti specifici · tutti.
- Click su un record → dialog dettaglio con: modifica, segna come chiuso/saldato, elimina, condividi/aggiorna condivisioni, cronologia condivisione.
- Azione "Invia a…" su ogni record: scegli uno o più utenti; il record appare nella loro lista come "Condiviso da X" (non possono modificarlo, solo segnare come letto / copiare nella propria lista).

## Modello dati (Lovable Cloud)

Tabelle nuove in `public`:

- `personal_records`
  - `id uuid pk`
  - `owner_id uuid` (auth.users)
  - `contact_name text` (denormalizzato, sempre presente)
  - `contact_kind text` check in (`cliente`,`fornitore`,`entrambi`,`altro`)
  - `record_type text` check in (`pagamento_ricevuto`,`da_incassare`,`pagamento_fatto`,`da_pagare`,`promemoria`,`nota`)
  - `title text`, `description text`
  - `amount numeric` null, `currency text default 'EUR'`
  - `due_date date` null, `event_at timestamptz` null
  - `status text default 'aperto'` (`aperto`,`chiuso`)
  - `tags text[] default '{}'`
  - `visibility text default 'private'` (`private`,`shared`,`all`)
  - `created_at`, `updated_at` (+ trigger updated_at)

- `personal_record_shares`
  - `record_id uuid` fk → personal_records on delete cascade
  - `shared_with uuid` (auth.users) — null se `visibility='all'`
  - `shared_by uuid`, `created_at`
  - `read_at timestamptz` null
  - pk (record_id, shared_with)

GRANT su entrambe a `authenticated` + `service_role`.

### RLS
- `personal_records`
  - SELECT: `owner_id = auth.uid()` OR `visibility='all'` OR exists share `shared_with=auth.uid()`
  - INSERT: `owner_id = auth.uid()`
  - UPDATE/DELETE: `owner_id = auth.uid()` (o admin)
- `personal_record_shares`
  - SELECT: `shared_with = auth.uid()` OR owner del record (via security definer helper o subselect)
  - INSERT/DELETE: owner del record
  - UPDATE (read_at): `shared_with = auth.uid()`

Per evitare ricorsione: helper `public.is_record_owner(_record_id uuid)` security definer.

## File toccati

- nuovo `supabase/migrations/...` — tabelle, grants, RLS, helper, trigger updated_at
- `src/pages/Record.tsx` — pagina
- `src/components/record/RecordList.tsx`, `RecordDialog.tsx`, `ShareDialog.tsx`, `ContactPicker.tsx`
- `src/lib/record/types.ts`, `src/lib/record/api.ts`
- `src/pages/Hub.tsx` — aggiungere tile "Record" (visibile a tutti gli utenti approvati, come Magazzino)
- `src/App.tsx` — route `/record` (no RouteGuard per pagina, basta essere autenticati e approvati; gate interno)

Nessuna modifica al sistema permessi (`user_permissions`): Record è personale, non legato a `PageKey`.

## Note
- Il dialog guidato propone i tipi monetari con campo importo; per "Promemoria"/"Nota" l'importo è nascosto.
- Autocomplete contatti: query distinct su `personal_records.contact_name` dell'utente + suggerimenti opzionali da `marketing_contacts` solo per nomi (no PII condivisa qui).
- Realtime opzionale (fase 2): per ora refetch on focus.
