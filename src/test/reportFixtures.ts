import type { Entry, Group, Settings, Timecode } from '../types';
import { buildReportLines, type BillableLine } from '../utils/billing';
import {
  buildDetailTable,
  buildDetailedRawCSV,
  buildReportMeta,
  buildReportModel,
  buildSummaryCSV,
  buildSummaryTable,
  type ReportModel,
} from '../utils/reportDocument';

/**
 * The fixture matrix the document layer is asserted against, and the same one
 * the PDFs are rendered from.
 *
 * One matrix, not two: a review PDF built from fixtures the invariants do not
 * cover would be a document nobody has checked the arithmetic of, and an
 * invariant on a case no one has ever looked at is half a guarantee.
 */

// Fixtures are built from local-time components, so a formatted cell reads the
// same under any TZ the suite runs in and the snapshots stay stable.
const at = (y: number, mo: number, d: number, h: number, mi = 0, sec = 0): string =>
  new Date(y, mo - 1, d, h, mi, sec, 0).toISOString();

const G_CLIENT: Group = { id: 'g-client', name: 'Acme Corp', color: '#123456', archived: false, updatedAt: at(2026, 1, 1, 0) };
const G_INTERNAL: Group = { id: 'g-internal', name: 'Internal', color: '#654321', archived: false, updatedAt: at(2026, 1, 1, 0) };

const TC_DEV: Timecode = { id: 'tc-dev', name: 'Development', groupId: 'g-client', hourlyRate: 120, archived: false, updatedAt: at(2026, 1, 1, 0) };
const TC_DESIGN: Timecode = { id: 'tc-design', name: 'Design', groupId: 'g-client', hourlyRate: 85, archived: false, updatedAt: at(2026, 1, 1, 0) };
const TC_ADMIN: Timecode = { id: 'tc-admin', name: 'Admin', groupId: null, hourlyRate: null, archived: false, updatedAt: at(2026, 1, 1, 0) };
const TC_RETAINER: Timecode = { id: 'tc-retainer', name: 'Retainer', groupId: 'g-internal', hourlyRate: 150, archived: false, updatedAt: at(2026, 1, 1, 0) };
const TC_AWKWARD: Timecode = { id: 'tc-awkward', name: '-Ops, Support & "Misc"', groupId: 'g-internal', hourlyRate: 40, archived: false, updatedAt: at(2026, 1, 1, 0) };

export const ALL_TIMECODES = [TC_DEV, TC_DESIGN, TC_ADMIN, TC_RETAINER, TC_AWKWARD];
export const ALL_GROUPS = [G_CLIENT, G_INTERNAL];

const entry = (
  id: string,
  timecodeId: string,
  startTime: string,
  endTime: string | null,
  over: Partial<Entry> = {},
): Entry => ({
  id,
  timecodeId,
  startTime,
  endTime,
  duration: 0,
  note: '',
  isRunning: endTime === null,
  isPaused: false,
  pausedSegments: [],
  editHistory: [],
  createdAt: startTime,
  updatedAt: startTime,
  ...over,
});

const BASE_SETTINGS: Settings = {
  id: 'user-settings',
  lastBackupDate: null,
  reminderIntervalDays: 7,
  roundingRule: 'none',
  roundingScope: 'day',
  idleThresholdMinutes: null,
  weeklyTargetHours: null,
  allowConcurrentTimers: false,
  currencySymbol: '$',
};

const settingsWith = (over: Partial<Settings>): Settings => ({ ...BASE_SETTINGS, ...over });

// A Mon–Sun reporting week.
const WEEK = {
  start: new Date(2026, 0, 5, 0, 0, 0, 0),
  end: new Date(2026, 0, 11, 23, 59, 59, 999),
};

export const NOW = new Date(2026, 0, 8, 17, 0, 0, 0);

/** Two ordinary days of hourly work, shared by most fixtures. */
const HOURLY_ENTRIES = [
  entry('e-dev-1', 'tc-dev', at(2026, 1, 5, 9), at(2026, 1, 5, 12, 30), { note: 'Auth flow' }),
  entry('e-dev-2', 'tc-dev', at(2026, 1, 6, 13), at(2026, 1, 6, 15, 45), { note: 'Review' }),
  entry('e-design-1', 'tc-design', at(2026, 1, 6, 9), at(2026, 1, 6, 11), { note: 'Wireframes' }),
];

export interface Fixture {
  name: string;
  entries: Entry[];
  settings: Settings;
  timecodes?: Timecode[];
  window?: { start: Date; end: Date };
  now?: Date;
  /**
   * Set false for a fixture whose printed output legitimately differs between
   * the timezones the suite runs under — a DST window is 23 or 25 hours long in
   * Auckland and 24 in UTC. Their arithmetic is still asserted; only the
   * snapshot, which is shared by both runs, is skipped.
   */
  snapshot?: boolean;
}

