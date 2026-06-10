## Cosa costruisco

Un sistema in **Impostazioni → Reparti** (sezione *Dipendenti → Gestione reparti*) per dichiarare, per ogni materiale o lavorazione, **chi lo produce internamente** e **come si comportano i reparti che lo consumano**.

### Esempio concreto
- *MOZAIK* viene prodotto da **Stampa**.
- *Tappezzeria* può essere configurata in due modi:
  - **Dipendente** → la lavorazione Tappezzeria parte solo quando Stampa ha consegnato il MOZAIK (oggi è il default).
  - **Autonoma** → Tappezzeria parte subito; nella sua scheda compare il MOZAIK con badge *"in arrivo da Stampa"*, ma non blocca.

## 1. Nuova tabella `material_dependencies`

```sql
material_pattern   text       -- es. "MOZAIK", "Panno Oscurante" (match case-insensitive sul nome)
produced_by_dept   text       -- "stampa", "falegnameria"...
consumer_dept      text NULL  -- NULL = vale per tutti; altrimenti specifico
mode               text       -- 'blocking' | 'autonomous' | 'ignore'
note               text
```

RLS: read per `authenticated`, write per `admin`.

## 2. UI in `Dipendenti.tsx` → nuovo blocco `MaterialDependenciesManager`

Sotto al `RepartiManager` esistente, una card "Dipendenze materiali tra reparti" con:
- elenco regole esistenti
- form per aggiungere: nome materiale (testo libero o suggerito dai cataloghi), reparto che produce, reparto che consuma (o "tutti"), modalità (`blocca` / `autonomo` / `ignora`).
- modifica/eliminazione in linea

## 3. Applicazione nelle commesse

**`snapshot-materials.ts`** estrae i materiali come oggi, ma ogni `SnapshotMaterial` ottiene anche:
- `producedByDept?: ProdDept` — dal match della regola
- `mode?: 'blocking' | 'autonomous' | 'ignore'`

**`CreateCommessaButton.tsx`** — al momento di creare gli acquisti e i `depends_on`:
- regola `blocking` → comportamento attuale (sub consumatore attende acquisti / sub produttore)
- regola `autonomous` → niente `depends_on`; il sub consumatore parte subito
- regola `ignore` → il materiale non genera né acquisto né dipendenza

**`SubOrderDetailDialog.tsx`** — nella lista "Materiali necessari" del sub consumatore, quando il materiale è `autonomous` con `producedByDept ≠ sub.dept`, mostra un badge **"in arrivo da {Reparto}"** invece di nasconderlo (come avviene ora).

## 4. Default e migrazione

- Nessuna regola = comportamento attuale (il materiale è del reparto che lo usa, niente cross-dependency).
- Le regole si applicano solo alle commesse create *dopo* il salvataggio.

## Dettagli tecnici

- Nuovo file `src/lib/material-dependencies.ts` con hook `useMaterialDependencies()` + `matchRule(materialName, consumerDept)`.
- Match: case-insensitive, `material_pattern` confrontato come *contains* sul nome materiale.
- I tipi `ProdDept` esistono già in `src/lib/produzione/types.ts` — riuso quelli.
- Migrazione separata con GRANT su `authenticated` + `service_role`.

## Fuori scopo

- Override per singola commessa (puoi aggiungerlo dopo).
- UI di gestione regole nelle commesse già create (le regole valgono solo per nuove commesse).
- Inferenza automatica da catalogo: tutte le regole sono manuali.
