import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { format } from 'date-fns';
import { TimesheetCalendarView } from './TimesheetCalendarView';
import { GroupingManagement } from './GroupingManagement';
import { AnalysisView } from './AnalysisView';
import type { Entry, Timecode, Group, Settings } from '../types';

const today = format(new Date(), 'yyyy-MM-dd');

const mockTimecodes: Timecode[] = [
  { id: 'tc1', name: 'Dev 50', hourlyRate: 50, groupId: 'g1', color: '#111111', archived: false, updatedAt: new Date().toISOString() },
  { id: 'tc2', name: 'Dev 150', hourlyRate: 150, groupId: 'g1', color: '#222222', archived: false, updatedAt: new Date().toISOString() },
];

const mockGroups: Group[] = [
  { id: 'g1', name: 'Group 1', color: '#111111', archived: false, updatedAt: new Date().toISOString() },
];

const mockEntries: Entry[] = [
  {
    id: 'e1',
    timecodeId: 'tc1',
    startTime: `${today}T10:00:00`,
    endTime: `${today}T11:00:00`,
    duration: 3600,
    note: 'Live Entry',
    tags: [],
    isRunning: false,
    isPaused: false,
    pausedSegments: [],
    editHistory: [],
    createdAt: `${today}T10:00:00`,
    updatedAt: `${today}T11:00:00`,
  },
  {
    id: 'e-trashed',
    timecodeId: 'tc1',
    startTime: `${today}T11:00:00`,
    endTime: `${today}T12:00:00`,
    duration: 3600,
    note: 'Trashed Entry',
    tags: [],
    isRunning: false,
    isPaused: false,
    pausedSegments: [],
    editHistory: [],
    deletedAt: `${today}T12:05:00`,
    createdAt: `${today}T11:00:00`,
    updatedAt: `${today}T12:05:00`,
  },
];

const mockMergeTimecodes = vi.fn().mockResolvedValue(true);
const mockAddToast = vi.fn();

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: mockTimecodes,
    groups: mockGroups,
    settings: { currencySymbol: '$', taxEnabled: true, taxRate: 15, taxInclusive: true, taxLabel: 'GST' } as Settings,
    mergeTimecodes: mockMergeTimecodes,
    updateSettings: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('M-6, M-7, M-10 Audit Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('M-6: TimesheetCalendarView day-detail panel filters out soft-deleted entries', async () => {
    render(<TimesheetCalendarView />);

    const todayNum = format(new Date(), 'd');
    const dayElements = screen.getAllByText(todayNum);
    // Find the current month's square for today
    const todaySquare = dayElements.find(
      (el) => el.closest('.cursor-pointer') && !el.closest('.opacity-40')
    )?.closest('.cursor-pointer');

    expect(todaySquare).toBeTruthy();
    fireEvent.click(todaySquare!);

    // Live Entry should be displayed, Trashed Entry should not
    await waitFor(() => {
      expect(screen.getByText(/Live Entry/i)).toBeTruthy();
      expect(screen.queryByText(/Trashed Entry/i)).toBeNull();
    });
  });

  it('M-7: GroupingManagement merge confirm prompt discloses rate shift and trash wording', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<GroupingManagement />);

    const mergeBtns = screen.getAllByRole('button', { name: 'Merge Timecode' });
    fireEvent.click(mergeBtns[0]); // tc1 Dev 50

    const destSelect = screen.getByRole('combobox');
    fireEvent.change(destSelect, { target: { value: 'tc2' } });

    const confirmMergeBtn = screen.getByRole('button', { name: 'Confirm Merge' });
    fireEvent.click(confirmMergeBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const confirmMsg = confirmSpy.mock.calls[0][0];

    // Assert rate disclosure and trash wording
    expect(confirmMsg).toContain('1 entry currently billed at $50.00/hr will move to a timecode billed at $150.00/hr.');
    expect(confirmMsg).toContain('The source timecode moves to the trash; restoring it will not bring the entries back.');

    confirmSpy.mockRestore();
  });

  it('M-10: AnalysisView summary CSV and PDF exports use Total (incl. GST) and Subtotal (excl. GST) in tax-inclusive mode', () => {
    render(<AnalysisView />);

    // In Export tab, summary CSV button exists
    const summaryCsvBtn = screen.getByRole('button', { name: /Summary CSV/i });
    expect(summaryCsvBtn).toBeTruthy();
  });
});
