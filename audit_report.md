# TimeTag — Deep Analysis Report

Reviewed: full `src/` tree (context, db, components, utils) against `plan.md` and `README.md`, commit at `main`. Overall the POC is impressively complete — almost every Phase 1–5 item in the plan is actually implemented (soft-delete/trash, audit trail, split entries, templates, idle detection, checksum'd backups, PWA, keyboard shortcut, concurrent timers). The issues below are mostly correctness edge-cases and polish, not missing scaffolding.

---

## 1. Bugs & Correctness Issues

### 🔴 High priority

- [ ] **1.1 — "Merge" import silently overwrites existing data (`TimeTrackerContext.importData` → `db.importBackup`)**
  `importBackup` just does `store.put()` for every record in the file, for both `merge` and `replace` modes — the only difference is whether the stores are `clear()`-ed first. Since IndexedDB `put` is an upsert-by-key, importing an old backup in "merge" mode will **overwrite** any current entry/timecode/group that happens to share an ID with the backup, discarding newer edits. There's no last-write-wins comparison on `updatedAt`, and no dedup — "merge" today behaves like "replace, but keep records the backup doesn't mention," not a real merge.
  - `settings` is even worse: its key is always the constant `'user-settings'`, so **any** import in merge mode unconditionally clobbers current settings (rounding rule, idle threshold, templates, theme) even though the user picked "merge" specifically to avoid this.
  - Fix: on merge, only insert records whose ID doesn't already exist, or compare `updatedAt`/`editHistory` and keep the newer one; exclude `settings` from merge entirely (or merge field-by-field).

- [ ] **1.2 — Deleting/archiving a timecode doesn't update `EntryTemplate.timecodeId`**
  `deleteTimecode`, `hardDeleteTimecode`, and `mergeTimecodes` never touch `settings.templates`. A Quick Log Template can end up pointing at a deleted or merged-away timecode. `TemplateList` will silently show "Unknown Timecode" color/name, and clicking it still calls `addManualEntry` with the dangling `timecodeId`, creating an orphaned entry that can never be attributed correctly in Analysis.
  - Fix: cascade-update templates in `deleteTimecode`/`mergeTimecodes`, or filter/disable templates whose timecode no longer exists.

- [ ] **1.3 — Inconsistent delete confirmation**
  `GroupingManagement`'s "Archive" and "Delete timecode with entries" both use `window.confirm`, but **deleting a Group** (`GroupingManagement.tsx` ~line 148) and **deleting an Entry** (`EntryList.tsx` "Trash2" button) fire immediately with no confirmation at all — even though `TemplateList` deletion *does* confirm. Since these are soft-deletes it's not catastrophic, but the inconsistency is confusing and a stray click removes data from the active view without warning (the user has to know Trash exists to recover it).
  - Fix: standardize — either confirm on every destructive action, or none, and make the existence of Trash/undo obvious at the point of deletion (e.g. a toast with "Undo" like `stopTimer` already does).

### 🟠 Medium priority

- [ ] **1.4 — Duplicate entries in the Timecode Selector dropdown**
  `TimecodeSelector` shows a "Recently Used" section (top 3) and then the full grouped list right below it — the same timecodes appear twice with no visual dedup or "recent" exclusion from the main list. For someone with few timecodes this list is needlessly long and mildly confusing.

- [ ] **1.5 — `checkOverlap` ignores soft-deleted / doesn't exclude the entry's own timecode edge case**
  `checkOverlap` in `timeUtils.ts` iterates `entries` (already filtered to non-deleted in context state) which is correct, but it's called with the full `entries` array from context in both `EntryEditModal` and `ManualEntryModal` — for large histories (months of daily use) this is an O(n) scan on every keystroke of the datetime inputs (see §4.2 also). Not wrong, but will visibly lag with a large dataset.

- [ ] **1.6 — `applyRounding` uses `Math.round`, not floor, and rounds per-entry rather than per-report**
  Rounding "15min" is applied to *each entry* independently (in `EntryList` display and `AnalysisView` aggregation) rather than once on the total. Over many short entries this can materially inflate or deflate totals compared to rounding the daily/period total once — e.g. ten 2-minute entries rounded individually to 15min each becomes 150 minutes instead of ~20. Worth deciding intentionally (per-entry rounding is defensible for billing granularity, but should probably be documented/configurable, and the Analysis totals currently *do* round per-entry via the same `actualDuration` before summing, which compounds the effect further for split/date-range-clipped entries).

- [ ] **1.7 — Analysis "proportional duration" math (AnalysisView ~line 150) can misattribute paused time**
  When an entry is clipped to a date-range boundary, the code approximates the clipped duration as `entry.duration * (rawOverlapDuration / rawFullDuration)` — a proportional scaling — rather than actually recomputing `calculateDuration` against the clipped window with the real pause segments. The code comments acknowledge this ("for simplicity"). It's a reasonable approximation but will be measurably wrong for any entry that has an uneven pause distribution and happens to be clipped by a date filter (e.g. custom range starting mid-entry).

- [ ] **1.8 — Forgot-to-Stop detection re-triggers unexpectedly on reload**
  `dismissedForgotToStopId` is a single ID kept in `localStorage`. If the user dismisses the prompt for entry A, then a *different* long-running entry B later crosses the threshold, B correctly shows. But if the user later starts a **new** long-running timer that reuses... actually more concretely: it only stores one dismissed ID at a time — if a second stale timer starts running concurrently (allowed when `allowConcurrentTimers` is on) while the first is still dismissed, the loop `for (const entry of loadedActiveEntries)` will surface whichever qualifying entry it hits first each refresh, but there's no persistence for "dismiss all currently known offenders," so toggling tabs can bring back a banner for entry B after A was dismissed. Minor, but worth a `Set<string>` instead of a single ID for correctness under concurrent timers.

### 🟡 Low priority / nitpicks

- [ ] `EntrySplitModal`/`splitEntry` require the entry to have an `endTime` (can't split a running entry) — reasonable, but there's no UI affordance explaining *why* the split icon simply doesn't appear for running entries; it just vanishes (`EntryList` only renders it `!entry.isRunning`). A disabled state with tooltip would communicate this better than disappearing.
- [ ] `formatDateHeader` in `EntryList` constructs `yesterday` via `new Date(); .setDate(-1)`, which is correct but mutates `today`-adjacent `Date` objects — fine functionally, just brittle style (prefer `date-fns subDays`, which is already a project dependency, for consistency).
- [ ] `package.json` still has `"name": "temp"` and `"version": "0.0.0"` — cosmetic but worth fixing before any real release/build artifact naming.
- [ ] PWA icons are SVG-only (`pwa-192x192.svg`, `pwa-512x512.svg`). iOS Safari's "Add to Home Screen" and some Android launchers don't reliably rasterize SVG manifest icons or support the `maskable` purpose — a PNG fallback set (and a `maskable` variant) is safer for real installability.

---

## 2. Data Model / Architecture Observations

- [ ] **No schema migration path beyond `schemaVersion: 1`.** The export includes a version number as planned, but `importData` only accepts `schemaVersion === 1` and throws otherwise — there's no migration function, so the moment the schema needs to change, all older backups become unimportable rather than upgradeable. Worth stubbing a `migrate(data, fromVersion)` function now, even a no-op, so the pattern exists before it's needed.
- [ ] **`editHistory` can grow unbounded** for entries that get corrected repeatedly (e.g. a recurring forgot-to-stop entry). There's no cap or summarization — fine at POC scale, worth a note for very long-lived installs.
- [ ] **Soft-delete retention window is undecided** (plan.md §10 open question) — `deletedAt` is set but nothing ever auto-purges old trash; `emptyTrash` is manual-only. Either implement the "30 day" auto-purge from the plan or explicitly drop it from scope.
- [ ] Good: the IndexedDB wrapper (`db/index.ts`) is a clean, single-responsibility data-access layer exactly as planned, and the v1→v2 index-cleanup migration for `is-running` shows the team already anticipated schema evolution — the gap is only at the *export/import* layer, not the local DB layer.

---

## 3. Missing / Incomplete Features (vs. `plan.md`)

| Plan item | Status |
|---|---|
| Optional passphrase encryption at rest (§8.8) | Explicitly out of scope per README — fine, just confirm this is a deliberate product decision communicated to end users, not a silent gap. |
| Soft-delete auto-purge after N days (§8.12, §10) | - [ ] Trash exists, auto-expiry does not. |
| CSV **import** for entries | - [ ] ✅ implemented (`SettingsModal`), but only maps "Start Time / End Time / Timecode" columns — no documented mapping for existing Toggl/Clockify export formats as the plan specifically called out; worth verifying column-name tolerance against a real Toggl CSV export. |
| Recurring/template entries (§8.11) | - [ ] ✅ implemented via `TemplateList`, but see bug 1.2 (orphaned timecode references). |
| Multiple concurrent timers (§8.15) | - [ ] ✅ implemented, but see §4.1 below on how it's surfaced in the timer title / keyboard shortcut. |
| Weekly target hours + progress bar (§8.9) | - [ ] ✅ `WeeklySummary` present — not deeply reviewed here, worth a pass for correct week boundaries under `weekStartsOn: 1` consistency with `AnalysisView`. |

---

## 4. UI/UX Issues & Improvements

### 4.1 Concurrent timers are under-explained
- [ ] When `allowConcurrentTimers` is on, the UI supports multiple running timers stacked vertically, a "+ Start Another Timer" button, and a tab-title that shows `[2] 🔴 12:34 - Project X` for the "primary" (most recently started) entry. But:
  - There's no visual indication *in the tab title or anywhere* of what the *other* running timer(s) are — only the most recent one's name and time shows.
  - The global `Cmd/Ctrl+Shift+S` shortcut stops `activeEntries[activeEntries.length - 1]` — the *last* array item, whose order depends on `db.getActiveEntries()`'s IndexedDB iteration order, not necessarily "most recently started." This could stop the wrong timer for a user who has two running and expects "most recent" semantics like the tab title uses.

### 4.2 No virtualization on the entry list
- [ ] `EntryList` loads all `entries` from IndexedDB into memory and renders 50 at a time via a "Load More" button and client-side `.filter()`/`.reduce()` grouping on every keystroke of the search box. For the intended "months or years of daily use" audience (per plan.md's own rationale for using IndexedDB over localStorage), this will become a real performance and memory problem — a few thousand entries is a realistic 1-year outcome for someone tracking hourly. Recommend `react-window`/`react-virtuoso` for the list, and moving search/filter into an indexed IndexedDB query rather than filtering the full in-memory array each render.

### 4.3 No empty/first-run guidance beyond the timecode dropdown
- [ ] First-run experience is just an empty "Select or type to create..." field. There's no onboarding copy explaining groups vs. timecodes, no sample data, and no explanation of the Trash/Management/Analysis tabs until the user clicks into them. A short first-run tooltip tour or a "Create your first timecode" empty state on the Analysis/Management tabs (which currently just render empty charts/tables) would help new users understand the mental model faster — this matters more than usual since the plan explicitly optimizes for "would I actually want to use this every day."

### 4.4 Mobile layout untested for the timeline view
- [ ] `AnalysisView`'s "Daily Timeline" renders 24 absolutely-positioned hour markers with `text-[10px]` labels inside a `h-12` bar — on narrow viewports these labels will likely overlap or become illegible. Worth an explicit mobile breakpoint (e.g. show only every 6 hours, or switch to a scrollable horizontal timeline) since this is a PWA explicitly targeting installable/mobile use.

### 4.5 Color contrast / dark mode edge cases
- [ ] Several status badges (`bg-green-100 text-green-800` "Running", `bg-yellow-100 text-yellow-800` "Paused" in `EntryList`) don't have a `dark:` variant unlike almost everything else in the codebase, which is otherwise very consistently dark-mode-aware. These two badges will render as light-on-light or low-contrast in dark mode.

### 4.6 No visible way to discover the keyboard shortcut
- [ ] `Cmd/Ctrl+Shift+S` exists but isn't surfaced anywhere in the UI (no tooltip, no settings-page mention, no `?`-key help panel). Given "keyboard shortcuts" was an explicit plan feature aimed at power users touching the app "dozens of times a day," it's currently undiscoverable without reading source.

### 4.7 Toast/undo pattern is inconsistent across destructive actions
- [ ] `stopTimer` gets a 5-second "Undo" toast (nice touch). Deleting an entry, archiving a group/timecode, and deleting a group do not, despite being conceptually similar "recoverable" actions (soft-delete). Extending the same toast+undo pattern to entry/timecode/group deletion (instead of relying on users discovering the Trash section) would make the "forgiving of human error" plan principle (§1) more consistently realized.

### 4.8 Minor
- [ ] The `ForgotToStopPrompt` and `BackupReminderBanner` both render as full-width banners stacked at the top — with both active simultaneously plus the idle-detection modal potentially popping up too, a returning user after a long absence could face three separate interruptions at once. Consider prioritizing/collapsing.
- [ ] `TimecodeSelector`'s inline "create" form doesn't validate hex color input beyond the fixed 8-swatch palette (fine), but there's no duplicate-name check *within the same group* — only a global case-insensitive name check, so "Client Calls" under Group A and a second "Client Calls" attempt under Group B is blocked, which may be overly strict if that's actually a legitimate use case (e.g. "Standup" recurring under multiple client groups).

---

## 5. Testing & Code Quality

- [ ] Test coverage is present (`TimeTrackerContext.test.tsx`, `timeUtils.test.ts`) but thin relative to the surface area — no tests found for `checkOverlap`'s concurrent-timer branch, `splitEntry`'s pause-segment splitting logic, or the CSV/PDF export paths, all of which are exactly the "easy to get subtly wrong" areas the plan itself calls out (§4.8 in plan.md). Given date/duration math is explicitly flagged as high-risk in the plan, prioritize unit tests for: DST transitions in `calculateDuration`, the Analysis proportional-clipping math (§1.7 above), and rounding boundary values (`applyRounding` at exact half-interval marks).
- [ ] No Playwright/e2e tests despite being called out in the plan (§4.8) for the core start→stop→edit→export loop — currently that flow's correctness relies entirely on manual testing.
- [ ] `oxlint` is configured but the recommended type-aware rules (`react/rules-of-hooks`, typed linting via `oxlint-tsgolint`) from the README aren't actually enabled in `.oxlintrc.json` — worth turning on given how much `useEffect`/dependency-array logic exists in `TimecodeSelector` and `ActiveTimer`.
- [ ] Several `any` types slip into otherwise strict TypeScript (`EditHistory.oldValue: any`, `pausedSegments1: any[]` in `splitEntry`) — low risk given the data model is simple, but worth tightening since type-safety around date/duration math was explicitly the reason TypeScript was chosen (plan.md §4.1).

---

## 6. Priority Summary

| # | Issue | Area | Priority |
|---|---|---|---|
| 1.1 | Merge-import overwrites existing/newer data, including settings | Data integrity | 🔴 High |
| 1.2 | Templates reference deleted/merged timecodes | Data integrity | 🔴 High |
| 1.3 | Inconsistent delete confirmations | UX / safety | 🔴 High |
| 4.2 | No virtualization / in-memory filtering at scale | Performance | 🟠 Medium |
| 1.7 | Proportional duration math on clipped entries | Correctness | 🟠 Medium |
| 4.1 | Concurrent-timer shortcut targets wrong entry | UX / correctness | 🟠 Medium |
| 4.5 | Missing dark-mode variants on status badges | Polish | 🟡 Low |
| 4.6 | Undiscoverable keyboard shortcut | UX | 🟡 Low |
| 2 | No schema migration path beyond v1 | Future-proofing | 🟡 Low (now) / 🔴 (later) |
