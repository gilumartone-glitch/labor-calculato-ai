# Tasks

- [ ] Simplify bank causali and direct-cash defaults: payer/recipient only for transfers, CARTA DI DEBITO for international debit-card payments; preserve full descriptions and verify both examples.

- [x] Restrict Conti, banking reads and interactive actions to gmartone@tecnofra.it; 20 tests passed, authorized UI/read verified, another account denied by server helper, scheduled imports remain active.

- [x] Enable automatic Credem, BNL and PayPal synchronization at 08:30 and 15:00 Europe/Rome; single active job 128, DST-aware dispatcher and server-only authorization.
- [x] Verify configuration and scheduled authorization: PayPal succeeds; Credem/BNL respond rate_limited after prior manual calls. Active times verified in signed-in Conti; 20 focused tests passed.

- [x] Remove obsolete accounts from Conti selectors using live provider identity; verified only BNL, current Credem and PayPal remain.
- [x] Add authorized bulk editing and deletion, preserving allocations and preventing deleted records or manual edits from being restored by sync.
- [x] Remove 712 bank movements before 24 October 2026 and enforce the inclusive starting date for every import channel; verified zero earlier records remain.
- [x] Verify bulk save/delete persistence and cutoff: 23 tests pass; signed-in UI edited/deleted two temporary rows and reimport added zero rows.

- [x] Connect Conti manual synchronization to guarded open-banking.io transaction import; 22 tests pass, 556 Credem and 36 BNL movements imported and read back through the signed-in UI. Repeated request adds zero duplicates and banks report rate_limited.

- [x] Finish deployed open-banking.io getAccounts smoke test: authenticated deployed read succeeded with 2 accounts and credentials stored securely.
- [x] Replace stale Enable account counts and controls in Conti with live open-banking.io accounts; verified 1 Credem account and 1 BNL account, retaining existing transactions and PayPal.
- [x] Replace the scheduled legacy Enable dispatcher with bank-scheduled-sync for open-banking.io and PayPal; old manual Enable code is not used by the active schedule.

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
- [x] Activate background updates with the user's revised 08:30/15:00 Italian schedule; external bank rate limits remain enforced, no automatic immediate retries.
- [x] Test reconciliation persistence, amounts, duplicate protection and accounting read-back; verified a 1 € outgoing payment against 1.50 € competence leaves 0.50 €, plus a direct 0.50 € incoming payment, using temporary records removed afterward.