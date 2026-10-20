# Architecture rules

- Accounting writes, including owner and page-close saves, use the authorized merge RPC to avoid overwriting another user's hours.
- Hours merge uses stable employee/row identity, deletion tombstones, and per-day edit timestamps; cleared days remain explicit empty cells so stale copies cannot restore them.
- `src/lib/hours-sync.ts` mirrors the database hours merge and has focused regression tests.
- Monthly movement ordering uses `src/lib/movement-order.ts` and freezes row positions during entry so editing cannot relocate the active form before confirmation.