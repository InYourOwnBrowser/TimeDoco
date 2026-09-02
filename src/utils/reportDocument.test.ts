import { describe, it, expect } from 'vitest';
import { createEvents } from 'ics';
import { roundCurrency } from './timeUtils';
import { buildCalendarEvents, buildDetailTable, buildDetailedRawCSV, formatAmount, formatMoney, sortEntriesForDocument } from './reportDocument';
import { ALL_GROUPS, ALL_TIMECODES, FIXTURES, NOW, renderFixture as render } from '../test/reportFixtures';
import type { Entry } from '../types';

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

  // W-2: an unreadable timestamp threw a RangeError out of `format` — and out
  // of `calendarDayKey`, which raises its own — so one bad row in a restored
  // backup cost the entire export rather than the row that was broken.
  describe('a row whose timestamp cannot be read', () => {
    const timecodeMap = new Map(ALL_TIMECODES.map((t) => [t.id, t]));
    const groupMap = new Map(ALL_GROUPS.map((g) => [g.id, g]));
    const noLines = new Map();
    const settings = FIXTURES[0].settings;

    const base = { timecodeId: ALL_TIMECODES[0].id, tags: [], pausedSegments: [] };
    const good = {
      ...base, id: 'e-ok', note: 'fine',
      startTime: '2026-01-05T09:00:00.000Z', endTime: '2026-01-05T10:00:00.000Z',
    } as unknown as Entry;
    const broken = {
      ...base, id: 'e-broken', note: 'kept',
      startTime: 'not-a-timestamp', endTime: 'also-not-a-timestamp',
    } as unknown as Entry;

    it('still writes the raw CSV, leaving the unreadable cells blank', () => {
      const csv = buildDetailedRawCSV([good, broken], noLines, timecodeMap, groupMap);

      // Header plus both entries: the broken row is kept, not dropped.
      expect(csv.split('\n')).toHaveLength(3);
      // Its note survives, so the user can find the entry and repair it.
      expect(csv).toContain('kept');
    });

    it('still builds the detail table the PDF is drawn from', () => {
      const table = buildDetailTable([good, broken], noLines, timecodeMap, settings);

      expect(table.body).toHaveLength(2);
      // Found by note: an invalid date has no defined sort position.
      const row = table.body.find((cells) => cells[7] === 'kept');
      expect(row).toBeDefined();
      expect(row![0]).toBe('—');
      expect(row![2]).toBe('—');
    });

    it('leaves the entry out of the calendar rather than writing NaN into it', () => {
      // This path never threw; it wrote NaN components and produced an event no
      // calendar can read, which risks the whole file rather than one entry.
      const events = buildCalendarEvents([good, broken], timecodeMap);

      expect(events).toHaveLength(1);
      expect(events[0].uid).toBe('e-ok');
    });
  });

  describe('money on the page', () => {
    it('groups thousands, so a four-figure invoice is not counted out digit by digit', () => {
      expect(formatMoney(4800, '$')).toBe('$4,800.00');
      expect(formatMoney(1234567.5, '$')).toBe('$1,234,567.50');
      // The sign goes in front of the symbol: "$-1,234.50" scans as a typo on a
      // document a client reads, where "-$1,234.50" reads as the credit it is.
      expect(formatMoney(-1234.5, '$')).toBe('-$1,234.50');
      expect(formatMoney(920, '$')).toBe('$920.00');
    });

    it('keeps the decimal a point, whatever locale the machine would prefer', () => {
      // Both CSV exports print with `toFixed`, so a comma here would put the
      // PDF and the spreadsheet a client reconciles it against into different
      // number formats.
      expect(formatMoney(1234.5, '€')).toBe('€1,234.50');
      expect(formatAmount(1234.5, '€')).toBe('€1,234.50');
    });

    it('still prints nothing at all as a dash', () => {
      expect(formatAmount(0, '$')).toBe('-');
      expect(formatMoney(0, '$')).toBe('$0.00');
    });

    it('leaves the CSV exports ungrouped, where a comma would be a column break', () => {
      const out = render(FIXTURES.find((f) => f.name === 'fees alongside hourly work')!);
      const total = parseCSV(out.summaryCsv).find((row) => row[0] === 'Total')!;
      expect(total.some((cell) => cell.includes(','))).toBe(false);
      expect(total[total.length - 1]).toBe('1420.00');
      // And the PDF beside it does group the same figure.
      expect(out.summary.foot.at(-1)!.at(-1)).toBe('$1,420.00');
    });
  });
});
