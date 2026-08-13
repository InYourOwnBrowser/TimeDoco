# TimeTag — Deep Analysis Report

**Repo:** `LukeAFullard/TimeTag` @ `main` · **Stack:** React 19 + TypeScript + Vite + IndexedDB (`idb`) + Tailwind + Recharts + jsPDF

**Build status:** `npm run build` ✅ · `npm run lint` ✅ (1 warning) · `npm run test` ✅ 19/19 passing. CI (`.github/workflows/deploy.yml`) already gates deploys on lint + test + build.

**Note:** The repo contains a prior `audit_report.md` whose checked-off items (rounding rule, overlap-detection scoping, cascading-delete disclosure, CSV per-row error handling, duplicate-timecode protection, idle back-dating, modal a11y, toasts, forgot-to-stop persistence, CI gating) I verified are indeed fixed in the current code. This report focuses on **what's still outstanding** after that pass.

---

## 1. Bugs

- [x] **1.1 Document title races when multiple concurrent timers are active.** `ActiveTimer.tsx` sets `document.title` in a `useEffect`, and `App.tsx` renders one `<ActiveTimer>` per entry in `activeEntries`. With "Allow Multiple Concurrent Timers" on and 2+ timers running, each mounted instance fights over `document.title` every second, and each instance's cleanup resets it to `'Time Tracker'` on unmount — the tab title will flicker/thrash unpredictably. Title-updating should be lifted to a single place (e.g. one effect in `App.tsx` driven by `activeEntries`, showing a count or the most-recently-started timer) rather than living in a component that can have multiple instances.

- [x] **1.2 `entries.is-running` IndexedDB index is dead/broken.** In `db/index.ts`:
  ```ts
  entryStore.createIndex('is-running', 'isRunning');
  ```
  `isRunning` is a `boolean`, but boolean is not a valid IndexedDB key type — records aren't indexable on a boolean property, so this index silently never contains any entries. It's harmless today only because `getActiveEntries()` uses `getAll()` + `Array.filter` instead of querying the index, but the index adds write overhead for no benefit and is a trap for whoever tries to use it. Either drop the index or change it to index a queryable representation.

- [ ] **1.3 Overlap/duration checks in modals are minute-resolution, entries are second-resolution.** `datetime-local` inputs in `ManualEntryModal`, `EntryEditModal`, and `EntrySplitModal` only carry HH:MM. For entries shorter than 60s (fine-grained corrections), the computed `min`/`max` for the split time can equal the start/end minute, making a legal split impossible via the UI. Low-frequency edge case, but worth a `step="1"` + seconds field or at least a friendlier error than a disabled-looking control.

- [ ] **1.4 Warnings never block saving overlapping/absurd entries.** `checkOverlap` and the 12-hour-duration check in `ManualEntryModal`/`EntryEditModal` are advisory only — `handleSave` never reads `warning` before calling `addManualEntry`/`updateEntry`. This is a defensible product choice ("forgiving, not blocking" per `plan.md`), but it means a typo'd date (e.g. wrong AM/PM, wrong year) creating a 9,000-hour entry saves silently and will visibly wreck the Analysis totals until manually found. Consider a lighter-weight "Save anyway?" confirmation specifically for the >12h/overlap cases rather than zero friction.

