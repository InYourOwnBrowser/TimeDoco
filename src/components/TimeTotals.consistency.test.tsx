import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntryList } from './EntryList';
import { WeeklySummary } from './WeeklySummary';
import { TimesheetMatrixView } from './TimesheetMatrixView';
import { TimesheetCalendarView } from './TimesheetCalendarView';
import type { Entry, Group, Settings, Timecode } from '../types';

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
  { id: 'tc-1', name: 'Client Work', groupId: 'g-1', color: '#3b82f6', hourlyRate: null, archived: false, updatedAt: local(1, 0, 0) },
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

// Monday: 12 + 12 minutes, which 15-minute rounding at day scope lifts to 30.
// Wednesday: a timer that has been running for 30 minutes, whose stored
// `duration` is still 0. Week total: exactly one hour.
const entries: Entry[] = [
  { ...base, id: 'e1', startTime: local(6, 9, 0), endTime: local(6, 9, 12), duration: 720, isRunning: false, createdAt: local(6, 9, 0), updatedAt: local(6, 9, 12) },
  { ...base, id: 'e2', startTime: local(6, 10, 0), endTime: local(6, 10, 12), duration: 720, isRunning: false, createdAt: local(6, 10, 0), updatedAt: local(6, 10, 12) },
  { ...base, id: 'e3', startTime: local(8, 13, 30), endTime: null, duration: 0, isRunning: true, createdAt: local(8, 13, 30), updatedAt: local(8, 13, 30) },
];

const settings: Settings = {
  id: 'user-settings',
  lastBackupDate: null,
  reminderIntervalDays: 0,
  roundingRule: '15min',
  roundingScope: 'day',
  idleThresholdMinutes: null,
  weeklyTargetHours: 40,
  allowConcurrentTimers: false,
  currencySymbol: '$',
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries,
    activeEntries: entries.filter(e => e.isRunning),
    timecodes,
    groups,
    settings,
    deleteEntry: vi.fn(),
    bulkDeleteEntries: vi.fn(),
    updateEntry: vi.fn(),
    addManualEntry: vi.fn(),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('every surface answers "how much time this week" with the same number', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('timesheet grid totals the week at one hour, running timer included', () => {
    render(<TimesheetMatrixView />);
    // Monday's cell and Wednesday's running timer, then the row total and the
    // week total, all agree.
    expect(screen.getAllByDisplayValue('0.50')).toHaveLength(2);
    expect(screen.getAllByText('1.00').length).toBeGreaterThan(0);
  });

  it('calendar shows the same half hour on each tracked day', () => {
    render(<TimesheetCalendarView />);
    // Monday's two short entries and Wednesday's running timer, each rounded to
    // half an hour at day scope.
    expect(screen.getAllByText('0.50h')).toHaveLength(2);
  });

  it('weekly target bar reads the same hour', () => {
    render(<WeeklySummary />);
    expect(screen.getByText('1.0')).toBeTruthy();
  });

  it('entry list totals the same hour, running timer included', () => {
    render(<EntryList />);

    // A filter has to be active before the list offers its total.
    fireEvent.change(screen.getByPlaceholderText('Search notes or timecode...'), {
      target: { value: 'billable' },
    });
    fireEvent.click(screen.getByText('Delete all 3 filtered entries'));

    expect(document.body.textContent).toContain('totaling 1h');
  });
});
