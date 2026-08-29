import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntryEditModal } from './EntryEditModal';
import type { Entry } from '../types';

const mockUpdateEntry = vi.fn().mockResolvedValue(undefined);

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    updateEntry: mockUpdateEntry,
    entries: [],
    settings: { allowConcurrentTimers: false, currencySymbol: '$' },
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('./TimecodeSelector', () => ({
  TimecodeSelector: ({ selectedId }: { selectedId: string }) => <div>selected:{selectedId}</div>,
}));

// Local wall-clock times, so the datetime-local values the modal renders are
// the same strings whatever timezone the suite runs in.
const at = (h: number, m: number, s = 0) => new Date(2025, 0, 6, h, m, s).toISOString();

// Three real pause periods totalling 3m30s, which no whole-minute break field
// can represent.
const entryWithPauses: Entry = {
  id: 'entry-1',
  timecodeId: 'tc-1',
  startTime: at(9, 0),
  endTime: at(11, 0),
  duration: 7200 - 210,
  note: 'Original note',
  tags: [],
  isRunning: false,
  isPaused: false,
  pausedSegments: [
    { pauseStart: at(9, 30), pauseEnd: at(9, 31) },
    { pauseStart: at(10, 0), pauseEnd: at(10, 1) },
    { pauseStart: at(10, 30), pauseEnd: at(10, 31, 30) },
  ],
  editHistory: [],
  createdAt: at(9, 0),
  updatedAt: at(11, 0),
};

describe('EntryEditModal pause history', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('leaves recorded pause segments alone when only the note is edited', async () => {
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    fireEvent.change(screen.getByDisplayValue('Original note'), { target: { value: 'Corrected note' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateEntry).toHaveBeenCalled());

    const [, updates] = mockUpdateEntry.mock.calls[0];
    expect(updates.note).toBe('Corrected note');
    // Writing a single collapsed block here would round 3m30s up to 4m and move
    // the entry's duration by 30 seconds for an edit that never touched time.
    expect(updates.pausedSegments).toBeUndefined();
  });

  it('shows the recorded pause total rather than only the rounded field value', () => {
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);
    expect(screen.getByText(/3 recorded pause periods totalling 4m/)).toBeTruthy();
  });

  it('replaces the segments only when the break field is actually edited', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    // 3m30s rounds to the "4" the field shows; typing a different value is a
    // deliberate override.
    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateEntry).toHaveBeenCalled());

    const [, updates] = mockUpdateEntry.mock.calls[0];
    expect(updates.pausedSegments).toHaveLength(1);
    expect(
      new Date(updates.pausedSegments[0].pauseEnd).getTime()
        - new Date(updates.pausedSegments[0].pauseStart).getTime()
    ).toBe(10 * 60000);
    // The user is told the recorded timeline is being discarded.
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('keeps the recorded segments when the discard confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockUpdateEntry).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('rejects a preserved break that no longer fits a shortened entry', async () => {
    const { container } = render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    // Shrink the entry to one minute without touching the break field: the
    // preserved pauses now cover the whole of it.
    const [startInput, endInput] = Array.from(
      container.querySelectorAll('input[type="datetime-local"]')
    );
    fireEvent.change(startInput, { target: { value: '2025-01-06T09:30:00' } });
    fireEvent.change(endInput, { target: { value: '2025-01-06T09:31:00' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(screen.getByText('Break time cannot exceed the entry duration.')).toBeTruthy());
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });
});

describe('EntryEditModal flat fee conversion', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  const convertToFlatFee = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Flat Fee' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. 150.00'), { target: { value: '400' } });
    fireEvent.click(screen.getByText('Save Changes'));
  };

  it('confirms before collapsing a real entry into a zero-length flat fee', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    convertToFlatFee();

    await waitFor(() => expect(mockUpdateEntry).toHaveBeenCalled());

    const message = confirmSpy.mock.calls[0][0] as string;
    // The two things it destroys are both named, since neither is recoverable
    // from editHistory once the entry has been rewritten.
    expect(message).toContain('2h');
    expect(message).toContain('3 pause periods');

    const [, updates] = mockUpdateEntry.mock.calls[0];
    expect(updates.startTime).toBe(updates.endTime);
    expect(updates.pausedSegments).toEqual([]);
    confirmSpy.mockRestore();
  });

  it('saves optional manualAmount on non-fixed time entry when provided', async () => {
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. 150.00'), { target: { value: '125.50' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateEntry).toHaveBeenCalled());

    const [, updates] = mockUpdateEntry.mock.calls[0];
    expect(updates.manualAmount).toBe(125.50);
  });

  it('keeps the entry untouched when the flat fee confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);

    convertToFlatFee();

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockUpdateEntry).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('warns in the panel as soon as Flat Fee is selected', () => {
    render(<EntryEditModal entry={entryWithPauses} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Flat Fee' }));
    expect(screen.getByText(/zero-length record at 12:00/)).toBeTruthy();
  });

  it('does not confirm when the entry is already a zero-length flat fee', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const flatFee: Entry = {
      ...entryWithPauses,
      id: 'entry-2',
      endTime: entryWithPauses.startTime,
      duration: 0,
      pausedSegments: [],
      manualAmount: 400,
    };
    render(<EntryEditModal entry={flatFee} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. 150.00'), { target: { value: '450' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateEntry).toHaveBeenCalled());
    // Nothing is being thrown away, so nothing to ask about.
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
