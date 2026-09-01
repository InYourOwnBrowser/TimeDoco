import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ROUNDING_SCOPES,
  buildReportLines,
  buildScreenLines,
  effectiveRoundingScope,
  secondsFor,
  type BillingSettings,
  type RoundingRule,
  type RoundingScope,
} from '../utils/billing';
import type { Entry, Timecode } from '../types';

/**
 * The defect these guard against: the same two entries billed as 20 minutes on
 * the month calendar, 22.5 on the week grid beside it and 15 in the entry list,
 * because each surface named its own rounding window.
 *
 * Every surface hands `buildScreenLines` a *different slice* of the same
 * entries — the entry list gives it everything, the grid one week, the calendar
 * one month — so the test has to do the same. Building one slice and comparing
 * it against itself is the shape of check that let the original bug through.
 */

const ISO = '2026-03-01T00:00:00.000Z';

const TIMECODES: Timecode[] = [
  { id: 'tc-a', name: 'A', groupId: 'grp-1', hourlyRate: 100, archived: false, updatedAt: ISO },
  { id: 'tc-b', name: 'B', groupId: null, hourlyRate: 55, archived: false, updatedAt: ISO },
];
const timecodeMap = new Map(TIMECODES.map((tc) => [tc.id, tc]));

const YEAR = 2026;
const MONTH = 2; // March
const FIRST_DAY = 2;
const SPAN_DAYS = 10;

const dayStart = (offset: number) => new Date(YEAR, MONTH, FIRST_DAY + offset, 0, 0, 0, 0);

interface EntrySpec {
  dayOffset: number;
  startMinute: number;
  durationSeconds: number;
  timecodeIndex: number;
}

// Entries stay inside the calendar day they start on. That is what makes a
// 'day' bucket well defined across slices: a surface showing whole days sees
// every entry in any bucket it touches, so the bucket total cannot change with
// the slice. An entry straddling midnight belongs to its start day's bucket and
// is the one case a day-aligned slice can cut — it is not modelled here.
const entrySpecArb = fc.record<EntrySpec>({
  dayOffset: fc.integer({ min: 0, max: SPAN_DAYS - 1 }),
  startMinute: fc.integer({ min: 0, max: 20 * 60 }),
  durationSeconds: fc.integer({ min: 1, max: 3 * 3600 }),
  timecodeIndex: fc.integer({ min: 0, max: TIMECODES.length - 1 }),
});

const makeEntries = (specs: EntrySpec[]): Entry[] =>
  specs.map((spec, index) => {
    const start = dayStart(spec.dayOffset);
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
      manualAmount: null,
      editHistory: [],
      createdAt: start.toISOString(),
      updatedAt: start.toISOString(),
    };
  });

const startDayOffset = (entry: Entry): number => {
  const start = new Date(entry.startTime);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return Math.round((midnight - dayStart(0).getTime()) / 86_400_000);
};

const onDays = (entries: Entry[], from: number, to: number): Entry[] =>
  entries.filter((entry) => {
    const day = startDayOffset(entry);
    return day >= from && day <= to;
  });

/**
 * The five surfaces that put a duration on screen, each modelled by the slice
 * it actually hands the builder. `compute` calls the real production function.
 */
const SURFACES = [
  {
    name: 'entry list',
    // EntryList passes every non-deleted entry.
    compute: (entries: Entry[], settings: BillingSettings) =>
      buildScreenLines(entries, settings, { timecodeMap }),
  },
  {
    name: 'timesheet grid',
    // TimesheetMatrixView passes one week.
    compute: (entries: Entry[], settings: BillingSettings) =>
      buildScreenLines(onDays(entries, 0, 6), settings, { timecodeMap }),
  },
  {
    name: 'calendar',
    // TimesheetCalendarView passes the visible range.
    compute: (entries: Entry[], settings: BillingSettings) =>
      buildScreenLines(onDays(entries, 2, SPAN_DAYS - 1), settings, { timecodeMap }),
  },
  {
    name: 'weekly summary',
    // WeeklySummary pre-filters to the week it is showing.
    compute: (entries: Entry[], settings: BillingSettings) =>
      buildScreenLines(onDays(entries, 7, SPAN_DAYS - 1), settings, { timecodeMap }),
  },
  {
    name: 'report',
    // AnalysisView windows internally over the whole entry list.
    compute: (entries: Entry[], settings: BillingSettings) =>
      buildReportLines(entries, settings, { start: dayStart(0), end: dayStart(SPAN_DAYS) }, { timecodeMap }),
  },
];