- [ ] **1.5 `Modal` has no backdrop-click-to-close and no scroll lock.** `components/ui/Modal.tsx` implements `Escape` and a focus trap, but clicking the dark backdrop does nothing (inconsistent with `TimecodeSelector`'s own dropdown, which *does* close on outside click), and `document.body` isn't given `overflow: hidden` while a modal is open, so the page behind a modal can still scroll on touch devices.

- [ ] **1.6 Accidental data loss via `Escape`.** Because `Modal`'s `Escape` handler always calls `onClose()` with no dirty-check, a user who has typed a note or adjusted times in `EntryEditModal`/`ManualEntryModal` and reflexively hits `Esc` loses the edit with no warning — the opposite of the app's "forgiving" intent elsewhere (undo toast on stop, non-blocking warnings, etc.).

- [ ] **1.7 `oxlint` warning on `ToastContext.tsx`.** `useToast` triggers the same `react-refresh/only-export-components` warning that `TimeTrackerContext.tsx` already silences with `// eslint-disable-next-line`. Trivial, but CI currently shows 1 warning that could be zero.

---

## 2. Missing Features

| Feature | Status |
|---|---|
| - [ ] Raw/detailed entry-level CSV export | **Missing** — `handleExportCSV` in `AnalysisView` only exports the *aggregated per-timecode* summary (name, group, hours, earnings), not individual entries (start/end/note/date). Anyone wanting to feed entries into invoicing or payroll tools has no way to get one row per entry. |
| - [ ] Soft-delete / trash with restore window | Not implemented — deletes (entries, timecodes, groups) are immediate and permanent behind a `window.confirm`. Only the just-stopped timer has an undo path (`UndoToast`, 5s window). |
| - [ ] Recurring / template entries | Not implemented (was scoped in `plan.md`). |
| - [ ] Passphrase encryption at rest | Not implemented — data sits unencrypted in IndexedDB. Reasonable for a "privacy-first, local-only" pitch, but worth stating explicitly in the UI/README if it's intentionally out of scope, since "privacy-first" reads to some users as "encrypted." |
| - [ ] Bulk actions on entries (multi-select delete/re-timecode/export) | Not implemented — `EntryList` only supports one-at-a-time edit/split/delete. |
| - [ ] Keyboard-navigable combobox in `TimecodeSelector` | Not implemented — mouse/touch only; no arrow-key navigation or `aria-activedescendant`/`role="combobox"` wiring (see 3.1). |
| - [ ] Search/filter/sort in `GroupingManagement` | Not implemented — with dozens of timecodes this becomes a long unfiltered list mixing active and archived items. |
| - [ ] Tests beyond `timeUtils` + 2 context tests | Coverage is thin for a codebase this UI-heavy: no tests for `AnalysisView`'s proportional-duration aggregation, gap/overlap detection, import/export checksum round-trip, or any component-level rendering test. |

---

## 3. UI/UX Issues

- [ ] **3.1 `TimecodeSelector` isn't a real accessible combobox.** No `role="combobox"`/`aria-expanded`/`aria-controls`, no arrow-key traversal of the list, no `aria-activedescendant`. It's the single most-used control in the app (the entry point for starting every timer) and is currently mouse/touch-only for selection.

- [ ] **3.2 Two toast systems coexist.** `ToastContext` renders generic toasts top-right; `UndoToast` is a separate, hand-rolled fixed-bottom-center element for the stop-timer undo. They don't collide visually today, but it's two parallel notification mechanisms to maintain, and a "Timer stopped" toast (from `addToast` in `stopTimerById`... actually from `stopTimer`) fires *at the same time* as the bottom "Timer stopped — Undo" toast — the user sees the same message twice in two different places. Consolidate into one toast system that supports action buttons.

- [ ] **3.3 PWA manifest has no `theme_color`/`background_color`.** `vite.config.ts`'s `VitePWA` `manifest` block only sets `name`/`short_name`/`description`/`icons` — no `theme_color` or `background_color`, so an installed PWA's splash screen and OS chrome fall back to browser defaults rather than matching the app, and won't reflect the in-app dark/light theme choice either way (this is a static manifest limitation; the best fix is a sensible default plus documenting that OS chrome won't track the in-app toggle).

- [ ] **3.4 Destructive actions use `window.confirm`.** Deleting an entry/timecode/group, and confirming a replace-import, mix native browser `confirm()` dialogs with the app's own styled modals (the replace-import flow *does* use a nice inline "type REPLACE" confirmation — the rest don't). Native confirms look jarring against the custom UI and can't be styled/localized/tested via component tests.

- [ ] **3.5 No visual distinction for archived items in the Management list.** Archived groups/timecodes stay inline in the same list as active ones (just with a small "Archived" badge), rather than being collapsed/filtered out by default. As the list grows this makes the primary "active" configuration harder to scan.

- [ ] **3.6 `AnalysisView` chunk remains large.** Confirmed via build: the lazily-loaded `AnalysisView` chunk is ~394 KB (~113 KB gzip) even with `jsPDF`/`jspdf-autotable` already split into their own dynamically-imported chunk (~430 KB combined, loaded only on "PDF / Print" click). The remaining weight is largely `recharts`. First visit to the Analysis tab will still cost a real download on slow connections — consider a lighter charting approach (or lazy-loading the charts specifically, keeping the summary numbers/table instant) if this matters for the target audience.

- [ ] **3.7 No indication of unsaved state / dirty-check before closing modals.** Related to 1.6 — none of the edit modals warn on close-with-unsaved-changes.

- [x] **3.8 Numeric inputs don't enforce their own `min`.** Hourly rate, weekly target hours, idle threshold, and reminder interval all use `<input type="number" min="0">`, but nothing stops a user from typing a negative number directly (browser `min` attribute only affects the spinner/native validation UI, not free typing without a `<form>` submit). A `-5` hourly rate or `-1` weekly target will silently be stored and produce nonsensical output (negative earnings, `Math.min` guard shows odd progress bars, etc.).

