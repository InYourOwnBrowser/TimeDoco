import React, { useState, useCallback, useRef } from 'react';
import { SaveAsModal, sanitizeFilename } from '../components/ui/SaveAsModal';
import { useToast } from '../context/ToastContext';

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
  const { addToast } = useToast();

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

    let succeeded = false;
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

      succeeded = true;
    } catch (err) {
      console.error('Download failed:', err);
      addToast('Download failed. Please try again.', 'error');
    } finally {
      setIsOpen(false);
      setSource(null);
    }

    // Outside the try: callers use this to record that the download happened,
    // and a callback that throws must not be reported back to the user as a
    // failed download.
    if (succeeded && onSuccessCallback) {
      try {
        onSuccessCallback();
      } catch (err) {
        console.error('Download onSuccess failed:', err);
      }
    }
  }, [source, defaultFilename, extension, onSuccessCallback, addToast]);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setSource(null);
  }, []);

  // The dialog's live props are read through a ref so that SaveAsDialog keeps a
  // stable function identity. A component whose identity changes is a different
  // component type to React, which unmounts and remounts SaveAsModal and throws
  // away whatever filename the user had typed. The owning component re-renders
  // whenever this hook's state changes, so the ref is always read fresh.
  const dialogPropsRef = useRef({ isOpen, defaultFilename, extension, handleConfirm, handleCancel });
  dialogPropsRef.current = { isOpen, defaultFilename, extension, handleConfirm, handleCancel };

  const SaveAsDialog: React.FC = useCallback(() => {
    const props = dialogPropsRef.current;
    return (
      <SaveAsModal
        isOpen={props.isOpen}
        defaultFilename={props.defaultFilename}
        extension={props.extension}
        onConfirm={props.handleConfirm}
        onCancel={props.handleCancel}
      />
    );
  }, []);

  return {
    triggerDownload,
    SaveAsDialog,
  };
}
