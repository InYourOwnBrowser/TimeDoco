import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalysisView } from './AnalysisView';

/**
 * An estimate is made for a task, so the only actual it can be compared
 * against is that task's.
 *
 * The variance used the billable line's worked seconds, which are clipped to
 * the reporting window. An entry that started before the range began therefore
 * contributed only its tail: a task that ran exactly to estimate was reported
 * as finishing far under it, and the further the range cut into it, the better
 * the estimate looked.
 */

// Four hours across a midnight, of which two fall inside the day charted below.
const straddling = {
  id: 'entry-straddling',
  timecodeId: 'tc-1',
  startTime: '2026-03-09T22:00:00',
  endTime: '2026-03-10T02:00:00',
  duration: 14400,
  note: 'Ran past midnight',
  expectedDurationMinutes: 240,
  pausedSegments: [],
  tags: [],
};

const insideTheWindow = {
  id: 'entry-inside',
  timecodeId: 'tc-1',
  startTime: '2026-03-10T09:00:00',
  endTime: '2026-03-10T10:00:00',
  duration: 3600,
  note: 'An ordinary hour',
  expectedDurationMinutes: 60,
  pausedSegments: [],
  tags: [],
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: [straddling, insideTheWindow],
    timecodes: [{ id: 'tc-1', name: 'Dev Task', groupId: 'grp-1', color: '#3b82f6', hourlyRate: 50, archived: false }],
    groups: [{ id: 'grp-1', name: 'Client A', color: '#3b82f6', archived: false }],
    settings: { currencySymbol: '$', taxEnabled: false, roundingRule: 'none', templates: [] },
    updateSettings: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const openEstimatesForMarch10 = () => {
  const { container } = render(<AnalysisView />);

  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  const [from, to] = Array.from(container.querySelectorAll('input[type="date"]'));
  fireEvent.change(from, { target: { value: '2026-03-10' } });
  fireEvent.change(to, { target: { value: '2026-03-10' } });

  fireEvent.click(screen.getByRole('tab', { name: /estimates/i }));
};

describe('estimate variance against a clipped entry', () => {
  it('compares the whole task, not the part of it inside the range', () => {
    openEstimatesForMarch10();

    // Both tasks ran exactly to estimate. Measuring the straddling one against
    // its two in-window hours would report it 50% under, and the pair at -25%.
    expect(screen.getByText('bias (net direction)')).not.toBeNull();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    expect(screen.queryByText('-25%')).toBeNull();
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
  });

  it('says the figures reach outside the range it is reporting on', () => {
    openEstimatesForMarch10();

    expect(screen.getByText(/1 task started before this range or ran past it/)).not.toBeNull();
    expect(screen.getByText(/cover more\s+time than the report bills/)).not.toBeNull();
  });
});
