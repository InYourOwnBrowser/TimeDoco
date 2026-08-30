

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

---

## Follow-up audit — Critical and High severity

A second pass over the branch found that several of the fixes above were applied
in one place and not in its sibling. These close that gap.

### Critical

- [x] **C1 — `splitEntry` wrote both halves unguarded.** The two sequential
  `putEntry` calls were two transactions: the first truncated the original to
  the first half, so a failure on the second destroyed the remainder and any fee
  allocated to it, with no rollback and nothing shown to the user. `db` gained
  `putEntries`, which writes a set of entries in one `readwrite` transaction, and
  the call is wrapped in `mutateValue`. A failed split now leaves the entry
  exactly as it was and returns `{ ok: false }`, which the split modal already
  reports without closing.

- [x] **C2 — success toasts fired for writes that never happened.** `updateEntry`,
  `addManualEntry`, `updateSettings`, `updateGroup` and `updateTimecode` returned
  `Promise<void>`, so a caller could not tell a failed write from a successful
  one: a quota error produced the red storage toast *and* a green "Changes
  saved", and the modal closed, discarding what the user had typed. All five now
  resolve to whether the change was stored, and `EntryEditModal`,
  `ManualEntryModal`, `SettingsModal` and `TemplateList` gate their toast and
  their close on it, leaving the form mounted with its state intact on failure.
  `guarded(...)` reports its result the same way, for the cascades.

- [x] **C3 — four views produced four different billable figures.** H7's
  `scopeWindow` had not reached every surface. `TimesheetMatrixView` passed none,
  so `timecode` and `invoice` scope silently degraded to `day` and the grid
  disagreed with the calendar tab beside it; it now names the visible week.
  `AnalysisView` built its lines over the group/timecode-filtered subset, which
  violates the documented contract that the caller pass every entry in the
  window — at `invoice` scope, changing the group dropdown moved each entry's
  billable minutes. It now builds over every entry in the period and filters for
  display. `TimeTotals.consistency.test.tsx` covers the grid and the calendar
  side by side at both wide scopes, on entry lengths where the scopes actually
  disagree.

### High

- [x] **H1 — idle detection billed the idle time it exists to remove.** The
  activity listeners stay attached while the prompt is up, so moving the mouse to
  click "No, pause timers" reset the last-activity time and the retroactive pause
  landed at ~now. The idle-start instant is captured when the prompt is raised.

- [x] **H2 — `updateEntry` bypassed the timer queue.** It reads a whole entry and
  writes it back, and both `ForgotToStopPrompt` and `EntryEditModal` call it on
  running entries, so a stop or the one-second note autosave landing between the
  read and the write was overwritten by the pre-edit copy. Its body now takes
  `runExclusive`, like every other whole-record writer.

- [x] **H3 — `EntryEditModal` carried a stale end time onto another entry.** The
  re-sync effect had no `else` branch, so pointing the modal at a running entry
  without unmounting kept the previous entry's end time and saving closed a live
  timer at a timestamp copied from an unrelated record. Every field is now reset
  unconditionally, as `EntrySplitModal` already did, and the three call sites key
  the modal on the entry id so a different entry remounts.

- [x] **H4 — template undo discarded templates created in the undo window.** The
  undo replayed a snapshot taken before the delete. A new `restoreTemplate`
  merges the removed template against a fresh read, at its original index — the
  pattern `deleteTimecode`'s undo already used.

- [x] **H5 — the import preview did not validate what the import validates.** It
  checked neither `schemaVersion` nor the checksum, so a hand-edited or
  future-format backup showed a clean green preview and then failed. `size`,
  parse, checksum and schema version now live in one shared `verifyBackupFile`
  that both paths call, and the preview reports the post-overlap count from the
  same `findOverlappingCandidates` pass the merge uses.

- [x] **H6 — `undoStopTimer` had no error handling.** It runs from a toast action
  that cannot await it, so a failed `putEntry` was an unhandled rejection: no
  error, no restored timer. Wrapped in `mutateValue`, with `null` (write failed)
  distinguished from `false` (another timer running).

