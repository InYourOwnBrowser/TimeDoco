import React, { useState, useCallback } from 'react';
import { SaveAsModal, sanitizeFilename } from '../components/ui/SaveAsModal';

export type DownloadSource = Blob | (() => Blob | Promise<Blob>);

export interface UseNamedDownloadReturn {
  triggerDownload: (
    source: DownloadSource,
    defaultFilename: string,
    extension: string,
    onSuccess?: () => void
  ) => void;
  SaveAsDialog: React.FC;
}

export function useNamedDownload(): UseNamedDownloadReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<DownloadSource | null>(null);
  const [defaultFilename, setDefaultFilename] = useState('');
  const [extension, setExtension] = useState('');
  const [onSuccessCallback, setOnSuccessCallback] = useState<(() => void) | null>(null);

  const triggerDownload = useCallback((
    src: DownloadSource,
    defFilename: string,
    ext: string,
    onSuccess?: () => void
  ) => {
    setSource(() => src);
    setDefaultFilename(defFilename);
    setExtension(ext);
    setOnSuccessCallback(() => onSuccess || null);
    setIsOpen(true);
  }, []);

  const handleConfirm = useCallback(async (chosenName: string) => {
    if (!source) return;

    try {
      const blob = typeof source === 'function' ? await source() : source;
      const cleanName = sanitizeFilename(chosenName) || defaultFilename;
      const cleanExt = extension.startsWith('.') ? extension.slice(1) : extension;
      const fullFilename = `${cleanName}.${cleanExt}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoking synchronously can cancel a large download in Firefox before
      // the browser has finished reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      if (onSuccessCallback) {
        onSuccessCallback();
      }
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsOpen(false);
      setSource(null);
    }
  }, [source, defaultFilename, extension, onSuccessCallback]);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setSource(null);
  }, []);

  const SaveAsDialog: React.FC = useCallback(() => {
    return (
      <SaveAsModal
        isOpen={isOpen}
        defaultFilename={defaultFilename}
        extension={extension}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  }, [isOpen, defaultFilename, extension, handleConfirm, handleCancel]);

  return {
    triggerDownload,
    SaveAsDialog,
  };
}
