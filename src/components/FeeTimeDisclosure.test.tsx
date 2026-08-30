import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Entry, Group, Settings, Timecode } from '../types';
import { EntryList } from './EntryList';
import { WeeklySummary } from './WeeklySummary';
import { TimesheetMatrixView } from './TimesheetMatrixView';
import { TimesheetCalendarView } from './TimesheetCalendarView';
import { ManualEntryModal } from './ManualEntryModal';
import { EntryEditModal } from './EntryEditModal';

// The picker is a combobox of its own; these tests are about the amount field
// beside it, so it stands in as a one-click selection.
vi.mock('./TimecodeSelector', () => ({
  TimecodeSelector: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('tc-1')}>pick timecode</button>
  ),
}));

vi.mock('react-virtuoso', () => ({
  GroupedVirtuoso: ({ groupCounts, itemContent, groupContent }: any) => {
    let globalIndex = 0;
    return (
      <div>
        {groupCounts.map((count: number, groupIndex: number) => {
          const items = [];
          for (let i = 0; i < count; i++) {
            items.push(<div key={globalIndex}>{itemContent(globalIndex, groupIndex)}</div>);
            globalIndex++;
          }
          return <div key={groupIndex}>{groupContent(groupIndex)}{items}</div>;
        })}
      </div>
    );
  },
}));

// Wednesday 8 Jan 2025, 14:00 local. The week starts Monday 6 Jan.
const NOW = new Date(2025, 0, 8, 14, 0, 0);
const local = (day: number, h: number, m: number) => new Date(2025, 0, day, h, m, 0).toISOString();

const timecodes: Timecode[] = [
  { id: 'tc-1', name: 'Client Work', groupId: 'g-1', color: '#3b82f6', hourlyRate: 100, archived: false, updatedAt: local(1, 0, 0) },
];
const groups: Group[] = [
  { id: 'g-1', name: 'Acme', color: '#3b82f6', archived: false, updatedAt: local(1, 0, 0) },
];

const base: Pick<Entry, 'timecodeId' | 'note' | 'tags' | 'isPaused' | 'pausedSegments' | 'editHistory'> = {
  timecodeId: 'tc-1',
  note: 'billable task',
  tags: [],
  isPaused: false,
  pausedSegments: [],
  editHistory: [],
};

// The audit's fixture: one ordinary billed hour, plus 40 minutes on the clock
// carrying a $150 flat fee. The fee's time is real and recorded, but it bills
// as a fee and so contributes no hours to any total on any surface.
const entries: Entry[] = [
  {
    ...base, id: 'e-hourly', startTime: local(6, 9, 0), endTime: local(6, 10, 0), duration: 3600,
    isRunning: false, createdAt: local(6, 9, 0), updatedAt: local(6, 10, 0),
  },
  {
    ...base, id: 'e-fee', note: 'materials', startTime: local(6, 11, 0), endTime: local(6, 11, 40),
    duration: 2400, manualAmount: 150, isRunning: false, createdAt: local(6, 11, 0), updatedAt: local(6, 11, 40),
  },
];

const settings: Settings = {
  id: 'user-settings',
  lastBackupDate: null,
  reminderIntervalDays: 0,
  roundingRule: 'none',
  roundingScope: 'day',
  idleThresholdMinutes: null,
  weeklyTargetHours: 40,
  allowConcurrentTimers: false,
  currencySymbol: '$',
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries,
    activeEntries: [],
    timecodes,
    groups,
    settings,
    deleteEntry: vi.fn(),
    bulkDeleteEntries: vi.fn(),
    updateEntry: vi.fn().mockResolvedValue(true),
    addManualEntry: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('a flat fee carrying tracked time is disclosed wherever its hours go missing', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('entry list: the rows no longer out-total the figure beneath them in silence', () => {
    render(<EntryList />);

    // A filter has to be active before the list offers its bulk total.
    fireEvent.change(screen.getByPlaceholderText('Search notes or timecode...'), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByText('Delete all 2 filtered entries'));

    // The headline number stays the billable one, so it still matches the
    // report and the timesheet — but it is labelled, and the note beside it
    // accounts for the 40 minutes the rows show and the total does not.
    expect(document.body.textContent).toContain('totaling 1h billable');
    expect(screen.getByText('worked 1h 40m · billed 1h plus fees')).not.toBeNull();
  });

  it('weekly target: says why the bar did not move for 40 minutes of work', () => {
    render(<WeeklySummary />);

    // The bar counts billable hours, so the fee's 40 minutes move it not at
    // all. Silently, that reads as 40 minutes of lost work.
    expect(screen.getByText('1.0')).not.toBeNull();
    expect(screen.getByText('worked 1h 40m · billed 1h plus fees')).not.toBeNull();
  });

  it('timesheet grid: marks the cell whose fee time it cannot print', () => {
    render(<TimesheetMatrixView />);

    // Monday bills one hour; the fee's 40 minutes are not in it.
    expect(screen.getAllByDisplayValue('1.00').length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText('40m on the clock bills as a flat fee of $150.00, so it adds no hours to this cell.')
    ).not.toBeNull();
  });

  it('calendar: marks the day whose fee time it cannot print', () => {
    render(<TimesheetCalendarView />);

    expect(screen.getByText('1.00h')).not.toBeNull();
    expect(
      screen.getByLabelText('40m on the clock bills as a flat fee of $150.00, so it adds no hours here.')
    ).not.toBeNull();
  });

  it('new entry: the amount field says what filling it in costs', () => {
    const { container } = render(<ManualEntryModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('pick timecode'));

    // "Fixed Amount — optional" read as a surcharge on top of the hours. It is
    // not: it replaces them.
    expect(screen.getByText(/Flat fee instead of hourly/)).not.toBeNull();
    expect(
      screen.getByText(/its tracked time is not billed and\s+does not count toward any hours total/)
    ).not.toBeNull();

    // Nothing to warn about until there is both a span on the clock and an
    // amount to replace it with.
    expect(screen.queryByText(/on the clock will not/)).toBeNull();

    const times = container.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(times[0], { target: { value: '2025-01-06T11:00:00' } });
    fireEvent.change(times[1], { target: { value: '2025-01-06T11:40:00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 150.00'), { target: { value: '150' } });

    expect(screen.getByText(/40m on the clock will not/)).not.toBeNull();
  });

  it('editing an entry: names the tracked time an amount is about to displace', () => {
    render(<EntryEditModal entry={entries[0]} onClose={vi.fn()} />);

    expect(screen.getByText(/Flat fee instead of hourly/)).not.toBeNull();
    expect(screen.queryByText(/on the clock will not/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('e.g. 150.00'), { target: { value: '150' } });

    // The hour this entry already has on the clock, named before the save
    // rather than discovered afterwards as a hole in four totals.
    expect(screen.getByText(/1h on the clock will not/)).not.toBeNull();
  });
});