- [x] **H7 — CSV import duplicated a timecode whose name was in the trash.** The
  name lookup read live timecodes only, unlike the JSON path. It now resolves
  against every timecode in the database and offers to reuse the trashed record,
  asking first because restoring one also restores the entries trashed with it.

- [x] **H8 — orphan timecodes survived an import that imported nothing.**
  `bulkAddManualEntries` resolves with `added: 0` when its own overlap pass
  rejects every row, so the `catch` never ran and the rollback never happened.
  Rollback now also runs on `added === 0`, and counts what `hardDeleteTimecode`
  actually reports rather than assuming a guarded call succeeded.

---

## Third audit — Critical and High severity

Each of these is a case where a fix landed on one path and its sibling kept the
old behaviour, or where a figure a client is invited to check did not add up.

### Critical

- [x] **C1 — deleting a group destroyed its timecodes' templates, and neither
  Undo nor Trash brought them back.** `deleteGroup` stripped every template
  belonging to the cascade, then offered an Undo that restored the group, its
  timecodes and their entries and nothing else; restoring from the Trash a day
  later was the same. `deleteTimecode` had the same hole one step out: its undo
  handler reconstructed the templates, so they were recoverable for five seconds
  and gone after that. Neither path deletes templates any more — a soft delete is
  reversible, so nothing of the user's is destroyed by one. A template whose
  timecode is in the trash is hidden in `TemplateList` (it has nothing to log
  against) and comes back with the timecode. Templates are still purged for good
  alongside the timecode in `hardDeleteTimecode`, `emptyTrash` and
  `autoPurgeTrash`, which is where a permanent delete belongs.

### High

- [x] **H1 — a flat fee on an entry with tracked time made Rate × Hours ≠ Total.**
  A "Fixed Amount" on an ordinary time entry billed as a fee *and* contributed
  its hours to the row, so a $100/hr timecode with one hour plus a 40-minute
  $150 fee printed Hours 1.75 · Rate $100.00/hr · Total $250.00 — the two columns
  beside each other multiplying out to $175. A fixed cost now bills as a fee and
  nothing else: `seconds` and `hours` are 0, its time on the clock stays in
  `workedSeconds` for the worked-vs-billed disclosure, and `displaySecondsFor`
  keeps the entry's own row showing the duration rather than `0s`. The summary
  table, the on-screen breakdown and the summary CSV grow a Fees column when
  there are fees, so `rate × hours + fees = total` is visible; a fee's detail row
  prints a dash for Hours. The special `f:` rounding bucket is gone with it — it
  had been rounding a fee at entry scope whatever scope was configured.

- [x] **H2 — `timecode` and `invoice` scope still gave three answers for one
  entry.** C3 had every surface name a scope window, but each named its own: the
  entry list all of history, the grid its week, the calendar its month, the
  report its period. Since a wide bucket *is* its window, the surfaces
  necessarily disagreed — two 20-minute entries billed as 15 minutes in the list,
  20 on the calendar and 22.5 on the grid tab beside it. The wide scopes are now
  properties of the report: only `AnalysisView` names a window, and every other
  surface passes `scopeWindow: null` and degrades to `day`, which is the one
  bucket they can all build identically. The settings help text says so. The
  consistency test grows a fixture whose two entries share a month but not a
  week, so the grid's window and the calendar's genuinely differ — the earlier
  fixture compared two surfaces over the same span and could not have caught it.

- [x] **H3 — CSV import matched timecodes by name only, so rows could bill to the
  wrong client.** Names are unique only within a group, so "Design" can sit under
  both Acme and Globex; the import resolved globally and took the first match,
  which is IndexedDB key order — arbitrary, and not the same on two devices. It
  now resolves on group + name where the CSV has a `Group` column (the column
  TimeDoco's own detailed export already writes) and on the name alone where it
  does not, and stops before writing anything if a name a surviving row needs
  matches more than one timecode, naming the groups it could have meant. A named
  group that does not exist yet is created, so the row lands where the CSV says
  and a second import of the same file resolves against it.
