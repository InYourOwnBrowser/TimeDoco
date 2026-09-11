import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from './SettingsModal';
import type { Entry, Group, Timecode } from '../types';
import { PartialImportError } from '../utils/importErrors';

const mockAddGroup = vi.fn();
const mockAddTimecode = vi.fn();
const mockBulkAddManualEntries = vi.fn();
const mockHardDeleteTimecode = vi.fn();
const mockRestoreTimecode = vi.fn();

let mockEntries: Entry[] = [];
let mockTimecodes: Timecode[] = [];
let mockDeletedTimecodes: Timecode[] = [];
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
    addGroup: mockAddGroup,
    addTimecode: mockAddTimecode,
    get groups() { return mockGroups; },
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
  fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
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
    mockGroups = [];
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
    mockGroups = [];
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

// Timecode names are only unique within a group, so "Design" can legitimately
// sit under two clients. Resolving by name alone and taking the first match put
// the imported hours on whichever one IndexedDB happened to return first — an
// order that is arbitrary and not stable across devices — with nothing on
// screen to say a choice had been made.
describe('CSV import resolves timecodes by group as well as name', () => {
  const group = (id: string, name: string): Group => ({
    id, name, color: '#3b82f6', archived: false, updatedAt: '2025-01-01T00:00:00.000Z',
  });
  const timecode = (id: string, name: string, groupId: string | null): Timecode => ({
    id, name, groupId, color: undefined, hourlyRate: null, archived: false,
    updatedAt: '2025-01-01T00:00:00.000Z',
  });

  const withGroupColumn =
    'Start Time,End Time,Timecode,Group,Note\n' +
    '2024-01-01T12:00:00Z,2024-01-01T13:00:00Z,Design,Globex,Test\n';
  const withoutGroupColumn =
    'Start Time,End Time,Timecode,Note\n' +
    '2024-01-01T12:00:00Z,2024-01-01T13:00:00Z,Design,Test\n';

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEntries = [];
    mockDeletedTimecodes = [];
    mockGroups = [group('g-acme', 'Acme'), group('g-globex', 'Globex')];
    mockTimecodes = [
      timecode('tc-acme-design', 'Design', 'g-acme'),
      timecode('tc-globex-design', 'Design', 'g-globex'),
    ];
    mockBulkAddManualEntries.mockResolvedValue({ added: 1, skipped: 0 });
    mockHardDeleteTimecode.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('stops before writing when a name it needs could mean either timecode', async () => {
    importCsv(withoutGroupColumn);

    const message = await screen.findByText(/Import stopped/);
    expect(message.textContent).toContain('"Design"');
    // Named, so the user can see which two it could have been.
    expect(message.textContent).toContain('Acme');
    expect(message.textContent).toContain('Globex');
    expect(message.textContent).toContain('Nothing was imported');

    // Not a single write, so there is nothing to roll back either.
    expect(mockBulkAddManualEntries).not.toHaveBeenCalled();
    expect(mockAddTimecode).not.toHaveBeenCalled();
    expect(mockRestoreTimecode).not.toHaveBeenCalled();
  });

  it('files the row against the named group when the CSV says which', async () => {
    importCsv(withGroupColumn);

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(mockAddTimecode).not.toHaveBeenCalled();
    expect(mockBulkAddManualEntries.mock.calls[0][0]).toEqual([
      expect.objectContaining({ timecodeId: 'tc-globex-design' }),
    ]);
  });

  it('still resolves a name that is unique across groups without a Group column', async () => {
    mockTimecodes = [timecode('tc-acme-design', 'Design', 'g-acme')];

    importCsv(withoutGroupColumn);

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(mockAddTimecode).not.toHaveBeenCalled();
    expect(mockBulkAddManualEntries.mock.calls[0][0]).toEqual([
      expect.objectContaining({ timecodeId: 'tc-acme-design' }),
    ]);
  });

  it('creates the timecode under the group the CSV names, creating the group if it is new', async () => {
    mockTimecodes = [];
    mockGroups = [];
    mockAddGroup.mockResolvedValue({ id: 'g-created', name: 'Globex' });
    mockAddTimecode.mockResolvedValue({ id: 'tc-created', name: 'Design' });

    importCsv(withGroupColumn);

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(mockAddGroup).toHaveBeenCalledWith('Globex', expect.any(String));
    // Filed under the new group, so the next import of the same CSV resolves
    // against it rather than making a second, identically named timecode.
    expect(mockAddTimecode).toHaveBeenCalledWith('Design', undefined, 'g-created', undefined, { deferRefresh: true });
  });

  it('does not treat a name that only collides in another group as ambiguous', async () => {
    // Two "Design"s exist, but the row names one of them, so there is no guess
    // to make and the import proceeds.
    importCsv(withGroupColumn);

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    expect(screen.queryByText(/Import stopped/)).toBeNull();
  });
});

/**
 * A CSV import whose write failed after part of it had committed.
 *
 * `bulkAddManualEntries` writes in chunks, each its own transaction, so a
 * failure part way through leaves the earlier chunks on disk. The catch below
 * could not tell that from a run that wrote nothing, so it ran the rollback —
 * and rolling back hard-deletes the timecodes the import created, which
 * cascades to the entries filed under them. The rows that had just committed
 * were deleted, and the message shown alongside said none had been imported,
 * which the deletion had just made true.
 */
describe('CSV import that committed some rows before failing', () => {
  const INNER_MESSAGE = "Cannot read properties of undefined (reading 'foo')";

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEntries = [];
    mockTimecodes = [];
    mockDeletedTimecodes = [];
    mockGroups = [];
    mockAddTimecode.mockResolvedValue({ id: 'tc-new', name: 'Client Work' });
    mockHardDeleteTimecode.mockResolvedValue(true);
    mockBulkAddManualEntries.mockRejectedValue(new PartialImportError(48000, 50000));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not roll back the timecodes the committed rows point at', async () => {
    importCsv();

    await waitFor(() => expect(mockBulkAddManualEntries).toHaveBeenCalled());
    await screen.findByText(/48000/);
    // The one that mattered: hardDeleteTimecode cascades to entries, so this
    // running here would permanently delete the 48,000 rows that landed.
    expect(mockHardDeleteTimecode).not.toHaveBeenCalled();
  });

  it('tells the user how many rows are in their timesheet', async () => {
    importCsv();

    const message = await screen.findByText(/48000/);
    expect(message.textContent).toContain('48000');
    expect(message.textContent).toContain('50000');
    expect(message.textContent).toContain('in your timesheet');
  });

  it('never says nothing was imported when something was', async () => {
    importCsv();

    const message = await screen.findByText(/48000/);
    expect(message.textContent).not.toMatch(/No entries were imported/);
    expect(message.textContent).not.toMatch(/Failed to import any entries/);
    // The rollback is what produces every one of those sentences, and the
    // committed count is what turns it into a no-op — so none of its text can
    // be appended either.
    expect(message.textContent).not.toMatch(/removed/);
    expect(message.textContent).not.toMatch(/could not be removed/);
  });

  it('keeps the cause of the failure out of the message', async () => {
    // The cause comes from the storage layer and may be a bug's message. It is
    // logged in the provider; it is not shown.
    importCsv();

    const message = await screen.findByText(/48000/);
    expect(message.textContent).not.toContain(INNER_MESSAGE);
    expect(message.textContent).not.toContain('undefined');
  });
});
