import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalysisView } from './AnalysisView';

/**
 * The single-day bar and the heatmap that replaces it at two days and up were
 * answering different questions without saying so: the heatmap plots billable
 * time, the bar drew each entry's raw span, pauses included. The same day's
 * work therefore looked like one amount at a one-day range and another at two.
 */

const withAPause = {
  id: 'entry-paused',
  timecodeId: 'tc-1',
  startTime: '2026-03-10T09:00:00',
  endTime: '2026-03-10T12:00:00',
  duration: 7200,
  note: 'An hour of it away from the desk',
  pausedSegments: [{ pauseStart: '2026-03-10T10:00:00', pauseEnd: '2026-03-10T11:00:00' }],
  tags: [],
};

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    entries: [withAPause],
    timecodes: [{ id: 'tc-1', name: 'Dev Task', groupId: 'grp-1', color: '#3b82f6', hourlyRate: 50, archived: false }],
    groups: [{ id: 'grp-1', name: 'Client A', color: '#3b82f6', archived: false }],
    settings: { currencySymbol: '$', taxEnabled: false, roundingRule: 'none', templates: [] },
    updateSettings: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const openTimelineForMarch10 = () => {
  const view = render(<AnalysisView />);

  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  const [from, to] = Array.from(view.container.querySelectorAll('input[type="date"]'));
  fireEvent.change(from, { target: { value: '2026-03-10' } });
  fireEvent.change(to, { target: { value: '2026-03-10' } });

  fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));
  return view;
};

describe('the single-day timeline bar', () => {
  it('draws the spans that were on the clock, with the pause left out', () => {
    const { container } = openTimelineForMarch10();

    const blocks = Array.from(container.querySelectorAll('[title^="Dev Task"]'));
    expect(blocks.map(b => b.getAttribute('title'))).toEqual([
      'Dev Task (9:00 AM – 10:00 AM)',
      'Dev Task (11:00 AM – 12:00 PM)',
    ]);
  });

  it('names what it is showing, and what the day bills', () => {
    openTimelineForMarch10();

    // Three hours between the ends, one of them paused: two on the clock, and
    // with no rounding rule, two billed.
    expect(screen.getByText(/2h worked/)).not.toBeNull();
    expect(screen.getByText(/2h billed/)).not.toBeNull();
  });
});
