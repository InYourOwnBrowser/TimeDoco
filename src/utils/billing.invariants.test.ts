import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ROUNDING_SCOPES,
  allocateProportionally,
  buildReportLines,
  summarizeReport,
  type BillingSettings,
  type DateRange,
  type RoundingRule,
} from './billing';
import { roundCurrency } from './timeUtils';
import type { Entry, Timecode } from '../types';

/**
 * These properties run the real entry points — `buildReportLines` and
 * `summarizeReport` — over generated entries, because the defects they exist to
 * catch live in how those two compose, not in either one alone. A property that
 * re-implements the caller inline can only ever agree with itself.
 *
 * Each is checked against all four rounding rules at all four scopes, since a
 * rounding bug that shows at one scope routinely hides at another.
 */

const ISO = '2026-03-01T00:00:00.000Z';

// Two timecodes share a group and two do not, so the group roll-up is exercised
// both as a sum of several rows and as a passthrough of one. `tc-d` has no rate
// at all: it bills nothing, which is a different thing from billing zero.
const TIMECODES: Timecode[] = [
  { id: 'tc-a', name: 'A', groupId: 'grp-1', hourlyRate: 100, archived: false, updatedAt: ISO },
  { id: 'tc-b', name: 'B', groupId: 'grp-1', hourlyRate: 137.5, archived: false, updatedAt: ISO },
  { id: 'tc-c', name: 'C', groupId: 'grp-2', hourlyRate: 42.75, archived: false, updatedAt: ISO },
  { id: 'tc-d', name: 'D', groupId: null, hourlyRate: null, archived: false, updatedAt: ISO },
];

const timecodeMap = new Map(TIMECODES.map((tc) => [tc.id, tc]));

// A three-day window in local time, because the 'day' rounding bucket keys off
// the local calendar date. Generated entries stay inside it, so nothing is
// clipped and `workedSeconds` is exactly the time on the clock — which is what
// lets the worked-vs-billed invariant be checked against an independent figure.
const WINDOW_YEAR = 2026;
const WINDOW_MONTH = 2; // March
const WINDOW_FIRST_DAY = 2;
const WINDOW: DateRange = {
  start: new Date(WINDOW_YEAR, WINDOW_MONTH, WINDOW_FIRST_DAY, 0, 0, 0, 0),
  end: new Date(WINDOW_YEAR, WINDOW_MONTH, WINDOW_FIRST_DAY + 2, 23, 59, 59, 999),
};

interface EntrySpec {
  dayOffset: number;
  startMinute: number;
  durationSeconds: number;
  timecodeIndex: number;
  feeCents: number | null;
}

const entrySpecArb = fc.record<EntrySpec>({
  dayOffset: fc.integer({ min: 0, max: 2 }),
  startMinute: fc.integer({ min: 0, max: 20 * 60 }),
  durationSeconds: fc.integer({ min: 1, max: 3 * 3600 }),
  timecodeIndex: fc.integer({ min: 0, max: TIMECODES.length - 1 }),
  // Mostly hourly work, with the occasional fixed cost mixed in.
  feeCents: fc.oneof(
    { arbitrary: fc.constant(null), weight: 5 },
    { arbitrary: fc.integer({ min: -20_000, max: 50_000 }), weight: 1 },
  ),
});

const entriesArb = fc.array(entrySpecArb, { minLength: 1, maxLength: 14 });

const makeEntry = (spec: EntrySpec, index: number): Entry => {
  const start = new Date(WINDOW_YEAR, WINDOW_MONTH, WINDOW_FIRST_DAY + spec.dayOffset, 0, 0, 0, 0);
  start.setMinutes(start.getMinutes() + spec.startMinute);
  const end = new Date(start.getTime() + spec.durationSeconds * 1000);
  return {
    id: `e-${index}`,
    timecodeId: TIMECODES[spec.timecodeIndex].id,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: spec.durationSeconds,
    note: '',
    isRunning: false,
    isPaused: false,
    pausedSegments: [],
    manualAmount: spec.feeCents === null ? null : spec.feeCents / 100,
    editHistory: [],
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
  };
};

const makeEntries = (specs: EntrySpec[]): Entry[] => specs.map(makeEntry);

/** Compare money and hours as exact integers, never as floats within a tolerance. */
const cents = (value: number): number => Math.round(value * 100);

const INTERVAL_SECONDS: Record<RoundingRule, number> = {
  none: 0,
  '5min': 5 * 60,
  '10min': 10 * 60,
  '15min': 15 * 60,
};

const RULES: RoundingRule[] = ['none', '5min', '10min', '15min'];

const combinations = RULES.flatMap((roundingRule) =>
  ROUNDING_SCOPES.map((roundingScope) => ({ roundingRule, roundingScope })),
);

