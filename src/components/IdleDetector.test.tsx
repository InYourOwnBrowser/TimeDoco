import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleDetector } from './IdleDetector';
import type { Entry } from '../types';

const mockPauseTimer = vi.fn().mockResolvedValue(undefined);

let mockActiveEntries: Entry[] = [];
const mockSettings = { idleThresholdMinutes: 5 };

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    activeEntries: mockActiveEntries,
    settings: mockSettings,
    pauseTimer: mockPauseTimer,
  }),
}));

vi.mock('./ui/Modal', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// 10:00 local. The timer started at 09:00 and there has been no activity since
// the component mounted, so the 5 minute threshold is long past.
const START = new Date(2025, 0, 8, 9, 0, 0);
const NOW = new Date(2025, 0, 8, 10, 0, 0);

const runningEntry: Entry = {
  id: 'e-1',
  timecodeId: 'tc-1',
  startTime: START.toISOString(),
  endTime: null,
  duration: 0,
  note: '',
  tags: [],
  isRunning: true,
  isPaused: false,
  pausedSegments: [],
  editHistory: [],
  createdAt: START.toISOString(),
  updatedAt: START.toISOString(),
};

describe('IdleDetector pauses back to when the idling started', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockActiveEntries = [runningEntry];
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** Advance past the 5 second poll so the prompt is raised. */
  const raisePrompt = async () => {
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
  };

  it('backdates the pause to the idle start, not to the click', async () => {
    render(<IdleDetector />);

    // Mounting records "now" as the last activity, so let the threshold pass.
    const idleStart = NOW.getTime();
    await act(async () => {
      vi.setSystemTime(new Date(idleStart + 6 * 60 * 1000));
    });
    await raisePrompt();

    expect(screen.getByText('Still working?')).toBeTruthy();

    // Moving the mouse over to the button is activity, and the listeners are
    // still attached while the prompt is up. Reading the last-activity time at
    // click time therefore put the pause at ~now and billed the whole idle
    // period — the exact thing this feature exists to remove.
    await act(async () => {
      vi.setSystemTime(new Date(idleStart + 6 * 60 * 1000 + 2000));
      fireEvent.mouseMove(window);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('No, pause timers'));
    });

    expect(mockPauseTimer).toHaveBeenCalledTimes(1);
    const [entryId, pauseStart] = mockPauseTimer.mock.calls[0];
    expect(entryId).toBe('e-1');
    // The instant the user went idle, not the instant they answered.
    expect(new Date(pauseStart as string).getTime()).toBe(idleStart);
  });

  it('never backdates the pause before the timer started', async () => {
    // A timer started after the last recorded activity: clamping keeps the
    // pause inside the entry.
    const lateStart = new Date(NOW.getTime() + 60 * 1000);
    mockActiveEntries = [{ ...runningEntry, startTime: lateStart.toISOString() }];

    render(<IdleDetector />);
    await act(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 10 * 60 * 1000));
    });
    await raisePrompt();

    await act(async () => {
      fireEvent.click(screen.getByText('No, pause timers'));
    });

    const [, pauseStart] = mockPauseTimer.mock.calls[0];
    expect(new Date(pauseStart as string).getTime()).toBe(lateStart.getTime());
  });

  it('forgets the captured idle start when the user says they are still working', async () => {
    render(<IdleDetector />);

    const firstIdleStart = NOW.getTime();
    await act(async () => {
      vi.setSystemTime(new Date(firstIdleStart + 6 * 60 * 1000));
    });
    await raisePrompt();

    // "Yes" counts as activity, so the next idle period starts from there.
    const secondIdleStart = Date.now();
    await act(async () => {
      fireEvent.click(screen.getByText('Yes, keep running'));
    });
    expect(screen.queryByText('Still working?')).toBeNull();

    await act(async () => {
      vi.setSystemTime(new Date(secondIdleStart + 6 * 60 * 1000));
    });
    await raisePrompt();

    await act(async () => {
      fireEvent.click(screen.getByText('No, pause timers'));
    });

    const [, pauseStart] = mockPauseTimer.mock.calls[0];
    expect(new Date(pauseStart as string).getTime()).toBe(secondIdleStart);
  });
});
