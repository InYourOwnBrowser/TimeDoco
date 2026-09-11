import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { AnalysisView } from './AnalysisView';

const today = format(new Date(), 'yyyy-MM-dd');

// 50 minutes, the length the audit used: at 15-minute rounding it bills 45, so
// one column cannot be both the invoice figure and the measurement the invoice
// is checked against. Plus a 40-minute entry carrying a $150 flat fee, whose
// hours are billed as a fee and so are not billed as hours at all.
const mockEntries = [
  {
    id: 'entry-fifty',
    timecodeId: 'tc-1',
    startTime: `${today}T09:00:00`,
    endTime: `${today}T09:50:00`,
    duration: 3000,
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
  roundingRule: '15min',
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

/**
 * Click the export button, confirm the Save As dialog, and parse the blob the
 * download hook hands to `URL.createObjectURL`. Parsed with the same CSV reader
 * the import path uses, so a header that is malformed as CSV — two of them
 * contain a comma — fails here rather than silently shifting a column.
 */
const exportDetailedRawCsv = async (): Promise<Record<string, string>[]> => {
  const blobs: Blob[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:mock-url'; }),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

  render(<AnalysisView />);
  fireEvent.click(screen.getByText('Detailed Raw CSV'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(blobs).toHaveLength(1));
  const parsed = Papa.parse<Record<string, string>>(await blobs[0].text(), { header: true });
  expect(parsed.errors).toEqual([]);
  return parsed.data;
};

describe('the Detailed Raw CSV export', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('carries the worked hours the invoice is meant to be checked against', async () => {
    const rows = await exportDetailedRawCsv();

    // Both columns, named for what they are. A single "Duration (h)" could only
    // ever be one of the two, and it used to be the billed one — under a header
    // the button, the README and the landing page all called raw.
    expect(Object.keys(rows[0])).toContain('Duration (h, worked)');
    expect(Object.keys(rows[0])).toContain('Duration (h, billed)');

    const worked = rows.find(r => r.Note === 'Consulting')!;
    // 50 minutes on the clock, unrounded, against 45 minutes billed under the
    // 15-minute rule. The worked figure keeps enough precision to recover the
    // exact second: 0.833333 x 3600 rounds back to 3000.
    expect(Math.round(parseFloat(worked['Duration (h, worked)']) * 3600)).toBe(3000);
    expect(worked['Duration (h, billed)']).toBe('0.75');
  });

  it("keeps a fee entry's time on the clock, where its billed hours are blank", async () => {
    const rows = await exportDetailedRawCsv();
    const fee = rows.find(r => r.Note === 'Materials')!;

    // 40 minutes worked, billed as a $150 fee rather than by the hour. The
    // billed cell stays empty because no hours were charged; the worked cell is
    // the only record in the file that those 40 minutes happened at all.
    expect(Math.round(parseFloat(fee['Duration (h, worked)']) * 3600)).toBe(2400);
    expect(fee['Duration (h, billed)']).toBe('');
    expect(fee.Amount).toBe('150.00');
  });
});
