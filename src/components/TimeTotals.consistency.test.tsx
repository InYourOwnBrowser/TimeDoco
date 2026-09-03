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
const weekEntries: Entry[] = [
  { ...base, id: 'e1', startTime: local(6, 9, 0), endTime: local(6, 9, 12), duration: 720, isRunning: false, createdAt: local(6, 9, 0), updatedAt: local(6, 9, 12) },
  { ...base, id: 'e2', startTime: local(6, 10, 0), endTime: local(6, 10, 12), duration: 720, isRunning: false, createdAt: local(6, 10, 0), updatedAt: local(6, 10, 12) },
  { ...base, id: 'e3', startTime: local(8, 13, 30), endTime: null, duration: 0, isRunning: true, createdAt: local(8, 13, 30), updatedAt: local(8, 13, 30) },
];

// Two 20-minute entries on two different days of the same week. At 15-minute
// rounding the scope decides the answer and the two answers differ: rounded per
// day each falls to 15 minutes and the week is 0.50h, pooled over the week the
// 40 minutes rise to 45 and the week is 0.75h. The week-total tests above use
// lengths where both scopes happen to land on the same hour, so they could not
// tell a grid that ignored the rounding scope from one that honoured it.
const scopeSensitiveWeek: Entry[] = [
  { ...base, id: 's1', startTime: local(6, 9, 0), endTime: local(6, 9, 20), duration: 1200, isRunning: false, createdAt: local(6, 9, 0), updatedAt: local(6, 9, 20) },
  { ...base, id: 's2', startTime: local(7, 9, 0), endTime: local(7, 9, 20), duration: 1200, isRunning: false, createdAt: local(7, 9, 0), updatedAt: local(7, 9, 20) },
];

// The same 20 minutes on Monday, with its partner two weeks later — inside the
// calendar's month but outside the grid's week. Any surface that pools a bucket
// over its own visible span gives Monday a different figure here than the
// surface beside it does.
const scopeSensitiveMonth: Entry[] = [
  { ...base, id: 'm1', startTime: local(6, 9, 0), endTime: local(6, 9, 20), duration: 1200, isRunning: false, createdAt: local(6, 9, 0), updatedAt: local(6, 9, 20) },
  { ...base, id: 'm2', startTime: local(20, 9, 0), endTime: local(20, 9, 20), duration: 1200, isRunning: false, createdAt: local(20, 9, 0), updatedAt: local(20, 9, 20) },
];

// Two weeks earlier, so it is history the entry list shows but no week-scoped
// surface does. 40 minutes: a length that rounds differently on its own day
// than it does pooled with the week.
const olderEntry: Entry = {
  ...base, id: 'e0', startTime: local(2, 9, 0), endTime: local(2, 9, 40), duration: 2400,
  isRunning: false, createdAt: local(2, 9, 0), updatedAt: local(2, 9, 40),
};

// Read through a holder so a test can widen the history between renders.
let entries: Entry[] = weekEntries;

