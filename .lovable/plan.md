# Task nel Flow (non produttivi)

Aggiungiamo un secondo tipo di elemento gestibile dentro `/produzione`, a fianco delle commesse: i **Task**. Stessa infrastruttura di assegnazioni, notifiche, chat, allegati e audit, ma senza reparti/pezzi/nesting/materiali.

## Categorie (6, fisse in v1, colore + icona dedicati)
- Amministrazione
- Acquisti
- Vendite
- Marketing
- HR
- Generico

Ogni categoria è un permesso a sé (`tasks_amministrazione`, `tasks_acquisti`, `tasks_vendite`, `tasks_marketing`, `tasks_hr`, `tasks_generico`) gestibile dalla pagina Utenti come tutti gli altri. Gli admin vedono tutto.

## Cosa fa un Task
Titolo, descrizione ricca, categoria, priorità (bassa/media/alta/urgente), stato (`da_fare`, `in_corso`, `in_attesa`, `bloccato`, `completato`, `annullato`), responsabile, assegnatari multipli, data inizio, scadenza, promemoria, checklist, allegati, commenti, collegamento opzionale a: commessa, cliente/fornitore (marketing_contacts), sub-progetto di progettazione.

## Dipendenze bidirezionali
Un task può essere **bloccato da** uno o più task **o** sub-ordini di produzione, e viceversa un sub-ordine di produzione può essere bloccato da un task. Quando il predecessore passa a "completato" il trigger sblocca il successore (estensione di `unlock_dependent_subs`) e manda notifica al responsabile.

Esempi che il sistema abiliterà:
- "Assemblaggio tavolino" bloccato da "Acquisti: ordinare viti"
- "Fatturare commessa X" sbloccato quando tutti i sub-ordini della commessa X sono completati
- "Vendite: firma preventivo" prerequisito del lancio in produzione (blocca la creazione automatica della commessa fino a completamento)

## UX

### Ingresso principale — pagina `/produzione`
- Nuova **tab "Task"** accanto ai reparti, con filtro per categoria (chip colorati) e vista Kanban + lista.
- Bottone globale **+ Nuovo task** in header.

### Dal progetto in Progettazione
Nel `SubProjectBar`, accanto a "Lancia nel Flow", nuovo menu **"+ Task collegato"** con le 6 categorie. Il task nasce già linkato al sub-progetto (visibile nel timeline del progetto e nella board Task).

### Dettaglio task
Dialog full-screen tipo `SubOrderDetailDialog`, con tab: Dettagli · Checklist · Allegati · Commenti · Dipendenze · Cronologia.

## Cosa NON avranno i Task (di proposito)
Niente pezzi, niente catalogo materiali, niente nesting, niente scarichi magazzino, niente reparti produttivi. Restano puliti e veloci.

## Dettagli tecnici

### Nuova tabella `admin_tasks`
Campi principali: `category` (enum), `title`, `description`, `status` (enum), `priority` (enum), `responsible_id`, `assignee_ids uuid[]`, `start_at`, `due_at`, `reminder_at`, `checklist jsonb`, `attachments jsonb`, `linked_commessa_id`, `linked_contact_id`, `linked_sub_project` (jsonb: draft_id + subProjectId), `created_by`, `completed_at`, `completed_by`.

### Tabella `admin_task_dependencies`
`task_id` + (`depends_on_task_id` XOR `depends_on_sub_order_id`), così una dipendenza può puntare o a un altro task o a un sub-ordine di produzione. Analogamente estendiamo `production_sub_orders` con `depends_on_task_id` (nullable) per il verso opposto.

### RLS
- SELECT: admin, `created_by`, `responsible_id`, chi è in `assignee_ids`, chi ha `has_permission('tasks_<category>', 'read')`.
- INSERT: chi ha `has_permission('tasks_<category>', 'write')` o admin.
- UPDATE/DELETE: admin, `created_by`, `responsible_id`, o `has_permission('tasks_<category>', 'write')`.
- Grants espliciti per `authenticated` e `service_role`.

### Trigger di sblocco
Estendiamo `unlock_dependent_subs` (o creiamo `unlock_dependent_tasks_and_subs`) per gestire i due lati: quando un task o un sub-ordine diventa `completato`, sblocca sia i task dipendenti sia i sub-ordini dipendenti.

### Notifiche
Riusiamo `prod_notifications` con nuovi tipi: `task_assegnato`, `task_sbloccato`, `task_scaduto`, `task_completato`, `task_mention`. Le email transazionali usano il template `notification` già esistente.

### Nuove pagine registrate in `app_pages`
Sei nuove voci `tasks_<categoria>` così compaiono nella matrice permessi dell'admin.

## Roadmap in due step
1. **Migration DB** (tabella, enums, trigger, RLS, grants, app_pages, aggiornamento `has_permission`/`unlock_dependent_subs`).
2. **Frontend**: hook `useAdminTasks`, nuova tab in `/produzione`, dialog nuovo task, dialog dettaglio, integrazione in `SubProjectBar`, badge nelle notifiche.

Confermi e procedo con la migration?