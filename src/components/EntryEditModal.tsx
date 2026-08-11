import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';
import type { Entry } from '../types';

interface EntryEditModalProps {
  entry: Entry;
  onClose: () => void;
}

export const EntryEditModal: React.FC<EntryEditModalProps> = ({ entry, onClose }) => {
  const { updateEntry, timecodes, entries } = useTimeTracker();
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timecodeId, setTimecodeId] = useState(entry.timecodeId);
  const [note, setNote] = useState(entry.note);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    // Initialize formats for datetime-local inputs
    setStartTime(format(parseISO(entry.startTime), "yyyy-MM-dd'T'HH:mm"));
    if (entry.endTime) {
      setEndTime(format(parseISO(entry.endTime), "yyyy-MM-dd'T'HH:mm"));
    }
  }, [entry]);

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

    const overlapping = entries.find(e => {
      if (e.id === entry.id || !e.endTime) return false;
      const eStart = new Date(e.startTime);
      const eEnd = new Date(e.endTime);

      // Check overlap: newStart < eEnd AND newEnd > eStart
      return start < eEnd && end > eStart;
    });

    if (overlapping) {
      setWarning('Warning: This entry overlaps with an existing time entry.');
    } else {
      setWarning(null);
    }
  }, [startTime, endTime, entries, entry.id]);

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

    const updates: Partial<Entry> = {
      timecodeId,
      note,
      startTime: start.toISOString(),
    };

    if (end) {
      updates.endTime = end.toISOString();
    }

    await updateEntry(entry.id, updates);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit Time Entry</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timecode</label>
            <select
              value={timecodeId}
              onChange={(e) => setTimecodeId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="" disabled>Select a timecode</option>
              {timecodes.filter(tc => !tc.archived).map(tc => (
                <option key={tc.id} value={tc.id}>{tc.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => { setStartTime(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time {entry.isRunning && '(Optional)'}</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => { setEndTime(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>

          {error && (
            <div className="flex items-center text-red-600 text-sm mt-2">
              <AlertCircle className="w-4 h-4 mr-1" />
              {error}
            </div>
          )}

          {warning && (
            <div className="flex items-center text-yellow-600 text-sm mt-2 bg-yellow-50 p-2 rounded">
              <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
              {warning}
            </div>
          )}
        </div>

        <div className="bg-gray-50 px-4 py-3 sm:px-6 flex flex-row-reverse">
          <button
            onClick={handleSave}
            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
