import { describe, it, expect } from 'vitest';
import {
  billableSecondsByDay,
  billableSecondsByTimecodeDay,
  buildReportLines,
  buildScreenLines,
  ROUNDING_SCOPES,
  type BillingSettings,
  type RoundingRule,
} from '../utils/billing';
import { calendarDayBounds, calendarDayKey, roundHours } from '../utils/timeUtils';
import type { Entry, Timecode } from '../types';

/**
 * A shift that runs through midnight, on every surface that reports it.
 *
 * `TimeTotals.consistency` states in as many words that this case is "not
 * modelled here", and the invariants generator cannot reach it either — its
 * entries start by 20:00 and run at most three hours, so none of them crosses a
 * date. The report clipped such an entry at the period boundary while every
 * screen filed all of it under the day it started, so a Sunday-night shift read
 * 2.00 h on the timesheet and 1.00 h on the invoice built from the same entry.
 *
 * The rule these lock down: time bills to the day it was worked on. An entry
 * spanning midnight is split between the two days, and the parts add back up to
 * what the entry bills in total.
 */

const ISO = '2026-01-01T00:00:00.000Z';
const TC: Timecode = { id: 'tc-a', name: 'A', groupId: null, hourlyRate: 100, archived: false, updatedAt: ISO };
const timecodeMap = new Map([[TC.id, TC]]);

/** A local wall clock, so the fixture is the same shift in every timezone. */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

const entry = (id: string, start: Date, end: Date, over: Partial<Entry> = {}): Entry => ({
  id, timecodeId: TC.id,
  startTime: start.toISOString(), endTime: end.toISOString(),
  duration: Math.round((end.getTime() - start.getTime()) / 1000),
  note: '', tags: [], isRunning: false, isPaused: false, pausedSegments: [],
  manualAmount: null, editHistory: [],
  createdAt: start.toISOString(), updatedAt: start.toISOString(),
  ...over,
});

// Sunday 8 March 2026 is the last day of a Mon–Sun week; Monday the 9th starts
// the next. The shift finishes at 1am on the Monday.
const OVERNIGHT = entry('e-night', at(2026, 3, 8, 23, 0), at(2026, 3, 9, 1, 0));
const SUNDAY_DAY_JOB = entry('e-day', at(2026, 3, 8, 9, 0), at(2026, 3, 8, 11, 0));

const weekOf = (monday: Date) => {
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  return {
    days,
    keys: new Set(days.map(calendarDayKey)),
    window: { start: calendarDayBounds(days[0]).start, end: new Date(calendarDayBounds(days[6]).end.getTime() - 1) },
  };
};

const WEEK_1 = weekOf(at(2026, 3, 2, 0));  // Mon 2 – Sun 8
const WEEK_2 = weekOf(at(2026, 3, 9, 0));  // Mon 9 – Sun 15

/** What the timesheet grid puts in a cell, via the same call the grid makes. */
const gridCell = (all: Entry[], settings: BillingSettings, day: Date) =>
  billableSecondsByTimecodeDay(all, buildScreenLines(all, settings), new Date())
    .get(`${TC.id}|${calendarDayKey(day)}`) ?? 0;

/** What the weekly target bar counts, via the same call it makes. */
const weekBar = (all: Entry[], settings: BillingSettings, keys: Set<string>) => {
  let total = 0;
  for (const [, days] of billableSecondsByDay(all, buildScreenLines(all, settings))) {
    for (const [day, value] of days) if (keys.has(day)) total += value;
  }
  return total;
};

/** What the report bills for a period. */
const report = (all: Entry[], settings: BillingSettings, window: { start: Date; end: Date }) =>
  [...buildReportLines(all, settings, window, { timecodeMap }).values()]
    .reduce((sum, line) => sum + line.seconds, 0);

const RULES: RoundingRule[] = ['none', '5min', '10min', '15min'];
const combos = RULES.flatMap((roundingRule) => ROUNDING_SCOPES.map((roundingScope) => ({ roundingRule, roundingScope })));