const RULES: RoundingRule[] = ['none', '5min', '10min', '15min'];
const combinations = RULES.flatMap((roundingRule) =>
  ROUNDING_SCOPES.map((roundingScope) => ({ roundingRule, roundingScope })),
);

describe('TimeTotals consistency across surfaces', () => {
  describe.each(combinations)('$roundingRule at $roundingScope scope', (combo) => {
    const settings: BillingSettings = combo;
    // A report scope means "this timecode's total on this report" and "this
    // report's total", so only the report may apply it; every screen surface
    // degrades to 'day' and must therefore still agree with the others.
    const isReportScope = effectiveRoundingScope(combo.roundingScope as RoundingScope, null) !== combo.roundingScope;

    it('bills a shared entry identically on every screen surface', () => {
      fc.assert(
        fc.property(fc.array(entrySpecArb, { minLength: 1, maxLength: 16 }), (specs) => {
          const entries = makeEntries(specs);
          const screens = SURFACES.filter((s) => s.name !== 'report').map((surface) => ({
            name: surface.name,
            lines: surface.compute(entries, settings),
          }));

          const [reference, ...rest] = screens;
          for (const surface of rest) {
            for (const entry of entries) {
              if (!surface.lines.has(entry.id) || !reference.lines.has(entry.id)) continue;
              expect(
                secondsFor(surface.lines, entry.id),
                `${surface.name} disagrees with ${reference.name} on ${entry.id}`,
              ).toBe(secondsFor(reference.lines, entry.id));
            }
          }
        }),
      );
    });

    it('bills a shared entry the same on the report as on screen, outside report scopes', () => {
      fc.assert(
        fc.property(fc.array(entrySpecArb, { minLength: 1, maxLength: 16 }), (specs) => {
          const entries = makeEntries(specs);
          const screen = buildScreenLines(entries, settings, { timecodeMap });
          const report = SURFACES[4].compute(entries, settings);

          for (const entry of entries) {
            const same = secondsFor(report, entry.id) === secondsFor(screen, entry.id);
            // At 'timecode' and 'invoice' scope the report legitimately buckets
            // wider than any screen can, so it is allowed — expected — to differ.
            if (!isReportScope) {
              expect(same, `report disagrees with the entry list on ${entry.id}`).toBe(true);
            }
          }
        }),
      );
    });
  });

  it('degrades a report scope to day scope on every screen surface', () => {
    fc.assert(
      fc.property(
        fc.array(entrySpecArb, { minLength: 1, maxLength: 16 }),
        fc.constantFrom<RoundingRule>('none', '5min', '10min', '15min'),
        fc.constantFrom<RoundingScope>('timecode', 'invoice'),
        (specs, roundingRule, roundingScope) => {
          const entries = makeEntries(specs);
          const asConfigured = buildScreenLines(entries, { roundingRule, roundingScope }, { timecodeMap });
          const asDay = buildScreenLines(entries, { roundingRule, roundingScope: 'day' }, { timecodeMap });
          for (const entry of entries) {
            expect(secondsFor(asConfigured, entry.id)).toBe(secondsFor(asDay, entry.id));
          }
        },
      ),
    );
  });

  it('covers every surface that puts a duration on screen', () => {
    expect(SURFACES.map((s) => s.name)).toEqual([
      'entry list',
      'timesheet grid',
      'calendar',
      'weekly summary',
      'report',
    ]);
  });
});
