## Obiettivo
Quando si lancia in Flow un progetto o un sub-progetto (es. "Tavoli"), per ogni reparto che contiene più lavorazioni distinte (es. Falegnameria = Taglio + Assemblaggio) creare **un sub-ordine per lavorazione**, ciascuno con proprio responsabile, operatori e date, e con la possibilità di indicare **quale lavorazione blocca l'altra** (es. Assemblaggio bloccato finché Taglio non è completato).

Oggi invece viene creato un solo sub-ordine per reparto e le lavorazioni "figlie" (taglio/assemblaggio dentro falegnameria) vengono unificate — chi assembla non vede il taglio come attività separata.

## Cosa cambia

### 1. Rilevamento lavorazioni per reparto
Estendere `inferProdDeptsFromSnapshot` (o affiancarci una nuova `inferProdTasksFromSnapshot`) per restituire una lista di **task**, non solo di reparti:

```ts
type ProdTask = {
  taskKey: string;          // es. "falegnameria:taglio", "falegnameria:assemblaggio"
  dept: ProdDept;           // reparto macro (falegnameria)
  category: string;         // "taglio" | "assemblaggio" | "generale" | ...
  label: string;            // "Falegnameria — Taglio"
  pieceIds: string[];       // pezzi coinvolti
};
```

Il raggruppamento avviene per **categoria dell'operazione** letta dal catalogo (`perimeterOps.category`, `printOps.category`, categorie in Falegnameria/Laboratorio/Tappezzeria). Se un reparto ha una sola categoria → un solo task come oggi.

### 2. UI di pianificazione (`CreateCommessaButton`)
Oggi il tab di pianificazione è per reparto (`activePlanTab: ProdDept`). Diventa **per task**:
- Un sotto-tab per ogni lavorazione dentro il reparto
- Per ciascuno: date inizio/fine/consegna, responsabile, operatori (come oggi)
- Nuovo campo **"Bloccata da"**: dropdown con le altre lavorazioni della stessa commessa (opzionale). Il default suggerisce l'ordine naturale (Taglio → Assemblaggio) ma è modificabile.

### 3. Creazione sub-ordini
Nel ramo "flusso normale" (`onWarehouseConfirm`), invece di iterare `depts`, iterare `tasks`:
- Un `production_sub_orders` per task
- `depends_on` = id del sub-ordine indicato come bloccante (oltre all'eventuale `acquistiByDept`)
- `code` con suffisso che distingue la lavorazione (es. `ORD-2026-001-F-TAGLIO-1`, `ORD-2026-001-F-ASSEMBLAGGIO-2`)
- La catena esistente (materiali mancanti → acquisti → reparto) resta invariata: se un task è bloccato sia da acquisti sia da un altro task, prevale il primo bloccante attivo (rimane un solo `depends_on`; l'eventuale secondo blocco viene tracciato in nota e sbloccato manualmente — Postgres non ha catena multipla su questa colonna).

### 4. Pianificazione calendario (`montaggi_planning` / righe reparto)
Il seed di pianificazione per reparto passa da "un reparto = una riga" a "un task = una riga", con reparto padre invariato.

### 5. Retro-compatibilità
- I progetti già in Flow (sub-ordine singolo) continuano a funzionare: la migrazione è solo lato creazione.
- Il "Solo magazzino" resta un singolo sub (non cambia nulla).
- Se un reparto ha una sola lavorazione, il comportamento è identico a oggi (nessuna regressione visiva).

## File coinvolti (frontend + DB)
- `src/lib/produzione/snapshot.ts` — nuova `inferProdTasksFromSnapshot`
- `src/components/calculator/CreateCommessaButton.tsx` — form pianificazione per task + creazione multi-sub
- `src/lib/produzione/types.ts` — tipo `ProdTask`, mappature label/suffix per categoria
- Nessuna migrazione DB necessaria: usiamo `production_sub_orders.depends_on` esistente. Aggiungiamo però una colonna opzionale `task_category text` per identificare la sotto-lavorazione nel Board (utile per filtri e chip).

## Punti da confermare prima di procedere
1. Il **catalogo Falegnameria** oggi ha categorie distinte per "taglio" e "assemblaggio" sulle operazioni? Se sì uso quelle; se no, ti chiedo su quali regole spezzare (nome operazione, tag, campo dedicato).
2. La catena `depends_on` in Postgres è **1→1**: se un task è bloccato da 2 cose (acquisti + altro task), quale ha priorità? Proposta: **acquisti vince**, e il blocco "task precedente" resta un vincolo software che l'operatore vede ma può scavalcare (o lo aggiungiamo come nuova tabella `sub_dependencies` a molti-a-uno).
3. Vuoi che l'ordine bloccante venga **proposto automaticamente** in base alle categorie note (Taglio prima di Assemblaggio, Stampa prima di Taglio, ecc.) o **sempre manuale**?
