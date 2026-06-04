## Obiettivo

1. Far comparire automaticamente tutti gli operatori del settore "Montaggi" anche dentro la pianificazione della singola commessa.
2. Aggiungere alla pagina **Pianificazione** una tab "Lavorazioni" (laboratorio / tappezzeria / vendite) parallela a quella "Montaggi", con la stessa logica.
3. Rendere lo spostamento delle assegnazioni veloce: **drag & drop** in calendario + **click veloce con popover** per modificare giorni/durata/eliminare senza aprire il dialog completo.

Niente modifiche al DB: la tabella `montaggi_planning` ha già la colonna `reparto` ed è già reparto-agnostica.

---

## Sezione 1 — Operatori mancanti in assegnazione (commessa)

**File:** `src/components/montaggi/PianificazioneSection.tsx`

- Aggiungere `settori` alla query profili (riga ~198) → `.select("id, display_name, settori")`.
- Aggiungere un memo `profileOps` analogo a quello già presente in `CalendarGlobalView.tsx` (righe 143-153): filtra i profili con `settori.includes("montaggi")`, deduplica contro gli operatori già presenti.
- Modificare la riga 160 (`operators = view === "progetto" ? projectOperators : ops.state`) in modo che in modalità progetto restituisca `[...projectOperators, ...profileOps]`. Così sia la griglia del calendario che il dropdown "Assegna intervallo veloce" interno alla commessa li includono.

Risultato: nessun setup manuale richiesto, basta che l'utente abbia il settore "Montaggi" nel profilo.

---

## Sezione 2 — Pianificazione con tab "Lavorazioni" + "Montaggi"

**Pagina:** `src/pages/MontaggiPianificazione.tsx` (rinomino concettualmente in "Pianificazione" ma lascio la route com'è per compatibilità).

Layout:

```text
┌──────────────────────────────────────────────────┐
│ [ Montaggi ] [ Lavorazioni ]    Reparto: [ ▾ ]   │
├──────────────────────────────────────────────────┤
│ ← settimana →    Oggi    Cantiere/Commessa: [ ▾ ]│
│                                                  │
│  OPERAIO  | LUN | MAR | MER | GIO | VEN | …      │
│  …                                               │
└──────────────────────────────────────────────────┘
```

- **Tab "Montaggi"**: comportamento attuale di `CalendarGlobalView` filtrato su `reparto = "montaggi"`. Operatori = profili con settore montaggi (già fatto).
- **Tab "Lavorazioni"**: stesso componente riutilizzato in modalità "lavorazioni"; filtro reparto interno con tre valori (`laboratorio`, `tappezzeria`, `vendite`), default "tutti". Operatori = profili con almeno uno di quei settori.
- Filtro reparto rimane visibile sopra la griglia per restringere ulteriormente.
- Le righe della tabella `montaggi_planning` con `reparto ∈ {laboratorio, tappezzeria, vendite}` sono già supportate, basta filtrare in lettura e settare il default corretto in scrittura.

Stessa griglia, stessi colori (già definiti in `COLORS`), stessa dialog di edit con `reparto` selezionabile.

---

## Sezione 3 — Spostamento veloce (drag & drop + click popover)

Uso `@dnd-kit/core` (già installato). Nessuna nuova dipendenza.

**Drag & drop:**
- Ogni chip assegnazione in calendario diventa `useDraggable` (id = assignment.id).
- Ogni cella `<td>` operatore×giorno diventa `useDroppable` (id = `${operator_id}|${dateStr}`).
- Su drop: `UPDATE montaggi_planning SET operator_id=…, date=… WHERE id=…` via `saveAssignment`.
- Drag su un bordo laterale della chip (mini-handle) → estende/riduce di 1 giorno: crea/duplica righe sui giorni vicini con la stessa `cantiere_label`/`reparto`/`hours` (la tabella usa 1 riga per giorno, quindi "estendere" = inserire righe contigue).

**Click veloce con popover:**
- Click semplice sulla chip: apre un `Popover` inline (shadcn) ancorato alla chip con:
  - input ore (numero)
  - pulsanti `−1g` / `+1g` per spostare la data
  - input "Dal / Al" per propagare l'assegnazione a un intervallo
  - bottone Elimina
  - link "Modifica avanzata…" che apre il dialog completo
- Doppio click: apre direttamente il dialog completo (comportamento attuale).
- Click sul `+` di una cella vuota: resta com'è (apre dialog).

Feedback visivo: durante il drag la chip diventa semitrasparente; la cella droppable evidenziata con `ring-2 ring-primary`.

---

## File modificati / creati

- **edit** `src/components/montaggi/PianificazioneSection.tsx` — merge `profileOps` per settore montaggi.
- **edit** `src/components/montaggi/CalendarGlobalView.tsx` —
  - prop `mode: "montaggi" | "lavorazioni"` per scegliere reparti predefiniti, settori da matchare per `profileOps`, colore default, valore reparto di default nel dialog;
  - wrap chip con `useDraggable`, cella con `useDroppable`, gestione drop;
  - nuovo `QuickEditPopover` (componente inline o file dedicato `src/components/montaggi/QuickEditPopover.tsx`);
  - sostituzione `onClick` chip → apertura popover; doppio click → dialog completo.
- **edit** `src/pages/MontaggiPianificazione.tsx` — Tabs con "Montaggi" / "Lavorazioni", ognuna renderizza `CalendarGlobalView` con `mode` diverso.
- **new** `src/components/montaggi/QuickEditPopover.tsx` (se conviene estrarlo).

Nessuna migrazione DB.

---

## Note tecniche

- Tipi `Reparto` in `CalendarGlobalView`: già include `laboratorio`, `tappezzeria`, manca `vendite` → lo aggiungo nei `REPARTI`, `COLORS`, `REPARTO_LABEL`.
- Settori da matchare per la tab "Lavorazioni": `["laboratorio", "tappezzeria", "vendite"]` (valori del tipo `AppSettore`).
- `DndContext` avvolge solo la griglia operai (non i filtri/header) per evitare interferenze con i bottoni esistenti.
- `PointerSensor` con `activationConstraint: { distance: 4 }` così un click semplice non viene interpretato come drag e apre il popover.