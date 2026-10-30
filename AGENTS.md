# Architecture rules

- Upholstery roll nesting compares shared cuts across all compatible heights with separate-height cuts by total cost; quote totals use `src/lib/upholstery-totals.ts` with the saved nesting settings and overrides to match the department cards.

- Accounting writes, including owner and page-close saves, use the authorized merge RPC to avoid overwriting another user's hours.
- Hours merge uses stable employee/row identity, deletion tombstones, and per-day edit timestamps; cleared days remain explicit empty cells so stale copies cannot restore them.
- `src/lib/hours-sync.ts` mirrors the database hours merge and has focused regression tests.
- Monthly movement ordering uses `src/lib/movement-order.ts` and freezes row positions during entry so editing cannot relocate the active form before confirmation.- Accounting list rows (movements, fixed expenses, salaries, contacts) carry `_u` edit time; client (`src/lib/row-sync.ts`) and database list merge keep the newest copy so failed saves or stale devices cannot revert edits.
- Realtime-triggered reloads go through `src/lib/coalesce.ts` (debounced, one at a time) and store reloads are single-flight; save retries back off and never overlap, so event bursts cannot flood the small database.
- Bank statement rows and allocations live separately from accounting state; reconciliation uses a locked, idempotent authorized RPC to create dated cash movements and reduce competence residuals atomically, preserving prior advances and preventing duplicate allocations.
- Open-banking setup uses an authenticated server assessment and fails closed until a production provider adapter and verified commercial/consent evidence exist; client acknowledgements never activate synchronization or establish compatibility.
- Enable Banking credentials and session/account identifiers remain server-only; state-bound one-time callbacks bind consent to the requesting user, and statement imports require verified commercial evidence and valid business consent to avoid unauthorized reads or unknown charges.
- Bank accounts expose only masked IBANs; provider and CSV imports use the same locked storage RPC and canonical account/reference identity. Pending records cannot be allocated, and bank balances remain separate from reconciled accounting cash totals to prevent double counting.
- Bank scheduled dispatch uses Europe/Rome local-hour guards with an inactive cron and a server-only token; both schedule and commercial gates must be enabled before any unattended request.
- Bank sync prerequisite failures return an HTTP-success typed blocked result with zero imports, not an error; clients show that state without throwing so expected safety gates cannot blank the preview.
- Provider replacement is gated on a deployed authenticated SDK read/decryption smoke test; diagnostic responses expose only count/masked IBANs and sanitized failure codes, never raw provider errors or keys.
- Conti displays active banking accounts through authenticated obio-accounts reads, not legacy Enable consent counts; provider credentials and account/session identifiers stay server-only, and this read does not initiate bank synchronization.
- Manual open-banking.io imports use obio-sync with provider-specific verified commercial terms, live business consent, a service-only run lock, stable hashed account identity, decimal-string normalization and the shared storage RPC; this does not enable scheduled synchronization.
