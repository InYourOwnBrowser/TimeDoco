import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { format } from 'date-fns';
import { AnalysisView } from './AnalysisView';

const today = format(new Date(), 'yyyy-MM-dd');

const mockEntries = [
  {
    id: 'entry-est-1',
    timecodeId: 'tc-1',
    startTime: `${today}T10:00:00`,
    endTime: `${today}T10:30:00`, // 30 mins actual
    duration: 1800,
    note: 'Task 1',
    expectedDurationMinutes: 30, // on time
    pausedSegments: [],
    tags: [],
  },
  {
    id: 'entry-est-2',
    timecodeId: 'tc-1',
    startTime: `${today}T11:00:00`,
    endTime: `${today}T11:45:00`, // 45 mins actual
    duration: 2700,
    note: 'Task 2',
    expectedDurationMinutes: 30, // overrun by 15m (+50%)
    pausedSegments: [],
    tags: [],
  },
];

const mockTimecodes = [
  {
    id: 'tc-1',
    name: 'Dev Task',
    groupId: 'grp-1',
    color: '#3b82f6',
    hourlyRate: 50,
    archived: false,
  },
];

const mockGroups = [
  {
    id: 'grp-1',
    name: 'Client A',
    color: '#3b82f6',
    archived: false,
  },
];

const mockSettings = {
  currencySymbol: '$',
  taxEnabled: false,
  templates: [],
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: mockTimecodes,
    groups: mockGroups,
    settings: mockSettings,
    updateSettings: vi.fn(),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

describe('AnalysisView Estimate Accuracy', () => {
  it('renders estimate accuracy card when entries with estimates exist', () => {
    render(<AnalysisView />);

    expect(screen.getByText('Estimate Accuracy')).not.toBeNull();
    expect(screen.getByText('tasks estimated')).not.toBeNull();
    expect(screen.getByText('2')).not.toBeNull(); // 2 tasks estimated
    expect(screen.getByText('50%')).not.toBeNull(); // 1 of 2 finished on/under estimate
    expect(screen.getByText('+25%')).not.toBeNull(); // Total expected 60m, total actual 75m => +25%
  });
});
