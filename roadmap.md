# Tasks

- [x] Connect Conti manual synchronization to guarded open-banking.io transaction import; 22 tests pass, 556 Credem and 36 BNL movements imported and read back through the signed-in UI. Repeated request adds zero duplicates and banks report rate_limited.

- [x] Finish deployed open-banking.io getAccounts smoke test: authenticated deployed read succeeded with 2 accounts and credentials stored securely.
- [x] Replace stale Enable account counts and controls in Conti with live open-banking.io accounts; verified 1 Credem account and 1 BNL account, retaining existing transactions and PayPal.
- [ ] Complete legacy Enable retirement and scheduled dispatcher replacement as the remaining provider migration; not part of this manual-sync fix and schedule activation awaits explicit user instruction.

- [x] Complete existing banking schema with accounts, balances, pending movements and safe synchronization logs.
- [x] Extend existing authorization/sync and CSV import with shared deduplication; preserve manual cash reconciliation.
- [x] Add account balances, filters, renewal warnings and manual synchronization to Conti and display balances separately in Generale.
- [x] Prepare inactive 07:00/14:00 Europe/Rome synchronization schedule; activate only on explicit user request and verified terms.
- [x] Run 21 focused regression tests and signed-in Conti CSV save/read-back/reimport checks; verified provider-channel deduplication with synthetic data and removed temporary records. Live provider import remains blocked pending commercial terms.

- [x] Configure Enable Banking credentials and verify the active Tecnofra application and business support for Credito Emiliano and BNL Corporate.
- [x] Add state-bound bank authorization callback and guarded booked-movement import with duplicate protection.
- [x] Explain where to find the Tecnofra application ID and downloaded private key, with secure-entry guidance.
- [x] Add safe Credem/BNL preparation flow with authenticated prerequisite assessment, official provider links, unknown costs/renewals clearly disclosed and activation blocked; verified both banks through the signed-in UI and 15 passing tests.

- [x] Use joint nesting for Tappezzeria fabric totals and choose the lowest-cost roll height.
- [x] Test shared-cut consumption and cheaper taller rolls; verify the quote flow.
- [x] Add Conti with Credem/BNL statement imports and manual full/partial reconciliation to competence or direct cash.
- [x] Activate and verify open-banking.io imports: user confirmed €3 + €1 plan, official terms verified and saved (€4/month for two accounts); business consent verified and 592 movements imported. No wallet top-up or auto-pay activated.
- [ ] Activate background bank updates: inactive job remains off; waiting for explicit user instruction and migration of the scheduled dispatcher to open-banking.io.
- [x] Test reconciliation persistence, amounts, duplicate protection and accounting read-back; verified a 1 € outgoing payment against 1.50 € competence leaves 0.50 €, plus a direct 0.50 € incoming payment, using temporary records removed afterward.