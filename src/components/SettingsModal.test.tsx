import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsModal } from './SettingsModal';

const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);
const mockAddToast = vi.fn();

vi.mock('../context/TimeTrackerContext', () => ({
  useTimeTracker: () => ({
    exportData: vi.fn(),
    importData: vi.fn(),
    settings: {
      userLogoBase64: null,
      theme: 'system',
      allowConcurrentTimers: false,
    },
    updateSettings: mockUpdateSettings,
    bulkAddManualEntries: vi.fn(),
    addTimecode: vi.fn(),
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
  });
});
