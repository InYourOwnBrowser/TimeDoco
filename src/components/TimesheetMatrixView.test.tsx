import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimesheetMatrixView } from './TimesheetMatrixView';
import { ToastProvider } from '../context/ToastContext';
import { startOfWeek, format } from 'date-fns';

const mockAddManualEntry = vi.fn().mockResolvedValue(true);
const mockUpdateEntry = vi.fn().mockResolvedValue(true);
const mockDeleteEntry = vi.fn().mockResolvedValue(undefined);
const mockAddToast = vi.fn();

const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
const mondayISO = format(currentWeekStart, "yyyy-MM-dd'T'09:00:00.000'Z'");
const mondayEndISO = format(currentWeekStart, "yyyy-MM-dd'T'09:12:00.000'Z'");

const mondayNoonISO = format(currentWeekStart, "yyyy-MM-dd'T'11:30:00.000'Z'");
const mondayNoonEndISO = format(currentWeekStart, "yyyy-MM-dd'T'12:30:00.000'Z'");

let mockEntries = [
  {
    id: 'entry-1',
    timecodeId: 'tc-1',
    startTime: mondayISO,
    endTime: mondayEndISO, // 12 minutes = 720 seconds -> rounds to 15m (0.25h) under 15min rule
    duration: 720,
    pausedSegments: [],
    isRunning: false,
  },
];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: [
      { id: 'tc-1', name: 'Task 1', color: '#000000', archived: false },
    ],
    groups: [],
    settings: {
      roundingRule: '15min',
      allowConcurrentTimers: false,
    },
    addManualEntry: mockAddManualEntry,
    updateEntry: mockUpdateEntry,
    deleteEntry: mockDeleteEntry,
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('TimesheetMatrixView commitCell rounding behavior', () => {
  beforeEach(() => {
    mockEntries = [
      {
        id: 'entry-1',
        timecodeId: 'tc-1',
        startTime: mondayISO,
        endTime: mondayEndISO,
        duration: 720,
        pausedSegments: [],
        isRunning: false,
      },
    ];
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not create phantom adjustment when user commits the displayed rounded hours (0.25h)', async () => {
    const { getByDisplayValue } = render(
      <ToastProvider>
        <TimesheetMatrixView />
      </ToastProvider>
    );

    const input = getByDisplayValue('0.25') as HTMLInputElement;
    expect(input).not.toBeNull();

    fireEvent.blur(input, { target: { value: '0.25' } });

    await waitFor(() => {
      expect(mockAddManualEntry).not.toHaveBeenCalled();
      expect(mockUpdateEntry).not.toHaveBeenCalled();
    });
  });

  it('refuses reduction below tracked time without deleting adjustment', async () => {
    // 720s worked time (12m). Target = 0.10h (6m). trackedSeconds = 720s.
    const { getByDisplayValue } = render(
      <ToastProvider>
        <TimesheetMatrixView />
      </ToastProvider>
    );

    const input = getByDisplayValue('0.25') as HTMLInputElement;
    fireEvent.blur(input, { target: { value: '0.10' } });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        "Can't reduce below tracked time — edit or delete the underlying entries instead.",
        'error'
      );
      expect(mockDeleteEntry).not.toHaveBeenCalled();
    });
  });

  it('deletes adjustment when targetSeconds equals trackedSeconds', async () => {
    // Tracked: 720s. Adjustment: 3600s. Cell displays (720+3600=4320s => 1.25h).
    mockEntries = [
      {
        id: 'entry-1', timecodeId: 'tc-1',
        startTime: mondayISO, endTime: mondayEndISO, duration: 720,
        pausedSegments: [], isRunning: false,
      },
      {
        id: 'adj-1', timecodeId: 'tc-1',
        startTime: mondayISO, endTime: format(currentWeekStart, "yyyy-MM-dd'T'10:00:00.000'Z'"),
        duration: 3600, pausedSegments: [], isRunning: false,
        tags: ['timesheet-adjustment'],
      },
    ];

    const { getByDisplayValue } = render(
      <ToastProvider>
        <TimesheetMatrixView />
      </ToastProvider>
    );

    const input = getByDisplayValue('1.25') as HTMLInputElement;
    // Enter 0.20h (720 seconds = tracked seconds). Delta = 0.
    fireEvent.blur(input, { target: { value: '0.20' } });

    await waitFor(() => {
      expect(mockDeleteEntry).toHaveBeenCalledWith('adj-1');
      expect(mockAddToast).toHaveBeenCalledWith('Timesheet adjustment removed.', 'info');
    });
  });

  it('avoids overlaps by using findFreeSlot when entry spans noon', async () => {
    // Entry spanning 11:30 to 12:30.
    mockEntries = [
      {
        id: 'entry-1', timecodeId: 'tc-1',
        startTime: mondayNoonISO, endTime: mondayNoonEndISO, duration: 3600,
        pausedSegments: [], isRunning: false,
      },
    ];

    const { getByDisplayValue } = render(
      <ToastProvider>
        <TimesheetMatrixView />
      </ToastProvider>
    );

    const input = getByDisplayValue('1.00') as HTMLInputElement;
    // Add 1 hour -> total 2.00 hours.
    fireEvent.blur(input, { target: { value: '2.00' } });

    await waitFor(() => {
      expect(mockAddManualEntry).toHaveBeenCalled();
      const callArg = mockAddManualEntry.mock.calls[0][0];
      // Should start at 12:30 or later, not 12:00
      const startHour = new Date(callArg.startTime).getHours();
      const startMin = new Date(callArg.startTime).getMinutes();
      expect(startHour * 60 + startMin).toBeGreaterThanOrEqual(12 * 60 + 30);
    });
  });
});
