

## Suggested Features / Follow-ups

- [x] **Route every surface through `buildBillableLines`.** This is the single highest-value change and would close C3, most of the timesheet issues, and the running-timer discrepancy in one pass. The function already exists and is well-tested. *(Done as part of C3, via `buildLinesFromSettings`.)*
- [ ] **Give `updateGroup`/`updateTimecode` an `updatedAt` stamp and a DB read**, matching the pattern the delete paths already use on this branch.
- [ ] **Preserve real pause segments in the edit modal** — show them as a list with add/remove, and reserve the single "break minutes" field for entries that have none. *(C4 stops the silent rewrite and warns before a deliberate one; per-segment add/remove editing is still outstanding.)*
- [ ] **Guard `splitEntry`** against `manualAmount`, or prompt the user to assign the fee to one half.
- [x] **Make `updateSettings` read-modify-write from the DB and broadcast**, closing the cross-tab clobber. *(The merge and the broadcast were already in place; `TemplateList` was still handing it a whole settings snapshot as the "updates", which made the merge a no-op. It now passes only the `templates` delta, like every other caller.)*
- [ ] **CSV import**: two-pass (validate all rows, then create timecodes), a row cap, tag/amount column support, and explicit date-format selection instead of `new Date()` fallback.
- [ ] **CI**: `npm audit --audit-level=high` will block unrelated deploys on any new upstream advisory; `npx license-checker` is unpinned and resolves at build time; the workflow has no `permissions:` block and no `concurrency:` group. The `on: push` trigger paired with `if: github.event_name == 'workflow_dispatch'` on the deploy job means pushes verify but never deploy — worth a comment if intentional.

