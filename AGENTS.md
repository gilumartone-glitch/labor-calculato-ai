# Architecture rules

- Upholstery roll nesting compares shared cuts across all compatible heights with separate-height cuts by total cost; quote totals use `src/lib/upholstery-totals.ts` with the saved nesting settings and overrides to match the department cards.

- Accounting writes, including owner and page-close saves, use the authorized merge RPC to avoid overwriting another user's hours.
- Hours merge uses stable employee/row identity, deletion tombstones, and per-day edit timestamps; cleared days remain explicit empty cells so stale copies cannot restore them.
- `src/lib/hours-sync.ts` mirrors the database hours merge and has focused regression tests.
- Monthly movement ordering uses `src/lib/movement-order.ts` and freezes row positions during entry so editing cannot relocate the active form before confirmation.- Accounting list rows (movements, fixed expenses, salaries, contacts) carry `_u` edit time; client (`src/lib/row-sync.ts`) and database list merge keep the newest copy so failed saves or stale devices cannot revert edits.
- Realtime-triggered reloads go through `src/lib/coalesce.ts` (debounced, one at a time) and store reloads are single-flight; save retries back off and never overlap, so event bursts cannot flood the small database.
- Bank statement rows and allocations live separately from accounting state; reconciliation uses a locked, idempotent authorized RPC to create dated cash movements and reduce competence residuals atomically, preserving prior advances and preventing duplicate allocations.
- Open-banking setup uses an authenticated server assessment and fails closed until a production provider adapter and verified commercial/consent evidence exist; client acknowledgements never activate synchronization or establish compatibility.