const baseSettings: Settings = {
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

// Read through a holder so a test can change the rounding scope between renders.
let settings: Settings = baseSettings;

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    get entries() { return entries; },
    get activeEntries() { return entries.filter(e => e.isRunning); },
    timecodes,
    groups,
    get settings() { return settings; },
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

describe('every surface answers "how much time this week" with the same number', () => {
  beforeEach(() => {
    cleanup();
    settings = baseSettings;
    entries = weekEntries;
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

  // 'timecode' and 'invoice' scope are properties of a report: a bucket's total
  // is the set of entries handed in, so a surface that pools over whatever it is
  // showing lets its own extent decide an entry's billable minutes. Every
  // surface but the report degrades them to 'day' instead.
  for (const scope of ['timecode', 'invoice'] as const) {
    it(`timesheet grid and weekly summary agree on the week at ${scope} scope`, () => {
      settings = { ...baseSettings, roundingScope: scope };

      render(<TimesheetMatrixView />);
      // 24 minutes on Monday and 30 running on Wednesday, each day's total
      // rounded on its own: half an hour apiece, an hour for the week.
      expect(screen.getAllByText('1.00').length).toBeGreaterThan(0);
      cleanup();

      render(<WeeklySummary />);
      // The same week, the same buckets, the same hour.
      expect(screen.getByText('1.0')).toBeTruthy();
    });
  }

  // The grid and the calendar are two tabs of the same Timesheet view, showing
  // the same days over different spans — a week against a month. While each
  // pooled a wide-scope bucket over its own span, the two tabs printed two
  // different figures for one day.
  for (const scope of ['timecode', 'invoice'] as const) {
    it(`timesheet grid and calendar show the same per-day figure at ${scope} scope`, () => {
      settings = { ...baseSettings, roundingScope: scope };
      entries = scopeSensitiveWeek;

      render(<TimesheetMatrixView />);
      // Each day rounds on its own: 20 minutes down to 15, and 0.50 for the
      // week. Pooled over the visible span instead, each cell would read 0.38.
      expect(screen.getAllByDisplayValue('0.25')).toHaveLength(2);
      expect(screen.getAllByText('0.50').length).toBeGreaterThan(0);
      cleanup();

      render(<TimesheetCalendarView />);
      expect(screen.getAllByText('0.25h')).toHaveLength(2);
    });
  }

  // The case the fixture above could not catch: both entries sat in the grid's
  // week *and* the calendar's month, so the two spans happened to hold the same
  // entries. Put the second entry two weeks out and the spans differ — the grid
  // sees one entry, the calendar sees two — and only a bucket that ignores the
  // visible span gives Monday the same figure on both.
  for (const scope of ['timecode', 'invoice'] as const) {
    it(`grid and calendar agree on a day whose week and month hold different entries at ${scope} scope`, () => {
      settings = { ...baseSettings, roundingScope: scope };
      entries = scopeSensitiveMonth;

      render(<TimesheetMatrixView />);
      // Monday's 20 minutes, rounded on their own day: 0.25. The grid's week
      // holds this entry alone, so pooling would have rounded it to 0.25 too —
      // the disagreement is on the calendar's side.
      expect(screen.getAllByDisplayValue('0.25')).toHaveLength(1);
      cleanup();

      render(<TimesheetCalendarView />);
      // Both days are in the visible month. Pooled over it, 40 minutes would
      // round to 45 and each day would read 0.38 — against the grid's 0.25.
      expect(screen.getAllByText('0.25h')).toHaveLength(2);
    });
  }

  it('entry list rounds per day at invoice scope rather than pooling all history', () => {
    // The list has no reporting window. Taken literally, 'invoice' scope would
    // make its bucket the user's entire history: 40 + 12 + 12 + 30 = 94 minutes
    // pooled and rounded to 90. Degrading to 'day' rounds each day on its own —
    // 45 + 30 + 30 — which is the figure that stays stable as history grows and
    // does not move when an unrelated old entry is edited.
    settings = { ...baseSettings, roundingScope: 'invoice' };
    entries = [olderEntry, ...weekEntries];
    render(<EntryList />);

    fireEvent.change(screen.getByPlaceholderText('Search notes or timecode...'), {
      target: { value: 'billable' },
    });
    fireEvent.click(screen.getByText('Delete all 4 filtered entries'));

    expect(document.body.textContent).toContain('totaling 1h 45m');
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

  it('agrees on week totals for an entry crossing the midnight/week boundary', () => {
    // Sunday 2025-01-05 23:00 to Monday 2025-01-06 01:00 (2 hours).
    // Week starts Monday 2025-01-06.
    const crossBoundaryEntry: Entry = {
      ...base,
      id: 'cross-1',
      startTime: local(5, 23, 0),
      endTime: local(6, 1, 0),
      duration: 7200,
      isRunning: false,
      createdAt: local(5, 23, 0),
      updatedAt: local(6, 1, 0),
    };
    entries = [crossBoundaryEntry];

    // Under start-day filing convention, entry starts on Sunday (prev week), so
    // for the current week starting Monday, both grid and weekly summary show 0.0 hrs.
    render(<TimesheetMatrixView />);
    expect(screen.getAllByText('0.00').length).toBeGreaterThan(0);
    cleanup();

    render(<WeeklySummary />);
    expect(screen.getByText('0.0')).toBeTruthy();
  });
});
