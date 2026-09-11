import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActiveTimer } from './ActiveTimer';
import type { Entry } from '../types';

const mockAddToast = vi.fn();
const mockUpdateActiveNote = vi.fn().mockResolvedValue(true);
const mockStopTimer = vi.fn().mockResolvedValue(undefined);

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    startTimer: vi.fn(),
    stopTimer: mockStopTimer,
    pauseTimer: vi.fn(),
    resumeTimer: vi.fn(),
    updateActiveNote: mockUpdateActiveNote,
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

/**
 * The note beside a running timer is written a second after the typing stops.
 * Everything that can happen inside that second has to write it rather than
 * discard it — the debounce used to live in an effect whose cleanup cleared the
 * timer, so leaving the tracker tab, or reloading to apply an update, threw the
 * write away without a word.
 */
describe('ActiveTimer note draft', () => {
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

  const noteField = (view: ReturnType<typeof render>) =>
    view.container.querySelector('input[placeholder="Add a note..."]')!;
  const tagsField = (view: ReturnType<typeof render>) =>
    view.container.querySelector('input[placeholder="Tags (e.g. design, review)"]')!;

  it('writes once the typing stops, not per keystroke', () => {
    const view = render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    fireEvent.change(noteField(view), { target: { value: 'Drafting the brief' } });
    expect(mockUpdateActiveNote).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockUpdateActiveNote).toHaveBeenCalledTimes(1);
    expect(mockUpdateActiveNote).toHaveBeenCalledWith('entry-1', 'Drafting the brief', []);
  });

  it('writes what was typed when the component goes away', () => {
    // Switching to another tab unmounts the tracker. The pending write used to
    // be cancelled by the effect cleanup, losing up to a second of typing.
    const view = render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    fireEvent.change(noteField(view), { target: { value: 'Half a sentence' } });
    view.unmount();

    expect(mockUpdateActiveNote).toHaveBeenCalledWith('entry-1', 'Half a sentence', []);
  });

  it('writes on blur rather than making the user wait out the debounce', () => {
    const view = render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    fireEvent.change(tagsField(view), { target: { value: 'design, review' } });
    fireEvent.blur(tagsField(view));

    expect(mockUpdateActiveNote).toHaveBeenCalledWith('entry-1', '', ['design', 'review']);
  });

  it('writes the note before the timer it belongs to is stopped', async () => {
    const view = render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    fireEvent.change(noteField(view), { target: { value: 'Last thought' } });
    await act(async () => {
      view.container.querySelector<HTMLButtonElement>('button[aria-label^="Stop Timer"]')!.click();
    });

    expect(mockUpdateActiveNote).toHaveBeenCalledWith('entry-1', 'Last thought', []);
    expect(mockStopTimer).toHaveBeenCalledWith('entry-1');
    expect(mockUpdateActiveNote.mock.invocationCallOrder[0])
      .toBeLessThan(mockStopTimer.mock.invocationCallOrder[0]);
  });

  it('does not write when nothing was typed', () => {
    const view = render(<ActiveTimer activeEntry={runningEntry('entry-1')} />);

    act(() => { vi.advanceTimersByTime(5000); });
    view.unmount();

    expect(mockUpdateActiveNote).not.toHaveBeenCalled();
  });
});
