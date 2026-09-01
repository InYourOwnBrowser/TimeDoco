import { describe, it, expect } from 'vitest';
import { checkOverlap, findFreeSlot, calculateDuration, applyRounding, calculateTaxBreakdown, calculateTotalPausedSeconds, formatDurationShort, getElapsedTimeMs, findOverlappingCandidates, calendarDayKey, calendarDayBounds } from './timeUtils';
import type { Entry, PauseSegment } from '../types';

describe('timeUtils', () => {
  describe('checkOverlap', () => {
    const baseDate = '2023-10-27T10:00:00Z';
    const createEntry = (id: string, startOffsetMins: number, endOffsetMins: number): Entry => {
      const startTime = new Date(new Date(baseDate).getTime() + startOffsetMins * 60000).toISOString();
      const endTime = new Date(new Date(baseDate).getTime() + endOffsetMins * 60000).toISOString();
      return {
        id,
        timecodeId: 'tc1',
        startTime,
        endTime,
        duration: (endOffsetMins - startOffsetMins) * 60,
        note: '',
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: startTime,
        updatedAt: startTime
      };
    };

    const entries = [
      createEntry('e1', 0, 60), // 10:00 to 11:00
      createEntry('e2', 120, 180), // 12:00 to 13:00
    ];

    it('returns false when there is no overlap', () => {
      const start = new Date('2023-10-27T11:00:00Z');
      const end = new Date('2023-10-27T12:00:00Z');
      expect(checkOverlap(start, end, entries)).toBe(false);
    });

    it('returns true when overlapping at the start', () => {
      const start = new Date('2023-10-27T09:30:00Z');
      const end = new Date('2023-10-27T10:30:00Z'); // Overlaps with e1
      expect(checkOverlap(start, end, entries)).toBe(true);
    });

    it('returns true when overlapping at the end', () => {
      const start = new Date('2023-10-27T10:30:00Z'); // Overlaps with e1
      const end = new Date('2023-10-27T11:30:00Z');
      expect(checkOverlap(start, end, entries)).toBe(true);
    });

    it('returns true for exact overlap', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      expect(checkOverlap(start, end, entries)).toBe(true);
    });

    it('returns true when completely encompassing an existing entry', () => {
      const start = new Date('2023-10-27T09:00:00Z');
      const end = new Date('2023-10-27T11:30:00Z');
      expect(checkOverlap(start, end, entries)).toBe(true);
    });

    it('returns false when ignoring self (excludeId)', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      expect(checkOverlap(start, end, entries, 'e1')).toBe(false);
    });

    it('returns false when concurrent mode is on and timecodes differ', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      // Overlaps with e1 in time, but timecodeId is different and concurrent mode is true
      expect(checkOverlap(start, end, entries, undefined, 'tc2', true)).toBe(false);
    });

    it('returns true when concurrent mode is on and timecodes are the same', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      // Overlaps with e1 in time, and timecodeId is the same
      expect(checkOverlap(start, end, entries, undefined, 'tc1', true)).toBe(true);
    });
  });

  describe('findFreeSlot', () => {
    const day = new Date(2025, 0, 8); // Wednesday Jan 8 2025
    const createEntry = (id: string, startH: number, startM: number, endH: number, endM: number, timecodeId = 'tc1'): Entry => {
      const startTime = new Date(2025, 0, 8, startH, startM, 0).toISOString();
      const endTime = new Date(2025, 0, 8, endH, endM, 0).toISOString();
      return {
        id, timecodeId, startTime, endTime,
        duration: ((endH * 60 + endM) - (startH * 60 + startM)) * 60,
        note: '', isRunning: false, isPaused: false,
        pausedSegments: [], editHistory: [],
        createdAt: startTime, updatedAt: startTime,
      };
    };

    it('returns 12:00 anchor if no entries overlap noon', () => {
      const entries = [createEntry('e1', 9, 0, 11, 0)];
      const slot = findFreeSlot(day, 1800, entries, undefined, 'tc1', false)!;
      expect(slot.start.getHours()).toBe(12);
      expect(slot.start.getMinutes()).toBe(0);
      expect((slot.end.getTime() - slot.start.getTime()) / 1000).toBe(1800);
    });

    it('finds slot immediately after conflicting entry covering 12:00', () => {
      const entries = [createEntry('e1', 11, 0, 13, 0)]; // 11:00 to 13:00
      const slot = findFreeSlot(day, 1800, entries, undefined, 'tc1', false)!;
      expect(slot.start.getHours()).toBe(13);
      expect(slot.start.getMinutes()).toBe(0);
    });

    it('finds slot between two conflicting entries if wide enough', () => {
      const entries = [
        createEntry('e1', 11, 0, 13, 0), // 11:00 - 13:00
        createEntry('e2', 14, 0, 16, 0), // 14:00 - 16:00
      ];
      // Looking for 30 min (1800s). Gap 13:00 - 14:00 is free.
      const slot = findFreeSlot(day, 1800, entries, undefined, 'tc1', false)!;
      expect(slot.start.getHours()).toBe(13);
      expect(slot.start.getMinutes()).toBe(0);
    });

    it('skips tight gaps and lands after the last conflicting entry', () => {
      const entries = [
        createEntry('e1', 11, 0, 13, 0), // 11:00 - 13:00
        createEntry('e2', 13, 0, 13, 15), // 13:00 - 13:15 (only 15m gap)
      ];
      // Looking for 30 min (1800s) slot.
      const slot = findFreeSlot(day, 1800, entries, undefined, 'tc1', false)!;
      expect(slot.start.getHours()).toBe(13);
      expect(slot.start.getMinutes()).toBe(15);
    });

    // A timesheet adjustment belongs to the day whose cell was edited. A slot
    // that runs past midnight silently moves the time onto the next day, where
    // it lands in a different rounding bucket and a different week's total.
    it('never returns a slot that runs past midnight', () => {
      const slot = findFreeSlot(day, 14 * 3600, [], undefined, 'tc1', false);
      expect(slot).not.toBeNull();
      expect(slot!.end.getDate()).toBe(day.getDate());
      expect(slot!.start.getTime()).toBeGreaterThanOrEqual(day.getTime());
    });

    it('uses the free morning when nothing after noon is long enough', () => {
      // Busy 09:00-17:00, so 00:00-09:00 is the only stretch that fits 8 hours.
      const entries = [createEntry('e1', 9, 0, 17, 0)];
      const slot = findFreeSlot(day, 8 * 3600, entries, undefined, 'tc1', false);
      expect(slot).not.toBeNull();
      expect(slot!.start.getHours()).toBe(0);
      expect(slot!.end.getHours()).toBe(8);
    });

    it('can use the last hour of the day', () => {
      // Busy 09:00-23:00; 23:00 to midnight is exactly the hour requested.
      const entries = [createEntry('e1', 9, 0, 23, 0)];
      const slot = findFreeSlot(day, 3600, entries, undefined, 'tc1', false);
      expect(slot).not.toBeNull();
      expect(slot!.start.getHours()).toBe(23);
      expect(slot!.end.getTime()).toBe(new Date(2025, 0, 9).getTime());
    });

    it('returns null only when the day genuinely has no room', () => {
      const entries = [createEntry('e1', 0, 0, 23, 30)];
      expect(findFreeSlot(day, 3600, entries, undefined, 'tc1', false)).toBeNull();
      // ...but the half hour that is left is still reachable.
      const slot = findFreeSlot(day, 1800, entries, undefined, 'tc1', false);
      expect(slot!.start.getHours()).toBe(23);
      expect(slot!.start.getMinutes()).toBe(30);
    });

    it('never returns a slot that overlaps an existing entry', () => {
      const entries = [
        createEntry('e1', 8, 0, 10, 0),
        createEntry('e2', 11, 30, 12, 30),
        createEntry('e3', 15, 0, 21, 0),
      ];
      for (const minutes of [15, 30, 45, 60, 90, 120, 180]) {
        const slot = findFreeSlot(day, minutes * 60, entries, undefined, 'tc1', false);
        if (!slot) continue;
        expect(checkOverlap(slot.start, slot.end, entries, undefined, 'tc1', false)).toBe(false);
        expect(slot.end.getTime() - slot.start.getTime()).toBe(minutes * 60 * 1000);
      }
    });

    it('ignores a trashed entry when looking for room', () => {
      const trashed = { ...createEntry('e1', 0, 0, 23, 59), deletedAt: new Date().toISOString() };
      const slot = findFreeSlot(day, 3600, [trashed], undefined, 'tc1', false);
      expect(slot).not.toBeNull();
      expect(slot!.start.getHours()).toBe(12);
    });
  });

  describe('applyRounding', () => {
    it('returns original seconds if rounding rule is none', () => {
      expect(applyRounding(100, 'none')).toBe(100);
    });

    it('rounds to nearest 5 minutes', () => {
      // 2.5 mins = 150 seconds. Under 150 -> 0. 150+ -> 300.
      expect(applyRounding(149, '5min')).toBe(0);
      expect(applyRounding(150, '5min')).toBe(300); // 5 mins
      expect(applyRounding(300, '5min')).toBe(300);
      expect(applyRounding(449, '5min')).toBe(300);
      expect(applyRounding(450, '5min')).toBe(600); // 10 mins
    });

    it('rounds to nearest 10 minutes', () => {
      // 5 mins = 300 seconds.
      expect(applyRounding(299, '10min')).toBe(0);
      expect(applyRounding(300, '10min')).toBe(600); // 10 mins
      expect(applyRounding(899, '10min')).toBe(600);
      expect(applyRounding(900, '10min')).toBe(1200); // 20 mins
    });

    it('rounds to nearest 15 minutes', () => {
      // 7.5 mins = 450 seconds.
      expect(applyRounding(449, '15min')).toBe(0);
      expect(applyRounding(450, '15min')).toBe(900); // 15 mins
      expect(applyRounding(1349, '15min')).toBe(900);
      expect(applyRounding(1350, '15min')).toBe(1800); // 30 mins
    });
  });

  describe('calculateDuration', () => {
    it('calculates simple duration without pauses', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z'); // 1 hour = 3600 seconds
      expect(calculateDuration(start, end, [])).toBe(3600);
    });

    it('subtracts duration of one completed pause', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      const pauses: PauseSegment[] = [
        { pauseStart: '2023-10-27T10:15:00Z', pauseEnd: '2023-10-27T10:30:00Z' } // 15 mins pause = 900s
      ];
      expect(calculateDuration(start, end, pauses)).toBe(2700);
    });

    it('subtracts duration of multiple paused segments', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      const pauses: PauseSegment[] = [
        { pauseStart: '2023-10-27T10:15:00Z', pauseEnd: '2023-10-27T10:30:00Z' }, // 15 mins pause = 900s
        { pauseStart: '2023-10-27T10:45:00Z', pauseEnd: '2023-10-27T10:50:00Z' } // 5 mins pause = 300s
      ];
      expect(calculateDuration(start, end, pauses)).toBe(2400); // 3600 - 1200 = 2400
    });

    it('calculates duration where end time is during an active pause', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T10:30:00Z');
      const pauses: PauseSegment[] = [
        { pauseStart: '2023-10-27T10:15:00Z' } // 15 mins passed before pause started
      ];
      // When pauseEnd is undefined/missing, calculateDuration treats end as the end of the pause
      // Total diff = 1800s. Pause diff (10:15 to 10:30) = 900s. Result = 900s.
      expect(calculateDuration(start, end, pauses)).toBe(900);
    });

    it('returns 0 when start date is after end date', () => {
      const start = new Date('2023-10-27T11:00:00Z');
      const end = new Date('2023-10-27T10:00:00Z');
      expect(calculateDuration(start, end, [])).toBe(0);
    });

    it('returns 0 when start date is after end date even with pause segments', () => {
      const start = new Date('2023-10-27T11:00:00Z');
      const end = new Date('2023-10-27T10:00:00Z');
      const pauses: PauseSegment[] = [
        { pauseStart: '2023-10-27T10:15:00Z', pauseEnd: '2023-10-27T10:30:00Z' }
      ];
      expect(calculateDuration(start, end, pauses)).toBe(0);
    });

    it('clamps negative duration to 0', () => {
      const start = new Date('2023-10-27T10:00:00Z');
      const end = new Date('2023-10-27T11:00:00Z');
      const pauses: PauseSegment[] = [
        { pauseStart: '2023-10-27T10:00:00Z', pauseEnd: '2023-10-27T12:00:00Z' } // 2 hours pause
      ];
      // Diff = 3600. Pause = 7200. Result = -3600 -> 0.
      expect(calculateDuration(start, end, pauses)).toBe(0);
    });
  });

  describe('calculateTotalPausedSeconds', () => {
    it('sums completed pause segments clamped to the entry window', () => {
      const start = new Date('2026-01-01T09:00:00Z');
      const end = new Date('2026-01-01T12:00:00Z');
      const pauses = [{ pauseStart: '2026-01-01T10:00:00Z', pauseEnd: '2026-01-01T10:15:00Z' }];
      expect(calculateTotalPausedSeconds(start, end, pauses)).toBe(15 * 60);
    });
    it('returns 0 for no pauses', () => {
      const start = new Date('2026-01-01T09:00:00Z');
      const end = new Date('2026-01-01T12:00:00Z');
      expect(calculateTotalPausedSeconds(start, end, [])).toBe(0);
    });
  });

  describe('formatDurationShort', () => {
    it('formats minutes only under an hour', () => expect(formatDurationShort(15 * 60)).toBe('15m'));
    it('formats hours and minutes', () => expect(formatDurationShort(65 * 60)).toBe('1h 5m'));
    it('formats whole hours without a redundant 0m', () => expect(formatDurationShort(2 * 3600)).toBe('2h'));
    it('returns an em dash for zero', () => expect(formatDurationShort(0)).toBe('—'));
  });

  describe('calculateTaxBreakdown', () => {
    it('calculateTaxBreakdown: exclusive adds tax on top', () => {
      const r = calculateTaxBreakdown(100, 15, false);
      expect(r.subtotal).toBe(100);
      expect(r.tax).toBeCloseTo(15);
      expect(r.total).toBeCloseTo(115);
    });
    it('calculateTaxBreakdown: inclusive extracts tax from the total', () => {
      const r = calculateTaxBreakdown(115, 15, true);
      expect(r.subtotal).toBeCloseTo(100);
      expect(r.tax).toBeCloseTo(15);
      expect(r.total).toBe(115);
    });
  });

  describe("getElapsedTimeMs", () => {
    it("calculates elapsed time in milliseconds without pauses", () => {
      const startTime = "2026-01-01T10:00:00.000Z";
      const endTimeOverride = "2026-01-01T10:05:00.000Z"; // 5 mins = 300,000 ms
      expect(getElapsedTimeMs(startTime, [], endTimeOverride)).toBe(300000);
    });

    it("calculates elapsed time with completed pause segments", () => {
      const startTime = "2026-01-01T10:00:00.000Z";
      const endTimeOverride = "2026-01-01T10:10:00.000Z"; // 10 mins = 600,000 ms
      const pauses: PauseSegment[] = [
        { pauseStart: "2026-01-01T10:02:00.000Z", pauseEnd: "2026-01-01T10:05:00.000Z" } // 3 mins pause = 180,000 ms
      ];
      expect(getElapsedTimeMs(startTime, pauses, endTimeOverride)).toBe(420000); // 600,000 - 180,000 = 420,000 ms
    });

    it("calculates elapsed time with an ongoing pause segment (no pauseEnd)", () => {
      const startTime = "2026-01-01T10:00:00.000Z";
      const endTimeOverride = "2026-01-01T10:10:00.000Z"; // now = 10:10
      const pauses: PauseSegment[] = [
        { pauseStart: "2026-01-01T10:04:00.000Z" } // ongoing pause started 6 mins ago
      ];
      expect(getElapsedTimeMs(startTime, pauses, endTimeOverride)).toBe(240000);
    });

    it("calculates elapsed time with multiple pause segments", () => {
      const startTime = "2026-01-01T10:00:00.000Z";
      const endTimeOverride = "2026-01-01T10:20:00.000Z"; // 20 mins = 1,200,000 ms
      const pauses: PauseSegment[] = [
        { pauseStart: "2026-01-01T10:02:00.000Z", pauseEnd: "2026-01-01T10:05:00.000Z" }, // 3 mins pause
        { pauseStart: "2026-01-01T10:10:00.000Z", pauseEnd: "2026-01-01T10:12:00.000Z" }  // 2 mins pause
      ];
      expect(getElapsedTimeMs(startTime, pauses, endTimeOverride)).toBe(900000);
    });

    it("clamps negative elapsed time to 0 when start time is in the future", () => {
      const startTime = "2026-01-01T10:10:00.000Z";
      const endTimeOverride = "2026-01-01T10:00:00.000Z";
      expect(getElapsedTimeMs(startTime, [], endTimeOverride)).toBe(0);
    });
  });

  describe('regression: pause segment merging', () => {
    const start = new Date('2026-01-01T09:00:00.000Z');
    const end = new Date('2026-01-01T10:00:00.000Z');

    it('counts a duplicated pause segment once', () => {
      const pause = { pauseStart: '2026-01-01T09:10:00.000Z', pauseEnd: '2026-01-01T09:50:00.000Z' };
      const segments = [pause, { ...pause }];
      expect(calculateDuration(start, end, segments)).toBe(1200);
      expect(calculateTotalPausedSeconds(start, end, segments)).toBe(2400);
    });

    it('merges partially overlapping pause segments', () => {
      const segments = [
        { pauseStart: '2026-01-01T09:10:00.000Z', pauseEnd: '2026-01-01T09:40:00.000Z' },
        { pauseStart: '2026-01-01T09:30:00.000Z', pauseEnd: '2026-01-01T09:50:00.000Z' },
      ];
      // 09:10-09:50 is 40 minutes of pause, not 30 + 20.
      expect(calculateTotalPausedSeconds(start, end, segments)).toBe(2400);
      expect(calculateDuration(start, end, segments)).toBe(1200);
    });

    it('keeps calculateDuration and getElapsedTimeMs in agreement', () => {
      // A pause that starts before the entry, as happens after editing a start time later.
      const segments = [{ pauseStart: '2026-01-01T08:00:00.000Z', pauseEnd: '2026-01-01T09:30:00.000Z' }];
      const viaDuration = calculateDuration(start, end, segments);
      const viaElapsed = getElapsedTimeMs(start.toISOString(), segments, end.toISOString()) / 1000;
      expect(viaDuration).toBe(1800);
      expect(viaElapsed).toBe(viaDuration);
    });

    it('skips unparseable pause segments rather than poisoning the maths', () => {
      const segments = [{ pauseStart: 'not-a-date', pauseEnd: 'also-not-a-date' }] as any;
      expect(calculateDuration(start, end, segments)).toBe(3600);
    });
  });

  describe('regression: formatDurationShort never emits 60 minutes', () => {
    it('rolls 3599 seconds up to a whole hour', () => expect(formatDurationShort(3599)).toBe('1h'));
    it('rolls 7199 seconds up to two hours', () => expect(formatDurationShort(7199)).toBe('2h'));
    it('rolls 86399 seconds up to 24 hours', () => expect(formatDurationShort(86399)).toBe('24h'));
  });

  describe('regression: checkOverlap safety', () => {
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = new Date('2026-01-01T10:30:00.000Z');
    const existing = [{
      id: 'e1', timecodeId: 'tc-A',
      startTime: '2026-01-01T09:00:00.000Z',
      endTime: '2026-01-01T11:00:00.000Z',
    }] as any;

    it('still detects an overlap when no timecode is supplied in concurrent mode', () => {
      expect(checkOverlap(start, end, existing, undefined, undefined, true)).toBe(true);
    });

    it('does not let a soft-deleted entry block a new one', () => {
      const trashed = [{ ...existing[0], deletedAt: '2026-01-01T12:00:00.000Z' }];
      expect(checkOverlap(start, end, trashed, undefined, 'tc-A', false)).toBe(false);
    });
  });

  describe('regression: tax breakdown', () => {
    it('rounds to whole cents so lines sum to the total', () => {
      const r = calculateTaxBreakdown(1234.56, 15, false);
      expect(r.tax).toBe(185.18);
      expect(r.total).toBe(1419.74);
      expect(r.subtotal + r.tax).toBe(r.total);
    });

    it('does not divide by zero on an inclusive rate of -100%', () => {
      const r = calculateTaxBreakdown(100, -100, true);
      expect(Number.isFinite(r.subtotal)).toBe(true);
      expect(Number.isFinite(r.tax)).toBe(true);
      expect(r.total).toBe(100);
    });
  });

  describe('findOverlappingCandidates', () => {
    const mk = (id: string, startMin: number, endMin: number, timecodeId = 'tc-1'): any => ({
      id, timecodeId,
      startTime: new Date(Date.UTC(2026, 0, 1, 0, startMin)).toISOString(),
      endTime: new Date(Date.UTC(2026, 0, 1, 0, endMin)).toISOString(),
      pausedSegments: [],
    });

    it('rejects a candidate overlapping an existing entry', () => {
      const existing = [mk('x', 60, 120)];
      const candidates = [mk('c', 90, 150)];
      expect([...findOverlappingCandidates(candidates, existing)]).toEqual([0]);
    });

    it('rejects a candidate an existing entry sits inside', () => {
      // The candidate starts first, so a naive forward sweep would miss it.
      const existing = [mk('x', 90, 100)];
      const candidates = [mk('c', 60, 180)];
      expect([...findOverlappingCandidates(candidates, existing)]).toEqual([0]);
    });

    it('keeps the earlier of two colliding candidates, as adding them one by one would', () => {
      const candidates = [mk('a', 0, 60), mk('b', 30, 90)];
      expect([...findOverlappingCandidates(candidates, [])]).toEqual([1]);
    });

    it('accepts touching intervals', () => {
      expect(findOverlappingCandidates([mk('c', 60, 120)], [mk('x', 0, 60)]).size).toBe(0);
    });

    it('ignores soft-deleted existing entries', () => {
      const trashed = [{ ...mk('x', 60, 120), deletedAt: '2026-02-01T00:00:00.000Z' }];
      expect(findOverlappingCandidates([mk('c', 90, 150)], trashed).size).toBe(0);
    });

    it('only conflicts within a timecode when concurrent timers are allowed', () => {
      const existing = [mk('x', 60, 120, 'tc-A')];
      expect(findOverlappingCandidates([mk('c', 90, 150, 'tc-B')], existing, true).size).toBe(0);
      expect(findOverlappingCandidates([mk('c', 90, 150, 'tc-A')], existing, true).size).toBe(1);
      expect(findOverlappingCandidates([mk('c', 90, 150, 'tc-B')], existing, false).size).toBe(1);
    });

    it('agrees with sequential checkOverlap on randomised input', () => {
      // The sweep exists only for speed, so it must decide exactly what adding
      // the rows one at a time through checkOverlap would decide.
      let seed = 12345;
      const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };

      for (let trial = 0; trial < 200; trial++) {
        const codes = ['tc-A', 'tc-B'];
        const existing = Array.from({ length: rand(5) }, (_, i) => {
          const start = rand(200);
          return mk(`x${i}`, start, start + 1 + rand(60), codes[rand(2)]);
        });
        const candidates = Array.from({ length: 1 + rand(6) }, (_, i) => {
          const start = rand(200);
          return mk(`c${i}`, start, start + 1 + rand(60), codes[rand(2)]);
        });
        const concurrent = rand(2) === 1;

        // Reference: add the rows one at a time through checkOverlap, in the
        // chronological order the sweep resolves them in.
        const pool = [...existing];
        const expected = new Set<number>();
        candidates
          .map((c, index) => ({ c, index }))
          .sort((a, b) =>
            new Date(a.c.startTime).getTime() - new Date(b.c.startTime).getTime() ||
            new Date(a.c.endTime).getTime() - new Date(b.c.endTime).getTime())
          .forEach(({ c, index }) => {
            const clash = checkOverlap(
              new Date(c.startTime), new Date(c.endTime), pool, undefined, c.timecodeId, concurrent
            );
            if (clash) expected.add(index);
            else pool.push(c);
          });

        const actual = findOverlappingCandidates(candidates, existing, concurrent);
        expect([...actual].sort()).toEqual([...expected].sort());
      }
    });
  });

  /**
   * The calendar-day contract, which every day bucket in the app now shares.
   *
   * These run under both timezones the suite is configured for. The identities
   * hold anywhere; the concrete 23- and 25-hour assertions only mean anything
   * where there is a transition to observe, so they are gated on one.
   */
  describe('calendarDayKey / calendarDayBounds', () => {
    const HOUR = 3600 * 1000;

    // Auckland moves to NZDT on 27 September 2026 (a 23-hour day) and back on
    // 5 April 2026 (a 25-hour day).
    const SHORT_DAY = new Date(2026, 8, 27, 12, 0, 0);
    const LONG_DAY = new Date(2026, 3, 5, 12, 0, 0);
    const lengthOf = (d: Date) => {
      const { start, end } = calendarDayBounds(d);
      return (end.getTime() - start.getTime()) / HOUR;
    };
    const hasTransitions = lengthOf(SHORT_DAY) !== 24 || lengthOf(LONG_DAY) !== 24;

    it('keys a moment by its local calendar date', () => {
      expect(calendarDayKey(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
      expect(calendarDayKey(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
      expect(calendarDayKey(new Date(2026, 11, 31, 22, 0, 0))).toBe('2026-12-31');
    });

    it('pads every component, so keys sort lexicographically', () => {
      const keys = [
        calendarDayKey(new Date(2026, 8, 9, 12)),
        calendarDayKey(new Date(2026, 8, 10, 12)),
        calendarDayKey(new Date(2026, 9, 1, 12)),
      ];
      expect(keys).toEqual(['2026-09-09', '2026-09-10', '2026-10-01']);
      expect([...keys].sort()).toEqual(keys);
    });

    it('refuses an invalid date rather than keying it as NaN', () => {
      expect(() => calendarDayKey(new Date(NaN))).toThrow(RangeError);
    });

    it('bounds a day from its own midnight to the next one', () => {
      const { start, end } = calendarDayBounds(new Date(2026, 8, 27, 17, 34, 12, 999));
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
      expect(end.getHours()).toBe(0);
      // Half-open: the day ends exactly where the next one begins.
      expect(calendarDayKey(start)).toBe('2026-09-27');
      expect(calendarDayKey(end)).toBe('2026-09-28');
      expect(calendarDayBounds(end).start.getTime()).toBe(end.getTime());
    });

    it('is exactly as long as the local offset says, transition or not', () => {
      for (const day of [SHORT_DAY, LONG_DAY, new Date(2026, 5, 15, 12)]) {
        const { start, end } = calendarDayBounds(day);
        // getTimezoneOffset is minutes *behind* UTC, so it grows as the clock
        // goes back: a day that gains an hour has the larger offset at its end.
        const offsetShiftMs = (end.getTimezoneOffset() - start.getTimezoneOffset()) * 60 * 1000;
        expect(end.getTime() - start.getTime()).toBe(24 * HOUR + offsetShiftMs);
      }
    });

    it.runIf(hasTransitions)('gives a spring-forward day 23 hours and an autumn day 25', () => {
      expect(lengthOf(SHORT_DAY)).toBe(23);
      expect(lengthOf(LONG_DAY)).toBe(25);
    });

    it.runIf(hasTransitions)('will not place an adjustment longer than the short day holds', () => {
      // 24 hours does not fit in a 23-hour day, however empty it is.
      expect(findFreeSlot(SHORT_DAY, 24 * 3600, [])).toBeNull();
      expect(findFreeSlot(SHORT_DAY, 23 * 3600, [])).not.toBeNull();
      // The long day has room for a full 24 hours, and for its extra one.
      expect(findFreeSlot(LONG_DAY, 24 * 3600, [])).not.toBeNull();
      expect(findFreeSlot(LONG_DAY, 25 * 3600, [])).not.toBeNull();
      expect(findFreeSlot(LONG_DAY, 25 * 3600 + 1, [])).toBeNull();
    });

    it('never lets a slot spill onto the following day', () => {
      for (const day of [SHORT_DAY, LONG_DAY]) {
        const { start, end } = calendarDayBounds(day);
        const slot = findFreeSlot(day, lengthOf(day) * 3600, []);
        expect(slot).not.toBeNull();
        expect(slot!.start.getTime()).toBeGreaterThanOrEqual(start.getTime());
        expect(slot!.end.getTime()).toBeLessThanOrEqual(end.getTime());
        expect(calendarDayKey(new Date(slot!.end.getTime() - 1))).toBe(calendarDayKey(day));
      }
    });
  });

});
