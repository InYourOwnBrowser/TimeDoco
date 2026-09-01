import { describe, it, expect } from 'vitest';
import { createEvents } from 'ics';
import type { Entry, Group, Settings, Timecode } from '../types';
import { buildReportLines, type BillableLine } from './billing';
import { roundCurrency } from './timeUtils';
import {
  sortEntriesForDocument,
  buildCalendarEvents,
  buildDetailTable,
  buildDetailedRawCSV,
  buildReportMeta,
  buildReportModel,
  buildSummaryCSV,
  buildSummaryTable,
  type ReportModel,
} from './reportDocument';

/**
 * The document layer, asserted end to end: entries in, the exact rows a client
 * receives out.
 *
 * Snapshots alone would lock in whatever is currently produced, a wrong total
 * included, so every fixture is also checked arithmetically — the Hours column
 * sums to the foot, the money column sums to the foot, each row satisfies
 * `rate x hours + fees = amount`, and the two CSVs agree with the PDF about
 * totals and about which work appears. Those are the invariants `billing.ts`
 * guarantees on the way in; this is the last place they can be broken on the
 * way out.
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

const ALL_TIMECODES = [TC_DEV, TC_DESIGN, TC_ADMIN, TC_RETAINER, TC_AWKWARD];
const ALL_GROUPS = [G_CLIENT, G_INTERNAL];

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

const NOW = new Date(2026, 0, 8, 17, 0, 0, 0);

/** Two ordinary days of hourly work, shared by most fixtures. */
const HOURLY_ENTRIES = [
  entry('e-dev-1', 'tc-dev', at(2026, 1, 5, 9), at(2026, 1, 5, 12, 30), { note: 'Auth flow' }),
  entry('e-dev-2', 'tc-dev', at(2026, 1, 6, 13), at(2026, 1, 6, 15, 45), { note: 'Review' }),
  entry('e-design-1', 'tc-design', at(2026, 1, 6, 9), at(2026, 1, 6, 11), { note: 'Wireframes' }),
];