/** A Mon–Sun week ending on `endDay`, in local time. */
const weekEndingOn = (y: number, mo: number, d: number) => ({
  start: new Date(y, mo - 1, d - 6, 0, 0, 0, 0),
  end: new Date(y, mo - 1, d, 23, 59, 59, 999),
});

export const FIXTURES: Fixture[] = [
  {
    name: 'plain hourly report',
    entries: HOURLY_ENTRIES,
    settings: BASE_SETTINGS,
  },
  {
    name: 'fees alongside hourly work',
    entries: [
      ...HOURLY_ENTRIES,
      entry('e-fee-1', 'tc-retainer', at(2026, 1, 7, 9), at(2026, 1, 7, 10), { manualAmount: 500, note: 'Monthly retainer' }),
    ],
    settings: BASE_SETTINGS,
  },
  {
    name: 'a fee-only report',
    entries: [
      entry('e-fee-1', 'tc-retainer', at(2026, 1, 7, 9), at(2026, 1, 7, 10), { manualAmount: 500, note: 'Monthly retainer' }),
    ],
    settings: BASE_SETTINGS,
  },
  {
    name: 'tax, exclusive',
    entries: HOURLY_ENTRIES,
    settings: settingsWith({ taxEnabled: true, taxRate: 15, taxLabel: 'GST', taxInclusive: false }),
  },
  {
    name: 'tax, inclusive',
    entries: HOURLY_ENTRIES,
    settings: settingsWith({ taxEnabled: true, taxRate: 15, taxLabel: 'GST', taxInclusive: true }),
  },
  {
    name: 'tax enabled at a zero rate, so there is no breakdown',
    entries: HOURLY_ENTRIES,
    settings: settingsWith({ taxEnabled: true, taxRate: 0, taxLabel: 'GST', taxInclusive: true }),
  },
  {
    name: 'entries clipped by the window',
    entries: [
      entry('e-before', 'tc-dev', at(2026, 1, 4, 22), at(2026, 1, 5, 2), { note: 'Overnight into the window' }),
      entry('e-after', 'tc-design', at(2026, 1, 11, 22), at(2026, 1, 12, 3), { note: 'Overnight out of the window' }),
      ...HOURLY_ENTRIES,
    ],
    settings: BASE_SETTINGS,
  },
  {
    name: 'an entry rounded away to nothing',
    entries: [
      ...HOURLY_ENTRIES,
      entry('e-tiny', 'tc-design', at(2026, 1, 9, 9), at(2026, 1, 9, 9, 3), { note: 'Three minutes' }),
    ],
    settings: settingsWith({ roundingRule: '15min', roundingScope: 'entry' }),
  },
  {
    name: 'rounding at day scope',
    entries: [
      ...HOURLY_ENTRIES,
      entry('e-dev-3', 'tc-dev', at(2026, 1, 5, 14), at(2026, 1, 5, 14, 22)),
      entry('e-dev-4', 'tc-dev', at(2026, 1, 5, 15), at(2026, 1, 5, 15, 8)),
    ],
    settings: settingsWith({ roundingRule: '15min', roundingScope: 'day' }),
  },
  {
    // Two rows of 1.005 h each print as 1.01 and total 2.02, where rounding the
    // 7,236 summed seconds in one go gives 2.01. The report totals what it
    // printed, so the foot has to be the sum of the rows and not a figure
    // derived independently from the seconds.
    name: 'rows that round up where their own total would not',
    entries: [
      entry('e-dev-odd', 'tc-dev', at(2026, 1, 5, 9), at(2026, 1, 5, 10, 0, 18)),
      entry('e-design-odd', 'tc-design', at(2026, 1, 6, 9), at(2026, 1, 6, 10, 0, 18)),
    ],
    settings: BASE_SETTINGS,
  },
  {
    name: 'a timecode with no rate',
    entries: [
      ...HOURLY_ENTRIES,
      entry('e-admin-1', 'tc-admin', at(2026, 1, 8, 9), at(2026, 1, 8, 10, 30), { note: 'Invoicing' }),
    ],
    settings: BASE_SETTINGS,
  },
  {
    // Auckland springs forward on 27 September 2026: a 23-hour Sunday. The
    // entries either side of the 2am jump are one calendar day's work and one
    // rounding bucket, whatever the clock did in between.
    name: 'a week ending on a spring-forward day',
    entries: [
      entry('e-sat', 'tc-dev', at(2026, 9, 26, 9), at(2026, 9, 26, 12), { note: 'Saturday' }),
      entry('e-sun-early', 'tc-dev', at(2026, 9, 27, 1), at(2026, 9, 27, 1, 40), { note: 'Before the jump' }),
      entry('e-sun-late', 'tc-dev', at(2026, 9, 27, 22), at(2026, 9, 27, 23, 20), { note: 'After the jump' }),
      entry('e-design-dst', 'tc-design', at(2026, 9, 27, 14), at(2026, 9, 27, 15, 30), { note: 'Sunday design' }),
    ],
    settings: settingsWith({ roundingRule: '15min', roundingScope: 'day' }),
    window: weekEndingOn(2026, 9, 27),
    now: new Date(2026, 8, 28, 9, 0, 0),
    snapshot: false,
  },
  {
    // And back on 5 April 2026: a 25-hour Sunday, where an entry can sit in the
    // repeated hour.
    name: 'a week ending on a fall-back day',
    entries: [
      entry('e-sat', 'tc-dev', at(2026, 4, 4, 9), at(2026, 4, 4, 12), { note: 'Saturday' }),
      entry('e-sun-repeat', 'tc-dev', at(2026, 4, 5, 2), at(2026, 4, 5, 3), { note: 'In the repeated hour' }),
      entry('e-sun-late', 'tc-dev', at(2026, 4, 5, 20), at(2026, 4, 5, 21, 25), { note: 'Sunday evening' }),
      entry('e-design-dst', 'tc-design', at(2026, 4, 5, 11), at(2026, 4, 5, 12, 45), { note: 'Sunday design' }),
    ],
    settings: settingsWith({ roundingRule: '15min', roundingScope: 'day' }),
    window: weekEndingOn(2026, 4, 5),
    now: new Date(2026, 3, 6, 9, 0, 0),
    snapshot: false,
  },
  {
    name: 'an empty report',
    entries: [],
    settings: BASE_SETTINGS,
  },
  {
    name: 'a running timer',
    entries: [
      ...HOURLY_ENTRIES,
      entry('e-running', 'tc-dev', at(2026, 1, 8, 15), null, { note: 'Still going' }),
    ],
    settings: BASE_SETTINGS,
    now: NOW,
  },
  {
    name: 'names and notes that need escaping',
    entries: [
      entry('e-awkward-1', 'tc-awkward', at(2026, 1, 7, 9), at(2026, 1, 7, 11), {
        note: '=SUM(A1:A2), "quoted", and a very long remark that runs on past any sensible column width to see how it lands',
      }),
      ...HOURLY_ENTRIES,
    ],
    settings: BASE_SETTINGS,
  },
];

