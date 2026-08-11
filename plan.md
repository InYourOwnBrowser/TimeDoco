# Time Tracker App — Project Plan

A privacy-first, browser-only time tracking tool for staff to log hours against projects/timecodes. No server, no accounts, no data leaves the device unless the user explicitly exports it.

---

## 1. Goals & Principles

- **100% client-side.** All logic and data storage happens in the browser. No backend, no network calls, no analytics/tracking.
- **User owns their data.** Export/import is a first-class feature, not an afterthought — this is the only way data leaves the device.
- **Forgiving of human error.** People forget to press stop, forget to switch timecodes, forget to back up. The app should make correcting these mistakes easy rather than punishing the user for them.
- **Fast to use daily.** Starting/stopping/switching timers should take one or two clicks, since this is a tool people touch dozens of times a day.
- **Pleasant, not just functional.** A time tracker that people resent opening gets abandoned within a week. Every design decision below is also weighed against "would I actually want to use this every day?"

---

## 2. Data Model

Stored in **IndexedDB** (not localStorage — async, higher capacity, won't block the UI as data grows over months/years of use).

### `groups`
| field | type | notes |
|---|---|---|
| id | string (uuid) | |
| name | string | e.g. "Client A", "Internal" |
| color | string (hex) | for visual coding throughout the UI |
| archived | boolean | hide from active dropdowns without deleting history |

### `timecodes`
| field | type | notes |
|---|---|---|
| id | string (uuid) | |
| name | string | e.g. "Website redesign" |
| groupId | string \| null | FK to `groups` |
| color | string (hex) | optional override; inherits group color if unset |
| hourlyRate | number \| null | optional, for earnings view |
| archived | boolean | |

### `entries`
| field | type | notes |
|---|---|---|
| id | string (uuid) | |
| timecodeId | string | FK to `timecodes` |
| startTime | ISO datetime | **always stored** |
| endTime | ISO datetime \| null | **null while running**; always stored once stopped |
| duration | number (seconds) | derived from start/end, but cached for fast querying — recalculated whenever start/end is edited |
| note | string | optional free text |
| isRunning | boolean | true only for the single currently active entry |
| isPaused | boolean | true if paused (see §6.1) |
| pausedSegments | array of `{pauseStart, pauseEnd}` | tracks pause history within one session |
| editHistory | array | see §6.2 audit trail |
| createdAt / updatedAt | ISO datetime | bookkeeping |

**Key design decision:** because you store explicit `startTime` and `endTime` (not just an accumulated duration), the "forgot to press stop" problem becomes trivial to fix — the user just edits `endTime` directly, and duration recalculates automatically. This also means every entry is independently auditable and edit-friendly, which a pure stopwatch/duration model doesn't allow.

### `settings`
| field | type | notes |
|---|---|---|
| lastBackupDate | ISO datetime \| null | |
| reminderIntervalDays | number | default e.g. 7 |
| roundingRule | enum: none/5/10/15min | applied at export/report time only, never mutates raw data |
| idleThresholdMinutes | number | for idle detection |
| weeklyTargetHours | number \| null | |
| encryptionEnabled | boolean | see §8.8 |

---

## 3. Architecture

- **Storage layer:** IndexedDB via a lightweight wrapper (e.g. `idb`). All reads/writes go through a single data-access module so storage implementation can change later without touching UI code.
- **App shell:** installable PWA (manifest + service worker) so it works fully offline and can be "installed" like a native app.
- **State:** the currently running timer's state must be **persisted to IndexedDB immediately on start**, not just held in memory — this is what allows recovery if the tab is closed or the browser crashes mid-timer. On load, the app checks for any entry with `isRunning: true` and rebuilds the live display from the stored `startTime`.
- **No external requests at runtime.** All fonts/libraries bundled locally, consistent with a "runs entirely offline" privacy pitch.

---

## 4. Tech Stack

### 4.1 Framework & UI
- **React + TypeScript**, built with **Vite**. Vite gives fast local dev and a small, optimized production bundle — important since this all has to ship as static files with no backend. TypeScript is worth the setup cost here because the data model (entries, timecodes, groups, edit history) has enough structure that type-checking will catch real bugs, especially around date/duration math.
- **Component styling:** Tailwind CSS for speed and consistency, paired with a small set of hand-tuned design tokens (see §5) rather than an off-the-shelf component library — a generic Bootstrap/Material look undermines the "considered, trustworthy tool" feel you want people to associate with daily use.
- **State management:** React Context + hooks is sufficient at this scale (no Redux needed) — one context for the active timer, one for the timecode/group list, fed by a data-access layer that talks to IndexedDB.

### 4.2 Storage
- **IndexedDB** via the [`idb`](https://github.com/jakearchibald/idb) library — a thin Promise-based wrapper over the native IndexedDB API, avoids hand-rolling callback-based transaction code.
- **Dexie.js** is a solid alternative to `idb` if you want built-in query helpers (e.g. `.where('timecodeId').equals(x)`) — worth evaluating once the analysis page's query patterns are clearer, since it can simplify date-range filtering.

### 4.3 Charts & Data Visualization
- **Recharts** (React-native charting, composable, good defaults) for the analysis page's bar/pie/line charts — easier to theme consistently with the rest of the React UI than a raw D3 setup, while still being fully client-side with no external calls.

### 4.4 PDF & CSV Export
- **PDF generation:** a client-side library such as `pdf-lib` or `jsPDF`, run entirely in-browser — no server round-trip, consistent with the offline-first approach.
- **CSV export/import:** `PapaParse` — handles both directions well and is small.

### 4.5 Dates & Time Math
- **`date-fns`** (or `Temporal` polyfill if you want to be forward-looking) for start/end/duration arithmetic, timezone-safe formatting, and date-range bucketing on the analysis page. Avoid hand-rolled date math — it's the single most common source of off-by-one and DST bugs in time-tracking tools.

### 4.6 PWA / Offline
- **`vite-plugin-pwa`** to generate the manifest and service worker with minimal config, enabling installability and full offline use out of the box.

### 4.7 Encryption (if pursued — see §8.8)
- **Web Crypto API** (native, no dependency) for AES-GCM encryption of the exported/stored payload, with a key derived from the user's passphrase via PBKDF2 or Argon2 (via a small WASM library if Argon2 is preferred for stronger key derivation).

### 4.8 Testing & Tooling
- **Vitest** for unit tests (fast, integrates natively with Vite) — particularly valuable for the duration/rounding/overlap-detection logic, which is easy to get subtly wrong.
- **Playwright** for a small set of end-to-end tests covering the core loop (start → stop → edit → export) since this is the workflow that must never break.
- **ESLint + Prettier** for consistency, especially if more than one person ends up contributing.

### 4.9 Deployment
- Fully static output (`dist/` from Vite) — deployable to any static host (GitHub Pages, Netlify, Cloudflare Pages, or simply opened from disk). No server component, no environment variables, no build-time secrets — keeps the "runs entirely in your browser" claim literally true and easy to verify.

---

## 5. UX & Design Principles (Making People *Want* to Use It)

Time tracking tools have a bad reputation — most feel like surveillance or admin overhead. The goal here is to make it feel closer to a lightweight, personal habit tool.

- **Zero-friction start.** The most-used timecode(s) should be reachable in one click from the home screen — don't force a dropdown search for the thing someone does 10 times a day.
- **Big, satisfying "now" state.** When a timer is running, that should be the dominant visual on screen — a large, legible live-updating clock, a clear color state (e.g. green = running, amber = paused), and a title-bar/favicon indicator (§8.2) so it's visible even when the tab isn't focused.
- **Micro-feedback on every action.** Subtle animation/transition on start/stop/pause (not just an instant state swap) makes the app feel responsive and considered rather than utilitarian. Small toast confirmations ("Logged 1h 24m to Website redesign") reinforce that the action registered.
- **Empty states that guide, not apologize.** First-run experience should walk the user through creating their first group/timecode and starting their first timer in under a minute, not drop them on a blank dashboard.
- **Forgiving, never blocking.** Validation warnings (overlaps, unusually long durations) should be gentle nudges the user can dismiss, not hard stops — nobody should feel like the tool is scolding them.
- **Weekly summary as a small reward.** A short, visually pleasant "here's your week" view (total hours, top project, a streak indicator for days logged) gives people a reason to open the app even when they're not actively tracking — turns it from pure obligation into mild positive feedback.
- **Respect keyboard-first users.** Power users who log time constantly will want shortcuts (§8.7) — don't force mouse-only interaction for the core loop.
- **Consistent color language.** Group/timecode colors should be used consistently everywhere (dropdown, active timer, charts, calendar view) so users build quick visual pattern-recognition over time rather than reading labels each time.
- **Dark mode from day one.** A tool people glance at all day should be comfortable in low light — this is a small thing that disproportionately affects daily-tool goodwill.
- **Genuinely fast.** No loading spinners for local IndexedDB reads — the whole point of client-side storage is instant response; any perceptible lag on start/stop breaks trust in the tool.

---

## 6. Core Features (from original requirements)

### 6.1 Start / Stop / Pause
- One "active timer" at a time (simpler mental model than concurrent timers; see §8.15 for an optional advanced mode).
- **Start:** creates a new entry with `startTime = now`, `isRunning = true`.
- **Stop:** sets `endTime = now`, `isRunning = false`, recalculates `duration`.
- **Pause:** sets `isPaused = true`, appends `{pauseStart: now}` to `pausedSegments`. Resume appends the matching `pauseEnd` and clears `isPaused`. Paused time is subtracted from `duration` at calculation time, but the raw start/end timestamps are never altered — full history stays intact.
- Live display: a running clock computed from `startTime` (and any pause segments), updated every second via `setInterval`, purely a UI concern — not written to storage every tick.

### 6.2 Editing Entries
This directly addresses "forgot to press stop" and general correction needs.

- Every entry (running or completed) is editable: `startTime`, `endTime`, `timecodeId`, `note`.
- Editing `endTime` on a running entry effectively "closes" it retroactively — set `isRunning = false` at the same time.
- **Validation on edit:**
  - `endTime` must be after `startTime`.
  - Warn (but don't necessarily block) if the edit creates an overlap with another entry — overlaps are sometimes legitimate (e.g. a quick interruption logged separately) but usually indicate a mistake.
  - Warn if a manually-entered duration looks unusually long (e.g. >12 hours) — likely a forgotten-stop scenario the user is now fixing, good to double-check the date as well as the time.
- **Manual entry creation:** users can add a fully retroactive entry (both start and end typed in) for time not tracked live at all.
- **Audit trail (`editHistory`):** each edit appends `{ field, oldValue, newValue, editedAt }` so entries can't be silently altered without a trace — useful if this data ever feeds into client billing.
- **Delete with confirmation** (soft-delete/trash with a restore window is worth considering over hard delete, so accidental deletions are recoverable within e.g. 30 days).

### 6.3 Backup / Restore
- **Export:** single JSON file containing all groups, timecodes, entries, and settings, with a timestamped filename (e.g. `timetracker-backup-2026-08-11.json`).
- **Include a schema version number** in the export file so future app versions can migrate older backups safely.
- **Include a simple checksum/hash** in the export so a corrupted or truncated file fails to import with a clear error rather than loading partial/broken data.
- **Import/restore:** validate schema version and checksum first; offer "merge" vs "replace" — merge is safer as a default (avoids accidentally wiping recent data with an old backup).
- **Backup reminders:** track `lastBackupDate`; on load, if `now - lastBackupDate > reminderIntervalDays`, show a dismissible (not blocking) banner. Reset the timer whenever an export completes.

### 6.4 Projects / Timecodes with Grouping
- Dropdown for timecode selection, grouped visually by parent group (optgroup-style or a grouped searchable dropdown for larger lists).
- **Inline "add new"** directly from the dropdown (type a name that doesn't exist → "Create new timecode 'X'" option), with a quick prompt to assign a group and color.
- Separate **management page** for bulk actions: rename, recolor, regroup, archive (hide from dropdown without deleting historical entries), and merge two timecodes (useful when duplicates get created by accident).
- Most-recently/most-frequently used timecodes surfaced at the top of the dropdown for faster daily use.

### 6.5 Analysis Page
- Preset ranges: **Today / This Week / This Month**, plus a custom date-range picker.
- Breakdown views:
  - By timecode (bar or pie chart + table)
  - By group (roll-up of timecodes)
  - Timeline/calendar view showing entries laid out across the day (helps spot gaps or overlaps)
- Totals: total tracked time, and (if hourly rates are set) total earnings for the period.
- Table view exportable to CSV; report view exportable to PDF (see §8.5).
- Rounding rule (from settings) applied only at this display/export layer — raw stored data stays precise.

---

## 7. Handling the "Forgot to Stop" Scenario Specifically

Since this was called out directly, here's the concrete flow:

1. User opens the app the next day and sees a timer still showing as running, with an implausibly large elapsed time.
2. App can proactively flag this: if a running timer's elapsed time exceeds some threshold (e.g. 8–10 hours) or crosses midnight, show a gentle prompt: *"This timer has been running for 14 hours — did you forget to stop it?"*
3. User clicks into the entry and edits `endTime` to the actual time they stopped working (typed directly, or via a time picker).
4. `duration` recalculates automatically; `isRunning` is cleared; the edit is logged in `editHistory`.
5. Optionally, the user can split the entry if part of that stretch should actually belong to a different timecode.

---

## 8. Additional Feature Suggestions

1. **Idle detection** — after N minutes with no mouse/keyboard activity while a timer runs, prompt "Still working on this?" so idle time isn't silently logged (complements the forgot-to-stop handling above).
2. **Live tab title / favicon** — show the running timer directly in the browser tab (e.g. "🔴 12:34 — Project X") so users can glance at the tab bar instead of switching windows.
3. **Rounding rules for reporting** — round to nearest 5/10/15 minutes at export time only, never mutating raw data.
4. **Billable rate + earnings view** — optional hourly rate per timecode, purely local, surfaced on the analysis page.
5. **PDF report export** — generate polished timesheet/invoice-style PDFs entirely client-side.
6. **CSV export/import** — export for spreadsheets, import for migrating history from Toggl/Clockify/etc.
7. **Keyboard shortcuts** — global hotkey to start/stop the current or last-used timecode.
8. **Optional passphrase encryption at rest** — encrypt the IndexedDB payload via the Web Crypto API for shared-machine scenarios; reinforces the privacy-first brand.
9. **Weekly/target hours + progress bar** — e.g. "32/40 hrs this week."
10. **PWA install support** — installable, fully offline-capable.
11. **Recurring/template entries** — one-click log for regular blocks (standups, admin time).
12. **Soft-delete with restore window** — safety net against accidental deletion of entries or timecodes.
13. **Overlap/gap detection on the analysis page** — visually flag overlapping entries or large unexplained gaps in the day.
14. **Color-coded timecodes** — carried through dropdown, active timer, and charts for fast visual scanning.
15. **Multiple concurrent timers (advanced/optional mode)** — for users who genuinely context-switch between two tracked activities; off by default to keep the common case simple.

---

## 9. Suggested Build Phases

**Phase 1 — Core loop**
- [x] Project scaffold (Vite + React + TypeScript + Tailwind)
- [x] Data model + IndexedDB layer, start/stop/pause, live timer display, timecode dropdown with inline add.

**Phase 2 — Editing & correction**
- [ ] Entry edit UI (start/end/timecode/note), validation, audit trail, manual entry creation, forgot-to-stop detection prompt.

**Phase 3 — Backup**
- [ ] Export/import with checksum + schema version, backup reminder banner.

**Phase 4 — Analysis**
- [ ] Date-range presets + custom range, Recharts-based charts, tables, CSV/PDF export.

**Phase 5 — Polish & extras**
- [ ] Grouping management page, idle detection, keyboard shortcuts, PWA packaging, tab-title live timer, dark mode, weekly summary view, chosen items from §8.

---

## 10. Open Questions to Settle Before Building

- Single active timer only, or support concurrent timers from day one?
- Merge vs. replace as the default import behavior?
- Soft-delete retention window — how long before permanent deletion?
- Is optional encryption-at-rest a v1 requirement or a later add-on?
- `idb` vs `Dexie.js` for the storage layer — worth a quick spike once analysis-page query patterns are clearer.