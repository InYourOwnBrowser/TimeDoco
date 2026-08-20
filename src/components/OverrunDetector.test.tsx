import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OverrunDetector } from './OverrunDetector';
import type { Entry, Timecode } from '../types';

const mockStopTimer = vi.fn().mockResolvedValue(undefined);

let mockActiveEntries: Entry[] = [];
let mockTimecodes: Timecode[] = [
  {
    id: 'tc-1',
    name: 'Development Task',
    groupId: null,
    hourlyRate: 100,
    archived: false,
    updatedAt: new Date().toISOString(),
  },
];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    activeEntries: mockActiveEntries,
    timecodes: mockTimecodes,
    stopTimer: mockStopTimer,
  }),
}));

describe('OverrunDetector', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    mockActiveEntries = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when no active entries have an estimate', () => {
    mockActiveEntries = [
      {
        id: 'entry-1',
        timecodeId: 'tc-1',
        startTime: new Date().toISOString(),
        endTime: null,
        duration: 0,
        note: '',
        isRunning: true,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expectedDurationMinutes: null,
      },
    ];

    render(<OverrunDetector />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.queryByText('Past your estimate')).toBeNull();
  });

  it('shows modal when running entry exceeds expected duration', () => {
    const startTime = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 minutes ago
    mockActiveEntries = [
      {
        id: 'entry-overrun',
        timecodeId: 'tc-1',
        startTime,
        endTime: null,
        duration: 0,
        note: '',
        isRunning: true,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: startTime,
        updatedAt: startTime,
        expectedDurationMinutes: 30, // 30 mins estimate
      },
    ];

    render(<OverrunDetector />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('Past your estimate')).not.toBeNull();
    expect(screen.getByText(/Development Task/)).not.toBeNull();
    expect(screen.getByText(/You estimated 30 min for/)).not.toBeNull();
  });

  it('calls stopTimer when user clicks "No, stop timer"', async () => {
    const startTime = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    mockActiveEntries = [
      {
        id: 'entry-to-stop',
        timecodeId: 'tc-1',
        startTime,
        endTime: null,
        duration: 0,
        note: '',
        isRunning: true,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: startTime,
        updatedAt: startTime,
        expectedDurationMinutes: 30,
      },
    ];

    render(<OverrunDetector />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const stopButton = screen.getByText('No, stop timer');
    fireEvent.click(stopButton);

    expect(mockStopTimer).toHaveBeenCalledWith('entry-to-stop');
  });

  it('dismisses prompt without stopping timer when user clicks "Yes, keep going"', () => {
    const startTime = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    mockActiveEntries = [
      {
        id: 'entry-keep-going',
        timecodeId: 'tc-1',
        startTime,
        endTime: null,
        duration: 0,
        note: '',
        isRunning: true,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: startTime,
        updatedAt: startTime,
        expectedDurationMinutes: 30,
      },
    ];

    render(<OverrunDetector />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const keepGoingButton = screen.getByText('Yes, keep going');
    fireEvent.click(keepGoingButton);

    expect(mockStopTimer).not.toHaveBeenCalled();
    expect(screen.queryByText('Past your estimate')).toBeNull();

    // Advance time further and verify it does not re-prompt for the same entry
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText('Past your estimate')).toBeNull();
  });
});
