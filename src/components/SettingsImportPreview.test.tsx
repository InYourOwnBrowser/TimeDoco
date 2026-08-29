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
    updateSettings: vi.fn(),
    bulkAddManualEntries: vi.fn(),
    addTimecode: vi.fn(),
    refreshData: vi.fn(),
    timecodes: liveTimecodes,
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

/** A backup whose only entry points at a timecode the file does not carry. */
const backupReferencing = (timecodeId: string) => JSON.stringify({
  schemaVersion: 1,
  checksum: 'not-checked-at-preview-time',
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
