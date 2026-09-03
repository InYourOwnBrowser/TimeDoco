import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { format } from 'date-fns';
import { AnalysisView } from './AnalysisView';

const today = format(new Date(), 'yyyy-MM-dd');

// $100/hr, one ordinary hour, plus 40 minutes carrying a $150 flat fee. The
// summary used to print Hours 1.75 beside Rate $100.00/hr and Total $250.00, so
// the two columns a client multiplies came to $175 against a printed $250.
const mockEntries = [
  {
    id: 'entry-hourly',
    timecodeId: 'tc-1',
    startTime: `${today}T09:00:00`,
    endTime: `${today}T10:00:00`,
    duration: 3600,
    note: 'Consulting',
    pausedSegments: [],
    tags: [],
  },
  {
    id: 'entry-fee',
    timecodeId: 'tc-1',
    startTime: `${today}T11:00:00`,
    endTime: `${today}T11:40:00`,
    duration: 2400,
    note: 'Materials',
    manualAmount: 150,
    pausedSegments: [],
    tags: [],
  },
];

const mockTimecodes = [
  { id: 'tc-1', name: 'Design', groupId: 'grp-1', color: '#3b82f6', hourlyRate: 100, archived: false },
];

const mockGroups = [{ id: 'grp-1', name: 'Acme', color: '#3b82f6', archived: false }];

const mockSettings = {
  currencySymbol: '$',
  taxEnabled: false,
  roundingRule: 'none',
  roundingScope: 'day',
  templates: [],
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: mockEntries,
    timecodes: mockTimecodes,
    groups: mockGroups,
    settings: mockSettings,
    updateSettings: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

describe('a flat fee on an entry that also has tracked time', () => {
  it('bills the fee without billing its hours, so the report reconciles', () => {
    render(<AnalysisView />);

    // The Export tab's headline figures: the fee's 40 minutes are not hours.
    expect(screen.getByText('1h')).not.toBeNull();
    expect(screen.getByText('$250.00')).not.toBeNull();
  });

  it('says on screen that the clock and the billed hours differ, and why', () => {
    render(<AnalysisView />);
    fireEvent.click(screen.getByRole('tab', { name: /overview/i }));

    // 1h40m on the clock against 1h billed, with no rounding rule in play —
    // without this the headline card would quietly drop the fee's 40 minutes.
    expect(screen.getByText('worked 1h 40m · billed 1h plus fees')).not.toBeNull();
  });

  it('breaks the fee out of the row so rate x hours + fees is the total', () => {
    render(<AnalysisView />);
    fireEvent.click(screen.getByRole('tab', { name: /overview/i }));

    const breakdown = screen.getByText('Breakdown Table').closest('div')!.querySelector('table')!;
    const row = within(breakdown).getByText('Design').closest('tr') as HTMLTableRowElement;
    expect(row).not.toBeNull();

    const cells = within(row).getAllByRole('cell').map(c => c.textContent);
    // Timecode, Hours, Fees, Earnings — 1.00 h at $100/hr plus a $150 fee.
    expect(cells).toEqual(['Design', '1.00', '$150.00', '$250.00']);
  });
});
