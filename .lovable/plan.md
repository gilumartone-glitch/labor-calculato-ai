## Obiettivo
Integrare i **Montaggi** in Flow e nella Board di Produzione come cantieri di prima classe, con un **responsabile cantiere** (un assegnatario marcato) che gestisce una **timeline** di note/aggiornamenti, dichiara il cantiere completo o richiede un prolungamento (con approvazione admin).

## 1. Database

**Migrazione unica:**
- `commessa_reparto` enum: aggiungo valore `montaggi`.
- `commessa_assegnatari`: aggiungo colonna `responsabile boolean NOT NULL DEFAULT false` + indice parziale unico `(commessa_id) WHERE responsabile`.
- Nuova tabella `commessa_updates`:
  - `id, commessa_id, author_id, tipo` (`nota | aggiornamento | completamento | richiesta_prolungamento | risposta_admin`)
  - `body text`, `proposed_date date NULL`, `status text` (`pending|approvato|rifiutato` per le richieste; null altrimenti)
  - `decided_by uuid NULL`, `decided_at timestamptz NULL`
  - `created_at, updated_at` + trigger `update_updated_at_column`
- GRANT su `authenticated` + `service_role`; RLS:
  - SELECT: tutti gli autenticati (allineato alle altre tabelle commesse)
  - INSERT: solo autore = `auth.uid()` ed essere assegnatario della commessa o admin/coordinatore
  - UPDATE/DELETE: autore o admin; le richieste di prolungamento possono essere decise solo da admin (logica nel client + check policy `decided_by = auth.uid() AND has_role(admin)`).

## 2. Frontend — Flow

- `types.ts`: aggiungo `montaggi` a `CommessaReparto` e `REPARTI` (label "→ Montaggi", colore proprio già gestito via design tokens).
- `Flow.tsx`: filtro reparto già automatico via `REPARTI`. Aggiungo sezione **Cantieri attivi** sopra la kanban, che mostra le commesse con `reparto = montaggi` **oppure** quelle con almeno una entry in `montaggi_planning` nei prossimi 14 gg. Card compatta con responsabile, scadenza, prossimo giorno pianificato.

## 3. Frontend — Board produzione

- `ProdBoard.tsx`: nuova fascia **Cantieri (Montaggi)** affiancata alle colonne reparto. Stessa query della sezione Flow. Click → apre `CommessaDetailDialog` sul tab Timeline.

## 4. CommessaDetailDialog — Timeline & responsabile

- Nuovo tab **Timeline** dentro al dialog. Mostra:
  - Lista cronologica degli updates con avatar/nome autore, tipo (badge), corpo, eventuale data proposta, stato richiesta.
  - Form in fondo: textarea + selettore tipo (Nota / Aggiornamento / Completamento / Richiedi prolungamento — in quest'ultimo caso compare un date picker `proposed_date`).
- Tra gli assegnatari: icona ⭐ per impostare/togliere il **responsabile cantiere** (solo admin/coordinatore o lo stesso responsabile attuale).
- Permessi UI:
  - Tutti gli assegnatari + admin/coord vedono il form note/aggiornamento.
  - "Completamento" e "Richiedi prolungamento" visibili al responsabile + admin/coord.
  - Per ogni richiesta di prolungamento in stato `pending`, gli admin vedono i bottoni **Approva** (imposta `commesse.data_scadenza = proposed_date` e crea `risposta_admin`) / **Rifiuta** (solo risposta).
- Su "Completamento" eseguo `commesse.stato = 'consegnato'` (configurabile) + entry timeline.
- Notifiche `prod_notifications` per: richiesta prolungamento (→ tutti gli admin via `get_admin_user_ids()`); decisione admin (→ responsabile).

## 5. File toccati

```text
NEW   supabase/migrations/<ts>_montaggi_in_flow.sql
NEW   src/components/flow/CommessaUpdatesTab.tsx
NEW   src/components/flow/CantieriStrip.tsx     (riusato in Flow e ProdBoard)
NEW   src/lib/flow/updates.ts                   (hook useCommessaUpdates + tipi)
EDIT  src/components/flow/types.ts              (enum + REPARTI)
EDIT  src/components/flow/CommessaDetailDialog.tsx (tab Timeline + stella responsabile)
EDIT  src/pages/Flow.tsx                        (montaggio CantieriStrip)
EDIT  src/pages/produzione/ProdBoard.tsx        (montaggio CantieriStrip)
```

## Note tecniche

- Il `responsabile` su `commessa_assegnatari` è un flag, non un nuovo ruolo: chi è già assegnato può essere promosso. L'admin può cambiarlo in qualsiasi momento.
- Per "richiesta prolungamento", il client manda anche `proposed_date`; alla decisione admin l'update originale resta in timeline, e ne viene aggiunto uno di tipo `risposta_admin` linkato (`body` con motivo).
- Tutte le query sfruttano RLS esistenti; nessuna nuova GRANT su `anon`.

Procedo in un unico passaggio. Confermi?