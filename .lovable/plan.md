
# Sub-progetti (prodotti finiti) dentro un progetto madre

## Obiettivo
Permettere di suddividere un progetto in più **prodotti finiti** (es. *Tavolino*, *Pavimento*), ognuno con il suo set di lavorazioni distribuite su tutti i reparti (Laboratorio, Falegnameria, Tappezzeria, Vendite, ecc.). Il preventivo mostra un blocco con subtotale per ogni prodotto finito. In produzione ogni prodotto genera i suoi sub-ordini dedicati per reparto.

## Modello dati (frontend, in `officina:state` + snapshot)

Oggi ogni reparto ha una lista piatta `pieces[]`. Introduciamo un nuovo livello:

```text
Draft (Progetto madre "Tizio")
 ├── subProjects: [
 │     { id, name: "Tavolino", order: 0, note, ... },
 │     { id, name: "Pavimento", order: 1, ... }
 │   ]
 └── departments:
       laboratorio: { pieces: [ { …, subProjectId } ] }
       falegnameria: { pieces: [ { …, subProjectId } ] }
       tappezzeria:  { pieces: [ { …, subProjectId } ] }
       vendite:      { pieces: [ { …, subProjectId } ] }
```

- Ogni `piece` acquisisce `subProjectId?: string | null` (null = "Generale", per retrocompatibilità dei progetti esistenti).
- Nessuna migrazione DB necessaria: sta tutto nello snapshot JSON del draft. I progetti già creati continuano a funzionare (tutti i pezzi restano in "Generale").

## UI Progettazione

1. **Barra sub-progetti** in cima al calcolatore: chip per ciascun prodotto finito + pulsante "+ Nuovo prodotto finito". Filtro attivo (o "Tutti").
2. In **`DepartmentView`** (ogni reparto), i pezzi vengono raggruppati per sub-progetto con un header collassabile: `Tavolino (3 pezzi) — subtotale €X`. Pulsante "+ Aggiungi lavorazione a Tavolino" dentro ogni gruppo.
3. Quando si crea un pezzo, il selettore reparto è affiancato da un selettore sub-progetto (default: quello attivo sulla barra).
4. Drag&drop di un pezzo tra sub-progetti (cambia solo `subProjectId`).

## Preventivo / Riepilogo generale

- **`GeneralSummary`**: sezione per ogni sub-progetto con
  - tabella pezzi/materiali/operazioni (già esistente) filtrata per `subProjectId`
  - riga **Subtotale prodotto finito**
- In fondo: **Totale generale** = somma dei subtotali + eventuali voci "Generale".
- PDF/stampa: stessa struttura a blocchi.

## Produzione (lancio ordine)

Modifica in `LaunchOrderDialog` + `snapshot.ts`:
- Per ogni **(subProject × reparto con pezzi)** viene creato un `ProdSubOrder` distinto.
- `code` sub-ordine include l'indice del prodotto: es. `ORD-2026-005-L1` (Tavolino/Laboratorio), `ORD-2026-005-F1` (Tavolino/Falegnameria), `ORD-2026-005-L2` (Pavimento/Laboratorio).
- Nel `note`/titolo del sub-ordine viene mostrato "**Tavolino** — Falegnameria".
- Lo `snapshot` salvato sull'ordine include `subProjects[]` così la vista `SubOrderDetailDialog` mostra solo i pezzi del suo prodotto finito.
- I sub-progetti sono visibili anche in ProdBoard (raggruppamento visivo per prodotto finito dentro lo stesso ordine).

## Dettagli tecnici

- **Nuovo tipo** in `src/components/calculator/types.ts`:
  ```ts
  export type SubProject = { id: string; name: string; order: number; note?: string };
  ```
- **`Piece`**: aggiunto `subProjectId?: string | null`.
- **DraftState**: aggiunto `subProjects: SubProject[]`.
- Helper `getPiecesBySubProject(dept, subId)` per il rendering.
- `LaunchOrderDialog`: ciclo doppio `subProjects × workDepts` invece del solo `workDepts`.
- `snapshot.ts` (`buildProdSnapshot`): serializza `subProjects` e mantiene `subProjectId` sui pezzi; `readPiecesForSub` filtra anche per `subProjectId`.
- `SubOrderDetailDialog` / `CompleteSubDialog`: mostrano il nome del prodotto finito nell'intestazione e filtrano i pezzi.
- **Retrocompatibilità**: se `subProjects` è vuoto o assente, tutto funziona come oggi (un unico gruppo implicito "Generale").

## Fuori scope di questa iterazione
- Nessuna modifica a Montaggi (già usa il modello lavorazioni per draft).
- Nessuna modifica a Nesting (opera già su pezzi del reparto stampa/laboratorio; funziona uguale).
- Nessun cambio DB.

## Come procedo
Implemento in quest'ordine: tipi → stato draft + barra sub-progetti → raggruppamento in DepartmentView → GeneralSummary con subtotali → snapshot + LaunchOrderDialog (moltiplica sub-ordini) → dialoghi produzione (filtro per prodotto).
