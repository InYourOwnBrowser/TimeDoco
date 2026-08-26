import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EntryList } from './EntryList';
import type { Entry, Timecode, Group, Settings } from '../types';

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

let mockEntries: Entry[] = [];
const mockTimecodes: Timecode[] = [
  {
    id: 'tc1',
    name: 'Design',
    color: '#3b82f6',
    archived: false,
    groupId: null,
    hourlyRate: 50,
    updatedAt: new Date().toISOString(),
  },
];
const mockGroups: Group[] = [];
const mockSettings: Settings = {
  id: 'settings-1',
  currencySymbol: '$',
  roundingRule: 'none',
  idleThresholdMinutes: null,
  targetAlertMinutes: null,
  overrunAudioAlertEnabled: true,
  lastBackupDate: null,
  reminderIntervalDays: 0,
  weeklyTargetHours: null,
  allowConcurrentTimers: false,
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    activeEntries: [],
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

describe('EntryList Date Headers & Row Striping', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-05T12:00:00Z'));
    mockEntries = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders date headers with signal text color classes', () => {
    mockEntries = [
      {
        id: 'e1',
        timecodeId: 'tc1',
        startTime: '2025-01-05T09:00:00Z',
        endTime: '2025-01-05T10:00:00Z',
        duration: 3600,
        note: 'Header check entry',
        tags: [],
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: '2025-01-05T09:00:00Z',
        updatedAt: '2025-01-05T10:00:00Z',
      },
    ];

    render(<EntryList />);

    const headerSpan = screen.getByText('Today');
    expect(headerSpan.className).toContain('text-signal-dim');
    expect(headerSpan.className).toContain('dark:text-signal');
  });

  it('alternates row shading across entry list items', () => {
    mockEntries = [
      {
        id: 'e1',
        timecodeId: 'tc1',
        startTime: '2025-01-05T09:00:00Z',
        endTime: '2025-01-05T10:00:00Z',
        duration: 3600,
        note: 'First item (even index 0)',
        tags: [],
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: '2025-01-05T09:00:00Z',
        updatedAt: '2025-01-05T10:00:00Z',
      },
      {
        id: 'e2',
        timecodeId: 'tc1',
        startTime: '2025-01-05T08:00:00Z',
        endTime: '2025-01-05T09:00:00Z',
        duration: 3600,
        note: 'Second item (odd index 1)',
        tags: [],
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: '2025-01-05T08:00:00Z',
        updatedAt: '2025-01-05T09:00:00Z',
      },
      {
        id: 'e3',
        timecodeId: 'tc1',
        startTime: '2025-01-04T10:00:00Z',
        endTime: '2025-01-04T11:00:00Z',
        duration: 3600,
        note: 'Third item (even index 2)',
        tags: [],
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: '2025-01-04T10:00:00Z',
        updatedAt: '2025-01-04T11:00:00Z',
      },
    ];

    render(<EntryList />);

    const firstRowDiv = screen.getByText('First item (even index 0)').closest('.flex.items-center');
    const secondRowDiv = screen.getByText('Second item (odd index 1)').closest('.flex.items-center');
    const thirdRowDiv = screen.getByText('Third item (even index 2)').closest('.flex.items-center');

    expect(firstRowDiv?.className).toContain('bg-white dark:bg-graphite');
    expect(secondRowDiv?.className).toContain('bg-stone/40 dark:bg-white/[0.03]');
    expect(thirdRowDiv?.className).toContain('bg-white dark:bg-graphite');
  });
});
