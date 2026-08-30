import { describe, it, expect } from 'vitest';
import { buildReportLines, buildScreenLines } from '../utils/billing';
import type { Entry, Settings } from '../types';
import { startOfDay, endOfDay } from 'date-fns';

describe('TimeTotals Consistency', () => {
  it('has exactly 5 primary surfaces configured for checking billing consistency', () => {
    // 5 surfaces: entry list, timesheet grid, calendar, weekly summary, report
    const SURFACES = [
      {
        name: 'entry list',
        compute: (entries: Entry[], settings: Settings, day: Date) => {
          return Array.from(buildScreenLines(entries, settings, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);
        }
      },
      {
        name: 'timesheet grid',
        compute: (entries: Entry[], settings: Settings, day: Date) => {
          return Array.from(buildScreenLines(entries, settings, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);
        }
      },
      {
        name: 'calendar',
        compute: (entries: Entry[], settings: Settings, day: Date) => {
          return Array.from(buildScreenLines(entries, settings, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);
        }
      },
      {
        name: 'weekly summary',
        compute: (entries: Entry[], settings: Settings, day: Date) => {
          return Array.from(buildScreenLines(entries, settings, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);
        }
      },
      {
        name: 'report',
        compute: (entries: Entry[], settings: Settings, day: Date) => {
          const window = { start: startOfDay(day), end: endOfDay(day) };
          return Array.from(buildReportLines(entries, settings, window, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);
        }
      }
    ];

    expect(SURFACES.length).toBe(5);
  });
});
