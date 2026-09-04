import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { buildDetailedRawCSV } from '../utils/reportDocument';
import { buildReportLines } from '../utils/billing';
import type { Entry, Group, Timecode } from '../types';

/**
 * TimeDoco's own Detailed Raw CSV, read back in by TimeDoco's own CSV import.
 *
 * The file is the one the app tells a user to keep so they can check an invoice
 * against it, and both halves of the trip are in this repository — so "it
 * round trips" is a claim that can simply be executed rather than assumed.
 *
 * It did not. `Start` and `End` were bare clock times under a single `Date`, so
 * a shift finishing at 01:00 the next morning exported as `23:00:00` to
 * `01:00:00` — which the importer, gluing `Date` onto a bare time, read as an
 * end four hours before its own start and dropped. An overnight shift could not
 * survive its own export, and nothing said so: the row was counted as skipped
 * for "an end time at or before its start", which points at the date-format
 * dropdown rather than at the file. Tags went the same way, having no column at
 * all.
 */

const mockBulkAddManualEntries = vi.fn();
let mockEntries: Entry[] = [];
let mockTimecodes: Timecode[] = [];
let mockGroups: Group[] = [];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    getBackupBlob: vi.fn(),
    markBackupSaved: vi.fn(),
    importData: vi.fn(),
    wipeAllData: vi.fn(),
    refreshData: vi.fn().mockResolvedValue(undefined),
    settings: { userLogoBase64: null, theme: 'system', allowConcurrentTimers: false },
    updateSettings: vi.fn().mockResolvedValue(true),
    bulkAddManualEntries: mockBulkAddManualEntries,
    addGroup: vi.fn(),
    addTimecode: vi.fn(),
    get groups() { return mockGroups; },
    get entries() { return mockEntries; },
    get timecodes() { return mockTimecodes; },
    deletedEntries: [],
    restoreEntry: vi.fn(),
    hardDeleteEntry: vi.fn(),
    deletedTimecodes: [],
    restoreTimecode: vi.fn(),
    hardDeleteTimecode: vi.fn(),
    deletedGroups: [],
    restoreGroup: vi.fn(),
    hardDeleteGroup: vi.fn(),
    emptyTrash: vi.fn(),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

const GROUP: Group = { id: 'g-1', name: 'Acme', color: '#123456', archived: false, updatedAt: '2026-01-01T00:00:00.000Z' };
const TIMECODE: Timecode = { id: 'tc-1', name: 'Development', groupId: 'g-1', color: '#123456', hourlyRate: 100, archived: false, updatedAt: '2026-01-01T00:00:00.000Z' };

const entry = (id: string, start: Date, end: Date, over: Partial<Entry> = {}): Entry => ({
  id, timecodeId: TIMECODE.id,
  startTime: start.toISOString(), endTime: end.toISOString(),
  duration: Math.round((end.getTime() - start.getTime()) / 1000),
  note: 'Launch night', tags: ['billable', 'onsite'],
  isRunning: false, isPaused: false, pausedSegments: [],
  manualAmount: null, editHistory: [],
  createdAt: start.toISOString(), updatedAt: start.toISOString(),
  ...over,
});

const EXPORTED = [
  entry('e-day', at(2026, 3, 2, 9, 0), at(2026, 3, 2, 11, 30), { note: 'Daytime' }),
  entry('e-night', at(2026, 3, 8, 23, 0), at(2026, 3, 9, 1, 0)),
];

/** The file the Analysis tab hands the user, built the way that button builds it. */
const exportDetailedCsv = () => {
  const window = { start: at(2026, 3, 1, 0), end: at(2026, 3, 15, 0) };
  const lines = buildReportLines(EXPORTED, { roundingRule: 'none', roundingScope: 'day' }, window, {
    timecodeMap: new Map([[TIMECODE.id, TIMECODE]]),
  });
  return buildDetailedRawCSV(EXPORTED, lines, new Map([[TIMECODE.id, TIMECODE]]), new Map([[GROUP.id, GROUP]]));
};

const importCsv = (content: string) => {
  const { container } = render(<SettingsModal onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Data' }));
  const input = container.querySelector('input[type="file"][accept=".csv"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([content], 'entries.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: /import csv/i }));
};

describe('the Detailed Raw CSV, re-imported', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEntries = [];
    mockTimecodes = [TIMECODE];
    mockGroups = [GROUP];
    mockBulkAddManualEntries.mockResolvedValue({ added: 2, skipped: 0 });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('brings back every row, the overnight shift included', async () => {
    importCsv(exportDetailedCsv());
    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());

    const imported = mockBulkAddManualEntries.mock.calls[0][0] as Entry[];
    expect(imported).toHaveLength(EXPORTED.length);
  });

  it('reproduces each entry to the second, and its tags', async () => {
    importCsv(exportDetailedCsv());
    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());

    const imported = mockBulkAddManualEntries.mock.calls[0][0] as Entry[];
    const byNote = new Map(imported.map((e) => [e.note, e]));

    for (const original of EXPORTED) {
      const round = byNote.get(original.note);
      expect(round, `no row came back for "${original.note}"`).toBeDefined();
      expect(new Date(round!.startTime).getTime()).toBe(new Date(original.startTime).getTime());
      expect(new Date(round!.endTime!).getTime()).toBe(new Date(original.endTime!).getTime());
      expect(round!.tags).toEqual(original.tags);
      expect(round!.timecodeId).toBe(TIMECODE.id);
    }
  });

  it('keeps the shift two hours long rather than reading it backwards', async () => {
    importCsv(exportDetailedCsv());
    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());

    const night = (mockBulkAddManualEntries.mock.calls[0][0] as Entry[])
      .find((e) => e.note === 'Launch night');
    expect(night).toBeDefined();
    const seconds = (new Date(night!.endTime!).getTime() - new Date(night!.startTime).getTime()) / 1000;
    expect(seconds).toBe(7200);
  });
});
