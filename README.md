# TimeDoco

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10161C.svg)](https://lukeafullard.github.io/TimeTag/)
[![100% Client--Side](https://img.shields.io/badge/Storage-100%25%20Client--Side%20IndexedDB-green.svg)](https://lukeafullard.github.io/TimeTag/)

**TimeDoco** is a completely client-side, privacy-first time tracking web application built for freelancers, contractors, and privacy advocates. Your timesheets, billable rates, and client details never leave your device.

🔗 **Live Application:** [https://lukeafullard.github.io/TimeTag/app/](https://lukeafullard.github.io/TimeTag/app/)
🌐 **Landing & FAQ:** [https://lukeafullard.github.io/TimeTag/](https://lukeafullard.github.io/TimeTag/)

---

## Key Features

- 🔒 **100% Local & Confidential:** Stored entirely in your browser using IndexedDB. No accounts, no cloud servers, no third-party tracking or telemetry.
- ⏱️ **Active Timer & Matrix Views:** Track time in real-time or log hours directly via a fast weekly Timesheet Matrix grid.
- 📄 **Professional Reporting:** Export client-ready PDF summaries, unrounded raw CSV files for accounting tools, and standard ICS calendar feeds.
- 💵 **Tax & Multi-Currency Controls:** Configure global or report-level tax rates (inclusive/exclusive), custom tax labels, and currency symbols.
- ⚡ **Offline Progressive Web App (PWA):** Fully functional offline. Installable on desktop and mobile devices for zero-latency access everywhere.
- 💾 **Data Portability:** Full JSON backup and restore capabilities for easy cross-device transfers and manual backups.

---

## Tech Stack

- **Framework & Runtime:** React 19, TypeScript, Vite
- **Styling:** Tailwind CSS, Fontsource (IBM Plex Sans & IBM Plex Mono)
- **Local Database:** IndexedDB via `idb`
- **Testing & Quality:** Vitest, Testing Library, Oxlint
- **Export Engines:** `jspdf`, `jspdf-autotable`, `papaparse`, `ics`

---

## Getting Started Locally

### Prerequisites

- Node.js (v18 or higher recommended)
- `npm`

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/LukeAFullard/TimeTag.git
cd TimeTag

# Install dependencies
npm install

# Start development server
npm run dev
```

### Building & Testing

```bash
# Run unit tests
npm test

# Run linter
npm run lint

# Build for production
npm run build
```

---

## License

This project is open-source software licensed under the [MIT License](LICENSE).
