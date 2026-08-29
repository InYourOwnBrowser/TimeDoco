import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimesheetMatrixView } from './TimesheetMatrixView';
import { ToastProvider } from '../context/ToastContext';
import { startOfWeek, format } from 'date-fns';

const mockAddManualEntry = vi.fn().mockResolvedValue(true);
const mockUpdateEntry = vi.fn().mockResolvedValue(true);
const mockDeleteEntry = vi.fn().mockResolvedValue(undefined);

const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
const mondayISO = format(currentWeekStart, "yyyy-MM-dd'T'09:00:00.000'Z'");
const mondayEndISO = format(currentWeekStart, "yyyy-MM-dd'T'09:12:00.000'Z'");

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: [
      {
        id: 'entry-1',
        timecodeId: 'tc-1',
        startTime: mondayISO,
        endTime: mondayEndISO, // 12 minutes = 720 seconds -> rounds to 15m (0.25h) under 15min rule
        duration: 720,
        pausedSegments: [],
        isRunning: false,
      },
    ],
    timecodes: [
      { id: 'tc-1', name: 'Task 1', color: '#000000', archived: false },
    ],
    groups: [],
    settings: {
      roundingRule: '15min',
    },
    addManualEntry: mockAddManualEntry,
    updateEntry: mockUpdateEntry,
    deleteEntry: mockDeleteEntry,
  }),
}));

describe('TimesheetMatrixView commitCell rounding behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not create phantom adjustment when user commits the displayed rounded hours (0.25h)', async () => {
    const { getByDisplayValue } = render(
      <ToastProvider>
        <TimesheetMatrixView />
      </ToastProvider>
    );

    // The cell for Monday shows "0.25"
    const input = getByDisplayValue('0.25') as HTMLInputElement;
    expect(input).not.toBeNull();

    // Re-typing / blurring 0.25
    fireEvent.blur(input, { target: { value: '0.25' } });

    await waitFor(() => {
      // Since 720 seconds rounded under 15min rule is 900 seconds (0.25h), delta against target 0.25h is 0.
      // So no manual entry / adjustment should be added.
      expect(mockAddManualEntry).not.toHaveBeenCalled();
      expect(mockUpdateEntry).not.toHaveBeenCalled();
    });
  });
});
