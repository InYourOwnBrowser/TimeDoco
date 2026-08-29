import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActiveTimer } from './ActiveTimer';
import type { Entry } from '../types';

const mockAddToast = vi.fn();

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    pauseTimer: vi.fn(),
    resumeTimer: vi.fn(),
    updateActiveNote: vi.fn(),
    timecodes: [{ id: 'tc-1', name: 'Client Work', color: '#000', archived: false, groupId: null, hourlyRate: null }],
    settings: { targetAlertMinutes: 1, allowConcurrentTimers: false },
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('./TimecodeSelector', () => ({
  TimecodeSelector: () => <div>timecode selector</div>,
}));

const NOW = new Date(2025, 5, 2, 12, 0, 0);

// Started five minutes ago, well past the one-minute target.
const runningEntry = (id: string): Entry => ({
  id,
  timecodeId: 'tc-1',
  startTime: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  endTime: null,
  duration: 0,
  note: '',
  tags: [],
  isRunning: true,
  isPaused: false,
  pausedSegments: [],
  editHistory: [],
  createdAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  updatedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
});

describe('ActiveTimer target alert', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('fires for a second timer started straight after the first', () => {
    const { rerender } = render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    const alerts = () => mockAddToast.mock.calls.filter(([msg]) => String(msg).includes('Target reached'));
    expect(alerts()).toHaveLength(1);

    // Switching timers never empties the bar, so a flag only cleared on
    // `activeEntry === null` stayed set and the new timer went unannounced.
    rerender(<ActiveTimer activeEntry={runningEntry('entry-2')} />);
    expect(alerts()).toHaveLength(2);
  });

  it('does not re-fire for the same timer on every tick', () => {
    render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    vi.advanceTimersByTime(5000);

    const alerts = mockAddToast.mock.calls.filter(([msg]) => String(msg).includes('Target reached'));
    expect(alerts).toHaveLength(1);
  });

  it('reads the elapsed time without touching an absent Notification API', () => {
    // A browser with no Notification API threw here once a second, flooding the
    // log and freezing the display.
    const original = Object.getOwnPropertyDescriptor(window, 'Notification');
    // @ts-expect-error - deliberately removing the API for this test
    delete window.Notification;

    try {
      expect(() => render(<ActiveTimer activeEntry={runningEntry('entry-1')} />)).not.toThrow();
      expect(mockAddToast.mock.calls.some(([msg]) => String(msg).includes('Target reached'))).toBe(true);
    } finally {
      if (original) Object.defineProperty(window, 'Notification', original);
    }
  });
});
