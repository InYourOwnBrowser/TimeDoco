# TimeDoco — `Bug_cleanup` Branch Audit

**Commit audited:** `957b42f` (merge of PR #168)
**Build status:** `tsc -b` clean · `oxlint` 2 warnings (fast-refresh only) · **185/185 tests pass**

Everything below is a logic, consistency, or design issue that the type checker and test suite do not catch. The branch's recent commits (`810b145`, `8dff446`, `7602856`, `d73e85c`, `8a39b62`) did real work unifying billing maths in `utils/billing.ts` — but **that unification only reached AnalysisView.** Four other surfaces still compute time independently, which is the dominant theme of this report.

---

## Critical

- [x] **C1 — Splitting a flat-fee entry duplicates the charge**
  `splitEntry` builds `entry2` as `{ ...entry, id: crypto.randomUUID(), ... }`. `manualAmount` is copied verbatim. Billing keys fixed costs off `entry.manualAmount != null`, so a $500 flat fee split in two bills **$1000**. `EntrySplitModal` offers no warning. `expectedDurationMinutes` is duplicated the same way, corrupting estimate stats.

- [x] **C2 — CSP `style-src 'self'` blocks every inline style**
  `public/_headers` sets `style-src 'self'` with no `'unsafe-inline'`. Under CSP Level 3, `style-src` governs `style=""` attributes. The app uses them everywhere (`style={{ backgroundColor: tc.color }}` in ActiveTimer, GlobalActiveTimerBar, GroupingManagement, and all of Recharts' internals). In production this should strip every timecode colour dot and break chart rendering. Needs verifying against the deployed site immediately — either it's broken, or the header isn't actually being applied, and both are worth knowing.

- [ ] **C3 — Four different answers for "how much time this week"**
  | Surface | Source | Rounding |
  |---|---|---|
  | AnalysisView | `buildBillableLines` (recomputed, clipped, scope-aware) | scope-aware |
  | EntryList total | `applyRounding(e.duration)` per entry | per-entry, compounds |
  | TimesheetMatrix / Calendar | `applyRounding(sum(e.duration))` per cell | per-cell, then summed |
  | WeeklySummary | hand-rolled pause maths | **none** |
  Two consequences beyond the mismatch: the stored `duration` field is `0` while a timer runs, so **running timers contribute nothing** to the timesheet and entry-list totals but count in reports; and `WeeklySummary` re-implements pause subtraction without the `mergePausedSegments` overlap-merging that `timeUtils` added precisely because duplicate segments over-subtract. `AnalysisView`'s own `timelineDays` also ignores `roundingScope`, applying `applyRounding` per entry-slice.

- [ ] **C4 — Editing any entry silently rewrites its pause history**
  `EntryEditModal` collapses all pause segments into one integer `breakMinutes` field, then on save replaces `pausedSegments` with a single block anchored at the entry start. Two losses: the real pause timeline is destroyed, and `Math.round(...)` to whole minutes means **saving an unrelated field (a note) can shift the entry's duration by up to 30 seconds**. Nothing tells the user.

- [ ] **C5 — Global stop-guard lets a second timer start while one is stopping**
  `isStoppingTimerRef` is a single module-level flag. `startTimer` loops `await stopTimerById(...)` to enforce non-concurrency, but if a stop is already in flight the call returns `false` silently and `startTimer` proceeds to create the new entry anyway — two running timers with `allowConcurrentTimers: false`.

---

## High

- [x] **H1 — `updateGroup` / `updateTimecode` never bump `updatedAt`**
  ```ts
  const updatedGroup = { ...groupToUpdate, ...updates };
  await db.putGroup(updatedGroup);
  ```
  Merge-mode import resolves conflicts by comparing `updatedAt`. A renamed group keeps its old stamp, so **importing an older backup silently reverts the rename**. Same for `restoreGroup`, `restoreTimecode`, `restoreEntry`, and `emptyTrash`'s `groupId: null` cascade. Both functions also read from React state rather than the DB, unlike every delete path on this branch, which was specifically changed to read from the DB for exactly this reason.

- [x] **H2 — Settings writes clobber across tabs**
  `updateSettings` spreads the whole React `settings` snapshot and writes it back, with no `notifyOtherTabs()` and no re-read. Two tabs open, each saving a different field, and the second write reverts the first. Templates live in `settings.templates`, so template edits are affected too. `getBackupBlob` calls `updateSettings` on every export, widening the window.

- [x] **H3 — Imported settings can vanish into a wrong key**
  `validateBackupPayload` never checks `settings.id`. In replace mode `importBackup` does `settingsStore.put(data.settings)` against a `keyPath: 'id'` store. A backup whose settings carry any id other than `'user-settings'` is written under that key; `getSettings()` then returns `undefined` and the app silently resets to defaults. Merge mode has the same hole via the `...data.settings` spread.

- [x] **H4 — Import preview is stricter than the import itself**
  `SettingsModal.handleImport` calls `validateBackupPayload(parsed)` with no `knownTimecodeIds`. In merge mode the real import passes the locally-stored ids. So a valid merge backup whose entries reference existing local timecodes **fails at the preview step** with "refers to timecode X, which is not in this backup" — an import the app would have accepted.

- [ ] **H5 — CSV import creates orphan timecodes from rows it then rejects**
  In `handleImportCSV`, `addTimecode(timecodeName)` runs *before* date validation. A row with a good name and an unparseable date leaves a permanent new timecode behind. If every row fails, the user gets "Failed to import any entries" plus a pile of junk timecodes and no rollback. Each `addTimecode` also triggers a full `refreshData()` — 50 new timecodes means 50 complete database reads.

- [ ] **H6 — Timesheet cell edits fight their own rounding**
  `commitCell` compares the typed value against raw unrounded `e.duration`, but the cell *displays* a rounded value. Retyping the number already on screen (0.25 rounded up from 0.20) computes a positive delta and silently creates a phantom "Timesheet adjustment" entry. Those adjustments are written via `addManualEntry`, which performs no overlap check, so they land on top of real entries and are then flagged by AnalysisView's overlap detector.

- [x] **H7 — `Notification` accessed unguarded inside a 1-second interval**
  `ActiveTimer`'s `calculateElapsed` does `if (Notification.permission === 'granted')` with no `'Notification' in window` check — the effect 20 lines below it guards correctly. On a browser without the API this throws every second, flooding the error log and freezing the elapsed display. Related: `alertTriggeredRef` is only reset when `activeEntry` becomes `null`, so switching directly between timers means the second one never fires its target alert.

---

## Medium

- [x] **M1 — Negative amounts print as `—`.** `amount > 0 ? amount.toFixed(2) : '-'` appears in the PDF summary, PDF detail table, and detailed CSV. Credits, discounts, and negative-rate adjustments are invisible on the invoice while still counting toward the total.
- [ ] **M2 — Three definitions of "the primary timer."** `db.getActiveEntry` picks the longest-running (its comment claims this is what the global bar shows); `GlobalActiveTimerBar` and App's document title both pick the most recently started.
- [x] **M3 — `buildBillableLines` doc comment contradicts the code.** Rule 2 states "`amount` is derived from the same two-decimal `hours` value that gets printed, so a client checking `rate x hours = amount` finds it holds." Amounts are now allocated from a timecode-level total, so per-line `rate × hours ≠ amount`. `BillableLine.amount`'s doc has the same stale claim. A client reconciling a line item will find it doesn't.
- [ ] **M4 — Overlap detection ignores the concurrency setting.** AnalysisView's `overlaps` memo compares across all timecodes regardless of `allowConcurrentTimers`, so users who deliberately run concurrent timers get a permanent red warning chip. It's also O(n²) with no dedup.
- [ ] **M5 — Escape closes all stacked modals.** `Modal` binds its Escape handler at the document level with no stack awareness. The focus trap only fires when `activeElement` is exactly the first or last element, so focus that escapes the modal isn't recaptured, and focus is never restored to the trigger on close.
- [ ] **M6 — Notification spam.** `OverrunDetector`'s 5-second interval re-fires `new Notification(...)` for the same overrun indefinitely; only `tag` dedup keeps it visually tolerable. It also fights App.tsx over `document.title` — App rewrites the title every 500ms while OverrunDetector flashes it every 1000ms.
- [x] **M7 — Timecodes in archived groups stay visible.** `TimecodeSelector` filters on `t.archived` only, never `group.archived`. Archiving a client leaves all its timecodes in the picker.
- [x] **M8 — Download failures are silent.** `useNamedDownload.handleConfirm` catches to `console.error` with no toast. Only PDF export surfaces its own error; CSV, ICS, and JSON backup failures show the user nothing.
- [x] **M9 — Empty weeks chart as 100% hit rate.** `estimatesTrend` returns `{ hitRate: 100 }` for weeks with no entries, drawing a flat perfect line through gaps in the data.
- [ ] **M10 — Theme flash.** `app/index.html` hardcodes `class="dark"` on `<html>`; App.tsx corrects it after hydration. Light-theme users see a dark flash on every load.
- [ ] **M11 — `by-start-time` index sorts lexicographically.** `getEntries` trusts the index order, but IndexedDB string-compares. ISO strings with mixed offsets (`+13:00` vs `Z`) — plausible from CSV import — sort wrong. The fallback path sorts by parsed `Date`, so the two paths disagree. The `getAllFromIndex`/`count` consistency check also runs as two separate transactions and can race.
- [ ] **M12 — Fixed-cost detection is inconsistent.** The UI infers it from `startTime === endTime`; billing infers it from `manualAmount != null`. Toggling Flat Fee back to Time Entry without clearing the amount produces an entry that bills as a fee while looking like a time entry.

---

## Low / Performance

- [ ] `EntryList` recomputes `filteredEntries`, `groupedEntries`, and `flatEntries` on every render with no `useMemo`, and resolves timecode names via `timecodes.find` inside a filter over all entries — O(n×m). The repo's own `AnalysisView.bench.test.ts` measures Map-vs-find; AnalysisView adopted Maps, EntryList didn't.
- [ ] `TimesheetMatrixView.isVisible` is called from inside `.filter()` chains, re-walking 7 cells per timecode per render.
- [ ] `GlobalActiveTimerBar` ticks at 200ms to render a seconds-resolution display.
- [ ] `restoreTimecode` / `restoreGroup` call `restoreEntry` per record, each triggering its own full `refreshData()` — N complete database reads for one restore. `bulkDeleteEntries`' undo does the same.
- [ ] `applyRounding` on a live ticking timer means a 15-minute rule shows "0s" for seven and a half minutes, then jumps.
- [ ] Fallback mode is a silent data-loss path: writes go to memory only, and `closeDB` clears that memory unconditionally.
- [ ] ICS export emits no `uid`, so re-importing duplicates every event.
- [ ] `escapeCSV` guards `= + - @` but not leading tab or CR.
- [ ] `react-virtuoso` emits "Each child in a list should have a unique key" during tests (React 19 compat).
- [ ] Summary CSV omits the tax and total rows the PDF includes.
- [ ] `restoreEntry` doesn't check whether the entry's timecode is still trashed — restores into an orphan state.
- [ ] `SettingsModal`'s `saveTimeoutRef` isn't cleared on unmount.

---

## Suggested Features / Follow-ups

- [ ] **Route every surface through `buildBillableLines`.** This is the single highest-value change and would close C3, most of the timesheet issues, and the running-timer discrepancy in one pass. The function already exists and is well-tested.
- [ ] **Give `updateGroup`/`updateTimecode` an `updatedAt` stamp and a DB read**, matching the pattern the delete paths already use on this branch.
- [ ] **Preserve real pause segments in the edit modal** — show them as a list with add/remove, and reserve the single "break minutes" field for entries that have none.
- [ ] **Guard `splitEntry`** against `manualAmount`, or prompt the user to assign the fee to one half.
- [ ] **Make `updateSettings` read-modify-write from the DB and broadcast**, closing the cross-tab clobber.
- [ ] **CSV import**: two-pass (validate all rows, then create timecodes), a row cap, tag/amount column support, and explicit date-format selection instead of `new Date()` fallback.
- [ ] **CI**: `npm audit --audit-level=high` will block unrelated deploys on any new upstream advisory; `npx license-checker` is unpinned and resolves at build time; the workflow has no `permissions:` block and no `concurrency:` group. The `on: push` trigger paired with `if: github.event_name == 'workflow_dispatch'` on the deploy job means pushes verify but never deploy — worth a comment if intentional.

The two things I'd fix before anything else are **C2** (verify against production — it may already be breaking the live app) and **C1** (silent double-billing is the kind of bug that costs a user a client).
