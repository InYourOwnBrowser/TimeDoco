import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';
import type { Entry } from '../types';
import { Modal } from './ui/Modal';

interface EntrySplitModalProps {
  entry: Entry;
  onClose: () => void;
}

export const EntrySplitModal: React.FC<EntrySplitModalProps> = ({ entry, onClose }) => {
  const { splitEntry, timecodes } = useTimeTracker();
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
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Split Time Entry</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            This entry runs from <strong>{format(parseISO(entry.startTime), 'HH:mm')}</strong> to <strong>{format(parseISO(entry.endTime!), 'HH:mm')}</strong>.
            Select a time to split it into two separate entries.
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Split Time</label>
            <input
              type="datetime-local"
              step="1"
              value={splitTime}
              onChange={(e) => { setSplitTime(e.target.value); setError(null); }}
              min={format(parseISO(entry.startTime), "yyyy-MM-dd'T'HH:mm:ss")}
              max={format(parseISO(entry.endTime!), "yyyy-MM-dd'T'HH:mm:ss")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timecode for Second Part</label>
            <select
              value={newTimecodeId}
              onChange={(e) => setNewTimecodeId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              {timecodes.filter(tc => !tc.archived || tc.id === entry.timecodeId).map(tc => (
                <option key={tc.id} value={tc.id}>
                  {tc.name} {tc.archived ? '(archived)' : ''}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="flex items-center text-red-600 text-sm mt-2">
              <AlertCircle className="w-4 h-4 mr-1" />
              {error}
            </div>
          )}
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 sm:px-6 flex flex-row-reverse">
          <button
            onClick={handleSave}
            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Split Entry
          </button>
          <button
            onClick={onClose}
            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