describe.each(combinations)('report invariants — $roundingRule at $roundingScope scope', (combo) => {
  const settings: BillingSettings = combo;

  const report = (entries: Entry[]) => {
    const lines = buildReportLines(entries, settings, WINDOW, { timecodeMap });
    return { lines, summary: summarizeReport(entries, lines, timecodeMap) };
  };

  it('I1: the printed row hours add up to the printed total hours', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const { summary } = report(makeEntries(specs));
        const rowHours = summary.timecodeRows.reduce((acc, row) => acc + cents(row.hours), 0);
        expect(rowHours).toBe(cents(summary.totalHours));
      }),
    );
  });

  it('I2: every row reconciles on its own — rate x hours + fees = amount', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const { summary } = report(makeEntries(specs));
        for (const row of summary.timecodeRows) {
          const rate = timecodeMap.get(row.id)?.hourlyRate ?? 0;
          expect(cents(row.amount)).toBe(cents(roundCurrency(rate * row.hours) + row.fees));
        }
      }),
    );
  });

  it('I3: the row amounts add up to the report total', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const { summary } = report(makeEntries(specs));
        const rowAmounts = summary.timecodeRows.reduce((acc, row) => acc + cents(row.amount), 0);
        expect(rowAmounts).toBe(cents(summary.totals.amount));
      }),
    );
  });

  it('I4: the group table and the timecode table report the same time and money', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const { summary } = report(makeEntries(specs));
        const groupHours = summary.groupRows.reduce((acc, row) => acc + cents(row.hours), 0);
        const groupAmounts = summary.groupRows.reduce((acc, row) => acc + cents(row.amount), 0);
        expect(groupHours).toBe(cents(summary.totalHours));
        expect(groupAmounts).toBe(cents(summary.totals.amount));
      }),
    );
  });

  it('I5: worked time counts every entry in the window, billed or not', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const entries = makeEntries(specs);
        const { summary } = report(entries);
        // Independent of the billing pipeline: the time on the clock.
        const onTheClock = entries.reduce(
          (acc, entry) => acc + (new Date(entry.endTime!).getTime() - new Date(entry.startTime).getTime()) / 1000,
          0,
        );
        expect(summary.totals.workedSeconds).toBe(onTheClock);
      }),
    );
  });

  it('I6: every line is either on a row or counted as rounded away, never neither', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const entries = makeEntries(specs);
        const { lines, summary } = report(entries);
        const rowLineCount = entries.filter((entry) => {
          const line = lines.get(entry.id);
          return line && !(line.seconds <= 0 && line.amount === 0);
        }).length;
        expect(summary.zeroLinesCount + rowLineCount).toBe(entries.length);
        expect(summary.totals.seconds).toBe(
          summary.timecodeRows.reduce((acc, row) => acc + row.seconds, 0),
        );
      }),
    );
  });

  it('I7: a fixed cost bills as a fee and contributes no hours', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const entries = makeEntries(specs);
        const { lines } = report(entries);
        for (const entry of entries) {
          const line = lines.get(entry.id);
          if (!line?.isFixedCost) continue;
          expect(line.seconds).toBe(0);
          expect(line.hours).toBe(0);
        }
      }),
    );
  });

  it('I8: rounding moves each bucket by at most half an interval, and nothing else', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const entries = makeEntries(specs);
        const { lines, summary } = report(entries);
        const hourly = entries.filter((entry) => entry.manualAmount == null);
        const worked = hourly.reduce((acc, entry) => acc + (lines.get(entry.id)?.workedSeconds ?? 0), 0);
        const billed = summary.totals.seconds;
        // A bucket is rounded to its nearest interval, so it moves by at most
        // half of one; there are never more buckets than there are entries.
        // This is the bound the whole scope mechanism exists to hold: without
        // it, per-entry rounding lets the error grow with the entry count.
        const halfInterval = INTERVAL_SECONDS[combo.roundingRule] / 2;
        expect(Math.abs(billed - worked)).toBeLessThanOrEqual(halfInterval * hourly.length);
        expect(billed).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('I9: a report is unchanged by pre-filtering or reordering its input list', () => {
    fc.assert(
      fc.property(entriesArb, (specs) => {
        const entries = makeEntries(specs);
        const outOfWindow: Entry = makeEntry(
          { dayOffset: 0, startMinute: 0, durationSeconds: 3600, timecodeIndex: 0, feeCents: null },
          9_999,
        );
        // A month earlier, so it must not reach the report at all.
        const shifted = new Date(WINDOW_YEAR, WINDOW_MONTH - 1, 1, 9, 0, 0, 0);
        outOfWindow.startTime = shifted.toISOString();
        outOfWindow.endTime = new Date(shifted.getTime() + 3_600_000).toISOString();

        const plain = report(entries).summary;
        const padded = summarizeReport(
          entries,
          buildReportLines([...entries].reverse().concat(outOfWindow), settings, WINDOW, { timecodeMap }),
          timecodeMap,
        );

        expect(cents(padded.totalHours)).toBe(cents(plain.totalHours));
        expect(cents(padded.totals.amount)).toBe(cents(plain.totals.amount));
        expect(padded.totals.seconds).toBe(plain.totals.seconds);
      }),
    );
  });
});

