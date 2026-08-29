import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNamedDownload } from './useNamedDownload';
import { ToastProvider } from '../context/ToastContext';

const InnerComponent: React.FC<{
  source: Blob | (() => Blob | Promise<Blob>);
  defaultName: string;
  extension: string;
  onSuccess?: () => void;
}> = ({ source, defaultName, extension, onSuccess }) => {
  const { triggerDownload, SaveAsDialog } = useNamedDownload();

  return (
    <div>
      <button onClick={() => triggerDownload(source, defaultName, extension, onSuccess)}>
        Trigger
      </button>
      <SaveAsDialog />
    </div>
  );
};

const TestComponent: React.FC<{
  source: Blob | (() => Blob | Promise<Blob>);
  defaultName: string;
  extension: string;
  onSuccess?: () => void;
}> = (props) => {
  return (
    <ToastProvider>
      <InnerComponent {...props} />
    </ToastProvider>
  );
};

describe('useNamedDownload', () => {
  let createObjectURLSpy: any;
  let revokeObjectURLSpy: any;

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers download with chosen filename on confirmation', async () => {
    // Installed before the download runs so the deferred revoke lands on a
    // timer this test controls; shouldAdvanceTime keeps waitFor working.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const onSuccess = vi.fn();
    const testBlob = new Blob(['hello world'], { type: 'text/plain' });

    render(
      <TestComponent
        source={testBlob}
        defaultName="my-summary-report"
        extension="csv"
        onSuccess={onSuccess}
      />
    );

    fireEvent.click(screen.getByText('Trigger'));

    expect(screen.getByText('Save File As')).not.toBeNull();
    const input = screen.getByDisplayValue('my-summary-report');
    fireEvent.change(input, { target: { value: 'custom-summary' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalledWith(testBlob);
      expect(clickSpy).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });

    // The object URL is revoked on a timer, not synchronously, so a large
    // download is not cancelled mid-transfer in Firefox.
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    vi.useRealTimers();

    clickSpy.mockRestore();
  });

  it('supports async getter function sources', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const asyncGetter = vi.fn().mockResolvedValue(new Blob(['pdf content'], { type: 'application/pdf' }));

    render(
      <TestComponent
        source={asyncGetter}
        defaultName="time-report-2025"
        extension="pdf"
      />
    );

    fireEvent.click(screen.getByText('Trigger'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(asyncGetter).toHaveBeenCalled();
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    clickSpy.mockRestore();
  });
});
