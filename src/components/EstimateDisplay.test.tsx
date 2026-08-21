import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActiveTimer } from './ActiveTimer';
import { GlobalActiveTimerBar } from './GlobalActiveTimerBar';
import { EntryList } from './EntryList';
import type { Entry, Timecode, Group, Settings } from '../types';

// Mock virtuoso for EntryList rendering
vi.mock('react-virtuoso', () => ({
  GroupedVirtuoso: ({ groupCounts, itemContent, groupContent }: any) => {
    let globalIndex = 0;
    return (
      <div data-testid="virtuoso-container">
        {groupCounts.map((count: number, groupIndex: number) => {
          const groupHeader = groupContent(groupIndex);
          const items = [];
          for (let i = 0; i < count; i++) {
            items.push(itemContent(globalIndex, groupIndex));
            globalIndex++;
          }
          return (
            <div key={groupIndex}>
              {groupHeader}
              {items}
            </div>
          );
        })}
      </div>
    );
  },
}));

let mockActiveEntries: Entry[] = [];
let mockEntries: Entry[] = [];
const mockTimecodes: Timecode[] = [
  { id: 'tc1', name: 'Design', color: '#3b82f6', archived: false },
];
const mockGroups: Group[] = [];
const mockSettings: Settings = {
  currencySymbol: '$',
  roundingRule: 'none',
  idleThresholdMinutes: null,
  targetAlertMinutes: null,
  darkTheme: false,
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    activeEntries: mockActiveEntries,
    timecodes: mockTimecodes,
    groups: mockGroups,
    settings: mockSettings,
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    pauseTimer: vi.fn(),
    resumeTimer: vi.fn(),
    updateActiveNote: vi.fn(),
    deleteEntry: vi.fn(),
    bulkDeleteEntries: vi.fn(),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

describe('Estimated Time Display', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    mockActiveEntries = [];
    mockEntries = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders estimate and time left on ActiveTimer when running under estimate', () => {
    const startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
    const activeEntry: Entry = {
      id: 'e1',
      timecodeId: 'tc1',
      startTime,
      duration: 300,
      note: 'Working on UI',
      tags: [],
      isRunning: true,
      isPaused: false,
      pausedSegments: [],
      expectedDurationMinutes: 20,
    };

    render(<ActiveTimer activeEntry={activeEntry} />);

    expect(screen.getByText('Est. 20m')).not.toBeNull();
    expect(screen.getByText('15m left')).not.toBeNull();
  });

  it('renders estimate and time over on ActiveTimer when running over estimate', () => {
    const startTime = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // 25 minutes ago
    const activeEntry: Entry = {
      id: 'e1',
      timecodeId: 'tc1',
      startTime,
      duration: 1500,
      note: 'Working on UI',
      tags: [],
      isRunning: true,
      isPaused: false,
      pausedSegments: [],
      expectedDurationMinutes: 20,
    };

    render(<ActiveTimer activeEntry={activeEntry} />);

    expect(screen.getByText('Est. 20m')).not.toBeNull();
    expect(screen.getByText('5m over')).not.toBeNull();
  });

  it('renders estimate on GlobalActiveTimerBar', () => {
    const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    const activeEntry: Entry = {
      id: 'e1',
      timecodeId: 'tc1',
      startTime,
      duration: 600,
      note: '',
      tags: [],
      isRunning: true,
      isPaused: false,
      pausedSegments: [],
      expectedDurationMinutes: 20,
    };
    mockActiveEntries = [activeEntry];

    render(<GlobalActiveTimerBar />);

    expect(screen.getByText('/ 20m')).not.toBeNull();
  });

  it('renders estimate comparison on EntryList for completed entry (under estimate)', () => {
    const completedEntry: Entry = {
      id: 'e2',
      timecodeId: 'tc1',
      startTime: '2025-01-01T10:00:00Z',
      endTime: '2025-01-01T10:10:00Z',
      duration: 600, // 10m
      note: 'Done',
      tags: [],
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      expectedDurationMinutes: 20,
    };
    mockEntries = [completedEntry];

    render(<EntryList />);

    expect(screen.getByText('Est. 20m · 10m under')).not.toBeNull();
  });

  it('renders estimate comparison on EntryList for completed entry (over estimate)', () => {
    const completedEntry: Entry = {
      id: 'e3',
      timecodeId: 'tc1',
      startTime: '2025-01-01T10:00:00Z',
      endTime: '2025-01-01T10:25:00Z',
      duration: 1500, // 25m
      note: 'Done late',
      tags: [],
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      expectedDurationMinutes: 20,
    };
    mockEntries = [completedEntry];

    render(<EntryList />);

    expect(screen.getByText('Est. 20m · 5m over')).not.toBeNull();
  });

  it('renders on target on EntryList for completed entry matching estimate exactly', () => {
    const completedEntry: Entry = {
      id: 'e4',
      timecodeId: 'tc1',
      startTime: '2025-01-01T10:00:00Z',
      endTime: '2025-01-01T10:20:00Z',
      duration: 1200, // 20m
      note: 'Exact',
      tags: [],
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      expectedDurationMinutes: 20,
    };
    mockEntries = [completedEntry];

    render(<EntryList />);

    expect(screen.getByText('Est. 20m · on target')).not.toBeNull();
  });
});
