import { describe, it, expect } from 'vitest';
import { buildBillableLines, buildScreenLines, sumBillableLines, summarizeReport, workedVsBilledNote } from './billing';
import type { Entry, Timecode } from '../types';

/**
 * Regressions for corrupt-input handling in the billing trunk.
 *
 * Every case here starts from a record that a validated import cannot produce
 * but a hand-edited IndexedDB, an interrupted write or an older schema can. The
 * document builders were each hardened against exactly these inputs; the shared
 * module they all read from was not, so the same bad record still reaches them
 * through `buildBillableLines`.
 */

const tc = (over: Partial<Timecode> = {}): Timecode => ({
  id: 'tc-1',
  name: 'Client work',
  groupId: null,
  hourlyRate: 100,
  color: '#000',
  archived: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
} as Timecode);

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e-1',
  timecodeId: 'tc-1',
  startTime: '2026-01-10T09:00:00.000Z',
  endTime: '2026-01-10T10:00:00.000Z',
  duration: 3600,
  note: '',
  tags: [],
  isRunning: false,
  isPaused: false,
  pausedSegments: [],
  editHistory: [],
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-01-10T09:00:00.000Z',
  ...over,
} as Entry);

const january = { start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-01-31T23:59:59.999Z') };

describe('an unreadable startTime', () => {
  // `bucketKeyFor` case 'day' calls `calendarDayKey`, which throws by design on
  // an invalid date. 'day' is the default scope and the one every non-report
  // surface degrades to, so this is the common path, not an edge one.
  it('does not throw out of buildBillableLines at day scope', () => {
    const e = entry({ startTime: 'not-a-date', endTime: null });
    expect(() => buildBillableLines([e], { dateRange: null, roundingScope: 'day' })).not.toThrow();
  });

  it('does not throw out of buildScreenLines, which runs inside a render', () => {
    // EntryList and WeeklySummary both call this in a useMemo, on the one tab
    // with no ErrorBoundary of its own — a throw here replaces the whole app.
    const e = entry({ startTime: 'not-a-date', endTime: null });
    expect(() => buildScreenLines([e], { roundingRule: 'none', roundingScope: 'day' } as never)).not.toThrow();
  });

  it('keeps a corrupt entry from taking a healthy one down with it', () => {
    const good = entry({ id: 'good' });
    const bad = entry({ id: 'bad', startTime: 'not-a-date', endTime: null });
    const lines = buildBillableLines([good, bad], { dateRange: null, roundingScope: 'day' });
    expect(lines.get('good')?.seconds).toBe(3600);
  });
});

describe('an unreadable endTime', () => {
  // `calculateDuration` returns NaN for these: Math.max(0, Math.floor(NaN/1000))
  // is NaN, so the clamp that reads like a guard is not one.
  const good = entry({ id: 'good' });
  const bad = entry({ id: 'bad', startTime: '2026-01-10T11:00:00.000Z', endTime: 'garbage' });

  it('does not zero a clean entry sharing its rounding bucket', () => {
    // Same timecode, same day, so both land in one 'day' bucket. applyRounding
    // turns the NaN bucket total into 0 and allocateProportionally then hands
    // every line in the bucket zero.
    const lines = buildBillableLines([good, bad], {
      dateRange: january,
      roundingRule: '15min',
      roundingScope: 'day',
      timecodeMap: new Map([['tc-1', tc()]]),
    });
    expect(lines.get('good')?.seconds).toBe(3600);
    expect(lines.get('good')?.amount).toBe(100);
  });

  it('does not drop both entries out of the report summary', () => {
    const lines = buildBillableLines([good, bad], {
      dateRange: january,
      roundingRule: '15min',
      roundingScope: 'day',
      timecodeMap: new Map([['tc-1', tc()]]),
    });
    const summary = summarizeReport([good, bad], lines, new Map([['tc-1', tc()]]));
    expect(summary.timecodeRows.length).toBeGreaterThan(0);
  });

  it('does not zero a clean entry when rounding is off either', () => {
    // `applyRounding` tests finiteness *before* its `'none'` early return, so a
    // NaN bucket total becomes 0 under every rule, not just a rounding one.
    // Turning rounding off is therefore no escape from the zeroing above.
    const lines = buildBillableLines([good, bad], {
      dateRange: january,
      roundingRule: 'none',
      roundingScope: 'day',
      timecodeMap: new Map([['tc-1', tc()]]),
    });
    expect(lines.get('good')?.seconds).toBe(3600);
    expect(lines.get('good')?.amount).toBe(100);
  });

  it('keeps a non-finite duration out of the worked total', () => {
    // `sumBillableLines` accumulates `workedSeconds` unguarded, so a NaN there
    // poisons the worked figure `workedVsBilledNote` prints beside the billed one.
    const lines = buildBillableLines([good, bad], {
      dateRange: january,
      roundingRule: 'none',
      roundingScope: 'day',
      timecodeMap: new Map([['tc-1', tc()]]),
    });
    const totals = sumBillableLines([...lines.values()]);
    expect(Number.isFinite(totals.workedSeconds)).toBe(true);
  });
});

describe('workedVsBilledNote', () => {
  // Rule 3 attributes a fixed cost to the period containing its start, so a fee
  // that began before the window contributes amount 0 while its worked time is
  // still in the totals. `fees !== 0` then reads as "no fee in play".
  it('does not call fee time a rounding adjustment when fees net to zero', () => {
    // A fee attributed to an earlier period: worked time in the totals, fee 0.
    const note = workedVsBilledNote(7200, 0, true);
    expect(note).not.toMatch(/rounding/);
  });
});

describe('manualAmount of 0', () => {
  // The modals coerce 0 to null ("no fee"); both import paths accept it as a
  // valid number; billing treats any non-null value as a fixed cost. An hour of
  // tracked work then bills as a zero fee and vanishes from every total.
  it('is not treated as a fixed cost that erases an hour of tracked time', () => {
    const e = entry({ id: 'imported', manualAmount: 0 });
    const lines = buildBillableLines([e], {
      dateRange: january,
      roundingRule: 'none',
      roundingScope: 'day',
      timecodeMap: new Map([['tc-1', tc()]]),
    });
    const line = lines.get('imported')!;
    expect(line.isFixedCost).toBe(false);
    expect(line.seconds).toBe(3600);
    expect(line.amount).toBe(100);
  });
});
