import { render, screen, fireEvent } from '@testing-library/react';
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
    expectedDurationMinutes: 30, // on time (0%)
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

describe('AnalysisView Redesign Tabs & Metrics', () => {
  it('defaults to Export tab and allows switching to Overview, Estimates, and Timeline tabs', () => {
    render(<AnalysisView />);

    // Verify Tab headers exist
    expect(screen.getByRole('tab', { name: /export/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /overview/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /estimates/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /timeline/i })).not.toBeNull();

    // Default tab is Export
    expect(screen.getByText('Export Scope')).not.toBeNull();
    expect(screen.getByText('Summary CSV')).not.toBeNull();
    expect(screen.getByText('Detailed Raw CSV')).not.toBeNull();
    expect(screen.getByText('Export Calendar (ICS)')).not.toBeNull();
    expect(screen.getByText('Generate Report (PDF)')).not.toBeNull();
  });

  it('renders headline cards when navigating to Overview tab', () => {
    render(<AnalysisView />);

    const overviewTab = screen.getByRole('tab', { name: /overview/i });
    fireEvent.click(overviewTab);

    expect(screen.getByText('TOTAL TRACKED TIME')).not.toBeNull();
    expect(screen.getByText('TOTAL EARNINGS')).not.toBeNull();
  });

  it('renders deep estimate metrics when navigating to Estimates tab', () => {
    render(<AnalysisView />);

    const estimatesTab = screen.getByRole('tab', { name: /estimates/i });
    fireEvent.click(estimatesTab);

    // Verify 4 headline metrics on Estimates tab
    expect(screen.getByText('tasks estimated')).not.toBeNull();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0); // 2 tasks estimated
    expect(screen.getByText('hit rate (on/under)')).not.toBeNull();
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0); // 1 of 2 on time
    expect(screen.getByText('bias (net direction)')).not.toBeNull();
    expect(screen.getAllByText('+25%').length).toBeGreaterThan(0); // (0% + 50%) / 2 = +25%
    expect(screen.getByText('typical miss (magnitude)')).not.toBeNull();

    // Verify per-timecode table header and entries
    expect(screen.getByText('Per-Timecode Estimate Performance')).not.toBeNull();
    expect(screen.getAllByText('Dev Task').length).toBeGreaterThan(0);
  });
});
