## Obiettivo

Trasformare la sezione "Stipendi" in Contabilità in due aree distinte:

1. **Stipendi** (solo admin) — invariata, resta come oggi.
2. **Calcolo ore** (admin + amministrazione) — nuova area presenze giornaliere con statistiche per dipendente.

## Struttura UI

Aggiungere una nuova tab "Calcolo ore" accanto a "Stipendi" nel tab bar di Contabilità. La tab "Stipendi" attuale rimane riservata all'admin; la nuova "Calcolo ore" è visibile a admin **e** ad amministrazione (chi ha `contabilita:write`).

```text
Tabs: Generale | Mensile | Movimenti | Fisse | Stipendi (admin) | Calcolo ore (admin+amm) | Grafici | Anagrafica
```

### Tab "Calcolo ore"

- Sotto-sezioni per ogni mese (accordion espandibile, come già si fa per Stipendi).
- Anno selezionabile (default anno corrente).
- Per ogni mese una **tabella presenze**:
  - Righe = dipendenti (auto-importati da `dipendenti` table, attivi). Pulsanti "Aggiungi dipendente" (libero) e "Rimuovi" per riga.
  - Colonne fisse: Nome dipendente, [N giorni del mese: 1 lun, 2 mar, …], poi colonne riepilogo: Ore lavorate, Straordinario, Trasferta, Ferie, Permessi, Malattia.
  - Ogni cella giorno è un input "ore" (0–24). Weekend evidenziati con colore tenue.
  - Per ogni cella, accanto al numero c'è un selettore tipo: `Lavoro / Trasferta / Ferie / Permesso / Malattia / Festivo`. Implementazione compatta: una pillola sotto la cella o tramite popover.
  - Calcolo automatico per riga:
    - `ore_lavoro_giornaliere = min(ore, 8)` se tipo=Lavoro/Trasferta
    - `straordinario = max(ore - 8, 0)` se tipo=Lavoro/Trasferta
    - Ferie/Permessi/Malattia conteggiati separatamente (ore o giorni)
    - Trasferta: numero giorni dove tipo=Trasferta
  - Totali a fine riga in colonne riepilogo.
- Pulsante "Vedi statistiche" su ogni nome dipendente → apre dialog con:
  - Riepilogo annuale (totali ore, straordinari, trasferte, ferie, permessi, malattia, presenza %)
  - Grafico ore mese per mese
  - Distribuzione tipi (pie chart)
  - Top mese, mese peggiore
  - Trend ultimi 6 mesi
  - Confronto con media azienda

### Persistenza

Estendere `AccountingState` con un nuovo campo:

```ts
hoursLog?: Record<string, { // chiave: `${year}-${monthIndex}`
  rows: Array<{
    id: string;
    dipendenteId?: string;       // collegamento opzionale a dipendenti
    name: string;
    days: Record<number, {       // chiave: giorno 1-31
      hours: number;
      type: 'lavoro' | 'trasferta' | 'ferie' | 'permesso' | 'malattia' | 'festivo';
    }>;
  }>;
}>
```

Salvataggio nel solito `contabilita_state` (jsonb), già sincronizzato.

### Permessi

- Tab "Stipendi" visibile solo se `isAdmin`.
- Tab "Calcolo ore" visibile se `isAdmin || can('contabilita','write')` (amministrazione = chi ha permesso scrittura contabilità). In sola lettura per i permessi `read`.

## File da modificare

- `src/pages/Contabilita.tsx` — aggiungere tipi, tab, vista "Calcolo ore", dialog statistiche dipendente.
- Nessuna migration: si appoggia al jsonb di `contabilita_state` esistente.

## Note

- Le righe vengono pre-popolate al primo accesso al mese leggendo `dipendenti` (attivi). L'utente può aggiungere/rimuovere righe libere senza toccare l'anagrafica.
- I dati sono salvati per mese; cambiare anagrafica non sovrascrive mesi già compilati.
