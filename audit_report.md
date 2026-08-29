

## Suggested Features / Follow-ups

- [x] **Route every surface through `buildBillableLines`.** This is the single highest-value change and would close C3, most of the timesheet issues, and the running-timer discrepancy in one pass. The function already exists and is well-tested. *(Done as part of C3, via `buildLinesFromSettings`.)*
- [x] **Give `updateGroup`/`updateTimecode` an `updatedAt` stamp and a DB read**, matching the pattern the delete paths already use on this branch.
- [ ] **Preserve real pause segments in the edit modal** — show them as a list with add/remove, and reserve the single "break minutes" field for entries that have none. *(C4 stops the silent rewrite and warns before a deliberate one; per-segment add/remove editing is still outstanding.)*
- [x] **Guard `splitEntry`** against `manualAmount`, or prompt the user to assign the fee to one half. *(H5: the split modal now asks where a flat fee goes — first half, second half, or removed — and the estimate is divided in proportion to each half's tracked time rather than dropped. `splitEntry` returns a discriminated result, so a declined split no longer closes the modal as though it had succeeded.)*
- [x] **Make `updateSettings` read-modify-write from the DB and broadcast**, closing the cross-tab clobber. *(The merge and the broadcast were already in place; `TemplateList` was still handing it a whole settings snapshot as the "updates", which made the merge a no-op. It now passes only the `templates` delta, like every other caller.)*
- [x] **CSV import**: two-pass (validate all rows, then create timecodes), a row cap, tag/amount column support, and explicit date-format selection instead of `new Date()` fallback.
- [ ] **CI**: `npm audit --audit-level=high` will block unrelated deploys on any new upstream advisory; `npx license-checker` is unpinned and resolves at build time; the workflow has no `permissions:` block and no `concurrency:` group. The `on: push` trigger paired with `if: github.event_name == 'workflow_dispatch'` on the deploy job means pushes verify but never deploy — worth a comment if intentional.

## Fixed on this branch — High severity

- [x] **H1 — CSV date parsing was timezone-shifted for date-only rows.** All three formats now anchor a bare date to local midnight. Tests run under `Pacific/Auckland`, `America/Los_Angeles` and `UTC` and assert the local calendar date, since the bug is invisible under UTC alone.
- [x] **H2 — `autoPurgeTrash` leaked templates.** Templates for hard-deleted timecodes are stripped in the same pass, so a backup cannot be made un-importable by the 30-day cleanup. The purge reports what it removed, and a failure is surfaced instead of going to `console.error`.
- [x] **H3 — `mergeTimecodes` failures were silent.** `handleMergeSave` catches, toasts the (already user-readable) message, and resets the panel in a `finally`.
- [x] **H4 — a failed CSV import left orphan timecodes.** `createdTimecodes` is hoisted out of the `try` and rolled back in the `catch`.
- [x] **H5 — `splitEntry` destroyed fees and estimates, and reported success regardless.** See the follow-up above.
- [x] **H6 — merge-mode import clobbered settings and skipped overlap checks.** `Settings` gained `updatedAt`, stamped centrally in `db.putSettings`, and merge compares it like every other record; templates still merge as a union. Imported entries are checked for overlaps against local ones, and the running-timer rule is judged against the local `allowConcurrentTimers` plus timers already running here — the same inputs the import preview now uses.
- [x] **H7 — `roundingScope` `timecode`/`invoice` gave every view a different number.** `BuildOptions` gained an explicit `scopeWindow`; each surface names the window it reports on. The entry list has no reporting period, so those two scopes degrade to `day` there rather than pooling all of history — the settings panel says so where the scope is chosen. `TimeTotals.consistency.test.tsx` now exercises both wide scopes.
- [x] **H8 — storage write failures failed silently.** `mutate`/`mutateValue`/`reportAndRethrow` in the context log, toast and (where the caller needs it) rethrow; cascades are guarded at the provider boundary. Success toasts are gated on the write resolving, and `QuotaExceededError` gets its own message pointing at export and the trash.

### Note on the C1–C4 fixes

`tsc -b` was failing on the critical-fix commit: the new `emptyTrash` template test built `EntryTemplate` literals with `name`/`defaultDurationMinutes`, but the interface declares `title`/`durationMinutes`. Vitest does not typecheck, so the test passed while `npm run build` did not. Fixed, along with two `no-unused-vars` warnings that appeared when the theme boot script moved into `public/` and so into oxlint's scope. `deleteEntry` had also moved its toast outside the `if (entry)` guard when it gained the timer queue, reporting success for an id that no longer existed; `bulkDeleteEntries` counted requested ids rather than trashed ones.
