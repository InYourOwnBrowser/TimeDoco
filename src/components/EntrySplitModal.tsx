import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';
import type { Entry } from '../types';
import { Modal } from './ui/Modal';
import { TimecodeSelector } from './TimecodeSelector';

interface EntrySplitModalProps {
  entry: Entry;
  onClose: () => void;
}

export const EntrySplitModal: React.FC<EntrySplitModalProps> = ({ entry, onClose }) => {
  const { splitEntry } = useTimeTracker();
  const [splitTime, setSplitTime] = useState('');
  const [newTimecodeId, setNewTimecodeId] = useState(entry.timecodeId);
  const [error, setError] = useState<string | null>(null);

  const start = new Date(entry.startTime).getTime();
  const end = entry.endTime ? new Date(entry.endTime).getTime() : start;
  const mid = new Date(start + (end - start) / 2);
  const initialSplitTime = entry.endTime ? format(mid, "yyyy-MM-dd'T'HH:mm:ss") : '';

  const isDirty = splitTime !== initialSplitTime || newTimecodeId !== entry.timecodeId;

  useEffect(() => {
    if (!entry.endTime) return;
    setSplitTime(initialSplitTime);
  }, [entry, initialSplitTime]);

  const handleSave = async () => {
    if (!entry.endTime) return;

    const split = new Date(splitTime);
    const start = new Date(entry.startTime);
    const end = new Date(entry.endTime);

    if (split <= start || split >= end) {
      setError('Split time must be strictly between start and end times.');
      return;
    }

    await splitEntry(entry.id, split.toISOString(), newTimecodeId);
    onClose();
  };

  return (
    <Modal onClose={onClose} isDirty={isDirty}>
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col border border-graphite/20 dark:border-white/20">
        <div className="flex justify-between items-center p-4 border-b border-graphite/20 dark:border-white/20">
          <h2 className="text-lg font-semibold text-graphite dark:text-stone">Split Time Entry</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            This entry runs from <strong>{format(parseISO(entry.startTime), 'HH:mm')}</strong> to <strong>{format(parseISO(entry.endTime!), 'HH:mm')}</strong>.
            Select a time to split it into two separate entries.
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Split Time</label>
            <input
              type="datetime-local"
              step="1"
              value={splitTime}
              onChange={(e) => { setSplitTime(e.target.value); setError(null); }}
              min={format(parseISO(entry.startTime), "yyyy-MM-dd'T'HH:mm:ss")}
              max={format(parseISO(entry.endTime!), "yyyy-MM-dd'T'HH:mm:ss")}
              className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus:border-signal focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Timecode for Second Part</label>
            <div className="w-full z-10 relative">
              <TimecodeSelector selectedId={newTimecodeId} onSelect={setNewTimecodeId} />
            </div>
          </div>

          {error && (
            <div className="flex items-center text-rust dark:text-orange-300 text-sm mt-2">
              <AlertCircle className="w-4 h-4 mr-1" />
              {error}
            </div>
          )}
        </div>

        <div className="bg-stone dark:bg-gray-800/30 px-4 py-3 sm:px-6 flex flex-wrap flex-row-reverse gap-2 border-t border-graphite/20 dark:border-white/20">
          <button
            onClick={handleSave}
            className="w-full inline-flex justify-center rounded-panel border border-transparent shadow-sm px-4 py-2 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal sm:w-auto sm:text-sm transition-colors"
          >
            Split Entry
          </button>
          <button
            onClick={onClose}
            className="mt-3 sm:mt-0 w-full inline-flex justify-center rounded-panel border border-graphite/20 dark:border-white/20 shadow-sm px-4 py-2 bg-white text-base font-medium text-graphite hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal sm:w-auto sm:text-sm dark:bg-graphite dark:text-stone dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
