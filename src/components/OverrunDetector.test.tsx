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
let mockSettings: { targetAlertMinutes: number | null } = { targetAlertMinutes: null };

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    activeEntries: mockActiveEntries,
    timecodes: mockTimecodes,
    stopTimer: mockStopTimer,
    settings: mockSettings,
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
    vi.unstubAllGlobals();
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

  it('requests notification permission if active entry has estimate', () => {
    const requestPermissionMock = vi.fn();
    const mockNotification = vi.fn();
    (mockNotification as any).permission = 'default';
    (mockNotification as any).requestPermission = requestPermissionMock;
    vi.stubGlobal('Notification', mockNotification);

    mockActiveEntries = [
      {
        id: 'entry-est',
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
        expectedDurationMinutes: 15,
      },
    ];

    render(<OverrunDetector />);
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
  });

  it('fires Notification when tab is hidden and entry overruns', () => {
    const mockNotificationClass = vi.fn();
    (mockNotificationClass as any).permission = 'granted';
    vi.stubGlobal('Notification', mockNotificationClass);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    const startTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mockActiveEntries = [
      {
        id: 'entry-bg-overrun',
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

    expect(mockNotificationClass).toHaveBeenCalledWith('Past your estimate', {
      body: 'Development Task has passed its 30 min estimate.',
      tag: 'overrun-entry-bg-overrun',
    });
  });

  it('does NOT fire Notification when tab is visible', () => {
    const mockNotificationClass = vi.fn();
    (mockNotificationClass as any).permission = 'granted';
    vi.stubGlobal('Notification', mockNotificationClass);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    const startTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mockActiveEntries = [
      {
        id: 'entry-visible-overrun',
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

    expect(mockNotificationClass).not.toHaveBeenCalled();
    expect(screen.getByText('Past your estimate')).not.toBeNull();
  });

  it('flashes document title when tab is hidden and overrun prompt exists', () => {
    document.title = 'Initial Title';

    let isHidden = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isHidden,
    });

    const startTime = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    mockActiveEntries = [
      {
        id: 'entry-flash-title',
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

    const { unmount } = render(<OverrunDetector />);

    // Trigger overrun prompt interval
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Advance 1s for title flash
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.title).toBe('⏰ Past estimate! · TimeDoco');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.title).toBe('Initial Title');

    // Unmount restores original title
    unmount();
    expect(document.title).toBe('Initial Title');
  });
});
