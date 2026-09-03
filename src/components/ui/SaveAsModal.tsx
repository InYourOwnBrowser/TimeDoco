import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { X, Download } from 'lucide-react';

/** Windows refuses these as filenames whatever the extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const sanitizeFilename = (name: string): string => {
  const stripped = name
    .replace(/[/\\:*?"<>|]/g, '')
    // Control characters are legal in some filesystems and confusing in all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    // Leading dots hide the file on Unix; runs of dots read as a path segment
    // even with the separators above already gone.
    .replace(/^\.+/, '')
    .replace(/\.{2,}/g, '.')
    .trim()
    // Windows silently drops a trailing dot or space, so two names that differ
    // only there collide.
    .replace(/[. ]+$/, '');

  return RESERVED_NAMES.test(stripped) ? `${stripped}-file` : stripped;
};

export interface SaveAsModalProps {
  isOpen: boolean;
  defaultFilename: string;
  extension: string;
  onConfirm: (filename: string) => void;
  onCancel: () => void;
}

export const SaveAsModal: React.FC<SaveAsModalProps> = ({
  isOpen,
  defaultFilename,
  extension,
  onConfirm,
  onCancel,
}) => {
  const [filename, setFilename] = useState(defaultFilename);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFilename(defaultFilename);
      setError(null);
    }
  }, [isOpen, defaultFilename]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = sanitizeFilename(filename);
    if (!clean) {
      setError('Please enter a valid filename.');
      return;
    }
    onConfirm(clean);
  };

  const cleanExtension = extension.startsWith('.') ? extension.slice(1) : extension;

  return (
    <Modal onClose={onCancel}>
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-graphite/20 dark:border-white/20">
        <div className="flex justify-between items-center p-4 border-b border-graphite/20 dark:border-white/20">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-signal-dim dark:text-signal" />
            <h2 className="text-lg font-semibold text-graphite dark:text-stone">Save File As</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">
              Filename
            </label>
            <div className="flex rounded-md shadow-sm border border-graphite/20 dark:border-white/20 overflow-hidden focus-within:ring-2 focus-within:ring-signal">
              <input
                type="text"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  if (error) setError(null);
                }}
                autoFocus
                placeholder="Enter filename"
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-white dark:bg-graphite text-graphite dark:text-stone focus:outline-none"
              />
              <span className="inline-flex items-center px-3 bg-stone dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm border-l border-graphite/20 dark:border-white/20 select-none font-mono">
                .{cleanExtension}
              </span>
            </div>
            {error && <p className="text-xs text-rust dark:text-orange-300 mt-1">{error}</p>}
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-panel border border-graphite/20 dark:border-white/20 bg-white dark:bg-graphite text-graphite dark:text-stone text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-panel bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink text-sm font-medium transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