- [ ] **3.9 Week start is hard-coded to Monday.** `WeeklySummary` and `AnalysisView`'s "This Week" preset both hard-code `weekStartsOn: 1`. Reasonable default, but there's no setting for users/locales that expect a Sunday-start week — worth a one-line settings toggle since the plumbing (`date-fns`) already supports it.

---

## 4. UI/UX Improvements (suggestions, not defects)

- [ ] **Consolidate toast systems** (see 3.2) into a single `ToastContext` that supports an optional action button, and use it for the stop-timer undo instead of a bespoke component.
- [ ] **Add a real combobox** to `TimecodeSelector` (arrow keys, `Enter` to select, proper ARIA) — this is the highest-leverage accessibility fix given how central the control is.
- [ ] **Add a raw entry-level CSV export** next to the existing summary export, e.g.:
  ```ts
  const handleExportRawCSV = () => {
    const headers = ['Date', 'Timecode', 'Group', 'Start', 'End', 'Duration (h)', 'Note'];
    const rows = filteredEntries.map(e => {
      const tc = timecodes.find(t => t.id === e.timecodeId);
      const grp = groups.find(g => g.id === tc?.groupId);
      return [
        format(parseISO(e.startTime), 'yyyy-MM-dd'),
        `"${(tc?.name ?? 'Unknown').replace(/"/g, '""')}"`,
        `"${(grp?.name ?? 'Ungrouped').replace(/"/g, '""')}"`,
        format(parseISO(e.startTime), 'HH:mm:ss'),
        e.endTime ? format(parseISO(e.endTime), 'HH:mm:ss') : '',
        (applyRounding(e.duration, settings?.roundingRule ?? 'none') / 3600).toFixed(2),
        `"${e.note.replace(/"/g, '""')}"`,
      ].join(',');
    });
    // ...blob/download as in handleExportCSV
  };
  ```
- [ ] **Soft-delete with a short restore window** for entries (mirroring the existing 5s undo-stop pattern but longer, e.g. a "Recently deleted" panel in Settings) would meaningfully reduce the risk of the still-permanent deletes in `EntryList`/`GroupingManagement`.
- [ ] **Bulk operations on `EntryList`**: checkboxes + "delete selected" / "reassign timecode" / "export selected", useful once entry counts grow into the hundreds.
- [ ] **Gate saves on the existing overlap/duration warnings** with a single extra confirm step ("This entry is 14h long / overlaps with X — save anyway?") instead of silent pass-through, to catch the common "wrong AM/PM" typo class of error without becoming blocking.
- [ ] **Add a lightweight numeric guard** (`Math.max(0, value)`) on all rate/hours/threshold inputs' `onChange` handlers to actually enforce the non-negative intent already implied by `min="0"`.
- [ ] **Debounce/throttle `refreshData()` during bulk operations** (CSV import, cascading deletes on merge/archive-group): each imported CSV row currently triggers `addManualEntry` → `refreshData()` → full `getAll()` across four object stores + re-render, sequentially awaited per row. For large CSVs this is O(n) full-database reloads. Batch the writes and call `refreshData()` once at the end.
- [ ] **Persist Analysis tab's selected preset/date-range** (e.g. to `sessionStorage`) so switching tabs and coming back doesn't reset to "Today."
- [ ] **Consider surfacing the "type to search/create" pattern's Escape/outside-click consistency** with the new shared `Modal` component — right now `TimecodeSelector`'s dropdown and `Modal` behave differently (one closes on outside click, the other doesn't), which is a small but noticeable inconsistency once you notice it.

---

## 5. Suggested Priorities

**High (correctness / data trust):**
- [x] 1. Fix the concurrent-timer `document.title` race (1.1)
- [x] 2. Guard against silent negative numeric inputs (3.8)
- [ ] 3. Add a confirm step for saves that already show an overlap/12h+ warning (1.4)

**Medium (polish / scale):**
- [ ] 4. Consolidate the two toast systems (3.2)
- [ ] 5. Add raw entry-level CSV export (missing feature, §2)
- [ ] 6. Add backdrop-click-to-close + scroll lock to `Modal` (1.5)
- [ ] 7. Batch CSV-import writes instead of refreshing per row (§4)

**Lower (nice-to-have / roadmap):**
- [ ] 8. Accessible combobox for `TimecodeSelector` (3.1)
- [ ] 9. Soft-delete/trash, bulk entry actions, recurring entries (§2)
- [ ] 10. Expand automated test coverage beyond `timeUtils` (§2)