describe('allocateProportionally', () => {
  it('hands out exactly the target, whatever the shape of the parts', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 20 }),
        // Spans both signs: a negative target is a credit, and it used to be the
        // one quadrant this property never generated, so the allocator silently
        // zeroed every line under it and nothing here objected.
        fc.integer({ min: -500_000, max: 500_000 }),
        (parts, target) => {
          const allocated = allocateProportionally(parts, target);
          const total = parts.reduce((acc, value) => acc + value, 0);
          expect(allocated).toHaveLength(parts.length);
          // Each part carries the target's sign: a credit never yields a positive
          // line, a charge never a negative one.
          expect(allocated.every((value) => (target < 0 ? value <= 0 : value >= 0))).toBe(true);
          expect(allocated.reduce((acc, value) => acc + value, 0)).toBe(
            total <= 0 || target === 0 ? 0 : target,
          );
        },
      ),
    );
  });

  // The counterexample I9 found, kept as a fixed case: the property that caught
  // it runs unseeded, so without this the same defect could return and be
  // dismissed as a flake on a re-run that happens to pass.
  it('gives two equal parts the same answer whichever order they arrive in', () => {
    const parts = [10794, 10794, 3769];
    const keys = ['a', 'b', 'c'];
    const target = 25358;

    const forward = allocateProportionally(parts, target, keys);
    const reversed = allocateProportionally(
      [...parts].reverse(),
      target,
      [...keys].reverse(),
    ).reverse();

    expect(forward).toEqual(reversed);
    expect(forward.reduce((acc, value) => acc + value, 0)).toBe(target);
  });

  // C-1: `ce388d3` taught the reports to print a negative amount, but the
  // allocator still bailed out on `target <= 0` and handed back all zeros, so a
  // credit's lines silently stopped summing to the row they sat under.
  it('shares a credit out exactly, the same way it shares a charge', () => {
    const parts = [3600, 1800];
    const credit = allocateProportionally(parts, -500);

    expect(credit.reduce((acc, value) => acc + value, 0)).toBe(-500);
    expect(credit).toEqual([-333, -167]);
    // Mirror image of the charge: same split, opposite sign.
    expect(credit).toEqual(allocateProportionally(parts, 500).map((value) => -value));
  });

  it('is a function of the set, not of the order the parts arrive in', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(
            fc.record({ key: fc.string({ minLength: 1, maxLength: 6 }), part: fc.integer({ min: 0, max: 100_000 }) }),
            { minLength: 1, maxLength: 12, selector: (item) => item.key },
          ),
          // Non-zero, both signs: order independence has to hold for credits too.
          fc.oneof(fc.integer({ min: -500_000, max: -1 }), fc.integer({ min: 1, max: 500_000 })),
        (items, target) => {
          const allocate = (list: typeof items) =>
            allocateProportionally(
              list.map((item) => item.part),
              target,
              list.map((item) => item.key),
            );

          const byKey = new Map(
            items.map((item, index) => [item.key, allocate(items)[index]]),
          );
          const shuffled = [...items].reverse();
          const shuffledAllocation = allocate(shuffled);

          shuffled.forEach((item, index) => {
            expect(shuffledAllocation[index]).toBe(byKey.get(item.key));
          });
        },
      ),
    );
  });
});

describe('regression: the invoice row a client checks', () => {
  // Two timecodes, 1 h 0 m 18 s each at $100/hr, no rounding rule. Each row
  // rounds to 1.01 h and bills 101.00; the report totals 2.02 h and 202.00.
  // Deriving the total from the total seconds printed 2.01 h beside 202.00, and
  // allocating that 2.01 back into the rows printed a row reading
  // "100.00/hr x 1.00 h = 101.00".
  const twoRows: Entry[] = [
    makeEntry({ dayOffset: 0, startMinute: 9 * 60, durationSeconds: 3618, timecodeIndex: 0, feeCents: null }, 1),
    makeEntry({ dayOffset: 0, startMinute: 9 * 60, durationSeconds: 3618, timecodeIndex: 2, feeCents: null }, 2),
  ];

  it('prints rows whose own arithmetic holds and which add up to the total', () => {
    const settings: BillingSettings = { roundingRule: 'none', roundingScope: 'invoice' };
    const lines = buildReportLines(twoRows, settings, WINDOW, { timecodeMap });
    const summary = summarizeReport(twoRows, lines, timecodeMap);

    const byId = new Map(summary.timecodeRows.map((row) => [row.id, row]));
    expect(byId.get('tc-a')).toMatchObject({ hours: 1.01, amount: 101 });
    expect(byId.get('tc-c')).toMatchObject({ hours: 1.01, amount: 43.18 });

    expect(summary.totalHours).toBe(2.02);
    expect(summary.totals.amount).toBe(144.18);
  });
});
