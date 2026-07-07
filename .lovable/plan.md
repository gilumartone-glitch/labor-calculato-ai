## Obiettivo

Aggiungere, in automatico, un task finale **"Assemblaggio in laboratorio"** per ogni sub-progetto (o per l'ordine intero se non ci sono sub) quando il preventivo lo prevede. Il task:

- viene eseguito dalla **Falegnameria**
- ha una **checklist dei componenti** da avere pronti (auto-generata dai pezzi/materiali del sub-progetto)
- ha **ore stimate + costo orario** che concorrono al preventivo
- diventa **bloccato da tutti gli altri task** dello stesso sub-progetto (Stampa, Taglio, Tappezzeria, Falegnameria/Taglio, ecc.)

Non è "posa in cantiere": resta separato dal reparto Montaggi (che gestisce i cantieri).

## Flusso utente

1. In `DepartmentView` (o meglio nel `SubProjectBar` / `GeneralSummary`) compare un toggle per sub-progetto: **"Assemblaggio finale in laboratorio"** con campi `ore` e `€/h` (default dal reparto Falegnameria).
2. Se attivo, il costo entra nel riepilogo del preventivo come voce Falegnameria.
3. In `CreateCommessaButton` → Pianificazione, il task compare in coda con:
   - categoria `assemblaggio_lab`
   - reparto `falegnameria`
   - `depends_on` pre-compilato = tutti gli altri task dello stesso sub-progetto
   - checklist dei componenti pronta
4. Al lancio, viene creato un `production_sub_order` con `dept='falegnameria'`, suffisso codice `ASM-LAB`, e la checklist popolata in `production_sub_checklist`.

## Modifiche tecniche

### 1. Preventivo (stato locale)
- `src/components/calculator/types.ts` — aggiungere, a livello di sub-progetto: `assemblyLab?: { enabled: boolean; hours: number; hourlyCost: number; notes?: string }`.
- `SubProjectBar.tsx` — UI (toggle + due input piccoli) accanto al nome del sub-progetto.
- `GeneralSummary.tsx` — includere `hours * hourlyCost` nella riga Falegnameria del sub.

### 2. Task generation
- `src/lib/produzione/prodTasks.ts` — nuova categoria `assemblaggio_lab`. Dopo aver generato i task esistenti, per ogni sub-progetto con `assemblyLab.enabled`:
  - creare un task `{ taskKey: "<sub>:assemblaggio_lab", dept: "falegnameria", category: "assemblaggio_lab", label: "Assemblaggio in laboratorio", subProjectId, pieceIds: [tutti i pezzi del sub] }`
  - `defaultBlockedBy` = tutti gli altri `taskKey` dello stesso `subProjectId`
  - `estimatedHours` / `hourlyCost` copiati dal preventivo per essere mostrati in UI

### 3. UI pianificazione
- `CreateCommessaButton.tsx` — il task compare come tab. Il dropdown "Bloccata da" mostra i task precedenti già selezionati per default (multi-blocco visivo; a DB resta la 1→1, gli altri finiscono nelle note come oggi).
- Sezione **Checklist componenti** nel tab del task: lista auto-generata (nome pezzo + qty + sub-lavorazione), editabile.

### 4. Snapshot → sub-order
- `snapshot.ts` — passare `assemblyLab` per sub nello snapshot.
- Al lancio, se il task è `assemblaggio_lab`:
  - `code` con suffisso `ASM-LAB-<n>`
  - `dept='falegnameria'`, `note` con "Assemblaggio in laboratorio"
  - popolare `production_sub_checklist` con le voci componenti (usa la tabella esistente).

### 5. Nessuna migration DB
Riusiamo `production_sub_orders` + `production_sub_checklist` esistenti. La categoria `assemblaggio_lab` vive solo come metadato applicativo nel `note`/prefisso codice.

## Cosa NON facciamo

- Non tocchiamo il reparto Montaggi (resta cantieri).
- Non creiamo un nuovo reparto in `ProdDept`: il task è un normale sub Falegnameria con marker nel codice/nota.
- Non forziamo un ordine di blocco: proposto in automatico, sempre modificabile.

## Domanda residua

Confermi che l'ora/costo default per l'assemblaggio in laboratorio li prendiamo dal **listino Falegnameria** già in `public/templates/listino-falegnameria.xml` (voce "manodopera"), oppure vuoi un campo separato nelle impostazioni reparto?
