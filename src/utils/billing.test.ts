import { describe, it, expect } from 'vitest';
import { buildBillableLines, buildLinesFromSettings, computeBillableLine, distributeAcrossBuckets, sumBillableLines } from './billing';
import type { Entry, Timecode } from '../types';

const tc = (over: Partial<Timecode> = {}): Timecode => ({
  id: 'tc-1',
  name: 'Client work',
  groupId: null,
  hourlyRate: 150,
  color: '#000',
  createdAt: '2026-01-01T00:00:00.000Z',
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
const february = { start: new Date('2026-02-01T00:00:00.000Z'), end: new Date('2026-02-28T23:59:59.999Z') };

describe('computeBillableLine', () => {
  it('clips an entry that overhangs the end of the reporting window', () => {
    // Runs 23:00 on 31 Jan to 01:00 on 1 Feb; only one hour belongs to January.
    const e = entry({ startTime: '2026-01-31T23:00:00.000Z', endTime: '2026-02-01T01:00:00.000Z', duration: 7200 });
    const line = computeBillableLine(e, january, 'none', tc());
    expect(line.hours).toBe(1);
    expect(line.isClipped).toBe(true);
    // The stored duration is the full two hours; the line must not use it.
    expect(e.duration / 3600).toBe(2);
  });

  it('bills a running timer up to now instead of its stored zero duration', () => {
    const now = new Date('2026-01-10T11:30:00.000Z');
    // startTimer writes duration: 0 and only fills it in on stop.
    const e = entry({ endTime: null, duration: 0, isRunning: true });
    const line = computeBillableLine(e, january, 'none', tc(), now);
    expect(line.isRunning).toBe(true);
    expect(line.hours).toBe(2.5);
    expect(line.amount).toBe(375);
  });

  it('reconciles rate x printed hours against the printed amount', () => {
    // 1h40m at $150/hr. The printed hours and the printed amount must agree.
    const e = entry({ endTime: '2026-01-10T10:40:00.000Z', duration: 6000 });
    const line = computeBillableLine(e, january, 'none', tc());
    expect(line.hours).toBe(1.67);
    expect(line.amount).toBe(roundTo2(1.67 * 150));
  });

  it('attributes a fixed cost only to the period containing the entry start', () => {
    const e = entry({
      startTime: '2026-01-31T23:00:00.000Z',
      endTime: '2026-02-01T01:00:00.000Z',
      duration: 7200,
      manualAmount: 500,
    });
    const jan = computeBillableLine(e, january, 'none', tc());
    const feb = computeBillableLine(e, february, 'none', tc());

    expect(jan.amount).toBe(500);
    // Billed once, not once per invoice that the entry happens to touch.
    expect(feb.amount).toBe(0);
    expect(jan.amount + feb.amount).toBe(500);
    // February still sees the hours worked, just none of the fee.
    expect(feb.hours).toBe(1);
  });

  it('subtracts a pause recorded twice only once', () => {
    const pause = { pauseStart: '2026-01-10T09:10:00.000Z', pauseEnd: '2026-01-10T09:50:00.000Z' };
    const e = entry({ pausedSegments: [pause, { ...pause }] });
    const line = computeBillableLine(e, january, 'none', tc());
    expect(line.seconds).toBe(20 * 60);
  });

  it('ignores a pause segment recorded outside the entry window', () => {
    // Reachable by editing an entry start time later than an existing pause.
    const e = entry({ pausedSegments: [{ pauseStart: '2026-01-10T08:00:00.000Z', pauseEnd: '2026-01-10T09:30:00.000Z' }] });
    const line = computeBillableLine(e, january, 'none', tc());
    expect(line.seconds).toBe(30 * 60);
  });

  it('applies the rounding rule to the clipped duration', () => {
    const e = entry({ endTime: '2026-01-10T09:52:00.000Z' });
    expect(computeBillableLine(e, january, '15min', tc()).seconds).toBe(45 * 60);
  });

  it('yields no amount when the timecode has no rate', () => {
    expect(computeBillableLine(entry(), january, 'none', tc({ hourlyRate: null })).amount).toBe(0);
  });
});

describe('sumBillableLines', () => {
  it('sums lines so the printed parts add up to the printed total', () => {
    const rate = tc({ hourlyRate: 150 });
    // Three 1h40m entries on one timecode, built together as a report does.
    const lines = [...buildBillableLines(
      [1, 2, 3].map(i =>
        entry({ id: `e-${i}`, startTime: `2026-01-1${i}T09:00:00.000Z`, endTime: `2026-01-1${i}T10:40:00.000Z` })
      ),
      { dateRange: january, roundingRule: 'none', timecodeMap: new Map([['tc-1', rate]]) }
    ).values()];
    const totals = sumBillableLines(lines);
    // Three entries of exactly 1h40m are exactly 5 hours. Summing the rounded
    // per-line hours instead would drift to 5.01h and bill 751.50.
    expect(totals.hours).toBe(5);
    expect(totals.amount).toBe(750);
    // The row a client checks multiplies out exactly.
    expect(roundTo2(totals.hours * 150)).toBe(totals.amount);
    // And the line amounts still sum to the row with no float dust.
    expect(roundTo2(lines.reduce((sum, l) => sum + l.amount, 0))).toBe(totals.amount);
  });
});

function roundTo2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

describe('rounding scope', () => {
  const rate = tc({ hourlyRate: 60 });
  const map = new Map([['tc-1', rate]]);

  // Ten 7-minute entries on one day: 70 minutes of real work.
  const tenSevenMinuteEntries = Array.from({ length: 10 }, (_, i) =>
    entry({
      id: `e-${i}`,
      startTime: `2026-01-05T09:${String(i * 3).padStart(2, '0')}:00.000Z`,
      endTime: `2026-01-05T09:${String(i * 3 + 7).padStart(2, '0')}:00.000Z`,
      duration: 420,
    })
  );

  const build = (entries: Entry[], scope: any, rule: any = '15min') =>
    buildBillableLines(entries, { dateRange: january, roundingRule: rule, roundingScope: scope, timecodeMap: map });

  it('entry scope bills nothing for 70 minutes of real work', () => {
    // The compounding the audit flagged, kept available but no longer default.
    const lines = [...build(tenSevenMinuteEntries, 'entry').values()];
    expect(sumBillableLines(lines).seconds).toBe(0);
    expect(sumBillableLines(lines).workedSeconds).toBe(70 * 60);
  });

  it('day scope rounds the daily total once instead of compounding', () => {
    const lines = [...build(tenSevenMinuteEntries, 'day').values()];
    const totals = sumBillableLines(lines);
    // 70 minutes rounds to 75, not to zero.
    expect(totals.seconds).toBe(75 * 60);
    expect(totals.workedSeconds).toBe(70 * 60);
  });

  it('keeps the distortion within one rounding interval', () => {
    for (const scope of ['day', 'timecode', 'invoice'] as const) {
      const totals = sumBillableLines([...build(tenSevenMinuteEntries, scope).values()]);
      expect(Math.abs(totals.seconds - totals.workedSeconds)).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('does not inflate eight 8-minute entries to two hours', () => {
    // 64 minutes of work; per-entry rounding bills 8 x 15min = 2h.
    const eight = Array.from({ length: 8 }, (_, i) =>
      entry({
        id: `f-${i}`,
        startTime: `2026-01-06T${String(9 + i).padStart(2, '0')}:00:00.000Z`,
        endTime: `2026-01-06T${String(9 + i).padStart(2, '0')}:08:00.000Z`,
        duration: 480,
      })
    );
    expect(sumBillableLines([...build(eight, 'entry').values()]).seconds).toBe(2 * 3600);
    expect(sumBillableLines([...build(eight, 'day').values()]).seconds).toBe(60 * 60);
  });

  it('allocates a rounded bucket back to its lines so the parts sum to the total', () => {
    const lines = [...build(tenSevenMinuteEntries, 'day').values()];
    const summed = lines.reduce((total, line) => total + line.seconds, 0);
    // No drift: allocation is exact, not approximate.
    expect(summed).toBe(75 * 60);
    expect(sumBillableLines(lines).amount).toBe(75);
  });

  it('rounds each day separately under day scope', () => {
    const twoDays = [
      entry({ id: 'd1', startTime: '2026-01-05T09:00:00.000Z', endTime: '2026-01-05T09:07:00.000Z' }),
      entry({ id: 'd2', startTime: '2026-01-06T09:00:00.000Z', endTime: '2026-01-06T09:07:00.000Z' }),
    ];
    // 7 minutes on each of two days rounds to zero per day...
    expect(sumBillableLines([...build(twoDays, 'day').values()]).seconds).toBe(0);
    // ...but 14 minutes across the report rounds to 15 at invoice scope.
    expect(sumBillableLines([...build(twoDays, 'invoice').values()]).seconds).toBe(15 * 60);
  });

  it('keeps separate timecodes in separate buckets under day scope', () => {
    const other = tc({ id: 'tc-2', name: 'Other', hourlyRate: 60 });
    const twoCodes = [
      entry({ id: 'a', startTime: '2026-01-05T09:00:00.000Z', endTime: '2026-01-05T09:08:00.000Z' }),
      entry({ id: 'b', timecodeId: 'tc-2', startTime: '2026-01-05T10:00:00.000Z', endTime: '2026-01-05T10:08:00.000Z' }),
    ];
    const lines = buildBillableLines(twoCodes, {
      dateRange: january, roundingRule: '15min', roundingScope: 'day',
      timecodeMap: new Map([['tc-1', rate], ['tc-2', other]]),
    });
    // Each rounds up on its own; they are not pooled into 16 -> 15 minutes.
    expect(lines.get('a')!.seconds).toBe(15 * 60);
    expect(lines.get('b')!.seconds).toBe(15 * 60);
  });

  it('leaves a fixed cost out of the time buckets', () => {
    const mixed = [
      entry({ id: 'fee', startTime: '2026-01-05T09:00:00.000Z', endTime: '2026-01-05T09:07:00.000Z', manualAmount: 300 }),
      entry({ id: 'time', startTime: '2026-01-05T10:00:00.000Z', endTime: '2026-01-05T10:08:00.000Z' }),
    ];
    const lines = build(mixed, 'day');
    // The fee is billed in full and its minutes do not shift the hourly line.
    expect(lines.get('fee')!.amount).toBe(300);
    expect(lines.get('time')!.seconds).toBe(15 * 60);
  });

  it('is a no-op when the rounding rule is none', () => {
    for (const scope of ['entry', 'day', 'timecode', 'invoice'] as const) {
      const totals = sumBillableLines([...build(tenSevenMinuteEntries, scope, 'none').values()]);
      expect(totals.seconds).toBe(70 * 60);
      expect(totals.seconds).toBe(totals.workedSeconds);
    }
  });
});

describe('distributeAcrossBuckets', () => {
  const map = new Map([['tc-1', tc({ hourlyRate: 60 })]]);
  const build = (entries: Entry[], scope: any, rule: any = '15min') =>
    buildBillableLines(entries, { dateRange: january, roundingRule: rule, roundingScope: scope, timecodeMap: map });

  // Half-open days, matching how the timeline slices its range.
  const dayBuckets = (isoDays: string[]) =>
    isoDays.map((day) => ({
      start: new Date(`${day}T00:00:00.000Z`).getTime(),
      end: new Date(`${day}T00:00:00.000Z`).getTime() + 24 * 3600 * 1000,
    }));

  it('adds up to exactly the billable total under every rounding scope', () => {
    const spread = [
      entry({ id: 'a', startTime: '2026-01-05T09:00:00.000Z', endTime: '2026-01-05T09:07:00.000Z' }),
      entry({ id: 'b', startTime: '2026-01-05T14:00:00.000Z', endTime: '2026-01-05T14:23:00.000Z' }),
      entry({ id: 'c', startTime: '2026-01-06T08:00:00.000Z', endTime: '2026-01-06T11:31:00.000Z' }),
    ];
    const buckets = dayBuckets(['2026-01-05', '2026-01-06']);

    for (const scope of ['entry', 'day', 'timecode', 'invoice'] as const) {
      const lines = build(spread, scope);
      const perDay = distributeAcrossBuckets(spread, lines, buckets);
      const total = sumBillableLines([...lines.values()]).seconds;
      // A chart that re-rounded each day-slice on its own disagreed with the
      // report total beside it; sharing out the scoped figure cannot.
      expect(perDay.reduce((sum, value) => sum + value, 0)).toBe(total);
    }
  });

  it('splits an entry that spans midnight without billing a rounding interval on each side', () => {
    const overnight = [
      entry({ id: 'night', startTime: '2026-01-05T23:00:00.000Z', endTime: '2026-01-06T01:00:00.000Z' }),
    ];
    const buckets = dayBuckets(['2026-01-05', '2026-01-06']);
    const lines = build(overnight, 'day');
    const perDay = distributeAcrossBuckets(overnight, lines, buckets);

    expect(perDay.reduce((sum, value) => sum + value, 0)).toBe(2 * 3600);
    // One hour fell on each side of midnight.
    expect(perDay[0]).toBe(3600);
    expect(perDay[1]).toBe(3600);
  });

  it('measures a running entry up to now rather than reading its stored duration', () => {
    const now = new Date('2026-01-05T10:30:00.000Z');
    const running = [
      entry({ id: 'live', startTime: '2026-01-05T10:00:00.000Z', endTime: null, duration: 0, isRunning: true }),
    ];
    const lines = buildLinesFromSettings(running, { roundingRule: 'none', roundingScope: 'day' }, { now });
    const perDay = distributeAcrossBuckets(running, lines, dayBuckets(['2026-01-05']), now);

    expect(lines.get('live')!.seconds).toBe(30 * 60);
    expect(perDay[0]).toBe(30 * 60);
  });
});
