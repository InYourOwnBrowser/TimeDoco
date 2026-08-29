import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from './SettingsModal';
import type { Entry, Timecode } from '../types';

const mockAddTimecode = vi.fn();
const mockBulkAddManualEntries = vi.fn();
const mockHardDeleteTimecode = vi.fn();
const mockRestoreTimecode = vi.fn();

let mockEntries: Entry[] = [];
let mockTimecodes: Timecode[] = [];
let mockDeletedTimecodes: Timecode[] = [];

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
    addTimecode: mockAddTimecode,
    get entries() { return mockEntries; },
    get timecodes() { return mockTimecodes; },
    deletedEntries: [],
    restoreEntry: vi.fn(),
    hardDeleteEntry: vi.fn(),
    get deletedTimecodes() { return mockDeletedTimecodes; },
    restoreTimecode: mockRestoreTimecode,
    hardDeleteTimecode: mockHardDeleteTimecode,
    deletedGroups: [],
    restoreGroup: vi.fn(),
    hardDeleteGroup: vi.fn(),
    emptyTrash: vi.fn(),
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const trashed: Timecode = {
  id: 'tc-trashed',
  name: 'Client Work',
  groupId: null,
  color: undefined,
  hourlyRate: null,
  archived: false,
  deletedAt: '2025-01-02T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
};

const CSV = 'Start Time,End Time,Timecode,Note\n2024-01-01T12:00:00Z,2024-01-01T13:00:00Z,Client Work,Test\n';

const importCsv = (content = CSV) => {
  const { container } = render(<SettingsModal onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Data' }));
  const input = container.querySelector('input[type="file"][accept=".csv"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([content], 'rows.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: /import csv/i }));
};

describe('CSV import and timecodes in the trash', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEntries = [];
    mockTimecodes = [];
    mockDeletedTimecodes = [trashed];
    mockAddTimecode.mockResolvedValue({ id: 'tc-new', name: 'Client Work' });
    mockBulkAddManualEntries.mockResolvedValue({ added: 1, skipped: 0 });
    mockHardDeleteTimecode.mockResolvedValue(true);
    mockRestoreTimecode.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reuses a trashed timecode of the same name rather than creating a duplicate', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    importCsv();

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    // The name resolves against every timecode in the database, trashed ones
    // included — the same set the JSON import path resolves against.
    expect(mockAddTimecode).not.toHaveBeenCalled();
    expect(mockRestoreTimecode).toHaveBeenCalledWith('tc-trashed');
    expect(mockBulkAddManualEntries.mock.calls[0][0]).toEqual([
      expect.objectContaining({ timecodeId: 'tc-trashed' }),
    ]);

    confirmSpy.mockRestore();
  });

  it('asks before restoring, because restoring brings back the entries trashed with it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    importCsv();

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('Client Work');
    // Declining is a deliberate choice to keep the trashed record where it is.
    expect(mockRestoreTimecode).not.toHaveBeenCalled();
    expect(mockAddTimecode).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it('leaves live timecodes alone and never prompts when nothing is in the trash', async () => {
    mockDeletedTimecodes = [];
    mockTimecodes = [{ ...trashed, id: 'tc-live', deletedAt: undefined }];
    const confirmSpy = vi.spyOn(window, 'confirm');

    importCsv();

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockAddTimecode).not.toHaveBeenCalled();
    expect(mockBulkAddManualEntries.mock.calls[0][0]).toEqual([
      expect.objectContaining({ timecodeId: 'tc-live' }),
    ]);

    confirmSpy.mockRestore();
  });
});

describe('CSV import rolls back the timecodes it created', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEntries = [];
    mockTimecodes = [];
    mockDeletedTimecodes = [];
    mockAddTimecode.mockResolvedValue({ id: 'tc-new', name: 'Client Work' });
    mockHardDeleteTimecode.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('removes them when the import resolves having added nothing', async () => {
    // bulkAddManualEntries resolves rather than throwing when its own overlap
    // pass rejects every row, so the catch never ran and the new timecodes were
    // left behind, empty, with nothing referencing them.
    mockBulkAddManualEntries.mockResolvedValue({ added: 0, skipped: 1 });

    importCsv();

    await waitFor(() => expect(mockHardDeleteTimecode).toHaveBeenCalledWith('tc-new'));
    expect(await screen.findByText(/were removed|was removed/)).toBeTruthy();
  });

  it('removes them when the write throws', async () => {
    mockBulkAddManualEntries.mockRejectedValue(new Error('Transaction aborted'));

    importCsv();

    await waitFor(() => expect(mockHardDeleteTimecode).toHaveBeenCalledWith('tc-new'));
  });

  it('does not claim a cleanup that the guarded delete refused', async () => {
    mockBulkAddManualEntries.mockResolvedValue({ added: 0, skipped: 1 });
    // hardDeleteTimecode is guarded: it reports its own failure and resolves
    // false. Counting every call as a success claimed a cleanup that never
    // happened and left the user with no idea the record was still there.
    mockHardDeleteTimecode.mockResolvedValue(false);

    importCsv();

    await waitFor(() => expect(mockHardDeleteTimecode).toHaveBeenCalledWith('tc-new'));
    expect(await screen.findByText(/could not be removed/)).toBeTruthy();
  });

  it('leaves them in place when entries were actually imported', async () => {
    mockBulkAddManualEntries.mockResolvedValue({ added: 1, skipped: 0 });

    importCsv();

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(mockHardDeleteTimecode).not.toHaveBeenCalled();
  });
});
