# TimeTag — Code & UX Analysis Report

Repo analyzed: `LukeAFullard/TimeTag` (main branch, latest commit `3674069`).
Method: full clone, `tsc -b`, `oxlint`, `vite build` all pass clean — the codebase is small, readable, and TypeScript-strict compliant. No compile errors, no lint errors. Issues below are logic bugs, missing features (vs. the project's own `plan.md`), and UX gaps found via manual code review.

Every item below was independently re-verified (grepping actual usages, re-reading exact source lines, and in one case reproducing the bug by running the app's date logic under different `TZ` values) rather than taken on first read. Severity/scope on two items (1.3, 1.5) was corrected downward after that verification pass — see inline notes.

---

## 1. Bugs

- [x] **Bug 1.1** (**High**) in ``TimecodeSelector.tsx``: After picking a timecode, `handleSelect` clears `search` to `''`. The selector has no `value`/controlled display of the current selection, so the input box goes blank instead of showing the chosen timecode name. Users have no visual confirmation of what they selected before pressing Start.
- [x] **Bug 1.2** (**High**) in ``SettingsModal.tsx``: Clicking **Import Data** with **Replace All** selected wipes the entire database immediately — no `confirm()` / secondary confirmation dialog, despite the UI's own red "WARNING" text right next to the button. One misclick destroys all history.
- [ ] **Bug 1.3** (**Medium**) in ``AnalysisView.tsx` (custom range)`: `new Date(customStart)` / `new Date(customEnd)` parse `yyyy-MM-dd` strings as **UTC midnight**. Verified with `TZ=America/New_York`: picking "Aug 12" as the start date actually filters from Aug 11 local time. **Only affects timezones behind UTC** (Americas, etc.) — verified `TZ=Pacific/Auckland` (ahead of UTC) does *not* trigger it, so this won't reproduce for every user, but is a real bug for a large share of the potential user base.
- [ ] **Bug 1.4** (**Medium**) in ``index.html``: `<title>temp</title>` — leftover Vite scaffold title. Only overwritten once `ActiveTimer` mounts and sets `document.title`; visible in browser tabs/bookmarks/link previews before JS runs or if JS fails.
- [ ] **Bug 1.5** (**Cosmetic**) in ``vite.config.ts``: `includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'masked-icon.svg']` — the latter two files don't exist in `public/` and are silently dropped by the build (no warning, no crash). Verified this is **inert, not functionally broken**: `index.html` has no `<link rel="apple-touch-icon">` tag, and the generated `manifest.webmanifest` only lists the two SVG icons that *do* exist and build correctly — so install/home-screen icons work fine. This is just dead config worth cleaning up, not a user-facing bug.
- [ ] **Bug 1.6** (**Low**) in `Repo root`: Two stray empty files, `temp@0.0.0` and `vite`, committed to the repo root — leftover artifacts from scaffolding, should be deleted.
- [ ] **Bug 1.7** (**Low**) in ``TimecodeSelector.tsx``: Empty-state check is `groups.length === 0 && !timecodes.length`, so if a user has created a group but no timecodes yet, the "No timecodes yet, type to create one" hint never shows.
- [ ] **Bug 1.8** (**Low**) in ``AnalysisView.tsx` / CSV export`: CSV rows are hand-built with manual `"` wrapping (`` `"${tc.name}"` ``) — a timecode name containing a `"` character will produce malformed CSV. No escaping of embedded quotes.

---

## 2. Missing Features (vs. the project's own `plan.md`)

The plan checks off Phases 1–5 as complete, but several explicitly-scoped items are absent from the shipped code:

- [ ] **No delete for entries, timecodes, or groups.** The `db` layer only exposes `put*` functions — no `delete*`. §6.2 ("Delete with confirmation... soft-delete/trash") and §6.4 ("merge two timecodes") are entirely unimplemented. Once a duplicate timecode or mistaken entry is created, there is no way to remove it, only archive (and entries can't be archived at all).
- [ ] **No long-duration edit warning.** §6.2 calls for a warning when a manually entered duration exceeds ~12 hours. Only the overlap warning exists in `EntryEditModal`/`ManualEntryModal`.
- [ ] **No timeline/calendar day view** on the Analysis page (§6.5) — only bar/pie charts and a table. Spotting gaps or overlaps visually isn't possible.
- [ ] **No overlap/gap detection on the Analysis page** (§8.13) — overlap checking only happens reactively while editing a single entry, not as a report.
- [ ] **True PDF export is not implemented.** §6.5/§8.5 call for a generated PDF; the "PDF" button in `AnalysisView` just calls `window.print()`, relying on the browser's print-to-PDF rather than a real client-side PDF (no `jsPDF`/`pdf-lib` in `package.json`).
- [ ] **No CSV *import*.** Only CSV export of the analysis table exists; §8.6's "import for migrating history from Toggl/Clockify" is missing.
- [ ] **Several `Settings` fields are unreachable from the UI.** `roundingRule`, `weeklyTargetHours`, `idleThresholdMinutes`, and `reminderIntervalDays` all exist in the data model and are actively used in logic (e.g. `WeeklySummary` silently renders nothing until `weeklyTargetHours` is set), but `SettingsModal.tsx` only exposes **Theme** and **Allow Concurrent Timers**. A user cannot set a weekly target, change the idle threshold, change the backup reminder interval, or choose a rounding rule without manually editing IndexedDB.
- [ ] **No "most recently/frequently used" surfacing** in the timecode dropdown (§6.4) — timecodes are listed in raw DB insertion/group order only.
- [ ] **No hourly-rate editing after creation.** Rate can only be set once, at timecode-creation time via `TimecodeSelector`'s inline form; `GroupingManagement.tsx`'s edit form has no rate field.
- [ ] **No automated tests.** `plan.md` §4.8 specifies Vitest for duration/rounding/overlap logic and Playwright for the core loop; there isn't a single test file in the repo, and neither dependency is installed. This is risky given how much of the app depends on subtle date/duration arithmetic.
- [ ] **No encryption-at-rest** (§8.8/§4.7) — flagged as optional in the plan, but `encryptionEnabled` exists in `Settings` with no corresponding implementation anywhere, i.e. a setting that would silently do nothing if toggled (it isn't exposed in the UI, so currently harmless, but it's a latent trap).

---

## 3. UI/UX Issues

- [ ] **Dark mode is inconsistently applied.** `AnalysisView.tsx`, `EntryEditModal.tsx`, `ManualEntryModal.tsx`, `ForgotToStopPrompt.tsx`, and `BackupReminderBanner.tsx` have **zero** `dark:` Tailwind classes, while the rest of the app (and the theme switcher in Settings) fully supports dark mode. In dark mode, these five surfaces render as a jarring white/light modal or banner floating in an otherwise dark UI, with default black text that may lose contrast against the app's dark backdrop bleeding through edges.
- [ ] **No visible date on entries.** `EntryList` only shows `h:mm a` (e.g. "2:30 PM – Now") with no date. Once a user has more than a day of history, entries from different days are visually indistinguishable in the list.
- [ ] **Unbounded entry list.** `EntryList` renders every single entry in `entries` with no pagination, virtualization, or date grouping. After months of daily use (the app's stated use case) this list — and the full `getAll('entries')` fetch on every `refreshData()` call — will grow large and degrade scroll/render performance.
- [ ] **No filtering/search in the entry list** — no way to filter by timecode, group, or date range from the main Tracker tab; the user must go to the Analysis tab to slice data.
- [ ] **Silent data-loss risk on Replace-mode import** (see Bug 1.2) is also a UX issue: the only safeguard is static text, not an interaction gate.
- [ ] **No "select nothing" reset for the Timecode dropdown.** Once `showAddForm` is toggled or a search is typed, there's no explicit "clear" button — user must delete all typed characters.
- [ ] **Backup reminder dismissal is per-session only** (`sessionStorage`), so it reappears every time the browser/tab is restarted even if dismissed minutes ago — likely to train users to habitually dismiss it rather than act on it.
- [ ] **No confirmation/undo on Archive.** Archiving a group or timecode is a single click with no undo affordance beyond manually un-archiving; fine for group archiving but paired with the total absence of delete, "archive" is the *only* housekeeping action available anywhere in the app.
- [ ] **Multiple concurrent timers UX is asymmetric.** When `allowConcurrentTimers` is on, `App.tsx` renders one `ActiveTimer` card per running entry, always followed by an extra empty "Start new" card — with 3+ concurrent timers running this becomes a long vertical stack with a lot of repeated chrome (avatar circle, "Currently Tracking" label, etc.) rather than a compact multi-timer view.
- [ ] **Large single JS bundle.** Production build reports a single 664 KB (193 KB gzip) JS chunk with a Vite build warning to code-split — Recharts in particular is a heavy dependency that could be lazy-loaded only when the Analysis tab is opened, rather than bundled into initial load for the Tracker tab.

---

## 4. Summary

The core timer loop (start/stop/pause/resume, edit, manual entry, backup/restore, analysis charts) is solid, type-safe, and matches the plan's data model well. The most impactful fixes, roughly in priority order, are:

- [x] Fix the Timecode Selector to display the current selection (1.1) — this is a first-impression, everyday-use bug.
- [x] Add a confirmation step before a destructive **Replace** import (1.2).
- [ ] Add delete/soft-delete for entries and timecodes — currently a one-way ratchet with no way to remove mistakes (§2).
- [ ] Expose the "orphaned" settings (weekly target, idle threshold, rounding rule, reminder interval) in the Settings modal — they already work, they're just unreachable.
- [ ] Fix dark-mode coverage on the five components that lack it.
- [ ] Add at least minimal unit test coverage for the duration/pause/overlap math, since that logic is the crux of the app's correctness and currently has zero tests.


---

**Note for AI Agent:** When all changes in this document have been completed and checked off, you must seek approval from the user before deleting this file.