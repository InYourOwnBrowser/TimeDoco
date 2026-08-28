import { describe, it, expect } from 'vitest';
import { computeBillableLine, sumBillableLines } from './billing';
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
    // Three 1h40m entries: each line is 1.67h / $250.50.
    const lines = [1, 2, 3].map(i =>
      computeBillableLine(
        entry({ id: `e-${i}`, startTime: `2026-01-1${i}T09:00:00.000Z`, endTime: `2026-01-1${i}T10:40:00.000Z` }),
        january, 'none', rate
      )
    );
    const totals = sumBillableLines(lines);
    expect(totals.hours).toBe(roundTo2(1.67 * 3));
    expect(totals.amount).toBe(roundTo2(250.5 * 3));
    // No float dust: the total is exactly the sum of the printed line amounts.
    expect(totals.amount).toBe(751.5);
  });
});

function roundTo2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