interface Fixture {
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

const FIXTURES: Fixture[] = [
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

interface Rendered {
  model: ReportModel;
  lines: Map<string, BillableLine>;
  summary: ReturnType<typeof buildSummaryTable>;
  detail: ReturnType<typeof buildDetailTable>;
  summaryCsv: string;
  detailedCsv: string;
  meta: { label: string; value: string }[];
  entries: Entry[];
  settings: Settings;
}

const render = (fixture: Fixture): Rendered => {
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
  };
};

/** A money cell: '-' is zero, everything else carries the currency symbol. */
const money = (cell: string): number => {
  const text = cell.trim();
  if (text === '-' || text === '') return 0;
  const parsed = Number(text.replace(/[^0-9.-]/g, ''));
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

/** A rate cell: null when the timecode has none, which prints as a dash. */
const rateOf = (cell: string): number | null => {
  const text = cell.trim();
  if (text === '-' || text === '') return null;
  return Number(text.replace(/\/hr$/, '').replace(/[^0-9.-]/g, ''));
};

const splitCSVLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
};

const parseCSV = (csv: string): string[][] => csv.split('\n').map(splitCSVLine);

/**
 * A CSV text field back to the value it was written from. `escapeCSV` prefixes
 * an apostrophe to anything a spreadsheet would read as a formula, so a name
 * beginning `-` or `=` is deliberately not byte-identical to the PDF's.
 */
const unguard = (field: string): string => field.replace(/^'/, '');

const columnIndex = (header: string[], name: string): number => {
  const index = header.indexOf(name);
  expect(index, `column ${name} in ${header.join('|')}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe('report documents', () => {
  describe.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const out = render(fixture);

    it.runIf(fixture.snapshot !== false)('assembles the summary table, both CSVs and the disclosure block', () => {
      expect({
        head: out.summary.head,
        body: out.summary.body,
        foot: out.summary.foot,
        meta: out.meta,
        summaryCsv: out.summaryCsv,
        detailedCsv: out.detailedCsv,
        detailHead: out.detail.head,
        detailBody: out.detail.body,
      }).toMatchSnapshot();
    });

    it('prints a summary table whose columns add up to its own foot', () => {
      const { head, body, foot } = out.summary;
      const hoursCol = columnIndex(head[0], 'Hours');
      const moneyCol = head[0].length - 1;

      const bodyHours = roundCurrency(body.reduce((sum, row) => sum + Number(row[hoursCol]), 0));
      const bodyMoney = roundCurrency(body.reduce((sum, row) => sum + money(row[moneyCol]), 0));

      // The Total line is the last foot row whatever the tax rows above it.
      const totalRow = foot[foot.length - 1];
      expect(Number(totalRow[3])).toBe(bodyHours);
      expect(Number(totalRow[3])).toBe(out.model.totalHours);

      const { taxBreakdown } = out.model;
      if (!taxBreakdown) {
        expect(money(totalRow[totalRow.length - 1])).toBe(bodyMoney);
      } else if (out.settings.taxInclusive) {
        // Inclusive: the rows already carry the tax, so they sum to the total.
        expect(money(totalRow[totalRow.length - 1])).toBe(bodyMoney);
        expect(roundCurrency(taxBreakdown.subtotal + taxBreakdown.tax)).toBe(taxBreakdown.total);
      } else {
        // Exclusive: the rows sum to the subtotal, and tax is added below them.
        expect(money(foot[0][foot[0].length - 1])).toBe(bodyMoney);
        expect(roundCurrency(taxBreakdown.subtotal + taxBreakdown.tax)).toBe(taxBreakdown.total);
        expect(money(totalRow[totalRow.length - 1])).toBe(taxBreakdown.total);
      }
    });

    it('prints rows whose own arithmetic a client can check', () => {
      const { head, body } = out.summary;
      const hoursCol = columnIndex(head[0], 'Hours');
      const feesCol = out.model.showFeesColumn ? columnIndex(head[0], 'Fees') : -1;
      const moneyCol = head[0].length - 1;

      body.forEach((row) => {
        const rate = rateOf(row[2]);
        const hours = Number(row[hoursCol]);
        const fees = feesCol >= 0 ? money(row[feesCol]) : 0;
        const amount = money(row[moneyCol]);

        if (rate === null) {
          // No rate to multiply by: whatever the row bills is fees.
          expect(amount).toBe(fees);
        } else {
          expect(roundCurrency(rate * hours + fees)).toBe(amount);
        }
      });
    });

    it('exports a summary CSV that agrees with the summary table', () => {
      const rows = parseCSV(out.summaryCsv);
      const header = rows[0];
      const hoursCol = columnIndex(header, 'Duration (Hours)');
      const moneyCol = header.length - 1;
      const csvBody = rows.slice(1, 1 + out.summary.body.length);

      expect(csvBody.map((row) => unguard(row[0]))).toEqual(out.summary.body.map((row) => row[0]));
      csvBody.forEach((row, i) => {
        expect(Number(row[hoursCol])).toBe(Number(out.summary.body[i][3]));
        expect(money(row[moneyCol])).toBe(money(out.summary.body[i][out.summary.head[0].length - 1]));
      });

      // The CSV's own Total row, and the PDF's, are the same two numbers.
      const totalRow = rows.slice(1).find((row) => row[0] === 'Total');
      expect(totalRow).toBeDefined();
      const pdfTotal = out.summary.foot[out.summary.foot.length - 1];
      expect(Number(totalRow![hoursCol])).toBe(Number(pdfTotal[3]));
      expect(money(totalRow![moneyCol])).toBe(money(pdfTotal[pdfTotal.length - 1]));

      // The money column's heading only claims tax is included when the
      // document actually breaks tax out below.
      const claimsTax = header[moneyCol].startsWith('Total (incl.');
      expect(claimsTax).toBe(!!out.model.taxBreakdown && !!out.settings.taxInclusive);
      expect(out.summary.head[0][out.summary.head[0].length - 1].startsWith('Total (incl.')).toBe(claimsTax);
    });

    it('exports a detailed CSV listing the same work as the itemised table', () => {
      const rows = parseCSV(out.detailedCsv);
      const header = rows[0];
      const body = rows.slice(1);

      expect(body.length).toBe(out.entries.length);
      expect(body.length).toBe(out.detail.body.length);
      // Same rows in the same order, so one document cannot be read against the
      // other line by line and come out short.
      expect(body.map((row) => unguard(row[1]))).toEqual(out.detail.body.map((row) => row[1]));
      expect(body.map((row) => row[3].slice(0, 5))).toEqual(out.detail.body.map((row) => row[2]));

      const amountCol = columnIndex(header, 'Amount');
      const csvAmount = roundCurrency(body.reduce((sum, row) => sum + money(row[amountCol]), 0));
      const pdfAmount = roundCurrency(out.detail.body.reduce((sum, row) => sum + money(row[6]), 0));

      // Per-entry amounts are allocated from the row totals, so they add up to
      // the report total exactly — on both documents.
      expect(csvAmount).toBe(pdfAmount);
      expect(csvAmount).toBe(out.model.totalEarnings);
    });

    it('discloses a billed figure that matches the one it prints', () => {
      const rounding = out.meta.find((line) => line.label === 'Rounding:');
      if (!rounding) return;
      const billed = rounding.value.match(/billed ([\d.]+) h/);
      expect(billed).not.toBeNull();
      expect(Number(billed![1])).toBe(out.model.totalHours);
    });

    it('generates a calendar export covering every entry', () => {
      const events = buildCalendarEvents(out.entries, new Map(ALL_TIMECODES.map((t) => [t.id, t])), NOW);
      expect(events.length).toBe(out.entries.length);
      // Earliest first, like every other document built from the same entries.
      expect(events.map((e) => e.uid)).toEqual(sortEntriesForDocument(out.entries).map((e) => e.id));
      if (events.length === 0) return;
      const { error, value } = createEvents(events);
      expect(error).toBeFalsy();
      expect(value).toContain('BEGIN:VEVENT');
    });
  });
});

describe('report document specifics', () => {
  it('an empty report still prints a zeroed total line', () => {
    const out = render(FIXTURES.find((f) => f.name === 'an empty report')!);
    expect(out.summary.body).toEqual([]);
    expect(out.summary.foot[0][3]).toBe('0.00');
    expect(out.model.totalHours).toBe(0);
  });

  it('a fee-only row bills its fee and no hours', () => {
    const out = render(FIXTURES.find((f) => f.name === 'a fee-only report')!);
    expect(out.model.showFeesColumn).toBe(true);
    const [row] = out.summary.body;
    expect(row[3]).toBe('0.00');
    expect(money(row[4])).toBe(500);
    expect(money(row[5])).toBe(500);
    // The itemised line shows a dash for hours, not a measured zero.
    expect(out.detail.body[0][5]).toBe('—');
  });

  it('does not claim tax is included when no breakdown is printed', () => {
    const out = render(FIXTURES.find((f) => f.name === 'tax enabled at a zero rate, so there is no breakdown')!);
    expect(out.model.taxBreakdown).toBeNull();
    expect(out.summary.head[0][out.summary.head[0].length - 1]).toBe('Total');
    expect(out.summaryCsv.split('\n')[0].endsWith('Earnings')).toBe(true);
    expect(out.summary.foot).toHaveLength(1);
  });

  it('discloses the entries a rounding rule dropped', () => {
    const out = render(FIXTURES.find((f) => f.name === 'an entry rounded away to nothing')!);
    expect(out.model.zeroLinesCount).toBe(1);
    expect(out.meta.find((l) => l.label === 'Rounding:')?.value).toContain('1 entry rounded to 0.00 h');
    expect(out.summaryCsv).toContain('Not billed');
  });

  it('keeps a formula-shaped note from executing in a spreadsheet', () => {
    const out = render(FIXTURES.find((f) => f.name === 'names and notes that need escaping')!);
    expect(out.detailedCsv).toContain('"\'=SUM(A1:A2), ""quoted""');
    // Every row parses back to the same column count as the header.
    const rows = parseCSV(out.detailedCsv);
    rows.forEach((row) => expect(row.length).toBe(rows[0].length));
  });

  it('bills a clipped entry only for the part inside the window', () => {
    const out = render(FIXTURES.find((f) => f.name === 'entries clipped by the window')!);
    expect(out.lines.get('e-before')!.isClipped).toBe(true);
    // 22:00–02:00, of which two hours fall on or after the window's start.
    expect(out.lines.get('e-before')!.seconds).toBe(2 * 3600);
    expect(out.lines.get('e-after')!.isClipped).toBe(true);
  });
});
