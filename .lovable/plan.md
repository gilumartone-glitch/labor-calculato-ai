

## Cosa costruisco

Un flusso unico "Lavorazione guidata" usato da:
1. **Calcolatore → Crea commessa** (`CreateCommessaButton`)
2. **Flow → Nuova commessa** (`CommessaDialog`)
3. **Produzione → Lancia ordine** (`LaunchOrderDialog`)

In tutti e tre l'utente compila gli stessi 4 step:

```text
[1] Macroreparto      → Laboratorio | Tappezzeria | Montaggi
[2] Microreparti       → checklist filtrata sul macro scelto
[3] Responsabile       → solo utenti con macroreparto in profiles.settori
[4] Operatori per micro→ solo utenti con quel micro in profiles.settori
[5] Dipendenze         → drag-order tra i micro attivati (chi blocca chi)
```

## Mappa macro → micro (default, modificabile)

| Macroreparto | Microreparti |
|---|---|
| Laboratorio | grafica, stampa, taglio, confezione |
| Tappezzeria | taglio_tessuti, cucito, montaggio_tende |
| Montaggi    | trasporto, installazione |

Aggiungerò i micro mancanti come valori riconosciuti in `profiles.settori` (oggi il campo è già `text[]`, quindi nessuna migration sul tipo — solo costanti TS in un nuovo `src/lib/reparti.ts`).

**Conferma o correggi questa mappa nel prossimo messaggio** — la uso come default se non rispondi.

## Comportamento

- **Filtro responsabili**: `profiles.settori` contiene almeno uno dei micro del macro scelto.
- **Filtro operatori per micro**: `profiles.settori` contiene quel micro specifico.
- **Dipendenze configurabili**: per ogni micro attivato l'utente sceglie "dipende da" (0..N micro precedenti). Default proposto = sequenza nell'ordine di selezione. Salvate in `production_sub_orders.depends_on` (campo già presente).
- **Sblocco automatico**: un sub-order resta `bloccato` finché tutti i suoi `depends_on` sono `completato`. Quando l'ultimo predecessore si completa, lo sblocco e mando notifica all'assegnatario.

## Modifiche tecniche

**DB (1 migration)**
- `production_sub_orders`: aggiungo `macro_reparto text`, `operator_ids uuid[]` (oltre all'esistente `assignee_id` = responsabile micro), `blocked_until_completed uuid[]` opzionale se serve multi-depends (oggi `depends_on` è singolo: lo estendo a array o tengo singolo e replico la riga? → **estendo a array** `depends_on_ids uuid[]`, mantengo `depends_on` per retrocompatibilità).
- `commesse`: aggiungo `macro_reparto text`, `responsabile_id uuid`, `operator_ids uuid[]`.
- Trigger `unlock_dependent_subs()` che on UPDATE di `status='completato'` setta a `in_corso` (o `pronto`) i sub con tutti i predecessori chiusi e crea notifiche.

**Frontend (nuovo componente condiviso)**
- `src/lib/reparti.ts` — costanti `MACRO_REPARTI`, `MICRO_BY_MACRO`, helper `filterUsersByMicro()`.
- `src/components/shared/LavorazioneGuidedForm.tsx` — il wizard 4-step riusato dalle tre schermate.
- Aggiornati: `CreateCommessaButton.tsx`, `flow/CommessaDialog.tsx`, `produzione/LaunchOrderDialog.tsx` per montarlo.

**Hub / Pianificazione**
- La Pianificazione mostra già `production_sub_orders` come impegni: aggiungerò il chip "🔒 bloccato" finché i predecessori non sono chiusi e il chip si sblocca da solo via realtime.

## Cosa NON tocco

- Permessi (`has_permission`) e ruoli admin: invariati.
- UI Hub, Record, Calendario operai: invariati.
- Logica importo/cliente nei dialog esistenti: invariata.

## Domande aperte (rispondi se vuoi cambiare i default)

1. Mappa macro→micro qui sopra: ok o aggiungo/tolgo qualcosa (es. "falegnameria" come macro a sé)?
2. Quando crei una lavorazione **dal Flow**, devo generare automaticamente i `production_sub_orders` corrispondenti (uno per micro attivato) o tenere il flow separato dalla produzione?

