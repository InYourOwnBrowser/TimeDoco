import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimesheetMatrixView } from './TimesheetMatrixView';
import { WeeklySummary } from './WeeklySummary';
import { ToastProvider } from '../context/ToastContext';
import { startOfWeek } from 'date-fns';
import type { Entry } from '../types';

/**
 * A shift through midnight, as the two screens that total it actually render it.
 *
 * `OvernightShift.consistency` proves the arithmetic; this proves the screens
 * use it. The defect was never in the maths — it was that the grid grouped
 * entries by the day they *started* and handed every second to that cell, so a
 * Sunday-night shift showed two hours on the Sunday and nothing on the Monday
 * while the invoice built from the same entry billed one hour to each week.
 */

const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
const day = (offset: number) =>
  new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset);
const atLocal = (d: Date, h: number, m = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).toISOString();

// Tuesday 23:00 → Wednesday 01:00: two hours, inside the visible week on both
// sides of the boundary, so one render shows both halves.
const OVERNIGHT: Entry = {
  id: 'e-night', timecodeId: 'tc-1',
  startTime: atLocal(day(1), 23, 0), endTime: atLocal(day(2), 1, 0),
  duration: 7200, note: 'Launch night', tags: [],
  isRunning: false, isPaused: false, pausedSegments: [], editHistory: [],
  createdAt: atLocal(day(1), 23, 0), updatedAt: atLocal(day(1), 23, 0),
};

let mockEntries: Entry[] = [OVERNIGHT];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: [{ id: 'tc-1', name: 'Task 1', color: '#000000', archived: false }],
    groups: [],
    settings: { roundingRule: 'none', roundingScope: 'day', allowConcurrentTimers: false, weeklyTargetHours: 40 },
    addManualEntry: vi.fn().mockResolvedValue(true),
    updateEntry: vi.fn().mockResolvedValue(true),
    deleteEntry: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => { mockEntries = [OVERNIGHT]; });

describe('the timesheet grid, on a shift that runs through midnight', () => {
  it('puts an hour in each of the two days, not two in the day it started', () => {
    const { container } = render(<ToastProvider><TimesheetMatrixView /></ToastProvider>);
    const cells = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    const values = cells.map((input) => input.value);

    // Seven day cells for the one timecode row, Monday first.
    expect(values).toHaveLength(7);
    expect(values[1]).toBe('1.00');  // Tuesday, 23:00–24:00
    expect(values[2]).toBe('1.00');  // Wednesday, 00:00–01:00
    expect(values[0]).toBe('');      // Monday, untouched
  });

  it('still totals the whole shift across the week', () => {
    const { getAllByText } = render(<ToastProvider><TimesheetMatrixView /></ToastProvider>);
    // The row total and the week total, both the whole shift: splitting it
    // across two cells must not lose an hour on the way to the totals.
    expect(getAllByText('2.00').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the weekly target bar, on the same shift', () => {
  it('counts the hours worked in the week rather than the whole shift', () => {
    const { getByText } = render(<ToastProvider><WeeklySummary /></ToastProvider>);
    // Both halves are inside this week here, so the bar reads the full two.
    expect(getByText('2.0')).toBeTruthy();
  });

  it('does not describe the split as rounding', () => {
    const { queryByText } = render(<ToastProvider><WeeklySummary /></ToastProvider>);
    expect(queryByText(/rounding/i)).toBeNull();
  });
});