export interface Rendered {
  model: ReportModel;
  lines: Map<string, BillableLine>;
  summary: ReturnType<typeof buildSummaryTable>;
  detail: ReturnType<typeof buildDetailTable>;
  summaryCsv: string;
  detailedCsv: string;
  meta: { label: string; value: string }[];
  entries: Entry[];
  settings: Settings;
  timecodeMap: Map<string, Timecode>;
}

export const renderFixture = (fixture: Fixture): Rendered => {
  const timecodes = fixture.timecodes ?? ALL_TIMECODES;
  const timecodeMap = new Map(timecodes.map((t) => [t.id, t]));
  const groupMap = new Map(ALL_GROUPS.map((g) => [g.id, g]));
  const window = fixture.window ?? WEEK;
  const now = fixture.now ?? NOW;

  const lines = buildReportLines(fixture.entries, fixture.settings, window, { timecodeMap, now });
  // What the report shows: entries the window actually covers.
  const shown = fixture.entries.filter((e) => lines.has(e.id));
  const model = buildReportModel({ entries: shown, lines, timecodeMap, groupMap, settings: fixture.settings });

  return {
    model,
    lines,
    summary: buildSummaryTable(model, fixture.settings),
    detail: buildDetailTable(shown, lines, timecodeMap, fixture.settings),
    summaryCsv: buildSummaryCSV(model, fixture.settings),
    detailedCsv: buildDetailedRawCSV(shown, lines, timecodeMap, groupMap),
    meta: buildReportMeta(model, {
      preparedFor: 'Acme Corp',
      preparedBy: 'A Freelancer',
      periodText: 'Jan 5, 2026 – Jan 11, 2026',
      generatedText: 'Jan 12, 2026 at 09:00',
      customFields: [{ label: 'PO', value: '12345' }],
      settings: fixture.settings,
    }),
    entries: shown,
    settings: fixture.settings,
    timecodeMap,
  };
};


/** A filename-safe form of a fixture's name. */
export const fixtureSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
