import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { format } from 'date-fns';
import { AnalysisView } from './AnalysisView';

const today = format(new Date(), 'yyyy-MM-dd');

// A billed job and a credit note against it. The credit counts toward the
// total, so a report that prints it as "—" cannot be reconciled.
const mockEntries = [
  {
    id: 'billed',
    timecodeId: 'tc-1',
    startTime: `${today}T09:00:00`,
    endTime: `${today}T11:00:00`,
    duration: 7200,
    note: 'Consulting',
    pausedSegments: [],
    tags: [],
  },
  {
    id: 'credit',
    timecodeId: 'tc-credit',
    startTime: `${today}T12:00:00`,
    endTime: `${today}T12:00:00`,
    duration: 0,
    note: 'Goodwill credit',
    manualAmount: -75,
    pausedSegments: [],
    tags: [],
  },
];

const mockTimecodes = [
  { id: 'tc-1', name: 'Consulting', groupId: 'grp-1', color: '#3b82f6', hourlyRate: 100, archived: false },
  { id: 'tc-credit', name: 'Credits', groupId: 'grp-1', color: '#ef4444', hourlyRate: null, archived: false },
];

const mockGroups = [{ id: 'grp-1', name: 'Client A', color: '#3b82f6', archived: false }];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: mockTimecodes,
    groups: mockGroups,
    settings: { currencySymbol: '$', taxEnabled: false, templates: [] },
    updateSettings: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

describe('AnalysisView negative amounts', () => {
  afterEach(cleanup);

  it('prints a credit in the breakdown instead of hiding it behind a dash', () => {
    render(<AnalysisView />);
    fireEvent.click(screen.getByText('Overview'));

    // $200 of consulting less a $75 credit.
    expect(screen.getAllByText('-$75.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$125.00').length).toBeGreaterThan(0);
  });
});
