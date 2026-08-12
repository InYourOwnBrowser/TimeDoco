import { describe, it, expect } from 'vitest';
import { checkOverlap, calculateDuration } from './timeUtils';
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
});
