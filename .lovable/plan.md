## Obiettivo
Ristrutturare i reparti su più livelli ed eliminare "Grafica".

## Nuova struttura
```text
Progettazione        (nuovo, sostituisce Grafica)
Lavorazione          (selezionabile + raggruppatore)
  ├─ Stampa
  ├─ Taglio
  ├─ Tappezzeria
  ├─ Falegnameria
  └─ Stampa 3D
Amministrazione
Acquisti
Vendite
```

## Cosa cambia nel codice
1. **`src/lib/produzione/types.ts`** — tipo cardine
   - `ProdDept`: rimuovo `"grafica"`, aggiungo `"progettazione"`. `"laboratorio"` resta come reparto generico "Lavorazione".
   - `AppSettore`: stesso trattamento (rimuovo grafica, aggiungo progettazione).
   - `SETTORE_LABEL`, `DEPT_LABEL`: `laboratorio → "Lavorazione"`, `progettazione → "Progettazione"`; rimuovo Grafica.
   - `WORK_DEPTS = ["laboratorio", "stampa", "taglio", "tappezzeria", "falegnameria", "stampa_3d", "progettazione"]`.
   - `ALL_SETTORI`: aggiorno con progettazione e i sotto-reparti.
   - `DEPT_COLOR`: nuovo colore per `progettazione`, mantengo gli altri.
   - `SUB_DEPT_SUFFIX`: aggiungo `progettazione: "P2"` (o simile), `laboratorio` resta `L`.
   - `toWorkDept()`: mappa legacy `"grafica"` → `"progettazione"` per compatibilità snapshot/ordini storici.
2. **UI dei reparti raggruppati**: nei selettori di reparto (LaunchOrderDialog, board produzione, CommessaDialog, calculator) renderizzo le opzioni con un'intestazione "Lavorazione" e i sotto-reparti indentati. Espongo anche "Lavorazione" come opzione selezionabile.
3. **Pages produzione (Board, Dashboard, Inventory, FindMaterial)**: filtri per reparto aggiornati. La vista board mostra colonna "Lavorazione" che può espandersi nei sub.
4. **Checklist e snapshot** (`checklist-templates.ts`, `snapshot.ts`, `helpers.ts`): rinomino chiave `grafica → progettazione`, lascio fallback che traduce eventuali vecchi valori.
5. **Contabilità / contatti** (`contacts.ts`, `AnagraficaView.tsx`, `Contabilita.tsx`): sostituisco etichetta Grafica con Progettazione.
6. **Hub / permessi pagina**: se la voce "Grafica" è una card a sé, diventa "Progettazione".
7. **Migrazione dati esistente**: non tocco lo schema (le colonne sono `text`), ma uno UPDATE per spostare i record con `dept='grafica'` (e simili in `commessa.reparto`, `prod_sub_orders.dept`, `profiles.settori`) a `progettazione`.

## Quello che NON faccio
- Nessuna modifica a colonne/enum del DB (sono già `text`).
- Nessun cambiamento alla logica di RLS/permessi (le chiavi reparto restano stringhe).
- Non rimuovo il file `checklist-templates.ts` legacy: lascio un alias.

## Test rapidi dopo le modifiche
- Build TS pulita.
- Selettori reparto mostrano la nuova gerarchia.
- Un ordine storico con reparto "grafica" continua a comparire (mappato a Progettazione).
