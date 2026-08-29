import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsModal } from './SettingsModal';

const mockUpdateSettings = vi.fn().mockResolvedValue(true);
const mockAddToast = vi.fn();
const mockAddTimecode = vi.fn();
const mockBulkAddManualEntries = vi.fn().mockResolvedValue({ added: 1, skipped: 0 });
let mockEntries: any[] = [];

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    exportData: vi.fn(),
    importData: vi.fn(),
    refreshData: vi.fn().mockResolvedValue(undefined),
    settings: {
      userLogoBase64: null,
      theme: 'system',
      allowConcurrentTimers: false,
    },
    updateSettings: mockUpdateSettings,
    bulkAddManualEntries: mockBulkAddManualEntries,
    addTimecode: mockAddTimecode,
    entries: mockEntries,
    timecodes: [],
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
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('SettingsModal Logo Upload Validation', () => {
  const renderComponent = (onClose = vi.fn()) => {
    return render(<SettingsModal onClose={onClose} />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects files with non-image MIME types (e.g. text/html)', () => {
    const { container } = renderComponent();

    const fileInput = container.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const invalidFile = new File(['<script>alert(1)</script>'], 'malicious.html', { type: 'text/html' });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(mockAddToast).toHaveBeenCalledWith(
      'Invalid file type — please upload a PNG, JPEG, or WEBP image.',
      'error'
    );
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('rejects files exceeding MAX_LOGO_BYTES (1MB)', () => {
    const { container } = renderComponent();

    const fileInput = container.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const largeBlob = 'a'.repeat(1024 * 1024 + 1);
    const oversizedFile = new File([largeBlob], 'large.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(mockAddToast).toHaveBeenCalledWith(
      'Logo image is too large — please use a file under 1MB.',
      'error'
    );
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('accepts valid PNG image and updates settings with Base64 data', async () => {
    const originalImage = global.Image;
    global.Image = class {
      onload: () => void = () => {};
      onerror: () => void = () => {};
      width = 100;
      height = 100;
      _src = '';
      set src(val: string) {
        this._src = val;
        setTimeout(() => this.onload(), 0);
      }
      get src() {
        return this._src;
      }
    } as any;

    const { container } = renderComponent();

    const fileInput = container.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const validFile = new File(['fake-png-content'], 'logo.png', { type: 'image/png' });

    const readAsDataURLSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: 'data:image/png;base64,ZmFrZS1wbmctY29udGVudA==' });
      if (this.onload) {
        this.onload({} as ProgressEvent<FileReader>);
      }
    });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        userLogoBase64: 'data:image/png;base64,ZmFrZS1wbmctY29udGVudA==',
      });
    });

    readAsDataURLSpy.mockRestore();
    global.Image = originalImage;
  });

  it('updates reportFooterText in settings when textarea changes', () => {
    const { getByPlaceholderText } = renderComponent();

    const textarea = getByPlaceholderText('Default report footer — payment details, terms, etc.') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea, { target: { value: 'Payment due in 30 days.' } });

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      reportFooterText: 'Payment due in 30 days.',
    });
  });

  it('does not create timecode when CSV row date is invalid', async () => {
    const { getByRole, container } = renderComponent();

    // Switch to Data tab
    fireEvent.click(getByRole('button', { name: 'Data' }));

    const csvFileInput = container.querySelector('input[type="file"][accept=".csv"]') as HTMLInputElement;
    expect(csvFileInput).not.toBeNull();

    const invalidCsvContent = 'Start Time,End Time,Timecode,Note\ninvalid-start,invalid-end,OrphanTimecode,Test\n';
    const csvFile = new File([invalidCsvContent], 'invalid.csv', { type: 'text/csv' });

    fireEvent.change(csvFileInput, { target: { files: [csvFile] } });

    const importBtn = getByRole('button', { name: /import csv/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockAddTimecode).not.toHaveBeenCalled();
    });
  });

  it('does not create orphan timecode when CSV row overlaps existing entry (M2)', async () => {
    mockEntries = [
      {
        id: 'existing-1',
        timecodeId: 'tc-existing',
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T11:00:00.000Z',
        duration: 3600,
      },
    ];

    const { getByRole, container } = renderComponent();
    fireEvent.click(getByRole('button', { name: 'Data' }));

    const csvFileInput = container.querySelector('input[type="file"][accept=".csv"]') as HTMLInputElement;
    const overlappingCsv = 'Start Time,End Time,Timecode,Note\n2024-01-01T10:30:00Z,2024-01-01T11:30:00Z,NewCollidingTimecode,Test\n';
    const csvFile = new File([overlappingCsv], 'overlap.csv', { type: 'text/csv' });

    fireEvent.change(csvFileInput, { target: { files: [csvFile] } });
    fireEvent.click(getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(mockAddTimecode).not.toHaveBeenCalled();
      expect(mockBulkAddManualEntries).not.toHaveBeenCalled();
    });
  });

  it('resets isProcessing even if bulkAddManualEntries rejects (M1)', async () => {
    mockBulkAddManualEntries.mockRejectedValueOnce(new Error('Transaction aborted'));
    mockAddTimecode.mockResolvedValueOnce({ id: 'tc-new', name: 'ValidCode' });

    const { getByRole, container } = renderComponent();
    fireEvent.click(getByRole('button', { name: 'Data' }));

    const csvFileInput = container.querySelector('input[type="file"][accept=".csv"]') as HTMLInputElement;
    const validCsv = 'Start Time,End Time,Timecode,Note\n2024-01-01T12:00:00Z,2024-01-01T13:00:00Z,ValidCode,Test\n';
    const csvFile = new File([validCsv], 'valid.csv', { type: 'text/csv' });

    fireEvent.change(csvFileInput, { target: { files: [csvFile] } });
    const importBtn = getByRole('button', { name: /import csv/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect((importBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('correctly uses DMY date format selection (M3)', async () => {
    mockAddTimecode.mockResolvedValueOnce({ id: 'tc-dmy', name: 'DMYCode' });
    const { getByRole, container } = renderComponent();
    fireEvent.click(getByRole('button', { name: 'Data' }));

    // Select DMY date format
    const select = container.querySelector('select[class*="border"]') as HTMLSelectElement;
    if (select) {
      fireEvent.change(select, { target: { value: 'dmy' } });
    }

    const csvFileInput = container.querySelector('input[type="file"][accept=".csv"]') as HTMLInputElement;
    // 01/02/2024 in DMY is 1st February 2024
    const dmyCsv = 'Start Time,End Time,Timecode,Note\n01/02/2024 10:00:00,01/02/2024 11:00:00,DMYCode,Test\n';
    const csvFile = new File([dmyCsv], 'dmy.csv', { type: 'text/csv' });

    fireEvent.change(csvFileInput, { target: { files: [csvFile] } });
    fireEvent.click(getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(mockBulkAddManualEntries).toHaveBeenCalledWith([
        expect.objectContaining({
          startTime: '2024-02-01T10:00:00.000Z',
          endTime: '2024-02-01T11:00:00.000Z',
        }),
      ]);
    });
  });
});
