# TimeTag — Deep Code & UX Analysis

Repo analyzed: `LukeAFullard/TimeTag` @ `main` (commit `8d4ae11`)
Stack: React 19 + TypeScript + Vite + IndexedDB (`idb`) + Tailwind + Recharts + jsPDF

**Build/test status:** `npm run build` ✅, `npm run lint` (oxlint) ✅ 0 warnings, `npm run test` ✅ 11/11 passing. The app is technically sound and ships — the issues below are correctness, completeness, and polish gaps rather than a broken build.

---

## 1. Bugs

- [x] **1.1 Rounding Rule setting does nothing (dead feature)**
  `Settings.roundingRule` (`none/5min/10min/15min`) is set in `SettingsModal.tsx` and persisted, but it is **never read anywhere** — not in `calculateDuration()`, not in `EntryList`, not in `AnalysisView`, not in CSV/PDF export. A user can pick "Nearest 15 Minutes" and see zero effect on any displayed time or export.
  `grep -rn "roundingRule" src/` only appears in SettingsModal.tsx and the default-settings object
  **Fix:** apply rounding at the display/export layer only (as `plan.md` §6.5 specifies), e.g. a `applyRounding(seconds, rule)` helper used in `AnalysisView`'s aggregation and `EntryList`'s `formatDuration`.

- [x] **1.2 Overlap detection ignores concurrent-timer mode**
  `checkOverlap()` (`utils/timeUtils.ts`) flags an overlap against **every** entry regardless of timecode. Once "Allow Multiple Concurrent Timers" is enabled (a supported, documented mode), any second simultaneous entry will always trigger the "This entry overlaps..." warning in `ManualEntryModal` / `EntryEditModal`, even though overlapping is the expected, valid behavior in that mode. The warning becomes noise and trains users to ignore it — including for genuine accidental overlaps in single-timer mode.
  **Fix:** pass `settings.allowConcurrentTimers` in and only flag overlaps between entries on the *same* timecode when concurrent mode is on.

- [x] **1.3 Deleting a Timecode silently deletes all its history**
  ```ts
  const deleteTimecode = async (id: string) => {
    const entriesToDelete = entries.filter((e) => e.timecodeId === id);
    for (const entry of entriesToDelete) { await db.deleteEntry(entry.id); }
    await db.deleteTimecode(id);
    ...
  ```
  The confirm dialog in `GroupingManagement.tsx` only says *"Are you sure you want to delete this timecode? This action cannot be undone."* — it never discloses that every associated time entry is being cascade-deleted too. A user trying to tidy up an unused timecode can unknowingly wipe months of tracked history. Archiving already covers the "hide it" use case, so this cascade is rarely what anyone wants.
  **Fix:** either (a) block delete entirely when entries exist and require archiving instead, or (b) show the entry count in the confirmation ("This will also delete 214 time entries").

