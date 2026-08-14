import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO, differenceInSeconds } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';
import { checkOverlap } from '../utils/timeUtils';
import type { Entry } from '../types';
import { Modal } from './ui/Modal';
import { useToast } from '../context/ToastContext';
import { TimecodeSelector } from './TimecodeSelector';

interface EntryEditModalProps {
  entry: Entry;
  onClose: () => void;
}

export const EntryEditModal: React.FC<EntryEditModalProps> = ({ entry, onClose }) => {
  const { updateEntry, entries, settings } = useTimeTracker();
  const { addToast } = useToast();
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timecodeId, setTimecodeId] = useState(entry.timecodeId);
  const [note, setNote] = useState(entry.note);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const initialStartTime = format(parseISO(entry.startTime), "yyyy-MM-dd'T'HH:mm:ss");
  const initialEndTime = entry.endTime ? format(parseISO(entry.endTime), "yyyy-MM-dd'T'HH:mm:ss") : '';

  const isDirty = startTime !== initialStartTime ||
    endTime !== initialEndTime ||
    timecodeId !== entry.timecodeId ||
    note !== entry.note;

  useEffect(() => {
    // Initialize formats for datetime-local inputs
    setStartTime(initialStartTime);
    if (entry.endTime) {
      setEndTime(initialEndTime);
    }
  }, [entry, initialStartTime, initialEndTime]);

  useEffect(() => {
    if (!startTime || !endTime) {
      setWarning(null);
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      setWarning(null);
      return;
    }

    const overlapping = checkOverlap(start, end, entries, entry.id, timecodeId, settings?.allowConcurrentTimers);

    if (overlapping) {
      setWarning('Warning: This entry overlaps with an existing time entry.');
    } else if (differenceInSeconds(end, start) > 12 * 3600) {
      setWarning('Warning: This entry duration exceeds 12 hours.');
    } else {
      setWarning(null);
    }
  }, [startTime, endTime, entries, entry.id, timecodeId, settings?.allowConcurrentTimers]);

  const handleSave = async () => {
    setError(null);

    if (!startTime) {
      setError('Start time is required.');
      return;
    }

    const start = new Date(startTime);
    let end: Date | undefined;

    if (endTime) {
      end = new Date(endTime);
      if (end <= start) {
        setError('End time must be after start time.');
        return;
      }
    } else if (!entry.isRunning) {
        setError('End time is required for completed entries.');
        return;
    }

    if (warning) {
      if (!window.confirm(`${warning}\n\nSave anyway?`)) {
        return;
      }
    }

    const updates: Partial<Entry> = {
      timecodeId,
      note,
      startTime: start.toISOString(),
    };

    if (end) {
      updates.endTime = end.toISOString();
    }

    await updateEntry(entry.id, updates);
    addToast('Changes saved', 'success');
    onClose();
  };

  return (
    <Modal onClose={onClose} isDirty={isDirty}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Time Entry</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timecode</label>
            <div className="w-full z-10 relative">
              <TimecodeSelector selectedId={timecodeId} onSelect={setTimecodeId} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Time</label>
              <input
                type="datetime-local"
                step="1"
                value={startTime}
                onChange={(e) => { setStartTime(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Time {entry.isRunning && '(Optional)'}</label>
              <input
                type="datetime-local"
                step="1"
                value={endTime}
                onChange={(e) => { setEndTime(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>

          {error && (
            <div className="flex items-center text-red-600 text-sm mt-2">
              <AlertCircle className="w-4 h-4 mr-1" />
              {error}
            </div>
          )}

          {warning && (
            <div className="flex items-center text-yellow-600 dark:text-yellow-200 text-sm mt-2 bg-yellow-50 dark:bg-yellow-900/50 p-2 rounded">
              <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
              {warning}
            </div>
          )}
        </div>

        {entry.editHistory && entry.editHistory.length > 0 && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Edit History</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {entry.editHistory.map((change, idx) => (
                <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{change.field}</span> changed at {format(new Date(change.editedAt), 'MMM d, h:mm a')}:
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="text-red-500 line-through truncate" title={String(change.oldValue)}>{String(change.oldValue) || '(empty)'}</div>
                    <div className="text-green-600 dark:text-green-400 truncate" title={String(change.newValue)}>{String(change.newValue) || '(empty)'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 sm:px-6 flex flex-row-reverse">
          <button
            onClick={handleSave}
            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Save Changes
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