describe('an overnight shift across every surface', () => {
  const all = [SUNDAY_DAY_JOB, OVERNIGHT];

  it('bills the hour after midnight to the Monday, not to the Sunday', () => {
    const settings: BillingSettings = { roundingRule: 'none', roundingScope: 'day' };
    expect(gridCell(all, settings, at(2026, 3, 8, 0))).toBe(2 * 3600 + 3600); // day job + 23:00–24:00
    expect(gridCell(all, settings, at(2026, 3, 9, 0))).toBe(3600);            // 00:00–01:00
  });

  it('the grid, the weekly bar and the report bill the same hours for the same week', () => {
    const settings: BillingSettings = { roundingRule: 'none', roundingScope: 'day' };

    for (const week of [WEEK_1, WEEK_2]) {
      const grid = week.days.reduce((sum, day) => sum + gridCell(all, settings, day), 0);
      // The two screens are the same arithmetic, so they agree to the second.
      expect(grid).toBe(weekBar(all, settings, week.keys));
      // Against the report, the figure that has to match is the one both print
      // and bill from. They differ by at most the single second between a
      // report window ending at 23:59:59.999 and a day ending at the next
      // midnight — a separate boundary defect, and not the split: before this
      // change the same comparison was out by a whole hour.
      expect(roundHours(grid / 3600)).toBe(roundHours(report(all, settings, week.window) / 3600));
      expect(Math.abs(grid - report(all, settings, week.window))).toBeLessThanOrEqual(1);
    }
  });

  it('bills the shift once across the two weeks, not twice and not half', () => {
    const settings: BillingSettings = { roundingRule: 'none', roundingScope: 'day' };
    const week1 = WEEK_1.days.reduce((sum, day) => sum + gridCell(all, settings, day), 0);
    const week2 = WEEK_2.days.reduce((sum, day) => sum + gridCell(all, settings, day), 0);
    // Two hours of day job plus two of night work, over the two weeks between
    // them — no hour counted on both invoices, none dropped between them.
    expect(week1 + week2).toBe(4 * 3600);
  });

  it.each(combos)('splits without inventing or losing time — $roundingRule at $roundingScope scope', (settings) => {
    const lines = buildScreenLines(all, settings);
    for (const [entryId, days] of billableSecondsByDay(all, lines, new Date())) {
      const parts = [...days.values()].reduce((sum, value) => sum + value, 0);
      // The split is an allocation, never a re-measurement: the parts are
      // exactly what the entry bills, whatever produced that figure.
      expect(parts).toBe(lines.get(entryId)!.seconds);
    }
  });

  it('keeps an entry inside one day on that day, unchanged', () => {
    const settings: BillingSettings = { roundingRule: '15min', roundingScope: 'day' };
    const only = [SUNDAY_DAY_JOB];
    const days = billableSecondsByDay(only, buildScreenLines(only, settings));
    expect([...days.get('e-day')!.keys()]).toEqual([calendarDayKey(at(2026, 3, 8, 0))]);
  });

  it('splits by time on the clock, so a pause comes out of the day it happened in', () => {
    // Two hours on the clock, but the whole of the pre-midnight hour is paused.
    const paused = entry('e-paused', at(2026, 3, 8, 23, 0), at(2026, 3, 9, 1, 0), {
      pausedSegments: [{ pauseStart: at(2026, 3, 8, 23, 0).toISOString(), pauseEnd: at(2026, 3, 9, 0, 0).toISOString() }],
    });
    const only = [paused];
    const settings: BillingSettings = { roundingRule: 'none', roundingScope: 'day' };
    const days = billableSecondsByDay(only, buildScreenLines(only, settings));
    expect(days.get('e-paused')!.get(calendarDayKey(at(2026, 3, 8, 0))) ?? 0).toBe(0);
    expect(days.get('e-paused')!.get(calendarDayKey(at(2026, 3, 9, 0)))).toBe(3600);
  });
});