- [x] **1.4 Idle detection doesn't back-date the pause**
  When the "Still working?" prompt fires and the user clicks "No, pause timers," the pause is recorded starting **at the moment they click**, not at the moment they actually went idle (`idleThresholdMinutes` earlier). The code comment even acknowledges this:
  `// A more advanced implementation would edit their endTime backward, but pausing is safer since they can edit the duration later...`
  The net effect is that the entire idle window is still counted as tracked/billable time unless the user manually edits the entry afterward — which defeats the main purpose of idle detection.
  **Fix:** on "No, pause timers," insert a `pauseStart` equal to `now - idleThresholdMinutes` (bounded by the timer's own start) instead of `now`.

- [x] **1.5 Editing an entry whose Timecode is archived shows a broken dropdown**
  `EntryEditModal`'s timecode `<select>` only lists non-archived timecodes, but a historical entry can legitimately point at one that's since been archived. The `value={timecodeId}` won't match any rendered `<option>`, so the select renders effectively blank/unselected even though a real value is set underneath. Users can be misled into thinking the entry has no timecode and change it unnecessarily.
  **Fix:** always include the entry's current timecode in the option list (flagged as "(archived)") even if it's archived elsewhere.

- [x] **1.6 CSV import has no per-row validation or error isolation**
  `SettingsModal.handleImportCSV` runs one big `for` loop and only has a single top-level `try/catch`. A malformed date (`new Date(badString).toISOString()`) throws `RangeError` mid-loop, aborting the whole import — any rows already imported stay imported, later rows are silently dropped, and the user sees a generic "Failed to import CSV data" message with no indication of which row failed or how many entries actually made it in.
  **Fix:** wrap each row in its own try/catch, collect skipped-row reasons, and report `"Imported 42, skipped 3 (see details)"`.

- [x] **1.7 No duplicate-timecode-name protection**
  Timecodes created via the "type to create" flow in `TimecodeSelector` are never checked against existing names (case-insensitive matching only happens on the separate CSV-import path). It's easy to end up with two "Client A" timecodes that silently split reporting totals, and there's no "merge timecodes" tool to fix it after the fact (this was explicitly called out as a needed feature in the project's own `plan.md` §6.4).

---

## 2. Missing Features (vs. the project's own `plan.md`)

| Planned feature | Status |
|---|---|
| - [ ] Passphrase encryption at rest (§8.8) | Not implemented — actively removed (`patch_encryption.py` strips `encryptionEnabled` from types/context/db) |
| - [ ] Soft-delete / trash with restore window (§8.12) | Not implemented — deletes are immediate and permanent, gated only by `window.confirm` |
| - [ ] Recurring/template entries (§8.11) | Not implemented |
| - [ ] Timecode merge tool (§6.4) | Not implemented |
| - [ ] Entry splitting across timecodes (§7.5) | Not implemented |
| - [ ] Gap detection on Analysis page (§8.13, "overlaps *or* gaps") | Only overlap detection shipped; no unexplained-gap flagging |
| - [ ] Toast/micro-feedback on actions (§5) | Not implemented — no confirmation toasts on start/stop/save |
| - [ ] Rounding rule applied at report time (§6.5) | Setting exists but is inert — see Bug 1.1 |

Additional gaps not called out in the plan but worth noting:
- [ ] **No "Add Timecode" button in the Management tab.** New timecodes can only be created inline from the tracker's search box; the Management page can only edit/archive/delete existing ones. Anyone wanting to pre-configure timecodes before tracking has to fake it through the tracker UI first.
- [ ] **No component/integration test coverage.** `vitest` only covers `timeUtils.ts` (overlap + duration math). None of the context reducer logic (start/stop/pause math, cascading deletes, import/export checksum flow) or the Analysis page's proportional-duration aggregation — the parts most likely to contain subtle date-math bugs — have any automated tests.
- [ ] **CI doesn't gate on tests or lint.** `.github/workflows/*.yml` runs `npm run build` and deploys straight to GitHub Pages; it never runs `npm run test` or `npm run lint`, so a red test suite wouldn't block a production deploy.

---

## 3. UI/UX Issues & Improvements

- [x] **3.1 Accessibility gaps on all overlay/modal components**
  None of the five overlay-style components (`SettingsModal`, `ManualEntryModal`, `EntryEditModal`, the idle-detector prompt, `TimecodeSelector`'s dropdown) implement `role="dialog"` / `aria-modal="true"`, a focus trap, or an `Escape`-to-close handler. Keyboard and screen-reader users can tab focus behind the overlay into the page underneath, and there's no standard way to dismiss with `Esc`. Given four of these are true full-screen modals, this is worth fixing as a shared `<Modal>` wrapper rather than per-component patches.

- [x] **3.2 No confirmation or undo on "Stop"**
  Deleting an entry asks for confirmation; stopping a running timer does not, even though a mis-click ends an active tracking session with no way to resume the exact same session (only edit the resulting entry after the fact). A lightweight "Timer stopped — Undo" toast (few seconds) would match the app's otherwise forgiving philosophy ("Forgiving, never blocking" is literally a stated design principle in `plan.md`) better than the current silent stop.

- [ ] **3.3 PWA status bar ignores dark mode**
  `vite.config.ts` hardcodes `theme_color: '#ffffff'` in the manifest, and there's no dynamic `<meta name="theme-color">` swap in `index.html`/`App.tsx`. A user who sets the in-app theme to Dark still gets a white OS status bar / browser chrome when the app is installed as a PWA — a small but visible inconsistency for a "dark mode from day one" product.

- [ ] **3.4 Modal viewport overflow on small screens**
  `ManualEntryModal` and `EntryEditModal` have no `max-height`/`overflow-y-auto` on their content area (unlike `SettingsModal`, which does). On short viewports, or with the mobile on-screen keyboard open while editing the datetime fields, the Save/Cancel footer can be pushed off-screen with no way to scroll to it.

- [ ] **3.5 Bundle size on the Analysis tab**
  `AnalysisView` lazy-chunk is **~822 KB (≈251 KB gzipped)** — by far the largest chunk in the app, driven mainly by `jsPDF` + `jspdf-autotable` (plus `html2canvas` pulled in transitively) and `recharts`. It's already code-split via `React.lazy`, which helps the initial load, but the first time a user opens the Analysis tab, especially on mobile data, there will be a noticeable stall.
  **Suggestion:** further split the PDF export path (`jsPDF`/`autoTable`) into its own dynamically-imported chunk that only loads when "PDF / Print" is actually clicked, rather than bundling it with the whole Analysis view.

- [ ] **3.6 Backup banner UX vs. Forgot-to-Stop banner UX are inconsistent**
  `BackupReminderBanner`'s dismissal persists for 24h via `localStorage`. `ForgotToStopPrompt`'s dismissal (`dismissedForgotToStopId`) lives only in React state, so it resets on every page refresh — meaning a user who dismisses "did you forget to stop this?" and then reloads the tab (or the PWA restarts) sees the same nag reappear immediately, which risks feeling naggy rather than forgiving. Consider persisting this dismissal the same way the backup banner does, perhaps re-showing only if the timer is *still* running some hours later.

- [ ] **3.7 Minor polish items**
  - [ ] `idleThresholdMinutes` input in `SettingsModal` falls back to a placeholder default of `5` (`settings?.idleThresholdMinutes ?? 5`) while the actual app default (set in `TimeTrackerContext`) is `15` — cosmetically inconsistent, though not user-visible in practice since settings are always populated on load.
  - [ ] 15 one-off `patch_*.py` scripts are committed at the repo root (`patch_banner.py`, `patch_encryption.py`, `patch_timeline.py`, etc.). These appear to be scratch scripts used to make individual code edits and aren't part of the app; leaving them in the repo root is confusing for new contributors and should be deleted or moved outside version control.

---

## 4. Summary of Recommended Priorities

**High priority (data-safety / correctness):**
- [x] 1. Fix or disclose the cascading delete on Timecodes (1.3)
- [x] 2. Make the Rounding Rule setting actually do something, or remove it from the UI until it does (1.1)
- [x] 3. Scope overlap detection to concurrent-timer mode correctly (1.2)
- [x] 4. Add per-row error handling to CSV import (1.6)

**Medium priority (trust / polish):**
- [x] 5. Add focus-trap + Escape handling to modals (3.1)
- [x] 6. Fix idle-detection back-dating so pauses reflect actual idle start (1.4)
- [ ] 7. Persist Forgot-to-Stop dismissal like the backup banner does (3.6)
- [ ] 8. Split jsPDF out of the Analysis chunk (3.5)

**Lower priority (nice-to-have, roadmap items already scoped in `plan.md`):**
- [ ] 9. Timecode merge tool, entry splitting, soft-delete/trash, recurring entries, gap detection
- [ ] 10. Repo cleanup: remove `patch_*.py` scripts, add `test`/`lint` steps to the deploy workflow
