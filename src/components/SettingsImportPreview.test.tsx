import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from './SettingsModal';

const mockImportData = vi.fn().mockResolvedValue(undefined);

// One timecode live, one in the trash. Both are in the database, so both are
// resolvable by a merge import.
const liveTimecodes = [
  { id: 'tc-live', name: 'Live', groupId: null, color: '#000', hourlyRate: null, archived: false, updatedAt: '2025-01-01T00:00:00.000Z' },
];
const trashedTimecodes = [
  { id: 'tc-trashed', name: 'Trashed', groupId: null, color: '#000', hourlyRate: null, archived: false, deletedAt: '2025-01-02T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    getBackupBlob: vi.fn(),
    importData: mockImportData,
    wipeAllData: vi.fn(),
    settings: { userLogoBase64: null, theme: 'system', allowConcurrentTimers: false },
    updateSettings: vi.fn().mockResolvedValue(true),
    bulkAddManualEntries: vi.fn(),
    addTimecode: vi.fn(),
    refreshData: vi.fn(),
    timecodes: liveTimecodes,
    get entries() { return localEntries; },
    deletedEntries: [],
    restoreEntry: vi.fn(),
    hardDeleteEntry: vi.fn(),
    deletedTimecodes: trashedTimecodes,
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

/**
 * The weak 32-bit hash a backup declares as `checksumAlgorithm: 'fallback'`.
 * The preview verifies the checksum now, so a fixture has to carry a real one.
 */
const fallbackChecksum = (payload: string): string => {
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
};

/** Wrap a payload with the checksum the verifier will recompute from it. */
const signed = (payload: Record<string, unknown>) =>
  JSON.stringify({ ...payload, checksum: fallbackChecksum(JSON.stringify(payload)) });

/** A backup whose only entry points at a timecode the file does not carry. */
const backupReferencing = (timecodeId: string) => signed({
  schemaVersion: 1,
  checksumAlgorithm: 'fallback',
  groups: [],
  timecodes: [],
  entries: [{
    id: 'e1',
    timecodeId,
    startTime: '2025-03-01T09:00:00.000Z',
    endTime: '2025-03-01T10:00:00.000Z',
    duration: 3600,
  }],
  settings: { id: 'user-settings' },
});

/** Local entries the merge-mode overlap pass weighs incoming rows against. */
let localEntries: any[] = [];

const selectBackup = (container: HTMLElement, content: string) => {
  const input = container.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  const file = new File([content], 'backup.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
  return input;
};

const openDataTab = () => fireEvent.click(screen.getByText('Data'));

describe('SettingsModal import preview matches the import it previews', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localEntries = [];
  });

  afterEach(cleanup);

  it('accepts a merge backup that references a trashed local timecode', async () => {
    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    // A trashed timecode is still in the database, so importData resolves it.
    // Validating the preview against live timecodes only rejected an import the
    // app would have accepted.
    selectBackup(container, backupReferencing('tc-trashed'));
    fireEvent.click(screen.getByText('Import Data'));

    await waitFor(() => {
      expect(screen.getByText(/Backup valid/i)).toBeTruthy();
    });
  });

  it('rejects a replace backup that only resolves against local timecodes', async () => {
    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    fireEvent.click(screen.getByLabelText(/Replace/i));

    // Nothing local survives a replace, so the reference cannot resolve. A
    // preview that always passed the local ids called this file importable and
    // then failed on the real import.
    selectBackup(container, backupReferencing('tc-live'));
    fireEvent.click(screen.getByText('Import Data'));

    await waitFor(() => {
      expect(screen.getByText(/is not in this backup/i)).toBeTruthy();
    });
  });

  it('rejects a backup whose checksum does not match, as the import does', async () => {
    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    // A hand-edited backup. The preview never computed a checksum, so this
    // showed a clean green preview and then failed on the real import.
    selectBackup(container, JSON.stringify({
      schemaVersion: 1,
      checksumAlgorithm: 'fallback',
      checksum: 'deadbeef',
      groups: [],
      timecodes: [],
      entries: [],
      settings: { id: 'user-settings' },
    }));
    fireEvent.click(screen.getByText('Import Data'));

    await waitFor(() => {
      expect(screen.getByText(/Checksum mismatch/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Backup valid/i)).toBeNull();
  });

  it('rejects a backup with no checksum at all', async () => {
    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    selectBackup(container, JSON.stringify({
      schemaVersion: 1,
      groups: [],
      timecodes: [],
      entries: [],
    }));
    fireEvent.click(screen.getByText('Import Data'));

    await waitFor(() => {
      expect(screen.getByText(/No checksum found/i)).toBeTruthy();
    });
  });

  it('rejects a schema version this build cannot migrate', async () => {
    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    // A backup from a future format. `migrateImportData` throws on this, so the
    // preview has to as well or it green-lights an import that cannot run.
    selectBackup(container, signed({
      schemaVersion: 99,
      checksumAlgorithm: 'fallback',
      groups: [],
      timecodes: [],
      entries: [],
      settings: { id: 'user-settings' },
    }));
    fireEvent.click(screen.getByText('Import Data'));

    await waitFor(() => {
      expect(screen.getByText(/Unsupported schema version/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Backup valid/i)).toBeNull();
  });

  it('counts the entries that will actually be imported, not the rows in the file', async () => {
    // One incoming entry sits inside the local one, so a merge drops it. The
    // preview used to report the raw file count and overstate what the user
    // would get.
    localEntries = [{
      id: 'local-1',
      timecodeId: 'tc-live',
      startTime: '2025-03-01T09:00:00.000Z',
      endTime: '2025-03-01T11:00:00.000Z',
      duration: 7200,
      note: '',
      tags: [],
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      editHistory: [],
      createdAt: '2025-03-01T09:00:00.000Z',
      updatedAt: '2025-03-01T09:00:00.000Z',
    }];

    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    selectBackup(container, signed({
      schemaVersion: 1,
      checksumAlgorithm: 'fallback',
      groups: [],
      timecodes: [],
      entries: [
        { id: 'in-clash', timecodeId: 'tc-live', startTime: '2025-03-01T10:00:00.000Z', endTime: '2025-03-01T10:30:00.000Z', duration: 1800 },
        { id: 'in-clear', timecodeId: 'tc-live', startTime: '2025-03-01T13:00:00.000Z', endTime: '2025-03-01T14:00:00.000Z', duration: 3600 },
      ],
      settings: { id: 'user-settings' },
    }));
    fireEvent.click(screen.getByText('Import Data'));

    await waitFor(() => expect(screen.getByText(/Backup valid/i)).toBeTruthy());
    expect(screen.getByText('1 entries')).toBeTruthy();
    expect(screen.getByText(/1 entry will be skipped/i)).toBeTruthy();
  });

  it('drops a preview when the mode changes underneath it', async () => {
    const { container } = render(<SettingsModal onClose={vi.fn()} />);
    openDataTab();

    selectBackup(container, backupReferencing('tc-live'));
    fireEvent.click(screen.getByText('Import Data'));
    await waitFor(() => expect(screen.getByText(/Backup valid/i)).toBeTruthy());

    // The preview was validated for merge; it says nothing about replace.
    fireEvent.click(screen.getByLabelText(/Replace/i));
    expect(screen.queryByText(/Backup valid/i)).toBeNull();
    expect(mockImportData).not.toHaveBeenCalled();
  });
});
