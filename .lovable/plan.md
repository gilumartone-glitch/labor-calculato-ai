
# Piano interventi

## 1. Dialog "Conferma → Magazzino" — ridurre ai campi mancanti

File: `src/components/produzione/ConfirmToWarehouseDialog.tsx` + 4 chiamanti (`CreateCommessaButton`, `CommessaDetailDialog`, `DraftTabsBar`, `MagazzinoCalc`).

- Aggiungere props opzionali: `defaultAssigneeId`, `defaultAcquistiAssigneeId`, `defaultSupplierByMaterialKey`, `hideOrderRef`, `hideProductionName`.
- Comportamento:
  - Se `defaultRef` e `defaultProductionName` sono già valorizzati dal chiamante → mostrarli in un **riquadro compatto di riepilogo non editabile** in cima ("Ordine: 955 · Prod. FONDALI PANNO OSCURANTE · ✎ modifica"), con un piccolo link "modifica" che ri-mostra i due campi solo se serve.
  - Pre-selezionare automaticamente il **primo responsabile magazzino** e nasconderlo dietro un riepilogo "Responsabile: Federica · ✎ cambia". Idem responsabile acquisti.
  - Per i materiali da ordinare, **pre-selezionare un fornitore di default** se la scheda materiale lo conosce (passato dal chiamante via `defaultSupplierByMaterialKey`), evitando di doverlo riscrivere.
- Il dialog continua a essere essenziale solo dove serve: spunta "in magazzino sì/no" sui materiali + eventuali override.

## 2. Comanda acquisti — chiarezza e ciclo chiuso

File: `src/pages/produzione/ProdAcquisti.tsx` + `src/lib/produzione/types.ts` + migrazione DB.

- Estendere `production_sub_orders` (dept = `acquisti`) con campi opzionali: `material_qty numeric`, `material_unit text`, `material_code text`, `material_label text`, `due_date date`, `order_status text` (`da_ordinare`/`ordinato`/`in_transito`/`arrivato`).
- Popolare questi campi quando si crea il sub-order acquisti nel flusso warehouse (`ConfirmToWarehouseDialog.onConfirm` → handlers in `DraftTabsBar`/`CreateCommessaButton`/`CommessaDetailDialog`), usando i dati già aggregati da `extractMaterialsFromSnapshot` (qty, unit, code, name, supplier).
- Riprogettare la card di `ProdAcquisti`:

```text
┌─────────────────────────────────────────────────────────┐
│ ORD-2026-012 · cliente 955 · FONDALI PANNO OSCURANTE   │
│ ┌─ DA ORDINARE ─────────────── entro Mar 10 ──────────┐│
│ │  ╔══════════════════════════════════════════╗      ││
│ │  ║   12.5 m²   Panno Oscurante h300         ║      ││
│ │  ║   cod. PAN-300-NAT                       ║      ││
│ │  ╚══════════════════════════════════════════╝      ││
│ │  Fornitore: IBENA           [cambia]              ││
│ └────────────────────────────────────────────────────┘│
│ Stato:  ● Da ordinare  ○ Ordinato  ○ In transito  ○ Arrivato │
│                                       [✔ Segna arrivato]│
└─────────────────────────────────────────────────────────┘
```

- La quantità è il dato visivamente dominante (font grande, riquadro pieno).
- Pulsanti per avanzare lo stato (`da_ordinare → ordinato → in_transito → arrivato`).
- Quando `arrivato`, il sub si completa e parte la notifica al responsabile della lavorazione bloccata + magazzino (già esistente).

## 3. Separazione lavorazione vs acquisti — "cerchio chiuso"

File: `src/pages/produzione/ProdBoard.tsx` (o componenti card lavorazione) + `src/lib/produzione/helpers.ts`.

- Quando un sub di lavorazione (es. `tappezzeria`) dipende da un sub `acquisti` non ancora arrivato:
  - mostrare la card lavorazione **già assegnata all'operatore** ma con stato `bloccato_attesa_materiale` (badge ambra visibile);
  - elencare i materiali in attesa con quantità + fornitore + stato ordine;
  - il pulsante "Inizia lavorazione" è disabilitato finché tutti i sub acquisti collegati non sono `completato`.
- Quando l'ultimo `acquisti` collegato passa a `completato`:
  - notifica push all'`assignee_id` del sub di lavorazione: "✅ Materiale arrivato per ORD-… — puoi iniziare la lavorazione";
  - card si sblocca automaticamente.
- Logica `depends_on` già esistente in DB → estendiamo per supportare *più* dipendenze acquisti (campo array `depends_on_ids` oppure controllo lato app su `subs.filter(dept==='acquisti', order_id)`).

## 4. Notifiche push sui cellulari

Diagnosi attesa:
- Service worker `/sw.js` c'è e gestisce `push`/`notificationclick` correttamente.
- Edge function `send-push` c'è e usa VAPID + iscrizioni `push_subscriptions`.
- Trigger `dispatch_push_on_notification` punta a un progetto Supabase **diverso** (`nnuxzyrchpbpztohlunb`) — il nostro è `oylveuwfvsijguwzlauw`. **Questo è il bug principale**: nessuna push viene mai inviata in produzione.

Interventi:
- Migrazione: aggiornare `dispatch_push_on_notification` per chiamare `https://oylveuwfvsijguwzlauw.supabase.co/functions/v1/send-push` con la `SUPABASE_ANON_KEY` corretta (o usare `service_role` via Vault).
- Aggiungere un piccolo pannello "Notifiche push" nelle impostazioni utente (o nella `NotificationsBell`) per:
  - mostrare stato (`unsupported`/`denied`/`default`/`subscribed`);
  - bottone "Abilita notifiche push" che chiama `subscribePush(user.id)`;
  - istruzioni iOS: "Installa l'app sulla home (Condividi → Aggiungi a Home) PRIMA di abilitare le push", perché iOS richiede PWA installata per le web push.
- Verifica `manifest.webmanifest`: ok per installabilità.
- Test rapido via bottone "Invia test" che chiama `send-push` con il proprio user_id.

## Ordine di esecuzione

1. Migrazione DB: campi acquisti + fix trigger push.
2. ConfirmToWarehouseDialog ridotto + propagazione default da chiamanti.
3. Salvataggio dei dati materiale nei sub acquisti.
4. ProdAcquisti riprogettato.
5. Card lavorazione bloccata + notifica sblocco.
6. UI iscrizione push + istruzioni mobile.

## Note tecniche

- I dati materiale (qty/unit/code/supplier) sono già calcolati da `extractMaterialsFromSnapshot` — riusare senza ricalcolare.
- Per "responsabile di default" usiamo il primo profilo con settore corrispondente (come già fa `ConfirmToWarehouseDialog` oggi) e lo passiamo a riposo dietro un riepilogo "✎ cambia".
- Per il bug push: il riferimento al ref Supabase sbagliato (`nnuxzyrchpbpztohlunb`) nel trigger spiega perché "le notifiche non arrivano sui cellulari" anche se l'iscrizione funziona.
